#!/usr/bin/env node
/**
 * Phase 2 acceptance run.
 *
 *   npm run db:reset          # the assertions below count fixture rows
 *   npm run dev               # in another terminal
 *   npm run check:phase2
 *
 * This is the build plan's "Done when" list made executable: a project walks
 * 1 → 7 by the correct roles and cannot be walked by the wrong ones, a
 * wrong-scope attempt is refused by the server, two projects in one club-year
 * cannot receive the same number, and the event log replays into the current
 * phase.
 *
 * It is a black-box run against a live server on port 3001, not a unit test —
 * the project has no test framework yet, and the properties worth checking here
 * are end-to-end ones (scope, transactions, HTTP status). It writes to the
 * development database and expects the fixtures to be freshly seeded.
 */
const B = 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(label, condition, extra = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: json, text };
}

async function login(username) {
  const r = await call('POST', '/api/auth/login', { body: { username, password: 'dev' } });
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status} ${r.text}`);
  return r.body.token;
}

(async () => {
  const sh = await login('fixture.student');
  const ad = await login('fixture.advisor');
  const stuact = await login('fixture.stuact');
  const admin = await login('fixture.admin');

  console.log('\n--- scope: list ---');
  const shList = await call('GET', '/api/projects', { token: sh });
  const adList = await call('GET', '/api/projects', { token: ad });
  const stuactList = await call('GET', '/api/projects', { token: stuact });
  const adminList = await call('GET', '/api/projects', { token: admin });
  ok('SH lists own club only (7)', shList.status === 200 && shList.body.total === 7, JSON.stringify(shList.body.total));
  ok('AD sees the same club', adList.body.total === shList.body.total);
  ok('STUACT sees its jurisdiction and not the other group (7)', stuactList.body.total === 7, String(stuactList.body.total));
  ok('ADMIN sees both clubs (8)', adminList.body.total === 8, String(adminList.body.total));
  ok('the out-of-scope project exists but only ADMIN lists it',
    adminList.body.items.some((p) => p.club.id !== shList.body.items[0].club.id));
  ok('another club id returns nothing rather than that club',
    (await call('GET', '/api/projects?clubId=999', { token: sh })).body.total === 0);

  console.log('\n--- create ---');
  const created = await call('POST', '/api/projects', {
    token: sh,
    body: { name: 'โครงการทดสอบ Phase 2', eventStartOn: '2024-08-01', eventEndOn: '2024-08-02', contact1Name: 'ผู้ประสานงาน' },
  });
  ok('SH creates a draft', created.status === 201, created.text.slice(0, 300));
  const id = created.body && created.body.id;
  ok('draft_sequence issued server-side', created.body && created.body.draftSequence === 8, JSON.stringify(created.body && created.body.draftSequence));
  ok('starts in DRAFT_PROPOSAL', created.body && created.body.phase.code === 'DRAFT_PROPOSAL');
  ok('no project number before approval', created.body && created.body.projectNumber === null);

  const adCreate = await call('POST', '/api/projects', { token: ad, body: { name: 'x' } });
  ok('AD cannot create (403)', adCreate.status === 403, adCreate.text);
  const stuactCreate = await call('POST', '/api/projects', { token: stuact, body: { name: 'x' } });
  ok('STUACT cannot create (403)', stuactCreate.status === 403, stuactCreate.text);

  console.log('\n--- mass assignment ---');
  const massAssign = await call('PATCH', `/api/projects/${id}`, {
    token: sh,
    body: { name: 'ok', projectNumber: 'B67042010099', clubId: 2, phaseId: 7 },
  });
  ok('unknown/protected fields rejected (400)', massAssign.status === 400, massAssign.text);
  ok('error names the fields', /projectNumber/.test(massAssign.text), massAssign.text);

  const badDate = await call('PATCH', `/api/projects/${id}`, { token: sh, body: { eventStartOn: '0000-00-00' } });
  ok("'0000-00-00' rejected", badDate.status === 400, badDate.text);

  console.log('\n--- edit rights ---');
  ok('SH edits own draft', (await call('PATCH', `/api/projects/${id}`, { token: sh, body: { name: 'โครงการทดสอบ (แก้ไข)' } })).status === 200);
  ok('AD cannot edit', (await call('PATCH', `/api/projects/${id}`, { token: ad, body: { name: 'x' } })).status === 403);
  ok('STUACT can edit in scope', (await call('PATCH', `/api/projects/${id}`, { token: stuact, body: { academicTerm: '1' } })).status === 200);

  const approved = adminList.body.items.find((p) => p.phase.code === 'PROJECT_APPROVED');
  const shPastDraft = await call('PATCH', `/api/projects/${approved.id}`, { token: sh, body: { name: 'x' } });
  ok('SH cannot edit past the drafting phases', shPastDraft.status === 403, shPastDraft.text);
  const closed = adminList.body.items.find((p) => p.phase.code === 'CLOSED');
  ok('nobody edits a closed project',
    (await call('PATCH', `/api/projects/${closed.id}`, { token: admin, body: { name: 'x' } })).status === 403);

  console.log('\n--- sections ---');
  const objectives = await call('PUT', `/api/projects/${id}/sections/objectives`, {
    token: sh,
    body: { items: [{ content: 'วัตถุประสงค์ ก' }, { content: 'วัตถุประสงค์ ข' }] },
  });
  ok('objectives replaced', objectives.status === 200 && objectives.body.count === 2, objectives.text.slice(0, 200));
  ok('ordinals assigned by position',
    JSON.stringify(objectives.body.items.map((i) => i.ordinal)) === '[1,2]', JSON.stringify(objectives.body.items));

  const attendance = await call('PUT', `/api/projects/${id}/sections/attendance`, {
    token: sh,
    body: { items: [
      { variant: 'PLANNED', attendeeType: 'STUDENT', label: 'นักศึกษา', headcount: 80 },
      { variant: 'PLANNED', attendeeType: 'STUDENT', label: 'นักศึกษาปี 2', headcount: 20 },
      { variant: 'PLANNED', attendeeType: 'PROFESSOR', label: 'อาจารย์', headcount: 4 },
    ] },
  });
  ok('grouped ordinals restart per (variant, type), grouped in the read',
    attendance.status === 200 &&
    JSON.stringify(attendance.body.items.map((i) => `${i.attendee_type}${i.ordinal}`)) === '["STUDENT1","STUDENT2","PROFESSOR1"]',
    attendance.text.slice(0, 300));

  const badActivity = await call('PUT', `/api/projects/${id}/sections/activities`, {
    token: sh, body: { items: [{ topic: 'ไม่มีวันที่' }] },
  });
  ok('required child field enforced', badActivity.status === 400, badActivity.text);
  ok('unknown section 404s', (await call('PUT', `/api/projects/${id}/sections/nope`, { token: sh, body: { items: [] } })).status === 404);

  const tags = await call('PUT', `/api/projects/${id}/tags`, { token: sh, body: { tagIds: [1, 2, 2] } });
  ok('tags de-duplicated', tags.status === 200 && tags.body.count === 2, tags.text.slice(0, 200));
  ok('unknown tag id named', /ไม่พบ tag/.test((await call('PUT', `/api/projects/${id}/tags`, { token: sh, body: { tagIds: [99999] } })).text));

  console.log('\n--- lifecycle ---');
  const wrongRole = await call('POST', `/api/projects/${id}/transitions`, { token: stuact, body: { toPhaseCode: 'PROPOSAL_SUBMITTED' } });
  ok('wrong role blocked (403)', wrongRole.status === 403, wrongRole.text);
  ok('403 names who may', /SH/.test(wrongRole.text), wrongRole.text);

  const skip = await call('POST', `/api/projects/${id}/transitions`, { token: sh, body: { toPhaseCode: 'CLOSED' } });
  ok('cannot skip phases (400)', skip.status === 400, skip.text);

  const backwards = await call('POST', `/api/projects/${approved.id}/transitions`, { token: admin, body: { toPhaseCode: 'DRAFT_PROPOSAL' } });
  ok('cannot walk backwards (400)', backwards.status === 400, backwards.text);

  const walk = [
    ['PROPOSAL_SUBMITTED', sh, 'SH'],
    ['PROJECT_APPROVED', admin, 'ADMIN'],
    ['BUDGET_APPROVED', stuact, 'STUACT'],
    ['DRAFT_REPORT', sh, 'SH'],
    ['REPORT_SUBMITTED', stuact, 'STUACT'],
    ['CLOSED', admin, 'ADMIN'],
  ];
  // Phase 3 put real limits on the three `requires_budget_check` gates, so a
  // project can no longer be walked past them with no money stated: the walk now
  // states a plan before it is approved and an approved amount before the money
  // is. What is being checked here is still the machine, not the limits —
  // `check-phase3.js` is where each limit is made to refuse.
  await call('PUT', `/api/projects/${id}/budget/plan`, { token: sh, body: { plannedAmount: '5000' } });
  await call('PUT', `/api/projects/${id}/budget/lines/PLANNED`, {
    token: sh,
    body: { items: [{ category: 'C', description: 'ค่าวัสดุ', qty1: '1', unit1: 'ชุด', unitPrice: '5000' }] },
  });

  let numberAtApproval = null;
  for (const [code, token, who] of walk) {
    if (code === 'BUDGET_APPROVED') {
      const approvedAmount = await call('POST', `/api/projects/${id}/budget/approve`, {
        token: stuact, body: { approvedAmount: '5000' },
      });
      ok('STUACT approves the amount before the money gate', approvedAmount.status === 200,
        approvedAmount.text.slice(0, 200));
    }
    if (code === 'REPORT_SUBMITTED') {
      await call('PUT', `/api/projects/${id}/budget/lines/ACTUAL`, {
        token: sh,
        body: { items: [{ category: 'C', description: 'ค่าวัสดุ', qty1: '1', unit1: 'ชุด', unitPrice: '4800' }] },
      });
    }
    const r = await call('POST', `/api/projects/${id}/transitions`, { token, body: { toPhaseCode: code } });
    ok(`${who} advances to ${code}`, r.status === 200, r.text.slice(0, 200));
    if (code === 'PROJECT_APPROVED') numberAtApproval = r.body.projectNumber;
  }

  ok('project number issued at approval', /^B67042010\d{3}$/.test(numberAtApproval || ''), String(numberAtApproval));
  const finalState = await call('GET', `/api/projects/${id}`, { token: admin });
  ok('project ends CLOSED', finalState.body.phase.code === 'CLOSED');
  ok('number kept through later phases', finalState.body.projectNumber === numberAtApproval);

  console.log('\n--- event log ---');
  const events = await call('GET', `/api/projects/${id}/events`, { token: admin });
  const phaseChanges = events.body.events.filter((e) => e.event_type === 'PHASE_CHANGED');
  ok('one PHASE_CHANGED per transition', phaseChanges.length === 6, String(phaseChanges.length));
  let replay = 'DRAFT_PROPOSAL', joined = true;
  for (const e of phaseChanges) {
    if (e.from_phase_code !== replay) joined = false;
    replay = e.to_phase_code;
  }
  ok('log chain joins up', joined);
  ok('log replays into the current phase', replay === finalState.body.phase.code, replay);
  ok('edits logged with their section',
    events.body.events.some((e) => e.event_type === 'EDITED' && e.edited_section === 'attendance'));

  console.log('\n--- out of scope ---');
  const outside = adminList.body.items.find((p) => p.club.id !== shList.body.items[0].club.id);
  ok('SH: another club 404s, not 403 (no existence leak)',
    (await call('GET', `/api/projects/${outside.id}`, { token: sh })).status === 404);
  ok('STUACT: outside its jurisdiction 404s',
    (await call('GET', `/api/projects/${outside.id}`, { token: stuact })).status === 404);
  ok('STUACT cannot advance a project outside its jurisdiction',
    (await call('POST', `/api/projects/${outside.id}/transitions`, { token: stuact, body: { toPhaseCode: 'PROPOSAL_SUBMITTED' } })).status === 404);
  ok('SH cannot edit another club\'s project',
    (await call('PATCH', `/api/projects/${outside.id}`, { token: sh, body: { name: 'x' } })).status === 404);
  ok('ADMIN can read it', (await call('GET', `/api/projects/${outside.id}`, { token: admin })).status === 200);
  const otherSh = await login('fixture.otherstudent');
  ok('its own SH can read it', (await call('GET', `/api/projects/${outside.id}`, { token: otherSh })).status === 200);
  ok('its own SH cannot read the first club', (await call('GET', `/api/projects/${id}`, { token: otherSh })).status === 404);
  ok('unauthenticated list 401s', (await call('GET', '/api/projects')).status === 401);

  console.log('\n--- reference ---');
  const phases = await call('GET', '/api/reference/phases', { token: sh });
  ok('7 phases, 11 transitions', phases.body.phases.length === 7 && phases.body.transitions.length === 11);
  const tagSets = await call('GET', '/api/reference/tags', { token: sh });
  ok('8 tag sets, 56 tags', tagSets.body.tagSets.length === 8 &&
    tagSets.body.tagSets.reduce((n, s) => n + s.tags.length, 0) === 56);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
