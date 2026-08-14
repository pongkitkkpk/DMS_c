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

  const advance = (token, id, toPhaseCode) =>
    call('POST', `/api/projects/${id}/transitions`, { token, body: { toPhaseCode } });

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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nrun aborted:', err.message);
  process.exit(1);
});
