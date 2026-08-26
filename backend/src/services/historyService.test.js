/**
 * `historyService.js` answers "how did last year go" and "is next year ready"
 * — both cross-year views nothing else in the system provides. `listYears`
 * combines allocation and project totals that come from different tables on
 * purpose, so a disagreement between them is visible rather than absorbed;
 * `nextYearReadiness` collapses several readiness counts into one `ready`
 * flag. Both are driven here through a fake `pool` (query dispatched by SQL
 * shape, same approach as the other service tests).
 */
function makeConn(overrides = {}) {
  const state = {
    allocationRows: [],   // allocationTotals — one row per (year)
    projectRows: [],      // projectTotals — one row per (year, phase)
    clubsTotal: 0,
    clubsFunded: 0,
    roleRows: [],          // [{ role, clubs }]
    admins: 0,
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('clubs_over')) return [state.allocationRows];
    if (text.includes('FROM project p') && text.includes('GROUP BY p.academic_year, ph.id')) {
      return [state.projectRows];
    }
    if (text.includes('COUNT(*) AS total') && text.includes('agency_allocation')) {
      return [[{ total: state.clubsFunded }]];
    }
    if (text.includes('COUNT(*) AS total FROM club c')) {
      return [[{ total: state.clubsTotal }]];
    }
    if (text.includes('COUNT(DISTINCT m.club_id) AS clubs')) return [state.roleRows];
    if (text.includes('AS admins')) return [[{ admins: state.admins }]];

    throw new Error(`makeConn: unhandled query: ${text}, params=${JSON.stringify(params)}`);
  });

  return { query, state };
}

function loadHistoryService(connState = {}) {
  jest.resetModules();
  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));
  const historyService = require('./historyService');
  return { historyService, conn, state: conn.state };
}

const actorWith = (role, academicYear = 2569, extra = {}) => ({
  person: { id: 1 },
  academicYear,
  membership: role ? { role, club_id: 10, jurisdiction_club_group_id: 5, ...extra } : null,
});

describe('listYears — which years qualify', () => {
  test('a year with only allocations still appears', async () => {
    const { historyService } = loadHistoryService({
      allocationRows: [{ year: 2567, clubs_funded: 3, allocated: '10000.00', clubs_over: 0 }],
    });
    const { items } = await historyService.listYears(actorWith('ADMIN', 2569));
    expect(items.map((i) => i.academicYear)).toContain(2567);
  });

  test('a year with only projects still appears', async () => {
    const { historyService } = loadHistoryService({
      projectRows: [{ year: 2568, phase_code: 'DRAFT_PROPOSAL', phase_ordinal: 1, phase_name_th: 'ร่าง', projects: 4, approved: 0 }],
    });
    const { items } = await historyService.listYears(actorWith('ADMIN', 2569));
    expect(items.map((i) => i.academicYear)).toContain(2568);
  });

  test('the current academic year always appears, even with nothing recorded', async () => {
    const { historyService } = loadHistoryService();
    const { items } = await historyService.listYears(actorWith('ADMIN', 2569));
    expect(items).toEqual([expect.objectContaining({ academicYear: 2569, isCurrent: true, projectCount: 0 })]);
  });
});

describe('listYears — the figures', () => {
  test('allocated and committed come from different tables, so a gap between them shows as overCommitted', async () => {
    const { historyService } = loadHistoryService({
      allocationRows: [{ year: 2569, clubs_funded: 2, allocated: '5000.00', clubs_over: 1 }],
      projectRows: [{ year: 2569, phase_code: 'BUDGET_APPROVED', phase_ordinal: 4, phase_name_th: 'อนุมัติเงิน', projects: 1, approved: '6000.00' }],
    });

    const { items } = await historyService.listYears(actorWith('ADMIN', 2569));
    const year = items.find((i) => i.academicYear === 2569);

    expect(year.allocated).toBe('5000.00');
    expect(year.committed).toBe('6000.00');
    expect(year.remaining).toBe('-1000.00');
    expect(year.overCommitted).toBe(true);
    expect(year.clubsOverCommitted).toBe(1);
  });

  test('byPhase carries every phase’s project count for the year', async () => {
    const { historyService } = loadHistoryService({
      projectRows: [
        { year: 2569, phase_code: 'DRAFT_PROPOSAL', phase_ordinal: 1, phase_name_th: 'ร่าง', projects: 3, approved: 0 },
        { year: 2569, phase_code: 'CLOSED', phase_ordinal: 7, phase_name_th: 'ปิดโครงการ', projects: 2, approved: '4000.00' },
      ],
    });

    const { items } = await historyService.listYears(actorWith('ADMIN', 2569));
    const year = items.find((i) => i.academicYear === 2569);

    expect(year.projectCount).toBe(5);
    expect(year.byPhase.map((p) => p.code)).toEqual(['DRAFT_PROPOSAL', 'CLOSED']);
  });
});

describe('nextYearReadiness', () => {
  test.each(['SH', 'AD', null])('%s may not see next year’s readiness', async (role) => {
    const { historyService } = loadHistoryService();
    await expect(historyService.nextYearReadiness(actorWith(role))).rejects.toMatchObject({ status: 403 });
  });

  test('ready only when every club is funded and every club has a student head', async () => {
    const { historyService } = loadHistoryService({
      clubsTotal: 5,
      clubsFunded: 5,
      roleRows: [{ role: 'SH', clubs: 5 }, { role: 'AD', clubs: 3 }],
      admins: 1,
    });

    const result = await historyService.nextYearReadiness(actorWith('ADMIN', 2569));

    expect(result.ready).toBe(true);
    expect(result.clubsWithAdvisor).toBe(3);
    expect(result.hasAdmin).toBe(true);
  });

  test('not ready when some clubs are unfunded, even if every club has a head', async () => {
    const { historyService } = loadHistoryService({
      clubsTotal: 5, clubsFunded: 3, roleRows: [{ role: 'SH', clubs: 5 }],
    });
    const result = await historyService.nextYearReadiness(actorWith('ADMIN', 2569));
    expect(result.ready).toBe(false);
  });

  test('a scope with zero clubs at all is never "ready" — vacuous completeness is not readiness', async () => {
    const { historyService } = loadHistoryService({ clubsTotal: 0, clubsFunded: 0, roleRows: [] });
    const result = await historyService.nextYearReadiness(actorWith('STUACT', 2569));
    expect(result.ready).toBe(false);
  });

  test('addresses next year, not the current one', async () => {
    const { historyService, conn } = loadHistoryService({ clubsTotal: 1, clubsFunded: 1, roleRows: [{ role: 'SH', clubs: 1 }] });
    const result = await historyService.nextYearReadiness(actorWith('ADMIN', 2569));
    expect(result.academicYear).toBe(2570);
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining('AS admins'), [2570]);
  });
});
