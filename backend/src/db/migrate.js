#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   node src/db/migrate.js            apply any migration not yet recorded
 *   node src/db/migrate.js --fresh    drop every table in the database first
 *
 * Migrations are plain .sql files in ./migrations, applied in filename order and
 * recorded in `schema_migration`. There is no "down" — with no production data
 * (DECISIONS.md, 2026-08-12) `--fresh` is the rollback.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'dms',
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
  });
}

async function dropEverything(conn) {
  const db = process.env.DB_NAME || 'dms';
  const [views] = await conn.query(
    `SELECT TABLE_NAME AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`, [db]
  );
  const [tables] = await conn.query(
    `SELECT TABLE_NAME AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`, [db]
  );
  if (!views.length && !tables.length) {
    console.log('  (nothing to drop)');
    return;
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const v of views) await conn.query(`DROP VIEW IF EXISTS \`${v.n}\``);
  for (const t of tables) await conn.query(`DROP TABLE IF EXISTS \`${t.n}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`  dropped ${tables.length} table(s), ${views.length} view(s)`);
}

async function main() {
  const fresh = process.argv.includes('--fresh');
  const conn = await connect();

  try {
    if (fresh) {
      console.log('--fresh: dropping existing schema');
      await dropEverything(conn);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`schema_migration\` (
        \`filename\`   VARCHAR(255) NOT NULL PRIMARY KEY,
        \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await conn.query('SELECT `filename` FROM `schema_migration`');
    const applied = new Set(rows.map((r) => r.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const pending = files.filter((f) => !applied.has(f));

    if (!pending.length) {
      console.log('Schema is up to date.');
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`applying ${file} ... `);
      await conn.query(sql);
      await conn.query('INSERT INTO `schema_migration` (`filename`) VALUES (?)', [file]);
      console.log('ok');
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
