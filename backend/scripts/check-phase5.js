#!/usr/bin/env node
/**
 * Phase 5 acceptance run.
 *
 *   npm run db:reset          # the assertions below start from the fixtures
 *   npm run dev               # in another terminal
 *   npm run check:phase5
 *
 * The build plan's "Done when" for Phase 5: every screen works for its roles
 * against the real API, and no screen relies on `sessionStorage` for an
 * authorization decision.
 *
 * The second half is the one a script can actually prove, and it is proved the
 * only way that means anything — by making the requests the screens make, as
 * each role, and checking the server refuses the ones it should. A screen that
 * hides a button proves nothing; a server that answers 403 proves everything.
 *
 * The first half needs eyes, and gets them separately in a browser.
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
  const otherSh = await login('fixture.otherstudent');

  // ------------------------------------------------------------------
  console.log('\n--- reference data the screens load ---');

  const limits = await call('GET', '/api/reference/limits', { token: sh });
  ok('the form learns its limits from the server', limits.status === 200 &&
    limits.body.sections.problems.capacity === 3, limits.text.slice(0, 200));
  ok('  …and they come from the templates, not from a constant in the client',
    limits.body.budget.BT === 12 && limits.body.budget.ETC === 0, JSON.stringify(limits.body.budget));

  const advisors = await call('GET', '/api/reference/advisors', { token: sh });
  ok('the advisor picker is offered the club\'s own AD memberships',
    advisors.status === 200 && advisors.body.advisors.length === 1 &&
    advisors.body.advisors[0].clubName === 'ชมรมพุทธศาสน์', advisors.text.slice(0, 200));
  ok('  …and another club\'s student is offered a different set',
    (await call('GET', '/api/reference/advisors', { token: otherSh }))
      .body.advisors.every((a) => a.clubName !== 'ชมรมพุทธศาสน์'));

  const clubs = await call('GET', '/api/reference/clubs', { token: stuact });
  ok('the allocation screen can list clubs in its jurisdiction',
    clubs.status === 200 && clubs.body.clubs.length > 0, clubs.text.slice(0, 150));
  ok('  …and a student sees only their own club',
    (await call('GET', '/api/reference/clubs', { token: sh })).body.clubs.length === 1);

  // ------------------------------------------------------------------
  console.log('\n--- the create form, end to end ---');

  const created = await call('POST', '/api/projects', {
    token: sh,
    body: {
      name: 'โครงการจากแบบฟอร์ม Phase 5',
      academicTerm: '1/2567',
      advisorPersonId: advisors.body.advisors[0].id,
      isNewProject: true,
      isContinueProject: false,
      prepareStartOn: '2024-06-01',
      prepareEndOn: '2024-06-20',
      eventStartOn: '2024-07-10',
      eventEndOn: '2024-07-12',
      reportDueOn: '2024-08-10',
      contact1Name: 'ผู้ประสานงานหนึ่ง',
      contact1Phone: '0810000001',
      contact2Name: '', contact2Phone: '',
      contact3Name: '', contact3Phone: '',
    },
  });
  ok('the form creates a project', created.status === 201, created.text.slice(0, 250));
  const id = created.body && created.body.id;
  ok('  …with the advisor it chose', created.body.advisor &&
    created.body.advisor.id === advisors.body.advisors[0].id);
  ok('  …and a server-issued draft number', Number.isInteger(created.body.draftSequence));

  const sections = {
    rationales: [{ content: 'เหตุผลข้อที่หนึ่ง' }, { content: 'เหตุผลข้อที่สอง' }],
    objectives: [{ content: 'วัตถุประสงค์ข้อที่หนึ่ง' }],
    types: [{ content: 'กิจกรรมบำเพ็ญประโยชน์' }],
    locations: [{ content: 'หอประชุมเบญจรัตน์' }],
    activities: [
      { topic: 'ประชุมเตรียมงาน', startOn: '2024-06-01', endOn: '2024-06-10', responsible: 'ฝ่ายประสานงาน' },
      { topic: 'จัดกิจกรรม', startOn: '2024-07-10', endOn: '2024-07-12', responsible: 'ทุกฝ่าย' },
    ],
    indicators: [{ expectedResult: 'นักศึกษาเข้าร่วมไม่น้อยกว่าร้อยละ 80', volumeTarget: '120 คน', qualityTarget: 'ความพึงพอใจ 4.0', etcFollow: '' }],
    problems: [{ problem: 'ฝนตก', resolution: 'ย้ายเข้าในอาคาร' }],
    attendance: [
      { variant: 'PLANNED', attendeeType: 'STUDENT', label: 'นักศึกษา', headcount: 120 },
      { variant: 'PLANNED', attendeeType: 'PROFESSOR', label: 'อาจารย์', headcount: 6 },
    ],
  };

  for (const [name, items] of Object.entries(sections)) {
    const r = await call('PUT', `/api/projects/${id}/sections/${name}`, { token: sh, body: { items } });
    ok(`  the form saves ${name}`, r.status === 200 && r.body.count === items.length,
      r.text.slice(0, 200));
  }

  const tagList = await call('GET', '/api/reference/tags', { token: sh });
  const sdg = tagList.body.tagSets.find((s) => s.code === 'SDG');
  const chosenTags = [sdg.tags[3].id, sdg.tags[16].id];
  const tagged = await call('PUT', `/api/projects/${id}/tags`, { token: sh, body: { tagIds: chosenTags } });
  ok('  the form saves tags', tagged.status === 200 && tagged.body.count === 2, tagged.text.slice(0, 200));

  const back = await call('GET', `/api/projects/${id}`, { token: sh });
  ok('everything reads back', back.status === 200);
  ok('  …lists in the order they were entered',
    back.body.sections.rationales.map((r) => r.content).join('|') === 'เหตุผลข้อที่หนึ่ง|เหตุผลข้อที่สอง',
    back.body.sections.rationales.map((r) => r.content).join('|'));
  ok('  …with ordinals the server assigned, never the client',
    back.body.sections.rationales.map((r) => r.ordinal).join(',') === '1,2');
  ok('  …attendance grouped, not interleaved',
    back.body.sections.attendance.every((r) => r.variant === 'PLANNED') &&
    back.body.sections.attendance.map((r) => r.ordinal).join(',') === '1,1',
    JSON.stringify(back.body.sections.attendance.map((r) => [r.attendee_type, r.ordinal])));
  ok('  …and the dates round-trip as dates', String(back.body.eventStartOn).slice(0, 10) === '2024-07-10',
    String(back.body.eventStartOn));

  // ------------------------------------------------------------------
  console.log('\n--- the edit form ---');

  const edited = await call('PATCH', `/api/projects/${id}`, {
    token: sh, body: { name: 'โครงการจากแบบฟอร์ม Phase 5 (แก้ไขแล้ว)' },
  });
  ok('the form edits the core row', edited.status === 200 && /แก้ไขแล้ว/.test(edited.body.name));

  const replaced = await call('PUT', `/api/projects/${id}/sections/objectives`, {
    token: sh, body: { items: [{ content: 'ข้อใหม่ที่หนึ่ง' }, { content: 'ข้อใหม่ที่สอง' }, { content: 'ข้อใหม่ที่สาม' }] },
  });
  ok('  …and replaces a list wholesale rather than merging',
    replaced.body.count === 3 && replaced.body.items.map((i) => i.ordinal).join(',') === '1,2,3');

  const badField = await call('PATCH', `/api/projects/${id}`, {
    token: sh, body: { projectNumber: 'B67042010999' },
  });
  ok('a field the form does not own is refused, not ignored',
    badField.status === 400 && /projectNumber/.test(badField.body.error), badField.text.slice(0, 150));

  const badAdvisor = await call('PATCH', `/api/projects/${id}`, {
    token: sh, body: { advisorPersonId: 9999 },
  });
  ok('an advisor who is not this club\'s is refused', badAdvisor.status === 400, badAdvisor.text.slice(0, 150));

  // ------------------------------------------------------------------
  console.log('\n--- permissions come from the server, not the browser ---');

  const detail = await call('GET', `/api/projects/${id}`, { token: sh });
  ok('the project tells the screen what this caller may do',
    detail.body.permissions && detail.body.permissions.edit === true &&
    detail.body.permissions.delete === true, JSON.stringify(detail.body.permissions));

  const adView = await call('GET', `/api/projects/${id}`, { token: ad });
  ok('the adviser is told it may not edit', adView.body.permissions.edit === false);
  ok('  …and is refused if it tries anyway',
    (await call('PATCH', `/api/projects/${id}`, { token: ad, body: { name: 'x' } })).status === 403);
  ok('  …and may not delete either', adView.body.permissions.delete === false &&
    (await call('DELETE', `/api/projects/${id}`, { token: ad })).status === 403);

  const stuactView = await call('GET', `/api/projects/${id}`, { token: stuact });
  ok('STUACT may edit in scope but not delete',
    stuactView.body.permissions.edit === true && stuactView.body.permissions.delete === false);

  ok('another club\'s student cannot even see it',
    (await call('GET', `/api/projects/${id}`, { token: otherSh })).status === 404);
  ok('  …nor create in this one — creation takes the club from the token',
    (await call('POST', '/api/projects', { token: otherSh, body: { name: 'x' } })).body.club.id !==
      detail.body.club.id);

  // ------------------------------------------------------------------
  console.log('\n--- the dashboard ---');

  const dash = await call('GET', '/api/projects?pageSize=200', { token: stuact });
  ok('the dashboard can count every project in scope in one call',
    dash.status === 200 && dash.body.items.length === dash.body.total, `${dash.body.items.length}/${dash.body.total}`);

  const allocations = await call('GET', '/api/allocations', { token: stuact });
  ok('allocations carry committed and remaining', allocations.status === 200 &&
    allocations.body.items.every((a) => a.committed !== undefined && a.remaining !== undefined));
  ok('  …and the over-committed list is present even when empty',
    Array.isArray(allocations.body.overCommitted));

  const clubId = detail.body.club.id;
  const year = detail.body.academicYear;
  const current = allocations.body.items.find((a) => a.club.id === clubId);
  const lowered = await call('PUT', '/api/allocations', {
    token: stuact, body: { clubId, academicYear: year, amount: '1' },
  });
  ok('Q33: lowering below committed is accepted', lowered.status === 200, lowered.text.slice(0, 200));
  ok('  …and warns, so the dashboard can say so',
    lowered.body.warnings.some((w) => w.code === 'ALLOCATION_BELOW_COMMITTED'),
    JSON.stringify(lowered.body.warnings));
  const flagged = await call('GET', '/api/allocations', { token: stuact });
  ok('  …and the club now appears under overCommitted',
    flagged.body.overCommitted.some((a) => a.club.id === clubId));
  await call('PUT', '/api/allocations', {
    token: stuact, body: { clubId, academicYear: year, amount: current.amount },
  });

  ok('a student may read allocations but not write them',
    (await call('GET', '/api/allocations', { token: sh })).status === 200 &&
    (await call('PUT', '/api/allocations', {
      token: sh, body: { clubId, academicYear: year, amount: '1' },
    })).status === 403);
  ok('the adviser is read-only here too (Q30)',
    (await call('PUT', '/api/allocations', {
      token: ad, body: { clubId, academicYear: year, amount: '1' },
    })).status === 403);

  // ------------------------------------------------------------------
  console.log('\n--- the profile screen ---');

  const me = await call('GET', '/api/me', { token: sh });
  ok('the profile reads the session from the server', me.status === 200 &&
    me.body.person.idStudent === 'fixture.student', me.text.slice(0, 150));
  ok('  …and the role comes with it, resolved from membership',
    me.body.role === 'SH' && me.body.memberships.length >= 1);
  ok('  …and the token carries no role of its own',
    !JSON.parse(Buffer.from(sh.split('.')[1], 'base64url').toString()).role,
    Buffer.from(sh.split('.')[1], 'base64url').toString());
  ok('unauthenticated /me is 401', (await call('GET', '/api/me')).status === 401);

  // ------------------------------------------------------------------
  console.log('\n--- the whole walk, through the screens\' own calls ---');

  await call('PUT', `/api/projects/${id}/budget/plan`, { token: sh, body: { plannedAmount: '5000' } });
  await call('PUT', `/api/projects/${id}/budget/lines/PLANNED`, {
    token: sh,
    body: { items: [{ category: 'C', description: 'ค่าวัสดุ', qty1: '1', unit1: 'ชุด', unitPrice: '5000' }] },
  });
  const walk = [
    ['PROPOSAL_SUBMITTED', sh],
    ['PROJECT_APPROVED', stuact],
    ['BUDGET_APPROVED', stuact],
    ['DRAFT_REPORT', sh],
    ['REPORT_SUBMITTED', stuact],
    ['CLOSED', stuact],
  ];
  let walked = true;
  for (const [code, token] of walk) {
    if (code === 'BUDGET_APPROVED') {
      await call('POST', `/api/projects/${id}/budget/approve`, { token: stuact, body: { approvedAmount: '5000' } });
    }
    if (code === 'REPORT_SUBMITTED') {
      await call('PUT', `/api/projects/${id}/budget/lines/ACTUAL`, {
        token: sh,
        body: { items: [{ category: 'C', description: 'ค่าวัสดุ', qty1: '1', unit1: 'ชุด', unitPrice: '4800' }] },
      });
    }
    const r = await call('POST', `/api/projects/${id}/transitions`, { token, body: { toPhaseCode: code } });
    if (r.status !== 200) { walked = false; console.log(`        (${code}: ${r.status} ${r.text.slice(0, 160)})`); }
  }
  ok('a project created through the form walks 1 → 7', walked);

  const documents = await call('GET', `/api/projects/${id}/documents`, { token: sh });
  ok('  …and produces both government forms at the end',
    documents.body.documents.every((d) => d.available),
    JSON.stringify(documents.body.documents.map((d) => [d.form, d.available, d.reason])));

  // ------------------------------------------------------------------
  // The year summary. Every figure on it exists elsewhere for one year at a
  // time; what is new is reading them across years, so what is worth checking
  // is that the roll-up agrees with the single-year screens rather than
  // computing its own answer, and that it is scoped like they are.
  console.log('\n--- the year summary ---');

  const history = await call('GET', '/api/history', { token: stuact });
  ok('the summary answers with one row per year, newest first',
    history.status === 200 && Array.isArray(history.body.items) &&
    history.body.items.every((y, i, all) => i === 0 || all[i - 1].academicYear > y.academicYear),
    history.text.slice(0, 250));

  const currentRow = history.body.items.find((y) => y.isCurrent);
  ok('the current year is always present, marked, and unique',
    currentRow !== undefined &&
    history.body.items.filter((y) => y.isCurrent).length === 1);

  // The two screens read different tables — the summary sums allocations and
  // approvals itself — so agreement here is a real cross-check, not a tautology.
  const singleYear = await call('GET', `/api/allocations?year=${currentRow.academicYear}`, { token: stuact });
  const allocatedOnAllocationsPage = singleYear.body.items
    .reduce((total, a) => total + Math.round(Number(a.amount) * 100), 0);
  ok('  …and its allocated total matches the allocations screen for that year',
    Math.round(Number(currentRow.allocated) * 100) === allocatedOnAllocationsPage,
    `${currentRow.allocated} vs ${(allocatedOnAllocationsPage / 100).toFixed(2)}`);
  ok('  …and it counts the same funded clubs',
    currentRow.clubsFunded === singleYear.body.items.length);
  ok('  …and reports the same clubs over their ceiling',
    currentRow.clubsOverCommitted === singleYear.body.overCommitted.length);

  const projectsThatYear = await call(
    'GET', `/api/projects?year=${currentRow.academicYear}&pageSize=200`, { token: stuact });
  ok('  …and its project count matches the project list filtered to that year',
    currentRow.projectCount === projectsThatYear.body.total,
    `${currentRow.projectCount} vs ${projectsThatYear.body.total}`);
  ok('  …with the phase counts summing to that same total',
    currentRow.byPhase.reduce((total, p) => total + p.count, 0) === currentRow.projectCount);

  // A year with allocations but no projects, and vice versa, both have to
  // appear — those are the states the edges of a year are actually in.
  await call('PUT', '/api/allocations', {
    token: stuact,
    body: { clubId, academicYear: currentRow.academicYear + 2, amount: '90000' },
  });
  const later = await call('GET', '/api/history', { token: stuact });
  const emptyYear = later.body.items.find((y) => y.academicYear === currentRow.academicYear + 2);
  ok('a year with money but no projects still appears',
    emptyYear !== undefined && emptyYear.projectCount === 0 && emptyYear.allocated === '90000.00',
    JSON.stringify(emptyYear));
  ok('  …and its remaining is the whole allocation',
    emptyYear.remaining === '90000.00' && emptyYear.overCommitted === false);

  ok('the summary is scoped — another club\'s year totals are not visible',
    (await call('GET', '/api/history', { token: otherSh })).body.items
      .every((y) => y.academicYear !== currentRow.academicYear + 2 || Number(y.allocated) === 0));
  ok('an adviser may read the summary',
    (await call('GET', '/api/history', { token: ad })).status === 200);
  ok('unauthenticated summary 401', (await call('GET', '/api/history')).status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nrun aborted:', err.stack || err.message);
  process.exit(1);
});
