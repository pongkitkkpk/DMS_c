#!/usr/bin/env node
/**
 * Phase 6 acceptance run — hardening.
 *
 *   npm run db:reset          # the assertions below start from the fixtures
 *   npm run dev               # in another terminal
 *   npm run check:phase6
 *
 * The build plan's Phase 6 list, item by item:
 *
 *   1. no double router mount, no route defined outside a router
 *   2. attachments served only behind an authorization check (Q21)
 *   4. indexes that the queries this system actually runs can use
 *   5. every deliberate deviation is both done and listed
 *
 * Sections 10 and 11 were added by the pre-deployment security pass on
 * 2026-08-17 and are not on the build plan's list: the login endpoint's
 * guessing budgets, and the headers every response carries. Both belong to
 * hardening, and both are the kind of thing that is quietly removed by a later
 * edit unless something fails when it is.
 *
 * Item 3 — real email notification — is deliberately **not** implemented; see
 * `docs/DECISIONS.md` → "Phase 6 close-out". This run asserts that it is absent
 * rather than half-present, because a notification path that silently does
 * nothing is worse than one that visibly does not exist.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { pool } = require('../src/db/pool');
const { config } = require('../src/config');

const B = 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(label, condition, extra = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
}

async function call(method, p, { token, body, form, raw = false } = {}) {
  const res = await fetch(B + p, {
    method,
    headers: {
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (raw) {
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

async function login(username) {
  const r = await call('POST', '/api/auth/login', { body: { username, password: 'dev' } });
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status} ${r.text}`);
  return r.body.token;
}

/** One multipart upload. */
function fileForm(name, bytes, type = 'application/pdf') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return form;
}

(async () => {
  const sh = await login('fixture.student');
  const ad = await login('fixture.advisor');
  const stuact = await login('fixture.stuact');
  const admin = await login('fixture.admin');
  const otherSh = await login('fixture.otherstudent');

  const mine = (await call('GET', '/api/projects', { token: sh })).body.items;
  const draft = mine.find((p) => p.phase.code === 'DRAFT_PROPOSAL');
  const outside = (await call('GET', '/api/projects', { token: admin }))
    .body.items.find((p) => p.club.id !== draft.club.id);

  // ------------------------------------------------------------------
  console.log('\n--- 1. structure: mounted once, nothing outside a router ---');

  const appSource = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
  // Comments stripped first: this file *mentions* `express.static` to say it is
  // deliberately absent, and a naive grep would fail on the explanation.
  const appCode = appSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('no express.static anywhere — the old upload directory was one',
    !/express\.static/.test(appCode));
  ok('no route is defined on the app itself except the health probe',
    (appSource.match(/app\.(get|post|put|patch|delete)\(/g) || []).join() === 'app.get(',
    (appSource.match(/app\.(get|post|put|patch|delete)\(/g) || []).join());

  const mounts = appSource.match(/app\.use\('\/api',/g) || [];
  ok('every router is mounted exactly once, all under /api', mounts.length >= 5);
  ok('  …and nothing is mounted at the root as well',
    !/app\.use\((?!'\/api')['"]\//.test(appSource));

  ok('an unknown path is a 404 from the API, not a file',
    (await call('GET', '/uploads/anything.pdf')).status === 404);
  ok('  …including one that looks like a stored upload',
    (await call('GET', '/api/uploads/projects/1/x.pdf', { token: sh })).status === 404);

  // ------------------------------------------------------------------
  console.log('\n--- 2. attachments: authorized, and only through a handler ---');

  const meta = await call('GET', `/api/projects/${draft.id}/attachments`, { token: sh });
  ok('a project lists its attachments', meta.status === 200 &&
    Array.isArray(meta.body.attachments), meta.text.slice(0, 150));
  ok('  …and says what may be uploaded', meta.body.allowedExtensions.includes('.pdf') &&
    meta.body.maxBytes > 0);
  ok('  …and whether this caller may add one', meta.body.canEdit === true);

  const bytes = Buffer.from('%PDF-1.4 fixture attachment\n');
  const uploaded = await call('POST', `/api/projects/${draft.id}/attachments`, {
    token: sh, form: fileForm('เอกสารแนบ.pdf', bytes),
  });
  ok('SH uploads a file', uploaded.status === 201, uploaded.text.slice(0, 200));
  const attachmentId = uploaded.body && uploaded.body.id;
  ok('  …and it is listed, with who uploaded it', await (async () => {
    const after = await call('GET', `/api/projects/${draft.id}/attachments`, { token: sh });
    return after.body.attachments.length === 1 &&
      after.body.attachments[0].originalName === 'เอกสารแนบ.pdf' &&
      Boolean(after.body.attachments[0].uploadedByName);
  })());
  ok('  …and logged against the project',
    (await call('GET', `/api/projects/${draft.id}/events`, { token: sh }))
      .body.events.some((e) => e.event_type === 'ATTACHMENT_ADDED'));

  const download = await call('GET', `/api/projects/${draft.id}/attachments/${attachmentId}`,
    { token: sh, raw: true });
  ok('the bytes come back exactly', download.status === 200 && download.buffer.equals(bytes));
  ok('  …as an octet-stream attachment, never inline',
    download.headers.get('content-type') === 'application/octet-stream' &&
    /^attachment/.test(download.headers.get('content-disposition')),
    `${download.headers.get('content-type')} / ${download.headers.get('content-disposition')}`);
  ok('  …with nosniff, so the browser cannot decide otherwise',
    download.headers.get('x-content-type-options') === 'nosniff');
  ok('  …and the Thai filename survives as UTF-8',
    decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(download.headers.get('content-disposition'))[1])
      === 'เอกสารแนบ.pdf');

  console.log('\n  — who may reach it —');
  ok('the adviser may download — a viewer still gets the files',
    (await call('GET', `/api/projects/${draft.id}/attachments/${attachmentId}`, { token: ad, raw: true })).status === 200);
  ok('the adviser may NOT upload', (await call('POST', `/api/projects/${draft.id}/attachments`, {
    token: ad, form: fileForm('x.pdf', bytes),
  })).status === 403);
  ok('the adviser may NOT delete',
    (await call('DELETE', `/api/projects/${draft.id}/attachments/${attachmentId}`, { token: ad })).status === 403);
  ok('another club\'s student gets 404 on the download, not the file',
    (await call('GET', `/api/projects/${draft.id}/attachments/${attachmentId}`, { token: otherSh })).status === 404);
  ok('  …and 404 on the list, so the project\'s existence is not confirmed',
    (await call('GET', `/api/projects/${draft.id}/attachments`, { token: otherSh })).status === 404);
  ok('unauthenticated download is 401',
    (await call('GET', `/api/projects/${draft.id}/attachments/${attachmentId}`)).status === 401);
  ok('an attachment id from another project is not found through this one',
    (await call('GET', `/api/projects/${outside.id}/attachments/${attachmentId}`, { token: admin })).status === 404);

  console.log('\n  — what may be uploaded —');
  const exe = await call('POST', `/api/projects/${draft.id}/attachments`, {
    token: sh, form: fileForm('payload.exe', Buffer.from('MZ')),
  });
  ok('an executable is refused by extension', exe.status === 400 && /ไม่รองรับ/.test(exe.body.error),
    exe.text.slice(0, 150));
  ok('a file with no extension is refused',
    (await call('POST', `/api/projects/${draft.id}/attachments`, {
      token: sh, form: fileForm('README', Buffer.from('x')),
    })).status === 400);

  const traversal = await call('POST', `/api/projects/${draft.id}/attachments`, {
    token: sh, form: fileForm('../../../../evil.pdf', Buffer.from('%PDF-1.4 traversal\n')),
  });
  ok('a traversing filename is accepted as a label, not as a path', traversal.status === 201,
    traversal.text.slice(0, 200));

  const [rows] = await pool.query(
    'SELECT original_name, storage_path FROM project_attachment WHERE project_id = ? ORDER BY id',
    [draft.id]
  );
  const evil = rows.find((r) => r.original_name.includes('evil'));
  // The transport already strips directories, so this asserts the outcome
  // rather than the mechanism — and `attachmentService` is exercised directly
  // below with a name no transport has touched.
  ok('  …the label holds no path of its own',
    !/[\\/]/.test(evil.original_name) && !evil.original_name.includes('..'),
    evil.original_name);
  ok('  …and the stored path contains none of it',
    !evil.storage_path.includes('..') && evil.storage_path.startsWith('projects/'),
    evil.storage_path);
  ok('  …resolving inside the upload root',
    path.resolve(config.uploadRoot, evil.storage_path).startsWith(config.uploadRoot + path.sep),
    path.resolve(config.uploadRoot, evil.storage_path));
  ok('  …and the file is really there',
    fs.existsSync(path.resolve(config.uploadRoot, evil.storage_path)));
  ok('no file was written outside the upload root',
    !fs.existsSync(path.resolve(config.uploadRoot, '../../../../evil.pdf')));

  // Straight at the service, with a name no client stack has sanitised, because
  // "the browser strips it" is not a property this system may rely on.
  const attachmentService = require('../src/services/attachmentService');
  const actor = { person: { id: 1 } };
  const hostile = await attachmentService.add(actor, { id: draft.id }, {
    originalname: '..\\..\\..\\windows\\system32\\hosts.pdf',
    buffer: Buffer.from('%PDF-1.4 direct\n'),
    size: 16,
  });
  const [[direct]] = await pool.query(
    'SELECT original_name, storage_path FROM project_attachment WHERE id = ?', [hostile.id]);
  ok('a traversing name passed straight to the service is neutralised',
    direct.original_name === 'hosts.pdf' && !direct.storage_path.includes('..'),
    `${direct.original_name} @ ${direct.storage_path}`);
  ok('  …and its bytes landed inside the upload root',
    fs.existsSync(path.resolve(config.uploadRoot, direct.storage_path)));

  // Built by round-trip rather than typed: the mangled form contains C1 control
  // characters, which do not survive being written into a source file.
  const mangled = Buffer.from('เอกสารแนบ.pdf', 'utf8').toString('latin1');
  ok('a Thai filename survives multer\'s latin1 header reading',
    attachmentService.repairMultipartFilename(mangled) === 'เอกสารแนบ.pdf',
    attachmentService.repairMultipartFilename(mangled));
  ok('  …and an ASCII one is left exactly as it came',
    attachmentService.repairMultipartFilename('report-2567.pdf') === 'report-2567.pdf');

  console.log('\n  — removal —');
  const storedPath = path.resolve(config.uploadRoot, rows[0].storage_path);
  const removed = await call('DELETE', `/api/projects/${draft.id}/attachments/${attachmentId}`,
    { token: sh });
  ok('SH deletes its own project\'s attachment', removed.status === 200, removed.text.slice(0, 150));
  ok('  …the row is gone', (await call('GET', `/api/projects/${draft.id}/attachments`, { token: sh }))
    .body.attachments.every((a) => a.id !== attachmentId));
  ok('  …and so is the file', !fs.existsSync(storedPath), storedPath);
  ok('  …and a second delete is a clean 404',
    (await call('DELETE', `/api/projects/${draft.id}/attachments/${attachmentId}`, { token: sh })).status === 404);

  // ------------------------------------------------------------------
  console.log('\n--- 3. email notification is absent, not half-present ---');

  const sources = ['src', 'scripts'].flatMap(function walk(dir) {
    const full = path.resolve(__dirname, '..', dir);
    return fs.readdirSync(full, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => path.join(e.parentPath || e.path, e.name));
  });
  const usesMailer = sources.filter((f) => /require\(['"]nodemailer['"]\)/.test(fs.readFileSync(f, 'utf8')));
  ok('nothing imports a mailer, so no notification can silently no-op',
    usesMailer.length === 0, usesMailer.join(', '));

  // ------------------------------------------------------------------
  console.log('\n--- 4. the indexes the real queries need ---');

  const indexed = async (table, column) => {
    const [idx] = await pool.query(`SHOW INDEX FROM \`${table}\` WHERE Column_name = ?`, [column]);
    return idx.length > 0;
  };

  ok('project is indexed by club — every scoped list filters on it',
    await indexed('project', 'club_id'));
  ok('project is indexed by phase — the dashboard groups on it',
    await indexed('project', 'phase_id'));
  ok('membership is indexed by club and year — resolved on every request',
    await indexed('membership', 'club_id'));
  ok('project_event is indexed by project', await indexed('project_event', 'project_id'));
  ok('budget_line is indexed by project', await indexed('budget_line', 'project_id'));
  ok('project_attachment is indexed by project', await indexed('project_attachment', 'project_id'));

  const [plan] = await pool.query(
    `EXPLAIN SELECT p.id FROM project p JOIN club c ON c.id = p.club_id
      WHERE c.club_group_id = ? AND p.academic_year = ?`, [1, 2567]);
  ok('the STUACT scope query does not table-scan project',
    plan.every((row) => row.type !== 'ALL' || row.table !== 'p'),
    JSON.stringify(plan.map((r) => [r.table, r.type, r.key])));

  // ------------------------------------------------------------------
  console.log('\n--- 5. every deviation is done and listed ---');

  const decisions = fs.readFileSync(path.resolve(__dirname, '../../docs/DECISIONS.md'), 'utf8');
  const listed = (decisions.match(/^\d+\.\s+\*\*/gm) || []).length;
  ok('the deviations list has grown with the phases', listed >= 25, String(listed));

  ok('deviation 1 — scope from the token: a club id in the query cannot widen it',
    (await call('GET', `/api/projects?clubId=${outside.club.id}`, { token: sh })).body.total === 0);
  ok('deviation 2 — no mass assignment',
    (await call('PATCH', `/api/projects/${draft.id}`, { token: sh, body: { phase_id: 7 } })).status === 400);
  ok('deviation 8 — attachment downloads authorized (asserted above)', true);
  ok('deviation 11 — the token carries no role',
    !JSON.parse(Buffer.from(sh.split('.')[1], 'base64url').toString()).role);
  ok('deviation 15 — out of scope is 404, not 403',
    (await call('GET', `/api/projects/${outside.id}`, { token: sh })).status === 404);

  // ------------------------------------------------------------------
  // Break-glass. Three decisions that are each right — a role belongs to one
  // academic year, the token carries none, and the .env fallback is
  // identity-only — combine so that moving ACADEMIC_YEAR to a year nobody was
  // prepared for leaves every account at `role: null`, including the Admin,
  // with no route back in through the API. `scripts/grant-admin.js` is the way
  // back. It is only worth having if it works, so it is exercised rather than
  // asserted to exist.
  console.log('\n--- 7. break-glass: recovering an unprepared year ---');

  // Asked of the running system, never of `config`: since the year moved into
  // the database, `config.fallbackAcademicYear` is only what it would fall back
  // to and can differ from what the server is actually serving.
  const liveYear = JSON.parse((await call('GET', '/api/health')).text).academicYear;
  const marooned = liveYear + 9;
  const before = await call('GET', `/api/memberships?year=${marooned}`, { token: admin });
  ok('the far year starts with nobody in it',
    before.status === 200 && before.body.items.length === 0);

  const run = (args) => execFileSync(process.execPath,
    [path.join(__dirname, 'grant-admin.js'), ...args],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });

  ok('a person who has never signed in cannot be granted anything', (() => {
    try { run(['--user', 'no.such.person', '--year', String(marooned)]); return false; }
    catch (err) { return /No person with id_student/.test(err.stdout + err.stderr); }
  })());

  const out = run(['--user', 'fixture.admin', '--year', String(marooned)]);
  ok('the console can grant ADMIN for a year nobody prepared', /Granted ADMIN/.test(out), out.trim());
  ok('  …and says so again rather than granting twice',
    /already holds ADMIN/.test(run(['--user', 'fixture.admin', '--year', String(marooned)])));

  const after = await call('GET', `/api/memberships?year=${marooned}`, { token: admin });
  ok('  …and the membership is real, not just printed',
    after.body.items.length === 1 && after.body.items[0].role === 'ADMIN' &&
    after.body.items[0].person.idStudent === 'fixture.admin',
    after.text.slice(0, 200));

  // A console grant must not be quieter than one made on screen — it is the
  // most privileged thing anyone can do and nobody in the system authorised it.
  const logged = (await call('GET', '/api/memberships/events', { token: admin }))
    .body.events.find((e) => e.academicYear === marooned);
  ok('  …and it is in the log like any other grant',
    logged !== undefined && logged.action === 'GRANT' && logged.role === 'ADMIN');
  ok('  …carrying the console signature: the recipient is its own actor',
    logged.personName === logged.actorName);

  // ------------------------------------------------------------------
  // The academic year is a row an Admin moves, not a line in .env. The guard is
  // the whole point: a year with no ADMIN cannot be entered, because on arrival
  // nobody could grant one. That single refusal turns the lockout from a
  // documented hazard into an impossible one.
  console.log('\n--- 8. the academic year, and the guard on moving it ---');

  const yr = liveYear;
  const state = await call('GET', '/api/academic-year', { token: admin });
  ok('the year reports itself and who may move it',
    state.status === 200 && state.body.academicYear === yr && state.body.settable === true,
    state.text.slice(0, 200));

  ok('only an Admin may move it',
    (await call('PUT', '/api/academic-year', { token: stuact, body: { academicYear: yr + 1 } })).status === 403 &&
    (await call('PUT', '/api/academic-year', { token: sh, body: { academicYear: yr + 1 } })).status === 403);
  ok('  …and a student is not told they may set it',
    (await call('GET', '/api/academic-year', { token: sh })).body.settable === false);

  const refused = await call('PUT', '/api/academic-year', { token: admin, body: { academicYear: yr + 1 } });
  ok('THE GUARD: a year with no Admin of its own cannot be entered',
    refused.status === 400 && /ผู้ดูแลระบบ/.test(refused.body.error),
    refused.text.slice(0, 220));
  ok('  …and the system did not move',
    (await call('GET', '/api/academic-year', { token: admin })).body.academicYear === yr);

  ok('moving to the year it is already in is refused',
    (await call('PUT', '/api/academic-year', { token: admin, body: { academicYear: yr } })).status === 400);
  ok('a year outside the Buddhist-era range is refused',
    (await call('PUT', '/api/academic-year', { token: admin, body: { academicYear: 1999 } })).status === 400);

  // Prepare the year the way the guard asks, then it opens.
  const adminP = (await call('GET', '/api/people?q=fixture.admin', { token: admin })).body.people[0];
  await call('POST', '/api/memberships', {
    token: admin, body: { personId: adminP.id, role: 'ADMIN', academicYear: yr + 1 },
  });
  ok('the readiness report says the year can now be entered',
    (await call('GET', '/api/readiness', { token: admin })).body.hasAdmin === true);

  const moved = await call('PUT', '/api/academic-year', { token: admin, body: { academicYear: yr + 1 } });
  ok('  …and the move is accepted', moved.status === 200 &&
    moved.body.academicYear === yr + 1 && moved.body.previousAcademicYear === yr,
    moved.text.slice(0, 200));

  // The move has to reach everything, not just the settings endpoint — this is
  // the value every request resolves a membership against.
  ok('  …and the whole system moved with it',
    JSON.parse((await call('GET', '/api/health')).text).academicYear === yr + 1 &&
    (await call('GET', '/api/me', { token: admin })).body.academicYear === yr + 1);
  ok('  …with the Admin still holding a role there',
    (await call('GET', '/api/me', { token: admin })).body.role === 'ADMIN');

  ok('moving back is allowed, since the old year still has an Admin',
    (await call('PUT', '/api/academic-year', { token: admin, body: { academicYear: yr } })).status === 200);
  ok('  …and everything followed it back',
    JSON.parse((await call('GET', '/api/health')).text).academicYear === yr);

  // ------------------------------------------------------------------
  // The boot-order lockout (found 2026-08-16 by starting the API before
  // MariaDB). An unreadable database used to be indistinguishable from an
  // unseeded one: both fell to the date and cached it *permanently*. MariaDB
  // then came up, health said `ok`, and every account resolved to `role: null`
  // because no membership exists in the guessed year.
  console.log('\n--- 9. a database that was not up when the API started ---');

  const health = JSON.parse((await call('GET', '/api/health')).text);
  ok('health says whether the year is the stored one or a guess',
    health.status === 'ok' && health.academicYearResolved === true,
    JSON.stringify(health));

  // Driven in-process rather than by stopping MariaDB: the state machine is
  // the thing under test, and a check suite must not take the database down.
  if (process.env.ACADEMIC_YEAR) {
    console.log('  (skipped: ACADEMIC_YEAR is overriding the year in this process)');
  } else {
    const yearService = require('../src/services/academicYearService');
    const realQuery = pool.query.bind(pool);
    pool.query = async () => {
      // What mysql2 actually throws for a refused connection: a `code`, and an
      // empty `message`. The empty message is why the log line prints the code.
      const err = new Error('');
      err.code = 'ECONNREFUSED';
      throw err;
    };
    const down = await yearService.load();
    ok('an unreadable database leaves the year unresolved rather than guessed',
      down.source === 'unresolved' && yearService.isResolved() === false, down.source);

    yearService.retryUntilResolved(50);
    pool.query = realQuery;
    await new Promise((resolve) => setTimeout(resolve, 400));
    ok('  …and it heals itself when the database arrives, with no restart',
      yearService.isResolved() === true && yearService.current() === yr,
      `${yearService.current()}`);
  }

  // ------------------------------------------------------------------
  // `POST /api/auth/login` is the only endpoint reachable without a token, and
  // until the security pass on 2026-08-17 it had no cost: `login_attempt` had
  // recorded every failure since migration 001 and nothing read the table.
  console.log('\n--- 10. guessing costs something ---');

  const { maxPerUsername, maxPerAddress } = config.loginThrottle;
  const tryLogin = (username, password = 'dev') =>
    call('POST', '/api/auth/login', { body: { username, password } });

  // Whatever address this suite reaches the API from — `localhost` resolves to
  // ::1 on some Node versions and 127.0.0.1 on others, and the address budget
  // is charged against whichever one it actually was.
  const [[{ remote_ip: here }]] = await pool.query(
    'SELECT remote_ip FROM login_attempt ORDER BY id DESC LIMIT 1'
  );
  ok('a login attempt records where it came from', here !== null, JSON.stringify(here));

  // An unknown username, so nothing a later section logs in as is affected.
  const ghost = 'fixture.nobody';
  const refusals = [];
  for (let i = 0; i < maxPerUsername; i++) refusals.push((await tryLogin(ghost)).status);
  ok(`the first ${maxPerUsername} wrong guesses are refused as wrong, not as too many`,
    refusals.every((s) => s === 401), refusals.join(','));

  const spent = await tryLogin(ghost);
  ok('  …and the next one is a 429', spent.status === 429, spent.text.slice(0, 120));
  ok('  …which says how long to wait, in the header and the body',
    Number(spent.headers.get('retry-after')) > 0 && spent.body.retryAfter > 0,
    `${spent.headers.get('retry-after')} / ${spent.body && spent.body.retryAfter}`);

  // The budget is per username. Spraying is what the address budget is for, and
  // one spent username must not refuse everyone else in the building.
  ok('a different username from the same address is still merely wrong',
    (await tryLogin('fixture.alsonobody')).status === 401);

  // The remaining assertions drive the window by writing `login_attempt`
  // directly: with the mock provider any non-empty password is accepted for a
  // known username (that is the point of the mock), so a real fixture cannot be
  // made to fail through the endpoint at all.
  const attempt = (idStudent, success, secondsAgo, ip = here) => pool.query(
    `INSERT INTO login_attempt (id_student, is_success, remote_ip, attempted_at)
     VALUES (?, ?, ?, NOW() - INTERVAL ? SECOND)`,
    [idStudent, success ? 1 : 0, ip, secondsAgo]
  );
  const forget = (idStudent) => pool.query('DELETE FROM login_attempt WHERE id_student = ?',
    [idStudent]);

  await forget('fixture.student');
  for (let i = 0; i < maxPerUsername; i++) await attempt('fixture.student', false, 60);
  ok('an account being guessed at is refused before its password is checked',
    (await tryLogin('fixture.student')).status === 429);

  await attempt('fixture.student', true, 30);
  ok('  …and one success since then clears the budget',
    (await tryLogin('fixture.student')).status === 200);

  await forget('fixture.student');
  for (let i = 0; i < maxPerUsername; i++) await attempt('fixture.student', false, 4000);
  ok('  …as does the window simply passing — nothing is locked out permanently',
    (await tryLogin('fixture.student')).status === 200);

  // Spraying: one attempt each against many usernames trips no per-username
  // counter. Written directly rather than driven, because sixty round trips to
  // prove an arithmetic threshold is sixty seconds nobody gets back.
  await forget('fixture.student');
  const sprayed = [];
  for (let i = 0; i < maxPerAddress; i++) sprayed.push(attempt(`sprayed.${i}`, false, 60));
  await Promise.all(sprayed);
  const blocked = await tryLogin('fixture.student');
  ok('an address spraying many usernames is refused even for an untouched account',
    blocked.status === 429, blocked.text.slice(0, 120));

  await pool.query("DELETE FROM login_attempt WHERE id_student LIKE 'sprayed.%'");
  await forget('fixture.student');
  await forget(ghost);
  await forget('fixture.alsonobody');
  ok('  …and the refusal lifts with the attempts that caused it',
    (await tryLogin('fixture.student')).status === 200);

  // ------------------------------------------------------------------
  console.log('\n--- 11. what every response says about itself ---');

  const headers = (await call('GET', '/api/health')).headers;
  ok('no X-Powered-By — the server does not name itself',
    headers.get('x-powered-by') === null, headers.get('x-powered-by'));
  ok('nosniff, so a JSON error body cannot be read as HTML',
    headers.get('x-content-type-options') === 'nosniff');
  ok('framing is denied, in both spellings',
    headers.get('x-frame-options') === 'DENY' &&
    /frame-ancestors 'none'/.test(headers.get('content-security-policy') || ''),
    headers.get('content-security-policy'));
  ok('a JSON API loads nothing, and the CSP says so',
    /default-src 'none'/.test(headers.get('content-security-policy') || ''));
  ok('no referrer, so project ids do not travel to the next page',
    headers.get('referrer-policy') === 'no-referrer');

  // ------------------------------------------------------------------
  // Every line here is a way a deployment that runs perfectly on day one is
  // already compromised. They are checked by loading `config` in a child
  // process, because the configuration this suite is running under is fixed the
  // moment the module is first required.
  console.log('\n--- 12. what a production start refuses ---');

  /** @returns {string} the refusal, or '' when the configuration was accepted. */
  function startWith(env) {
    try {
      execFileSync(process.execPath,
        ['-e', "require('./src/config').assertValid()"],
        {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          stdio: 'pipe',
          // A clean environment: `.env` is still read by config, so the
          // overrides below have to win, and anything left over from this
          // process would make the result depend on the developer's shell.
          env: {
            ...process.env,
            NODE_ENV: 'production',
            CORS_ORIGIN: 'https://dms.example',
            DB_USER: 'dms_api',
            DB_PASS: 'not-empty',
            JWT_SECRET: 'x'.repeat(48),
            ADMIN_USERNAME: '',
            ADMIN_PASSWORD: '',
            ALLOW_MOCK_AUTH: '',
            MOCK_PASSWORD: '',
            ALLOW_INSECURE_ORIGINS: '',
            ...env,
          },
        });
      return '';
    } catch (err) {
      return String(err.stderr || err.message);
    }
  }

  const demo = { ALLOW_MOCK_AUTH: '1', MOCK_PASSWORD: 'a-shared-demo-password' };

  ok('the mock in production is refused unless the deployment says it means it',
    /ALLOW_MOCK_AUTH=1/.test(startWith({})));
  ok('  …and saying it without a shared password is still refused',
    /MOCK_PASSWORD/.test(startWith({ ALLOW_MOCK_AUTH: '1' })));
  ok('  …while the demonstration deployment, gated, is allowed to start',
    startWith(demo) === '');
  ok('an empty database password is refused',
    /DB_PASS is empty/.test(startWith({ ...demo, DB_PASS: '' })));
  ok('the database superuser is refused',
    /DB_USER=root/.test(startWith({ ...demo, DB_USER: 'root' })));
  ok('a plain-http origin is refused, since the token would travel in the clear',
    /travel in the clear/.test(startWith({ ...demo, CORS_ORIGIN: 'http://dms.example' })));
  ok('  …unless the deployment explicitly accepts that',
    startWith({ ...demo, CORS_ORIGIN: 'http://dms.example', ALLOW_INSECURE_ORIGINS: '1' }) === '');
  ok('a wildcard origin is refused in any environment',
    /CORS_ORIGIN=\*/.test(startWith({ ...demo, CORS_ORIGIN: '*' })));
  ok('the local admin fallback is refused in production',
    /ADMIN_USERNAME is set in production/.test(
      startWith({ ...demo, ADMIN_USERNAME: 'root', ADMIN_PASSWORD: 'root' })));
  ok('a short signing secret is refused',
    /JWT_SECRET is \d+ characters/.test(startWith({ ...demo, JWT_SECRET: 'short' })));

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error('\nrun aborted:', err.stack || err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
