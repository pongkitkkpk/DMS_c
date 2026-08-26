/**
 * `evaluate`/`enforce`/`writeBlocks`/`assertTransitionAllowed` are the money
 * gate this file's own header calls the subsystem the old system did not have
 * — `allow_budget` was writable by anyone and nothing ever compared a request
 * against a limit. These are unit tests against those functions directly, with
 * a fake `conn` standing in for `budget_plan_line`/`budget_line`/`disbursement`/
 * `agency_allocation`, rather than going through a route: `evaluate` takes its
 * connection as a parameter precisely so the three layers (a/b/c) can be
 * checked without a database, inside the same transaction the real write runs
 * in. No mocking of `db/pool` is needed here — none of the functions under
 * test call `pool.query` themselves.
 */
const budgetService = require('./budgetService');
const { HttpError } = require('../lib/httpError');

/** A fake `conn` answering `budget_plan_line`/`budget_line`/`disbursement`/`agency_allocation` by query shape. */
function makeConn(overrides = {}) {
  const state = {
    plan: null, // { planned_amount, approved_amount, approved_by, approved_at }
    requestedTotal: '0.00',
    actualTotal: '0.00',
    disbursedTotal: '0.00',
    allocation: null, // { id, amount, campus_id }
    committed: '0.00',
    ...overrides,
  };

  const query = jest.fn(async (sql) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    // Checked first: `readCommitted`'s query also mentions `budget_plan_line`,
    // but joined against `project`, never `WHERE project_id` on its own.
    if (text.includes('budget_plan_line pl')) return [[{ committed: state.committed }]];
    if (text.includes('FROM budget_plan_line WHERE project_id')) {
      return [state.plan ? [state.plan] : []];
    }
    if (text.includes('FROM budget_line WHERE project_id')) {
      return [[{ requested_total: state.requestedTotal, actual_total: state.actualTotal }]];
    }
    if (text.includes('FROM disbursement WHERE project_id')) {
      return [[{ disbursed_total: state.disbursedTotal }]];
    }
    if (text.includes('FROM agency_allocation')) {
      return [state.allocation ? [state.allocation] : []];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

const project = (overrides = {}) => ({ id: 1, club_id: 1, academic_year: 2569, phase_ordinal: 2, ...overrides });

describe('evaluate — layer (a): requested lines vs the plan', () => {
  test('flags lines that exceed the plan, with the over-amount in baht', async () => {
    const conn = makeConn({ plan: { planned_amount: '1000.00' }, requestedTotal: '1500.00' });

    const { findings } = await budgetService.evaluate(conn, project(), ['a']);

    expect(findings).toEqual([
      expect.objectContaining({ code: 'REQUEST_OVER_PLAN', requested: '1500.00', planned: '1000.00', over: '500.00' }),
    ]);
  });

  test('does not flag lines within the plan', async () => {
    const conn = makeConn({ plan: { planned_amount: '1000.00' }, requestedTotal: '1000.00' });

    const { findings } = await budgetService.evaluate(conn, project(), ['a']);

    expect(findings).toEqual([]);
  });
});

describe('evaluate — layer (b): money out vs the approved amount', () => {
  test('flags a missing approved amount only once the project is committing money', async () => {
    const conn = makeConn({ plan: { planned_amount: '1000.00', approved_amount: null } });

    const committing = await budgetService.evaluate(conn, project(), ['b'], { committing: true });
    const drafting = await budgetService.evaluate(conn, project(), ['b'], { committing: false });

    expect(committing.findings).toEqual([expect.objectContaining({ code: 'APPROVED_AMOUNT_MISSING' })]);
    expect(drafting.findings).toEqual([]);
  });

  test('flags disbursements that exceed the approved amount', async () => {
    const conn = makeConn({
      plan: { planned_amount: '1000.00', approved_amount: '1000.00' },
      disbursedTotal: '1200.00',
    });

    const { findings } = await budgetService.evaluate(conn, project(), ['b']);

    expect(findings).toEqual([
      expect.objectContaining({ code: 'DISBURSED_OVER_APPROVED', disbursed: '1200.00', approved: '1000.00', over: '200.00' }),
    ]);
  });

  test('flags actual spend that exceeds the approved amount, separately from disbursement', async () => {
    const conn = makeConn({
      plan: { planned_amount: '1000.00', approved_amount: '1000.00' },
      actualTotal: '1300.00',
    });

    const { findings } = await budgetService.evaluate(conn, project(), ['b']);

    expect(findings).toEqual([
      expect.objectContaining({ code: 'ACTUAL_OVER_APPROVED', actual: '1300.00', approved: '1000.00', over: '300.00' }),
    ]);
  });
});

describe('evaluate — layer (c): the club-year allocation ceiling', () => {
  test('flags a missing allocation only once the project is committing money', async () => {
    const conn = makeConn({ plan: { planned_amount: '1000.00', approved_amount: '1000.00' } });

    const committing = await budgetService.evaluate(conn, project(), ['c'], { committing: true });
    const drafting = await budgetService.evaluate(conn, project(), ['c'], { committing: false });

    expect(committing.findings).toEqual([expect.objectContaining({ code: 'ALLOCATION_MISSING' })]);
    expect(drafting.findings).toEqual([]);
  });

  test('flags the club-year total over its allocation, even while only drafting', async () => {
    // Unlike the missing-allocation case, an *existing* allocation being
    // exceeded is not gated by `committing` — other projects already
    // approved this year are what pushed it over, not this one.
    const conn = makeConn({
      plan: { planned_amount: '1000.00', approved_amount: '1000.00' },
      allocation: { id: 1, amount: '5000.00', campus_id: 1 },
      committed: '5500.00',
    });

    const { findings } = await budgetService.evaluate(conn, project(), ['c'], { committing: false });

    expect(findings).toEqual([
      expect.objectContaining({ code: 'CLUB_YEAR_OVER_ALLOCATION', committed: '5500.00', allocation: '5000.00', over: '500.00' }),
    ]);
  });

  test('does not flag a club-year total within its allocation', async () => {
    const conn = makeConn({
      plan: { planned_amount: '1000.00', approved_amount: '1000.00' },
      allocation: { id: 1, amount: '5000.00', campus_id: 1 },
      committed: '5000.00',
    });

    const { findings } = await budgetService.evaluate(conn, project(), ['c']);

    expect(findings).toEqual([]);
  });
});

describe('enforce', () => {
  test('throws 422 with only the blocked layer’s findings, and keeps the rest as warnings', () => {
    const findings = [
      { layer: 'a', code: 'REQUEST_OVER_PLAN', message: 'a' },
      { layer: 'b', code: 'DISBURSED_OVER_APPROVED', message: 'b' },
    ];

    let caught;
    try {
      budgetService.enforce(findings, ['a']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpError);
    expect(caught.status).toBe(422);
    expect(caught.detail.budgetViolations).toEqual([findings[0]]);
    expect(caught.detail.budgetWarnings).toEqual([findings[1]]);
  });

  test('returns everything as warnings when no layer is enforced', () => {
    const findings = [{ layer: 'b', code: 'DISBURSED_OVER_APPROVED', message: 'b' }];

    expect(budgetService.enforce(findings, [])).toEqual(findings);
  });
});

describe('writeBlocks — which layers must already hold after a mid-phase edit', () => {
  test.each([
    [2, []],
    [3, ['a']],
    [5, ['a']],
    [6, ['a', 'b']],
  ])('phase_ordinal %i -> %j', (ordinal, expected) => {
    expect(budgetService.writeBlocks(ordinal)).toEqual(expected);
  });
});

describe('assertTransitionAllowed', () => {
  test('refuses PROJECT_APPROVED when the requested lines exceed the plan', async () => {
    const conn = makeConn({ plan: { planned_amount: '1000.00' }, requestedTotal: '2000.00' });

    await expect(
      budgetService.assertTransitionAllowed(conn, project(), 'PROJECT_APPROVED')
    ).rejects.toMatchObject({ status: 422 });
  });

  test('allows PROJECT_APPROVED without an approved amount yet — that is not committed until later', async () => {
    const conn = makeConn({ plan: { planned_amount: '1000.00', approved_amount: null }, requestedTotal: '500.00' });

    await expect(
      budgetService.assertTransitionAllowed(conn, project(), 'PROJECT_APPROVED')
    ).resolves.toBeDefined();
  });

  test('refuses BUDGET_APPROVED when it would push the club-year total over its allocation', async () => {
    const conn = makeConn({
      plan: { planned_amount: '1000.00', approved_amount: '1000.00' },
      requestedTotal: '1000.00',
      allocation: { id: 1, amount: '500.00', campus_id: 1 },
      committed: '600.00',
    });

    await expect(
      budgetService.assertTransitionAllowed(conn, project({ phase_ordinal: 3 }), 'BUDGET_APPROVED')
    ).rejects.toMatchObject({ status: 422 });
  });

  test('refuses REPORT_SUBMITTED when actual spend exceeds what was approved', async () => {
    const conn = makeConn({
      plan: { planned_amount: '1000.00', approved_amount: '1000.00' },
      requestedTotal: '1000.00',
      actualTotal: '1500.00',
    });

    await expect(
      budgetService.assertTransitionAllowed(conn, project({ phase_ordinal: 5 }), 'REPORT_SUBMITTED')
    ).rejects.toMatchObject({ status: 422 });
  });
});
