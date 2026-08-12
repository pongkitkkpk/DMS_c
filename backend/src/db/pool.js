const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mysql = require('mysql2/promise');

// One pool for the process. `mysql2` replaces the old `mysql@2.18` driver, which
// is unmaintained and cannot negotiate MySQL 8's default auth plugin. Same API
// plus promises — see DMS_REBUILD_STRATEGY.md, "Stack".
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'dms',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4_unicode_ci',
  // Keep DECIMAL as a string rather than letting JS float-round money.
  decimalNumbers: false,
  timezone: 'Z',
});

// XAMPP/MariaDB ships without STRICT_TRANS_TABLES, so a too-long string is
// truncated and a bad number becomes a warning instead of an error — exactly the
// silent-corruption class this rebuild exists to remove. Force strict mode on
// every connection rather than relying on server config we do not control.
pool.on('connection', (conn) => {
  conn.query(
    "SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ZERO_DATE,NO_ZERO_IN_DATE')"
  );
});

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Every write that touches more than one table goes through this. The old system
 * fired independent unawaited queries and could leave the phase changed but the
 * log unwritten — see docs/business-rules.md, "Transitions".
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, transaction };
