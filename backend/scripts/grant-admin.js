#!/usr/bin/env node
/**
 * Break-glass: give somebody `ADMIN` for an academic year, from the console.
 *
 *   npm run grant:admin -- --user fixture.admin --year 2568
 *
 * **Why this exists.** Three decisions that are each right on their own combine
 * into one way to lock the system permanently:
 *
 * 1. a role is a `membership`, and a membership belongs to one academic year;
 * 2. the token carries no role — `requireAuth` resolves it per request against
 *    `academicYearService.current()`;
 * 3. the `.env` admin fallback supplies identity only and cannot mint a role.
 *
 * So the moment `ACADEMIC_YEAR` moves to a year nobody has been prepared for,
 * *every* user resolves to `role: null`, including the Admin — and granting a
 * role needs an Admin. There is no route back in through the API. Verified by
 * rolling a server forward with nothing prepared: `POST /memberships` and
 * `PUT /allocations` answer 403 for every fixture account.
 *
 * The right answer is to prepare the year before rolling into it, which is what
 * the readiness banner on the dashboard is for. This is the answer when that did
 * not happen.
 *
 * **This is not a backdoor.** It needs shell access to the server and the
 * database credentials — someone holding those can already write the row by
 * hand. What it adds is doing it correctly: the same `membership_event` record
 * every API grant writes, so a console grant is as visible as any other, and a
 * refusal rather than a duplicate if the role is already there.
 *
 * A grant made here is recorded with the recipient as its own actor. That is
 * the honest description — nobody in the system authorised it — and it is the
 * signature to look for in the log: `person_id = actor_person_id` means the
 * console, not the screen.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mysql = require('mysql2/promise');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2);
    args[key] = inline !== undefined ? inline : argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const idStudent = args.user;
  const year = Number(args.year);

  if (!idStudent || !Number.isInteger(year)) {
    console.error('usage: npm run grant:admin -- --user <id_student> --year <academic year>');
    console.error('   eg: npm run grant:admin -- --user fixture.admin --year 2568');
    process.exit(2);
  }
  if (year < 2400 || year > 2700) {
    console.error(`--year must be a 4-digit Buddhist-era year, got ${year}.`);
    process.exit(2);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'dms',
    charset: 'utf8mb4_unicode_ci',
  });

  try {
    // Identity is ICIT's and is written on login, never here — the split
    // between `person` and `membership` exists so this file cannot invent a
    // human. They sign in once, holding nothing, and then they can be given
    // something.
    const [[person]] = await conn.query(
      'SELECT id, full_name_th FROM person WHERE id_student = ?', [idStudent]
    );
    if (!person) {
      console.error(`No person with id_student "${idStudent}".`);
      console.error('They must sign in at least once first — this script does not create people.');
      process.exit(1);
    }

    const [[existing]] = await conn.query(
      `SELECT id FROM membership
        WHERE person_id = ? AND academic_year = ? AND role = 'ADMIN'`,
      [person.id, year]
    );
    if (existing) {
      console.log(`${person.full_name_th} already holds ADMIN for ${year} (membership ${existing.id}). Nothing to do.`);
      return;
    }

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO membership (person_id, role, academic_year) VALUES (?, 'ADMIN', ?)`,
      [person.id, year]
    );
    await conn.query(
      `INSERT INTO membership_event
         (action, person_id, role, academic_year, actor_person_id)
       VALUES ('GRANT', ?, 'ADMIN', ?, ?)`,
      [person.id, year, person.id]
    );
    await conn.commit();

    console.log(`Granted ADMIN for ${year} to ${person.full_name_th} (${idStudent}).`);
    console.log(`  membership ${result.insertId}, recorded in membership_event as a console grant.`);
    console.log('  They can now sign in and prepare the year from the screens.');
  } catch (err) {
    try { await conn.rollback(); } catch { /* nothing to roll back */ }
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('\ngrant:admin failed:', err.message);
  process.exit(1);
});
