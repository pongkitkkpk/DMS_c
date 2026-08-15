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

  // ------------------------------------------------------------------
  // Granting roles. This is the only endpoint in the system that creates
  // authority rather than spending it, so the assertions that matter are the
  // refusals — a STUACT that can mint a STUACT can reach any jurisdiction in
  // two steps, and a role backdated into a closed year is authority over
  // decisions already made.
  console.log('\n--- granting roles ---');

  ok('a student cannot list who holds what',
    (await call('GET', '/api/memberships', { token: sh })).status === 403);
  ok('  …nor search people',
    (await call('GET', '/api/people?q=fixture', { token: sh })).status === 403);
  ok('  …nor grant anything',
    (await call('POST', '/api/memberships', {
      token: sh, body: { personId: 1, role: 'SH', academicYear: year, clubId },
    })).status === 403);
  ok('an adviser cannot grant either',
    (await call('POST', '/api/memberships', {
      token: ad, body: { personId: 1, role: 'SH', academicYear: year, clubId },
    })).status === 403);
  ok('unauthenticated memberships 401', (await call('GET', '/api/memberships')).status === 401);

  const found = await call('GET', '/api/people?q=fixture', { token: stuact });
  ok('an officer can search people who have signed in', found.status === 200 && found.body.people.length >= 4,
    found.text.slice(0, 200));
  ok('  …but a listing is refused — the term has a minimum',
    (await call('GET', '/api/people?q=fi', { token: stuact })).status === 400);

  const advisorPerson = found.body.people.find((p) => p.idStudent === 'fixture.advisor');
  const adminPerson = found.body.people.find((p) => p.idStudent === 'fixture.admin');
  // หัวหน้าชมรม must be a student account, so every SH grant below that is meant
  // to succeed uses one. The staff accounts stay where the point is a refusal.
  const studentPerson = found.body.people.find((p) => p.idStudent === 'fixture.otherstudent');
  const shPerson2 = found.body.people.find((p) => p.idStudent === 'fixture.student');

  ok('an unknown person is refused, not created',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: 999999, role: 'SH', academicYear: year, clubId },
    })).status === 400);

  // A4 made concrete: the adviser already holds AD at this club for this year,
  // and is about to hold SH as well. If person and membership had been collapsed
  // this call could not succeed.
  const second = await call('POST', '/api/memberships', {
    token: stuact, body: { personId: studentPerson.id, role: 'SH', academicYear: year, clubId },
  });
  ok('A4: one person may hold a second role in the same year', second.status === 201,
    second.text.slice(0, 250));
  ok('  …and granting the same one twice is a conflict, not a silent success',
    (await call('POST', '/api/memberships', {
      token: stuact, body: { personId: studentPerson.id, role: 'SH', academicYear: year, clubId },
    })).status === 409);

  // A club in a different group from the STUACT's, found through the Admin's
  // full list and the STUACT's own jurisdiction.
  //
  // It used to be read through `otherSh`'s token — their own club, which the
  // fixtures put in another group. That broke the moment the A4 test above
  // granted that same student a second club: `clubVisibilityClause` resolves
  // from their *primary* membership, and with two equal-precedence SH rows the
  // choice between them is arbitrary, so "the other student's club" quietly
  // became a club inside the jurisdiction and the refusal under test stopped
  // being the one intended. Derived from the group id, it cannot drift.
  const stuactGroup = (await call('GET', '/api/me', { token: stuact })).body.membership.jurisdiction_club_group_id;
  const outsideClub = (await call('GET', '/api/reference/clubs', { token: admin }))
    .body.clubs.find((c) => Number(c.clubGroupId) !== Number(stuactGroup));
  ok('STUACT cannot grant into a club outside its jurisdiction',
    (await call('POST', '/api/memberships', {
      // A student, so the refusal is the jurisdiction rule and not the
      // account-type rule that would fire first for a staff account.
      token: stuact, body: { personId: shPerson2.id, role: 'SH', academicYear: year, clubId: outsideClub.id },
    })).status === 403);
  // A STUACT may appoint a colleague beside it — the owner's call — but only
  // into its own jurisdiction. Into another group it would be reaching that
  // group in two steps, which would make every other scope check decorative.
  const groups0 = await call('GET', '/api/reference/club-groups', { token: admin });
  const myGroup = (await call('GET', '/api/me', { token: stuact })).body.membership.jurisdiction_club_group_id;
  const otherGroup = groups0.body.clubGroups.find((g) => Number(g.id) !== Number(myGroup));
  ok('STUACT may appoint another STUACT in its own jurisdiction',
    (await call('POST', '/api/memberships', {
      token: stuact,
      body: { personId: adminPerson.id, role: 'STUACT', academicYear: year, jurisdictionClubGroupId: myGroup },
    })).status === 201);
  ok('  …but never into another one — that would be reach, not delegation',
    (await call('POST', '/api/memberships', {
      token: stuact,
      body: { personId: advisorPerson.id, role: 'STUACT', academicYear: year, jurisdictionClubGroupId: otherGroup.id },
    })).status === 403);
  ok('STUACT still cannot mint an ADMIN',
    (await call('POST', '/api/memberships', {
      token: stuact, body: { personId: adminPerson.id, role: 'ADMIN', academicYear: year },
    })).status === 403);
  ok('  …and the list it is offered says so',
    (await call('GET', '/api/memberships', { token: stuact })).body.grantableRoles.join() === 'SH,AD,STUACT');

  const groups = await call('GET', '/api/reference/club-groups', { token: admin });
  const grantStuact = await call('POST', '/api/memberships', {
    token: admin,
    body: {
      personId: advisorPerson.id, role: 'STUACT', academicYear: year,
      jurisdictionClubGroupId: groups.body.clubGroups[0].id,
    },
  });
  ok('ADMIN may appoint a STUACT to a jurisdiction', grantStuact.status === 201,
    grantStuact.text.slice(0, 250));

  // The shape `ck_membership_scope` insists on, refused with a sentence.
  ok('a club role without a club is refused',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: adminPerson.id, role: 'SH', academicYear: year },
    })).status === 400);
  ok('a STUACT membership cannot also carry a club',
    (await call('POST', '/api/memberships', {
      token: admin,
      body: { personId: adminPerson.id, role: 'STUACT', academicYear: year, clubId, jurisdictionClubGroupId: 1 },
    })).status === 400);
  ok('an ADMIN membership carries neither',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: adminPerson.id, role: 'ADMIN', academicYear: year, clubId },
    })).status === 400);

  ok('a role cannot be granted into a year that has closed',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: studentPerson.id, role: 'SH', academicYear: year - 1, clubId },
    })).status === 400);
  const nextYearGrant = await call('POST', '/api/memberships', {
    token: admin, body: { personId: studentPerson.id, role: 'SH', academicYear: year + 1, clubId },
  });
  ok('  …but next year may be prepared in advance', nextYearGrant.status === 201,
    nextYearGrant.text.slice(0, 250));
  ok('  …and no further than that',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: studentPerson.id, role: 'SH', academicYear: year + 2, clubId },
    })).status === 400);

  const listedNext = await call('GET', `/api/memberships?year=${year + 1}`, { token: admin });
  // Identified by the membership's own id, not by who holds it. The same
  // student legitimately holds a role in both years by now, so matching on the
  // person would be asserting the fixtures rather than the year filter.
  const nextYearId = nextYearGrant.body.membership.id;
  ok('the list is per year, so next year\'s grant shows there and not in this one',
    listedNext.body.items.some((m) => m.id === nextYearId) &&
    !(await call('GET', `/api/memberships?year=${year}`, { token: admin }))
      .body.items.some((m) => m.id === nextYearId),
    `membership ${nextYearId}`);
  // What an officer may list is what it may hand out. Before a STUACT could
  // appoint another STUACT this list was club roles only, which after the change
  // meant it could create a colleague it could then never see or revoke — a
  // write-only grant, worse than not being allowed to grant at all.
  const stuactSees = (await call('GET', '/api/memberships', { token: stuact })).body.items;
  ok('STUACT sees the club roles in its jurisdiction',
    stuactSees.some((m) => m.club !== null));
  ok('  …and the officers of that jurisdiction, which it may now appoint',
    stuactSees.some((m) => m.role === 'STUACT' && m.jurisdiction !== null));
  ok('  …and nothing outside it: no ADMIN, no other group\'s officer',
    stuactSees.every((m) => m.role !== 'ADMIN') &&
    stuactSees.every((m) => m.club === null || Number(m.club.clubGroupId) === Number(myGroup)),
    JSON.stringify(stuactSees.map((m) => [m.role, m.club && m.club.clubGroupId, m.jurisdiction && m.jurisdiction.nameTh])));


  // ------------------------------------------------------------------
  // Revoking. The row goes and the record stays, so what is worth checking is
  // that the record really is written, that the refusals hold, and that
  // nothing else in the system depended on the row that was deleted.
  console.log('\n--- revoking roles ---');

  const beforeRevoke = await call('GET', '/api/memberships', { token: stuact });
  // The second SH the A4 test granted at this club — a role the STUACT may act
  // on, and not the club's original head, so revoking it leaves the fixtures
  // usable for everything after this point.
  const target = beforeRevoke.body.items.find(
    (m) => m.person.idStudent === 'fixture.otherstudent' && m.role === 'SH' &&
           m.club && m.club.id === clubId);

  ok('a student cannot revoke',
    (await call('DELETE', `/api/memberships/${target.id}`, { token: sh })).status === 403);
  ok('unauthenticated revoke 401',
    (await call('DELETE', `/api/memberships/${target.id}`)).status === 401);
  ok('revoking something that does not exist is 404',
    (await call('DELETE', '/api/memberships/999999', { token: admin })).status === 404);

  const gone = await call('DELETE', `/api/memberships/${target.id}`, { token: stuact });
  ok('STUACT may revoke a club role in its own jurisdiction', gone.status === 200,
    gone.text.slice(0, 250));
  ok('  …and the membership is really gone',
    !(await call('GET', '/api/memberships', { token: stuact }))
      .body.items.some((m) => m.id === target.id));
  ok('  …and revoking it twice is 404, not a second success',
    (await call('DELETE', `/api/memberships/${target.id}`, { token: stuact })).status === 404);

  // The point of the whole design: history hangs off `person`, not off
  // `membership`, so nothing the revoked officer did disappears with the row.
  const survives = await call('GET', `/api/projects/${id}`, { token: stuact });
  ok('the projects and history the row authorised are untouched', survives.status === 200);

  ok('STUACT cannot revoke a role it could not have granted',
    (await call('DELETE', `/api/memberships/${grantStuact.body.membership.id}`, { token: stuact }))
      .status === 403);

  // Standing on the branch you are cutting. Checked with ADMIN because ADMIN is
  // the only role allowed to grant its own kind, so it is the only one that
  // reaches this rule — a STUACT is stopped one rule earlier, by the role check.
  const meAsAdmin = (await call('GET', '/api/me', { token: admin })).body;
  ok('an officer cannot revoke the membership they are acting under',
    (await call('DELETE', `/api/memberships/${meAsAdmin.membership.id}`, { token: admin }))
      .status === 400);
  // A STUACT reaches the same rule now that it may grant its own kind. Before
  // the owner widened GRANTABLE_ROLES it was stopped one step earlier, by the
  // role check — so widening what an officer may hand out also widened what the
  // self-revoke guard has to catch, and this is where that shows.
  ok('  …and a STUACT is caught by the same rule, not by the role check',
    (await call('DELETE',
      `/api/memberships/${(await call('GET', '/api/me', { token: stuact })).body.membership.id}`,
      { token: stuact })).status === 400);
  ok('  …so the acting officer is still there afterwards',
    (await call('GET', '/api/me', { token: admin })).body.role === 'ADMIN');

  // Warned about before it happens, because nothing on screen would otherwise
  // suggest that revoking an adviser stops their club's projects being saved.
  const advisorRow = (await call('GET', '/api/memberships', { token: stuact }))
    .body.items.find((m) => m.role === 'AD');
  const impact = await call('GET', `/api/memberships/${advisorRow.id}/impact`, { token: stuact });
  ok('revoking an adviser reports how many projects it will strand',
    impact.status === 200 && impact.body.projects > 0, impact.text.slice(0, 200));
  ok('  …and a student cannot ask',
    (await call('GET', `/api/memberships/${advisorRow.id}/impact`, { token: sh })).status === 403);

  // Scope, not just role. Asking about a membership through its id must refuse
  // wherever revoking it would — otherwise the count of another jurisdiction's
  // projects leaks out through a membership id instead of a club id, which is
  // deviation 1 wearing a different hat.
  const adminOwnRow = (await call('GET', '/api/memberships', { token: admin }))
    .body.items.find((m) => m.role === 'ADMIN');
  ok('an officer cannot ask about a membership outside its jurisdiction',
    (await call('GET', `/api/memberships/${adminOwnRow.id}/impact`, { token: stuact }))
      .status === 403);
  ok('  …and an id that does not exist is 404, not an empty answer',
    (await call('GET', '/api/memberships/999999/impact', { token: admin })).status === 404);

  // The search is a search. An unescaped wildcard would make the three-character
  // minimum meaningless and turn it back into the listing it refuses to be.
  ok('a LIKE wildcard in the search term matches nothing rather than everyone',
    (await call('GET', '/api/people?q=%25%25%25', { token: admin })).body.people.length === 0);
  ok('  …and the search does not hand out email addresses no screen asked for',
    (await call('GET', '/api/people?q=fixture', { token: admin }))
      .body.people.every((p) => p.email === undefined));

  // The record is the whole reason the row may be deleted. If it is not
  // written, the delete is data loss rather than a revocation.
  const log = await call('GET', '/api/memberships/events', { token: admin });
  ok('every grant and revoke is recorded', log.status === 200 &&
    log.body.events.some((e) => e.action === 'GRANT') &&
    log.body.events.some((e) => e.action === 'REVOKE'),
    log.text.slice(0, 250));
  ok('  …newest first',
    log.body.events.every((e, i, all) =>
      i === 0 || new Date(all[i - 1].occurredAt) >= new Date(e.occurredAt)));

  const revokeEntry = log.body.events.find((e) => e.action === 'REVOKE');
  ok('  …and a revocation survives the row it describes',
    revokeEntry.personName && revokeEntry.role && revokeEntry.academicYear > 0 &&
    revokeEntry.actorName,
    JSON.stringify(revokeEntry));
  ok('  …naming who did it, not just what happened',
    revokeEntry.actorName === 'สมศักดิ์ กิจการ', revokeEntry.actorName);

  ok('the log is scoped like the memberships are',
    (await call('GET', '/api/memberships/events', { token: stuact }))
      .body.events.every((e) => e.scope !== null));
  ok('  …and a student cannot read it',
    (await call('GET', '/api/memberships/events', { token: sh })).status === 403);
  ok('  …and "events" is not read as a membership id',
    (await call('GET', '/api/memberships/events', { token: admin })).status === 200);

  // ------------------------------------------------------------------
  // Next year's readiness. The interesting property is that it moves: it must
  // read zero before anything is prepared and count up as things are, or it is
  // just a banner that always says the same thing.
  console.log('\n--- is next year ready ---');

  // Measured as deltas, not as absolutes: earlier blocks in this run have
  // already prepared parts of next year, and a check that assumed a clean slate
  // would be asserting the order of this file rather than the behaviour.
  const inScope = (await call('GET', '/api/reference/clubs', { token: stuact })).body.clubs;
  const ready = await call('GET', '/api/readiness', { token: stuact });

  ok('the readiness report names the year after this one',
    ready.status === 200 && ready.body.academicYear === year + 1, ready.text.slice(0, 200));
  ok('  …counts the clubs in scope, not every club',
    ready.body.clubsTotal === inScope.length && inScope.length > 1,
    `${ready.body.clubsTotal} vs ${inScope.length}`);
  ok('  …and a year with most of its clubs unprepared is not ready',
    ready.body.ready === false && ready.body.clubsWithHead < ready.body.clubsTotal,
    JSON.stringify(ready.body));

  // A club that nothing in this run has touched yet, so the numbers have to
  // move rather than merely already being right.
  const untouched = inScope.find((c) => c.id !== clubId);

  await call('PUT', '/api/allocations', {
    token: stuact, body: { clubId: untouched.id, academicYear: year + 1, amount: '10000' },
  });
  const afterFunding = await call('GET', '/api/readiness', { token: stuact });
  ok('funding another club for next year moves the count',
    afterFunding.body.clubsFunded === ready.body.clubsFunded + 1,
    `${ready.body.clubsFunded} -> ${afterFunding.body.clubsFunded}`);

  await call('POST', '/api/memberships', {
    token: stuact,
    body: { personId: studentPerson.id, role: 'SH', academicYear: year + 1, clubId: untouched.id },
  });
  const afterRole = await call('GET', '/api/readiness', { token: stuact });
  ok('granting another club\'s student head moves the count',
    afterRole.body.clubsWithHead === ready.body.clubsWithHead + 1,
    `${ready.body.clubsWithHead} -> ${afterRole.body.clubsWithHead}`);
  ok('  …counted per club, so a second head at the same club adds nothing',
    (await call('POST', '/api/memberships', {
      token: stuact,
      body: { personId: shPerson2.id, role: 'SH', academicYear: year + 1, clubId: untouched.id },
    })).status === 201 &&
    (await call('GET', '/api/readiness', { token: stuact })).body.clubsWithHead ===
      afterRole.body.clubsWithHead);
  ok('  …and it is still not ready while other clubs are unprepared',
    afterRole.body.ready === false && afterRole.body.clubsTotal > 2);

  ok('a student cannot read the readiness report',
    (await call('GET', '/api/readiness', { token: sh })).status === 403);
  ok('  …nor a student in another club',
    (await call('GET', '/api/readiness', { token: otherSh })).status === 403);

  // หัวหน้าชมรม is a student — what `domain-model.md` always said and no rule
  // had ever read. Enforcing it also closes the only route by which one person
  // could hold SH (opens projects) and STUACT (approves their money).
  const stuactPerson = found.body.people.find((p) => p.idStudent === 'fixture.stuact');
  ok('a staff account cannot be made หัวหน้าชมรม',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: stuactPerson.id, role: 'SH', academicYear: year, clubId },
    })).status === 400);
  ok('  …including by the officer themselves, which is what closes self-approval',
    (await call('POST', '/api/memberships', {
      token: stuact, body: { personId: stuactPerson.id, role: 'SH', academicYear: year, clubId },
    })).status === 400);
  ok('  …while the other roles are unconstrained by account type',
    (await call('POST', '/api/memberships', {
      token: admin, body: { personId: stuactPerson.id, role: 'AD', academicYear: year, clubId },
    })).status === 201);

  // A4 in the wild. `fixture.advisor` was an adviser and was granted STUACT
  // earlier in this run, so they now hold both; ROLE_PRECEDENCE resolves them
  // as a STUACT and the officer endpoints open up. Worth pinning, because it is
  // the one place a person's permissions change without their AD role changing.
  ok('an adviser who was also made an officer is treated as the officer',
    (await call('GET', '/api/readiness', { token: ad })).status === 200 &&
    (await call('GET', '/api/me', { token: ad })).body.role === 'STUACT' &&
    (await call('GET', '/api/me', { token: ad })).body.memberships.length === 2);

  ok('unauthenticated readiness 401', (await call('GET', '/api/readiness')).status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nrun aborted:', err.stack || err.message);
  process.exit(1);
});
