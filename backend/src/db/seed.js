#!/usr/bin/env node
/**
 * Seed runner.
 *
 *   node src/db/seed.js                 reference data + development fixtures
 *   node src/db/seed.js --no-fixtures   reference data only (for a real deployment)
 *
 * Idempotent by truncation: it clears the tables it owns and re-inserts, so it
 * can be run repeatedly during development. It refuses to run if any project
 * exists that it did not create, so it cannot wipe real work by accident.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mysql = require('mysql2/promise');
const { seedTaxonomy } = require('./seeds/taxonomy');
const { seedReference } = require('./seeds/reference');
const { seedFixtures } = require('./seeds/fixtures');

// Child-first, so foreign keys never block a delete.
const TABLES_IN_DELETE_ORDER = [
  'project_tag', 'project_event', 'project_attachment', 'project_attendance',
  'project_indicator', 'project_activity', 'project_problem', 'project_type',
  'project_location', 'project_rationale', 'project_objective',
  'disbursement', 'budget_line', 'budget_plan_line', 'agency_allocation',
  'project',
  'membership', 'login_attempt', 'person',
  'phase_transition', 'phase', 'tag', 'tag_set',
  'club', 'club_group', 'work_group', 'agency', 'division', 'campus',
  'award_category',
];

async function main() {
  const withFixtures = !process.argv.includes('--no-fixtures');
  const force = process.argv.includes('--force');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'dms',
    charset: 'utf8mb4_unicode_ci',
  });

  const log = (msg) => console.log(msg);

  try {
    const [[{ n }]] = await conn.query(`
      SELECT COUNT(*) AS n FROM project
       WHERE owner_person_id NOT IN (
         SELECT id FROM person WHERE id_student LIKE 'fixture.%'
       )`).catch(() => [[{ n: 0 }]]);

    if (n > 0 && !force) {
      console.error(
        `Refusing to seed: ${n} project(s) exist that the fixtures did not create.\n` +
        `Re-run with --force if you really mean to delete them.`
      );
      process.exit(1);
    }

    await conn.beginTransaction();

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of TABLES_IN_DELETE_ORDER) {
      await conn.query(`DELETE FROM \`${t}\``);
      await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`).catch(() => {});
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    log('organisation (setCode.json)');
    await seedTaxonomy(conn, log);

    log('reference (phases, transitions, tags)');
    await seedReference(conn, log);

    if (withFixtures) {
      log('fixtures');
      await seedFixtures(conn, log);
    } else {
      log('fixtures skipped (--no-fixtures)');
    }

    await conn.commit();
    log('\nSeed complete.');
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
