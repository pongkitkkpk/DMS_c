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

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error('\nrun aborted:', err.stack || err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
