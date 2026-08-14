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

const BACKEND = path.resolve(__dirname, '..');
const PHASES = [2, 3, 4, 5, 6];
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
    results.push({ phase, passed, failed, output, stderr: run.stderr });

    const verdict = run.status === 0 ? 'ok' : 'FAILED';
    console.log(`phase ${phase}  ${String(passed).padStart(3)} passed  ${String(Number.isNaN(failed) ? '?' : failed).padStart(3)} failed  ${verdict}`);
  }

  // Only the failures get reprinted. A green run should be five lines long.
  const broken = results.filter((r) => r.failed !== 0);
  for (const r of broken) {
    console.log(`\n--- phase ${r.phase} ---`);
    const lines = (r.output.match(/^\s*FAIL\s+.*$/gm) || []);
    lines.forEach((line) => console.log(line));
    if (!lines.length) console.log(r.stderr.trim() || '(no FAIL lines; the run aborted)');
  }

  console.log(`\n${totalPass} passed, ${totalFail} failed`);
  process.exit(totalFail ? 1 : 0);
})();
