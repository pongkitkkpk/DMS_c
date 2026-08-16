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
  /**
   * Dates and timestamps come back as the strings the columns hold, and are
   * never turned into a JS `Date` on the way out.
   *
   * This used to be `timezone: 'Z'`, which told the driver that every DATETIME
   * in the database was UTC. It is not: MariaDB here runs on the system
   * timezone and `NOW()` writes Thai wall-clock time, so a row written at
   * 00:03 came back as the instant `2026-08-17T00:03:18.000Z` and every screen
   * that rendered it as a local time printed **07:03** — seven hours after it
   * happened, on the timeline whose whole job is to say when things happened.
   *
   * A `DATETIME` column carries no timezone, so the honest thing is to stop
   * claiming one. `'2026-08-17 00:03:18'` is what the column says and what the
   * clock on the wall said; the frontend reads the parts and never asks a
   * `Date` to guess an offset.
   */
  dateStrings: true,
  // Only for writes now — a JS `Date` parameter is stored as local wall-clock,
  // which is what `NOW()` and `CURRENT_TIMESTAMP` in the same tables write.
  timezone: 'local',
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
 * Contention, not corruption: InnoDB resolves a deadlock by killing one
 * transaction and telling it to start over, and two clients racing for the next
 * sequence number in the same club-year is a normal way to reach one. The unique
 * keys still decide the outcome — this only decides whether the loser is
 * retried or handed to the user.
 */
const TRANSIENT_ERRORS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY']);

const isTransient = (err) => TRANSIENT_ERRORS.has(err && err.code);

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Every write that touches more than one table goes through this. The old system
 * fired independent unawaited queries and could leave the phase changed but the
 * log unwritten — see docs/business-rules.md, "Transitions".
 *
 * @param {function(import('mysql2/promise').PoolConnection): Promise<*>} fn
 * @param {{retries?: number}} [options] retry count for transient contention.
 *        Only for transactions that are pure database work and safe to re-run
 *        from the top — the numbering paths re-read their maximum on each
 *        attempt, so a retry issues the next number rather than repeating one.
 */
async function transaction(fn, { retries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (attempt >= retries || !isTransient(err)) throw err;
      // Brief, growing backoff so the retries do not simply collide again.
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    } finally {
      conn.release();
    }
  }
}

module.exports = { pool, transaction, isTransient };
