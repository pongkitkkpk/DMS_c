#!/usr/bin/env node
/**
 * Phase 3 acceptance run.
 *
 *   npm run db:reset          # the assertions below start from the fixtures
 *   npm run dev               # in another terminal
 *   npm run check:phase3
 *
 * The build plan's "Done when" list for Phase 3, made executable: each of the
 * three limits can be demonstrated to block, with distinct errors; concurrent
 * approvals against one allocation cannot both succeed; and no stored total
 * exists that could disagree with its components.
 *
 * Black-box against a live server on port 3001, like `check-phase2.js`, and for
 * the same reason: what is worth checking here is end-to-end — which HTTP status
 * a refusal carries, whether a refused transition left anything behind, and
 * whether two requests in flight at once can both win.
 *
 * It writes to the development database and expects freshly seeded fixtures.
 * Run it on its own: it creates projects, so `check:phase2`'s row counts will
 * not hold afterwards.
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

/** A line worth `total` baht, as one C-category row. */
const line = (total, description = 'ค่าวัสดุอุปกรณ์') =>
  ({ category: 'C', description, qty1: '1', unit1: 'ชุด', unitPrice: String(total) });

const codes = (res) => (res.body && res.body.budgetViolations || []).map((v) => v.code);
const warnCodes = (list) => (list || []).map((w) => w.code);

(async () => {
  const sh = await login('fixture.student');
  const ad = await login('fixture.advisor');
  const stuact = await login('fixture.stuact');
  const admin = await login('fixture.admin');
  const otherSh = await login('fixture.otherstudent');

  /** Create a draft, state a plan, state its lines. Returns the project id. */
  async function draft(name, planned, requested) {
    const created = await call('POST', '/api/projects', {
      token: sh,
      body: { name, eventStartOn: '2024-08-01', eventEndOn: '2024-08-02', contact1Name: 'ผู้ประสานงาน' },
    });
    if (created.status !== 201) throw new Error(`create ${name} -> ${created.status} ${created.text}`);
    const id = created.body.id;
    await call('PUT', `/api/projects/${id}/budget/plan`, { token: sh, body: { plannedAmount: String(planned) } });
    await call('PUT', `/api/projects/${id}/budget/lines/PLANNED`, { token: sh, body: { items: [line(requested)] } });
    return id;
  }

  // Migration 006 (check-signature.js) put a signature requirement on
  // BUDGET_APPROVED, REPORT_SUBMITTED and CLOSED. This suite is testing the
  // three money limits, not the signature, so `advance` always carries one for
  // those codes — including the calls this file expects to be refused for a
  // *budget* reason (`blockedB` below), because omitting it would refuse them
  // for the wrong reason (400, no signature) before the limit under test ever
  // runs.
  const VALID_PNG = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const SIGNATURE_GATED = new Set(['PROPOSAL_SUBMITTED', 'BUDGET_APPROVED', 'REPORT_SUBMITTED', 'CLOSED']);
  const advance = (token, id, toPhaseCode) =>
    call('POST', `/api/projects/${id}/transitions`, {
      token,
      body: { toPhaseCode, ...(SIGNATURE_GATED.has(toPhaseCode) ? { signatureImage: VALID_PNG } : {}) },
    });

  // ------------------------------------------------------------------
  console.log('\n--- derived totals: nothing summable is stored ---');

  const fixtures = await call('GET', '/api/projects', { token: sh });
  // BUDGET_APPROVED: far enough along to have actuals and a disbursement, and
  // still open, so the two refusal checks below are refused by the rule under
  // test rather than by the project being closed.
  const anyProject = fixtures.body.items.find((p) => p.phase.code === 'BUDGET_APPROVED');
  const overview = await call('GET', `/api/projects/${anyProject.id}/budget`, { token: sh });
  ok('budget reads in one call', overview.status === 200, overview.text.slice(0, 200));

  const planned = overview.body.lines.planned;
  const sumOf = (rows) => rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
  ok('every line amount is qty1 x qty2 x unit_price, computed by the database',
    planned.every((r) => Math.round(Number(r.amount) * 100) ===
      Math.round(Number(r.qty1 || 1) * Number(r.qty2 || 1) * Number(r.unit_price) * 100)),
    JSON.stringify(planned[0]));
  ok('requested_total is the sum of its lines',
    Math.round(Number(overview.body.money.requestedTotal) * 100) === sumOf(planned),
    `${overview.body.money.requestedTotal} vs ${sumOf(planned) / 100}`);
  ok('actual_total is the sum of its lines',
    Math.round(Number(overview.body.money.actualTotal) * 100) === sumOf(overview.body.lines.actual));
  ok('remaining is approved - disbursed, not a column',
    Math.round(Number(overview.body.money.remaining) * 100) ===
    Math.round(Number(overview.body.money.approvedAmount) * 100) -
    Math.round(Number(overview.body.money.disbursedTotal) * 100));
  ok('refund is approved - actual',
    Math.round(Number(overview.body.money.refundTotal) * 100) ===
    Math.round(Number(overview.body.money.approvedAmount) * 100) -
    Math.round(Number(overview.body.money.actualTotal) * 100));

  const withAmount = await call('PUT', `/api/projects/${anyProject.id}/budget/lines/PLANNED`, {
    token: stuact,
    body: { items: [{ ...line(100), amount: '999999' }] },
  });
  ok('a client-stated line total is refused, not ignored',
    withAmount.status === 400 && /amount/.test(withAmount.body.error), withAmount.text.slice(0, 200));

  const thirdDecimal = await call('PUT', `/api/projects/${anyProject.id}/budget/plan`, {
    token: stuact, body: { plannedAmount: '100.005' },
  });
  ok('a third decimal place is refused rather than rounded', thirdDecimal.status === 400, thirdDecimal.text.slice(0, 150));

  // ------------------------------------------------------------------
  console.log('\n--- ordinals are the server\'s to assign, per category ---');

  const ordinalProject = await draft('โครงการทดสอบ ordinal', 10000, 1000);
  const interleaved = await call('PUT', `/api/projects/${ordinalProject}/budget/lines/PLANNED`, {
    token: sh,
    body: { items: [
      { category: 'A', description: 'วิทยากร', qty1: '2', qty2: '3', unitPrice: '500' },
      { category: 'C', description: 'วัสดุ 1', unitPrice: '100' },
      { category: 'A', description: 'ผู้ช่วย', qty1: '1', qty2: '2', unitPrice: '300' },
      { category: 'C', description: 'วัสดุ 2', unitPrice: '200' },
    ] },
  });
  ok('lines accepted', interleaved.status === 200, interleaved.text.slice(0, 200));
  const back = (await call('GET', `/api/projects/${ordinalProject}/budget`, { token: sh })).body.lines.planned;
  const ordinalsOf = (category) => back.filter((r) => r.category === category).map((r) => r.ordinal);
  ok('ordinal restarts inside each category',
    JSON.stringify(ordinalsOf('A')) === '[1,2]' && JSON.stringify(ordinalsOf('C')) === '[1,2]',
    JSON.stringify(back.map((r) => `${r.category}${r.ordinal}`)));
  ok('categories read back grouped, not interleaved',
    back.map((r) => r.category).join('') === 'AACC', back.map((r) => r.category).join(''));

  // ------------------------------------------------------------------
  console.log('\n--- layer (a): request <= plan ---');

  const p = await draft('โครงการทดสอบ Phase 3', 10000, 12000);

  const overPlan = await call('GET', `/api/projects/${p}/budget`, { token: sh });
  ok('over-plan is visible while drafting, as a warning',
    warnCodes(overPlan.body.warnings).includes('REQUEST_OVER_PLAN'), JSON.stringify(overPlan.body.warnings));
  ok('nothing else is warned about while drafting — no approved amount is due yet',
    !warnCodes(overPlan.body.warnings).includes('APPROVED_AMOUNT_MISSING'));

  const submit = await advance(sh, p, 'PROPOSAL_SUBMITTED');
  ok('draft submit is allowed and warns (Q26)',
    submit.status === 200 && warnCodes(submit.body.budgetWarnings).includes('REQUEST_OVER_PLAN'),
    submit.text.slice(0, 250));

  const blockedA = await advance(stuact, p, 'PROJECT_APPROVED');
  ok('layer (a) hard-blocks approval', blockedA.status === 422, blockedA.text.slice(0, 250));
  ok('  with its own code', codes(blockedA).join() === 'REQUEST_OVER_PLAN', codes(blockedA).join());
  ok('  and a message naming both numbers',
    /12,000\.00/.test(blockedA.body.error) && /10,000\.00/.test(blockedA.body.error), blockedA.body.error);

  const stillThere = await call('GET', `/api/projects/${p}`, { token: stuact });
  ok('a refused transition changed nothing', stillThere.body.phase.code === 'PROPOSAL_SUBMITTED');
  const eventsAfterBlock = await call('GET', `/api/projects/${p}/events`, { token: stuact });
  ok('and logged nothing',
    !eventsAfterBlock.body.events.some((e) => e.to_phase_code === 'PROJECT_APPROVED'));

  await call('PUT', `/api/projects/${p}/budget/plan`, { token: stuact, body: { plannedAmount: '12000' } });
  const approvedProject = await advance(stuact, p, 'PROJECT_APPROVED');
  ok('raising the plan lets it through', approvedProject.status === 200, approvedProject.text.slice(0, 250));
  ok('and the project number is issued as before', Boolean(approvedProject.body.projectNumber));

  // ------------------------------------------------------------------
  console.log('\n--- layer (c): club-year total <= allocation ---');

  const clubId = stillThere.body.club.id;
  const year = stillThere.body.academicYear;
  const allocationsBefore = await call('GET', `/api/allocations?clubId=${clubId}`, { token: admin });
  const committed = Number(allocationsBefore.body.items[0].committed);
  ok('allocations report committed and remaining', allocationsBefore.status === 200 &&
    allocationsBefore.body.items[0].remaining !== undefined, allocationsBefore.text.slice(0, 250));

  const tighten = await call('PUT', '/api/allocations', {
    token: admin, body: { clubId, academicYear: year, amount: String(committed + 5000) },
  });
  ok('an admin sets the ceiling', tighten.status === 200, tighten.text.slice(0, 200));

  const blockedC = await call('POST', `/api/projects/${p}/budget/approve`, {
    token: stuact, body: { approvedAmount: '12000' },
  });
  ok('layer (c) hard-blocks the approval that would exceed it', blockedC.status === 422, blockedC.text.slice(0, 250));
  ok('  with its own code', codes(blockedC).join() === 'CLUB_YEAR_OVER_ALLOCATION', codes(blockedC).join());
  ok('  and the approval rolled back',
    (await call('GET', `/api/projects/${p}/budget`, { token: stuact })).body.money.approvedAmount === null);

  await call('PUT', '/api/allocations', { token: admin, body: { clubId, academicYear: year, amount: '500000' } });
  const approvedMoney = await call('POST', `/api/projects/${p}/budget/approve`, {
    token: stuact, body: { approvedAmount: '12000' },
  });
  ok('raising the ceiling lets it through', approvedMoney.status === 200, approvedMoney.text.slice(0, 250));
  ok('the club-year figures come back with it',
    approvedMoney.body.money.clubYearCommitted !== null && approvedMoney.body.money.clubYearRemaining !== null);

  const budgetApproved = await advance(stuact, p, 'BUDGET_APPROVED');
  ok('and the BUDGET_APPROVED gate now passes', budgetApproved.status === 200, budgetApproved.text.slice(0, 250));

  console.log('\n--- layer (c): a club with no allocation at all ---');

  const otherList = await call('GET', '/api/projects', { token: otherSh });
  const other = otherList.body.items[0];
  await call('PUT', `/api/projects/${other.id}/budget/plan`, { token: otherSh, body: { plannedAmount: '5000' } });
  await call('PUT', `/api/projects/${other.id}/budget/lines/PLANNED`, { token: otherSh, body: { items: [line(5000)] } });
  await advance(otherSh, other.id, 'PROPOSAL_SUBMITTED');
  const otherApproved = await advance(admin, other.id, 'PROJECT_APPROVED');
  ok('a club with no ceiling still gets its project approved', otherApproved.status === 200, otherApproved.text.slice(0, 200));

  const noCeiling = await call('POST', `/api/projects/${other.id}/budget/approve`, {
    token: admin, body: { approvedAmount: '5000' },
  });
  ok('but money cannot be approved against a ceiling nobody set', noCeiling.status === 422, noCeiling.text.slice(0, 250));
  ok('  with its own code', codes(noCeiling).join() === 'ALLOCATION_MISSING', codes(noCeiling).join());

  await call('PUT', '/api/allocations', {
    token: admin, body: { clubId: other.club.id, academicYear: year, amount: '50000' },
  });
  ok('once the ceiling exists the same call succeeds',
    (await call('POST', `/api/projects/${other.id}/budget/approve`, {
      token: admin, body: { approvedAmount: '5000' },
    })).status === 200);

  console.log('\n--- Q33: lowering below committed is allowed, loudly ---');

  const lowered = await call('PUT', '/api/allocations', {
    token: admin, body: { clubId: other.club.id, academicYear: year, amount: '1000' },
  });
  ok('the write is accepted', lowered.status === 200, lowered.text.slice(0, 200));
  ok('  and says so', warnCodes(lowered.body.warnings).includes('ALLOCATION_BELOW_COMMITTED'),
    JSON.stringify(lowered.body.warnings));
  ok('  and the row reads back over-committed for the dashboard',
    lowered.body.allocation.overCommitted === true && Number(lowered.body.allocation.remaining) < 0,
    JSON.stringify(lowered.body.allocation));
  const flagged = await call('GET', '/api/allocations', { token: admin });
  ok('  and is listed under overCommitted',
    flagged.body.overCommitted.some((a) => a.club.id === other.club.id));
  await call('PUT', '/api/allocations', {
    token: admin, body: { clubId: other.club.id, academicYear: year, amount: '50000' },
  });

  // ------------------------------------------------------------------
  console.log('\n--- layer (b): spend <= approved ---');

  const tooMuch = await call('POST', `/api/projects/${p}/disbursements`, {
    token: stuact, body: { amount: '13000', receivedByName: 'นักศึกษา', issuedByName: 'เจ้าหน้าที่' },
  });
  ok('money out beyond the approved amount is refused at the moment it is paid',
    tooMuch.status === 422, tooMuch.text.slice(0, 250));
  ok('  with its own code', codes(tooMuch).join() === 'DISBURSED_OVER_APPROVED', codes(tooMuch).join());

  const paid1 = await call('POST', `/api/projects/${p}/disbursements`, {
    token: stuact, body: { amount: '9000', receivedByName: 'นักศึกษา', issuedByName: 'เจ้าหน้าที่' },
  });
  ok('within it, it is recorded', paid1.status === 201, paid1.text.slice(0, 200));
  ok('  and remaining is the subtraction', paid1.body.money.remaining === '3000.00', paid1.body.money.remaining);

  const paid2 = await call('POST', `/api/projects/${p}/disbursements`, {
    token: stuact, body: { amount: '4000', receivedByName: 'นักศึกษา', issuedByName: 'เจ้าหน้าที่' },
  });
  ok('a second payment is checked against the running total, not against itself',
    paid2.status === 422 && codes(paid2).join() === 'DISBURSED_OVER_APPROVED', paid2.text.slice(0, 200));
  ok('  and the refused payment left no row',
    (await call('GET', `/api/projects/${p}/disbursements`, { token: stuact })).body.disbursements.length === 1);

  await call('POST', `/api/projects/${p}/disbursements`, {
    token: stuact, body: { amount: '3000', receivedByName: 'นักศึกษา', issuedByName: 'เจ้าหน้าที่' },
  });

  await advance(sh, p, 'DRAFT_REPORT');
  const overspend = await call('PUT', `/api/projects/${p}/budget/lines/ACTUAL`, {
    token: sh, body: { items: [line(15000, 'ค่าใช้จ่ายจริง')] },
  });
  ok('an over-approved actual can still be *recorded* while drafting the report',
    overspend.status === 200, overspend.text.slice(0, 200));
  ok('  as a warning', warnCodes(overspend.body.warnings).includes('ACTUAL_OVER_APPROVED'),
    JSON.stringify(overspend.body.warnings));

  const blockedB = await advance(stuact, p, 'REPORT_SUBMITTED');
  ok('layer (b) hard-blocks the report', blockedB.status === 422, blockedB.text.slice(0, 250));
  ok('  with its own code', codes(blockedB).join() === 'ACTUAL_OVER_APPROVED', codes(blockedB).join());

  await call('PUT', `/api/projects/${p}/budget/lines/ACTUAL`, {
    token: stuact, body: { items: [line(11000, 'ค่าใช้จ่ายจริง')] },
  });
  const reported = await advance(stuact, p, 'REPORT_SUBMITTED');
  ok('bringing the spend inside the approval lets the report through',
    reported.status === 200, reported.text.slice(0, 250));
  const closing = await call('GET', `/api/projects/${p}/budget`, { token: stuact });
  ok('the refund is approved - actual', closing.body.money.refundTotal === '1000.00', closing.body.money.refundTotal);
  ok('closing the project needs no further check', (await advance(stuact, p, 'CLOSED')).status === 200);

  // ------------------------------------------------------------------
  // `disbursement` is the one foreign key of the fourteen pointing at `project`
  // that does not cascade, so deleting a project money was paid out of used to
  // hit the constraint and answer a bare 500. The ledger is the reason to
  // refuse, so the refusal says so.
  console.log('\n--- a project that money has left cannot be deleted ---');

  const undeletable = await call('DELETE', `/api/projects/${p}`, { token: admin });
  ok('an Admin deleting a project with disbursements is refused, not crashed',
    undeletable.status === 409, `${undeletable.status} ${undeletable.text.slice(0, 200)}`);
  ok('  …and told it is the money that stops it',
    // Two payments were recorded above: 9,000 then 3,000. The count is in the
    // message because "it has money against it" is not actionable on its own.
    /เบิกจ่าย/.test(undeletable.body.error) && undeletable.body.disbursements === 2,
    undeletable.text.slice(0, 200));
  ok('  …and the project is still there',
    (await call('GET', `/api/projects/${p}`, { token: admin })).status === 200);

  const spendless = await draft('โครงการที่ยังไม่มีการเบิกจ่าย', 1000, 1000);
  ok('a project no money has left still deletes',
    (await call('DELETE', `/api/projects/${spendless}`, { token: admin })).status === 200);

  console.log('\n--- the three refusals are three different messages ---');
  const messages = [blockedA.body.error, blockedB.body.error, blockedC.body.error];
  ok('distinct messages per layer (Q32)', new Set(messages).size === 3, JSON.stringify(messages));

  // ------------------------------------------------------------------
  console.log('\n--- concurrency: one allocation, two approvals ---');

  const x = await draft('โครงการแข่งกัน ก', 8000, 8000);
  const y = await draft('โครงการแข่งกัน ข', 8000, 8000);
  for (const id of [x, y]) {
    await advance(sh, id, 'PROPOSAL_SUBMITTED');
    const r = await advance(stuact, id, 'PROJECT_APPROVED');
    if (r.status !== 200) throw new Error(`could not stage ${id}: ${r.text}`);
  }

  const now = await call('GET', `/api/allocations?clubId=${clubId}`, { token: admin });
  const room = Number(now.body.items[0].committed) + 12000;   // fits one 8,000, not two
  await call('PUT', '/api/allocations', { token: admin, body: { clubId, academicYear: year, amount: String(room) } });

  const [rx, ry] = await Promise.all([
    call('POST', `/api/projects/${x}/budget/approve`, { token: stuact, body: { approvedAmount: '8000' } }),
    call('POST', `/api/projects/${y}/budget/approve`, { token: admin, body: { approvedAmount: '8000' } }),
  ]);
  const winners = [rx, ry].filter((r) => r.status === 200);
  const losers = [rx, ry].filter((r) => r.status !== 200);
  ok('exactly one approval wins', winners.length === 1, `${rx.status}/${ry.status}`);
  ok('the other is refused by the ceiling, not by a crash',
    losers.length === 1 && losers[0].status === 422 &&
    codes(losers[0]).join() === 'CLUB_YEAR_OVER_ALLOCATION',
    losers.map((l) => `${l.status} ${l.text.slice(0, 120)}`).join());

  const after = await call('GET', `/api/allocations?clubId=${clubId}`, { token: admin });
  ok('the committed total never passed the ceiling',
    Number(after.body.items[0].committed) <= Number(after.body.items[0].amount),
    `${after.body.items[0].committed} of ${after.body.items[0].amount}`);

  // ------------------------------------------------------------------
  console.log('\n--- who may touch money ---');

  ok('SH cannot approve their own budget',
    (await call('POST', `/api/projects/${x}/budget/approve`, { token: sh, body: { approvedAmount: '1' } })).status === 403);
  ok('SH cannot record a disbursement',
    (await call('POST', `/api/projects/${x}/disbursements`, {
      token: sh, body: { amount: '1', receivedByName: 'a', issuedByName: 'b' },
    })).status === 403);
  ok('SH cannot set an allocation',
    (await call('PUT', '/api/allocations', {
      token: sh, body: { clubId, academicYear: year, amount: '1' },
    })).status === 403);
  ok('the adviser is still a viewer',
    (await call('PUT', `/api/projects/${x}/budget/lines/PLANNED`, { token: ad, body: { items: [] } })).status === 403);
  ok('STUACT cannot fund a club outside its jurisdiction',
    (await call('PUT', '/api/allocations', {
      token: stuact, body: { clubId: other.club.id, academicYear: year, amount: '1' },
    })).status === 403);
  ok('SH cannot read another club\'s budget — 404, not 403',
    (await call('GET', `/api/projects/${other.id}/budget`, { token: sh })).status === 404);
  ok('SH sees only their own club\'s allocations',
    (await call('GET', '/api/allocations', { token: sh })).body.items.every((a) => a.club.id === clubId));
  ok('unauthenticated allocations 401', (await call('GET', '/api/allocations')).status === 401);
  ok('a closed project refuses further money',
    (await call('POST', `/api/projects/${p}/budget/approve`, {
      token: admin, body: { approvedAmount: '1' },
    })).status === 403);
  ok('money cannot be approved before the project is',
    (await call('POST', `/api/projects/${ordinalProject}/budget/approve`, {
      token: admin, body: { approvedAmount: '1' },
    })).status === 400);
  ok('nothing can be disbursed before the money is approved',
    (await call('POST', `/api/projects/${ordinalProject}/disbursements`, {
      token: admin, body: { amount: '1', receivedByName: 'a', issuedByName: 'b' },
    })).status === 400);

  // ------------------------------------------------------------------
  // The ceiling is per (club, year) and each year is set fresh, so a second
  // year must be reachable and must not disturb the first. Until the year
  // filter was used by a caller this was only true in the schema: the list
  // answered with every year at once, and the dashboard rendered the club name
  // alone, so two years would have shown each club twice, indistinguishably.
  console.log('\n--- allocations are per academic year ---');

  const nextYear = year + 1;
  const thisYearBefore = await call('GET', `/api/allocations?year=${year}&clubId=${clubId}`, { token: admin });
  const thisYearAmount = thisYearBefore.body.items[0].amount;

  ok('an allocation can be set for a year that is not the current one',
    (await call('PUT', '/api/allocations', {
      token: admin, body: { clubId, academicYear: nextYear, amount: '123456' },
    })).status === 200);

  const next = await call('GET', `/api/allocations?year=${nextYear}`, { token: admin });
  ok('the year filter returns only that year',
    next.status === 200 && next.body.items.length > 0 &&
    next.body.items.every((a) => a.academicYear === nextYear),
    next.text.slice(0, 200));

  const current = await call('GET', `/api/allocations?year=${year}`, { token: admin });
  ok('the current year does not see the other year\'s row',
    current.body.items.every((a) => a.academicYear === year));

  ok('setting one year left the other year\'s amount alone',
    current.body.items.find((a) => a.club.id === clubId).amount === thisYearAmount,
    `${thisYearAmount} -> ${(current.body.items.find((a) => a.club.id === clubId) || {}).amount}`);

  ok('committed is counted per year, so the new year starts uncommitted',
    Number(next.body.items.find((a) => a.club.id === clubId).committed) === 0);

  ok('`years` lists every year in scope, newest first',
    Array.isArray(next.body.years) &&
    next.body.years.includes(year) && next.body.years.includes(nextYear) &&
    next.body.years[0] >= next.body.years[next.body.years.length - 1],
    JSON.stringify(next.body.years));

  // A year picker built from another club's years would name years this caller
  // cannot see a single row of — so the data half of the range is scoped like
  // the rows are. Tested with a far year, because the current one and the one
  // after it are offered to everybody by design.
  const farYear = year + 3;
  await call('PUT', '/api/allocations', {
    token: admin, body: { clubId, academicYear: farYear, amount: '1000' },
  });
  ok('`years` picks up a far year for the club that has one',
    (await call('GET', '/api/allocations', { token: sh })).body.years.includes(farYear));
  ok('`years` is scoped — another club\'s far year is not offered',
    !(await call('GET', '/api/allocations', { token: otherSh })).body.years.includes(farYear));

  ok('`years` is not narrowed by the year asked for',
    (await call('GET', `/api/allocations?year=${nextYear}`, { token: admin }))
      .body.years.includes(year));

  // The state a fresh academic year opens in. If the picker were derived from
  // the rows on screen, filtering to an empty year would leave nothing to
  // choose — including the year the officer came to the screen to fill in.
  ok('the current year is always offered even with nothing recorded in it',
    (await call('GET', `/api/allocations?year=${year + 5}`, { token: admin }))
      .body.years.includes(year));

  // Without this the year is unreachable until it has been funded, and it
  // cannot be funded until it is reachable — so next year could never be set up
  // in advance, which is the workflow the whole screen exists for.
  ok('next year is offered before anything has been recorded in it',
    (await call('GET', '/api/allocations', { token: otherSh })).body.years.includes(year + 1));

  ok('a year outside the Buddhist-era range is refused',
    (await call('GET', '/api/allocations?year=1999', { token: admin })).status === 400);

  // ------------------------------------------------------------------
  // `GET /api/spending` — the same three figures every screen above computes,
  // rolled up per club and per campus for the officers who hold more than one
  // club. The point of these assertions is that it is a *view*: nothing here
  // may disagree with the allocation rows it summarises.
  console.log('\n--- 6. the spending summary agrees with what it summarises ---');

  const spending = await call('GET', '/api/spending', { token: admin });
  ok('an officer may read the summary', spending.status === 200, spending.text.slice(0, 120));

  const allocationRows = (await call('GET', `/api/allocations?year=${year}`, { token: admin })).body;
  const sum = (rows, field) =>
    rows.reduce((total, row) => total + Math.round(Number(row[field]) * 100), 0);

  ok('  …its allocated total is the allocation rows added up',
    Math.round(Number(spending.body.totals.allocated) * 100)
      === sum(allocationRows.items, 'amount'),
    `${spending.body.totals.allocated} vs ${allocationRows.items.length} rows`);
  ok('  …and its committed total is theirs too',
    Math.round(Number(spending.body.totals.committed) * 100)
      === sum(allocationRows.items, 'committed'));

  ok('every club it lists rolls up into its campus',
    spending.body.byCampus.every((campus) =>
      Math.round(Number(campus.allocated) * 100) === sum(
        spending.body.byClub.filter((club) => club.campus.id === campus.campus.id), 'allocated')));

  // The level between a campus and a club. `club.club_group_id` is nullable —
  // only D04's ชมรม sit in a group — so the rollup needs a bucket for the rest
  // rather than dropping sixteen clubs or filing them somewhere they are not.
  ok('  …and into its club group, including the clubs that belong to none',
    spending.body.byClubGroup.every((group) =>
      Math.round(Number(group.allocated) * 100) === sum(
        spending.body.byClub.filter((club) =>
          (club.club.clubGroupId === null ? null : Number(club.club.clubGroupId))
            === group.clubGroup.id), 'allocated')),
    JSON.stringify(spending.body.byClubGroup.map((g) => [g.clubGroup.nameTh, g.allocated])));
  ok('  …with every club counted in exactly one group',
    spending.body.byClubGroup.reduce((total, group) => total + group.clubs, 0)
      === spending.body.totals.clubs);
  ok('the unaffiliated clubs are named as such rather than filed under a group',
    spending.body.byClubGroup.some((group) =>
      group.clubGroup.id === null && group.clubGroup.nameTh === 'ไม่สังกัดกลุ่มชมรม'));

  // A STUACT's jurisdiction *is* one club group, so its own summary has exactly
  // one — which is why the screen checks the length before drawing a chart of
  // it. A comparison of one is not a comparison.
  ok('a STUACT sees exactly the one club group it holds',
    (await call('GET', '/api/spending', { token: stuact })).body.byClubGroup.length === 1);

  // A club is listed for an allocation *or* for projects — a club spending
  // against a ceiling nobody set is the state worth not dropping. Asserted as
  // the union rather than by looking for a zero-allocation club, because
  // whether one exists depends on what the assertions above happened to fund.
  const projectItems = (await call('GET', `/api/projects?year=${year}&pageSize=200`, { token: admin }))
    .body.items;
  const fromProjects = projectItems.map((project) => project.club.id);
  const expected = [...new Set([
    ...allocationRows.items.map((row) => row.club.id),
    ...fromProjects,
  ])].sort((a, b) => a - b);

  ok('a club is listed for an allocation or for projects — the union, not either alone',
    JSON.stringify(spending.body.byClub.map((club) => club.club.id).sort((a, b) => a - b))
      === JSON.stringify(expected),
    JSON.stringify(spending.body.byClub.map((c) => [c.club.code, c.allocated, c.projects])));
  ok('  …and the clubs with nothing at all are counted rather than listed',
    spending.body.totals.idleClubs + spending.body.totals.activeClubs
      === spending.body.totals.clubs);

  // `submitted`/`closed` split the same project count by phase — DRAFT_PROPOSAL
  // counts toward neither (nothing has been sent yet), CLOSED counts only
  // toward `closed`, everything else counts toward `submitted`.
  const expectedByClub = new Map();
  for (const project of projectItems) {
    const entry = expectedByClub.get(project.club.id) || { submitted: 0, closed: 0 };
    if (project.phase.code === 'CLOSED') entry.closed += 1;
    else if (project.phase.code !== 'DRAFT_PROPOSAL') entry.submitted += 1;
    expectedByClub.set(project.club.id, entry);
  }
  ok('submitted/closed counts agree with each club\'s projects, split by phase',
    spending.body.byClub.every((club) => {
      const want = expectedByClub.get(club.club.id) || { submitted: 0, closed: 0 };
      return club.submitted === want.submitted && club.closed === want.closed;
    }),
    JSON.stringify(spending.body.byClub.map((c) => [c.club.code, c.submitted, c.closed])));

  // Q33: an allocation may be lowered below what is already committed, and the
  // summary is one of the places that has to say so rather than clamp it.
  const overClub = allocationRows.items[0];
  const restore = overClub.amount;
  await call('PUT', '/api/allocations', {
    token: admin,
    body: { clubId: overClub.club.id, academicYear: year, amount: '1.00' },
  });
  const over = (await call('GET', '/api/spending', { token: admin })).body
    .byClub.find((club) => club.club.id === overClub.club.id);
  ok('an over-committed club is reported as over, with a negative remainder',
    over.overCommitted === true && Number(over.remaining) < 0,
    JSON.stringify(over));
  await call('PUT', '/api/allocations', {
    token: admin,
    body: { clubId: overClub.club.id, academicYear: year, amount: restore },
  });

  ok('a STUACT sees its own jurisdiction and no more',
    (await call('GET', '/api/spending', { token: stuact })).body.totals.clubs
      < spending.body.totals.clubs);
  ok('a student may not read it at all',
    (await call('GET', '/api/spending', { token: sh })).status === 403);
  ok('  …nor may an adviser',
    (await call('GET', '/api/spending', { token: ad })).status === 403);
  ok('it is behind authentication like everything else',
    (await call('GET', '/api/spending')).status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nrun aborted:', err.message);
  process.exit(1);
});
