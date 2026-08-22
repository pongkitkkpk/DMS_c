#!/usr/bin/env node
/**
 * Every acceptance run, in order, each from a freshly seeded database.
 *
 *   npm start                 # or npm run dev, in another terminal
 *   npm run check:all
 *
 * The individual runs each say "npm run db:reset" in their header, and they
 * mean it: they create projects, approve budgets and walk phases, and none of
 * them clean up after itself. Run two of them back to back against the same
 * database and the second one fails for reasons that have nothing to do with
 * the code — the fixture counts have doubled, and the club's yearly allocation
 * has already been spent by the run before it. Those failures look exactly
 * like regressions, which is the expensive part.
 *
 * So this reseeds between suites rather than trusting anyone to remember.
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const { ACADEMIC_YEAR: FIXTURE_ACADEMIC_YEAR } = require('../src/db/seeds/fixtures');

const BACKEND = path.resolve(__dirname, '..');
const PHASES = [2, 3, 4, 5, 6];
// Post-v1 suites — not numbered phases in DECISIONS.md, but the same shape of
// acceptance run: black-box, against a fresh reseed, one script per feature.
const EXTRA_SUITES = [{ label: 'signature', script: 'scripts/check-signature.js' }];
const API = 'http://localhost:3001/api/health';

function node(script, args = []) {
  return spawnSync(process.execPath, [path.join(BACKEND, script), ...args], {
    cwd: BACKEND,
    encoding: 'utf8',
  });
}

(async () => {
  // The suites talk to a running API. Say so once, here, instead of letting
  // five runs abort one after another on "fetch failed".
  try {
    const res = await fetch(API);
    const health = await res.json();
    if (health.database !== 'ok') {
      console.error(`API is up but its database is not: ${health.database}`);
      process.exit(1);
    }
    // The API resolves every membership against its academic year, so a server
    // sitting in a different year than the fixtures seed fails *every* suite,
    // for one reason, with several hundred assertions each reporting it as
    // their own. Both ways that happens are named here rather than diagnosed
    // five hundred failures later.
    if (health.academicYearResolved === false) {
      console.error(
        `The API's academic year is a guess (${health.academicYear}) — it could not read the\n` +
        'stored one, most likely because it started before MariaDB. Restart it, or wait for\n' +
        'its retry, and run this again.'
      );
      process.exit(1);
    }
    if (health.academicYear !== FIXTURE_ACADEMIC_YEAR) {
      console.error(
        `The API is in academic year ${health.academicYear} and the fixtures seed ${FIXTURE_ACADEMIC_YEAR}, so no\n` +
        'membership would resolve and every suite would fail. If this is a year-rollover\n' +
        'rehearsal, that is expected — rehearse against the screens, not against this run,\n' +
        'which reseeds between suites and would erase the year you prepared.'
      );
      process.exit(1);
    }
    console.log(`API ok · database ok · academic year ${health.academicYear}\n`);
  } catch {
    console.error(`No API at ${API}. Start it with "npm start" and run this again.`);
    process.exit(1);
  }

  const results = [];
  let totalPass = 0, totalFail = 0;

  for (const phase of PHASES) {
    const migrate = node('src/db/migrate.js', ['--fresh']);
    const seed = node('src/db/seed.js');
    if (migrate.status !== 0 || seed.status !== 0) {
      console.error(`reseed failed before phase ${phase}:`);
      console.error(migrate.stderr || seed.stderr);
      process.exit(1);
    }

    const run = node(`scripts/check-phase${phase}.js`);
    const output = run.stdout || '';
    const tally = output.match(/^(\d+) passed, (\d+) failed$/m);
    const passed = tally ? Number(tally[1]) : 0;
    const failed = tally ? Number(tally[2]) : NaN;

    totalPass += passed;
    totalFail += Number.isNaN(failed) ? 1 : failed;
    results.push({ label: `phase ${phase}`, passed, failed, output, stderr: run.stderr });

    const verdict = run.status === 0 ? 'ok' : 'FAILED';
    console.log(`phase ${phase}  ${String(passed).padStart(3)} passed  ${String(Number.isNaN(failed) ? '?' : failed).padStart(3)} failed  ${verdict}`);
  }

  for (const suite of EXTRA_SUITES) {
    const migrate = node('src/db/migrate.js', ['--fresh']);
    const seed = node('src/db/seed.js');
    if (migrate.status !== 0 || seed.status !== 0) {
      console.error(`reseed failed before ${suite.label}:`);
      console.error(migrate.stderr || seed.stderr);
      process.exit(1);
    }

    const run = node(suite.script);
    const output = run.stdout || '';
    const tally = output.match(/^(\d+) passed, (\d+) failed$/m);
    const passed = tally ? Number(tally[1]) : 0;
    const failed = tally ? Number(tally[2]) : NaN;

    totalPass += passed;
    totalFail += Number.isNaN(failed) ? 1 : failed;
    results.push({ label: suite.label, passed, failed, output, stderr: run.stderr });

    const verdict = run.status === 0 ? 'ok' : 'FAILED';
    console.log(`${suite.label}  ${String(passed).padStart(3)} passed  ${String(Number.isNaN(failed) ? '?' : failed).padStart(3)} failed  ${verdict}`);
  }

  // Only the failures get reprinted. A green run should be short.
  const broken = results.filter((r) => r.failed !== 0);
  for (const r of broken) {
    console.log(`\n--- ${r.label} ---`);
    const lines = (r.output.match(/^\s*FAIL\s+.*$/gm) || []);
    lines.forEach((line) => console.log(line));
    if (!lines.length) console.log(r.stderr.trim() || '(no FAIL lines; the run aborted)');
  }

  console.log(`\n${totalPass} passed, ${totalFail} failed`);
  process.exit(totalFail ? 1 : 0);
})();
