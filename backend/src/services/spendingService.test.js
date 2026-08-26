/**
 * `spendingService.summary` rolls up a year's money by campus, club group and
 * club — the comparison view neither `allocationService` (one club) nor
 * `historyService` (one year of events) answers. The rollup logic (idle-club
 * counting, the "no club group" bucket, sorting) is the part most likely to
 * silently miscount, so these tests drive `summary` through a fake `pool`
 * (query dispatched by SQL shape) rather than only checking `present`'s math.
 */
function makeConn(overrides = {}) {
  const state = {
    clubs: [],
    allocatedRows: [],
    committedRows: [],
    disbursedRows: [],
    yearRows: [],
    ...overrides,
  };

  const query = jest.fn(async (sql) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('SELECT c.id, c.code, c.name_th, c.club_group_id')) return [state.clubs];
    if (text.includes('SELECT DISTINCT a.academic_year AS year')) return [state.yearRows];
    if (text.includes('FROM agency_allocation a') && text.includes('GROUP BY a.club_id')) {
      return [state.allocatedRows];
    }
    if (text.includes('FROM project p') && text.includes('COUNT(*)') && text.includes('GROUP BY p.club_id')) {
      return [state.committedRows];
    }
    if (text.includes('FROM disbursement d')) return [state.disbursedRows];

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

function loadSpendingService(connState = {}) {
  jest.resetModules();
  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));
  const spendingService = require('./spendingService');
  return { spendingService, conn, state: conn.state };
}

const actorWith = (role, extra = {}) => ({
  person: { id: 1 },
  academicYear: 2569,
  membership: role ? { role, jurisdiction_club_group_id: 5, ...extra } : null,
});

const club = (overrides = {}) => ({
  id: 1, code: 'A201', name_th: 'ชมรมหนึ่ง', club_group_id: 5,
  club_group_name: 'ฝ่ายกีฬา', campus_id: 1, campus_abbreviation: 'B', campus_name: 'บางซื่อ',
  ...overrides,
});

describe('assertIsOfficer', () => {
  test.each(['SH', 'AD', null])('%s may not see the spending summary', async (role) => {
    const { spendingService } = loadSpendingService();
    await expect(spendingService.summary(actorWith(role))).rejects.toMatchObject({ status: 403 });
  });

  test.each(['ADMIN', 'STUACT'])('%s may see it', async (role) => {
    const { spendingService } = loadSpendingService({ clubs: [] });
    await expect(spendingService.summary(actorWith(role))).resolves.toBeDefined();
  });
});

describe('summary — idle vs active clubs', () => {
  test('a club with no allocation, commitment, disbursement, or project is idle: counted, not listed', async () => {
    const { spendingService } = loadSpendingService({ clubs: [club({ id: 1 })] });

    const result = await spendingService.summary(actorWith('ADMIN'), { year: 2569 });

    expect(result.totals.idleClubs).toBe(1);
    expect(result.totals.activeClubs).toBe(0);
    expect(result.byClub).toEqual([]);
  });

  test('a club with projects but no money yet is active, not idle', async () => {
    const { spendingService } = loadSpendingService({
      clubs: [club({ id: 1 })],
      committedRows: [{ club_id: 1, projects: 2, total: 0, submitted: 1, closed: 0 }],
    });

    const result = await spendingService.summary(actorWith('ADMIN'), { year: 2569 });

    expect(result.totals.idleClubs).toBe(0);
    expect(result.byClub).toHaveLength(1);
    expect(result.byClub[0].projects).toBe(2);
  });
});

describe('summary — the overCommitted figure carries through the rollup', () => {
  test('a club with committed over its allocation is flagged, and the deficit rolls up into its campus/group too', async () => {
    const { spendingService } = loadSpendingService({
      clubs: [club({ id: 1 })],
      allocatedRows: [{ club_id: 1, total: '5000.00' }],
      committedRows: [{ club_id: 1, projects: 1, total: '6000.00', submitted: 1, closed: 0 }],
    });

    const result = await spendingService.summary(actorWith('ADMIN'), { year: 2569 });

    expect(result.byClub[0].overCommitted).toBe(true);
    expect(result.byClub[0].remaining).toBe('-1000.00');
    expect(result.byCampus[0].remaining).toBe('-1000.00');
    expect(result.byClubGroup[0].remaining).toBe('-1000.00');
  });
});

describe('summary — club-group bucketing', () => {
  test('clubs with no club group fall into a distinct bucket rather than being dropped', async () => {
    const { spendingService } = loadSpendingService({
      clubs: [
        club({ id: 1, club_group_id: 5, club_group_name: 'ฝ่ายกีฬา' }),
        club({ id: 2, club_group_id: null, club_group_name: null }),
      ],
      committedRows: [
        { club_id: 1, projects: 1, total: 0, submitted: 0, closed: 0 },
        { club_id: 2, projects: 1, total: 0, submitted: 0, closed: 0 },
      ],
    });

    const result = await spendingService.summary(actorWith('ADMIN'), { year: 2569 });

    const groupIds = result.byClubGroup.map((g) => g.clubGroup.id);
    expect(groupIds).toContain(5);
    expect(groupIds).toContain(null);
    const noneGroup = result.byClubGroup.find((g) => g.clubGroup.id === null);
    expect(noneGroup.clubGroup.nameTh).toBe('ไม่สังกัดกลุ่มชมรม');
  });
});

describe('summary — byClub is sorted by allocation, then committed, then club code', () => {
  test('bigger ceiling first; a tie on allocation falls back to committed', async () => {
    const { spendingService } = loadSpendingService({
      clubs: [
        club({ id: 1, code: 'B001' }),
        club({ id: 2, code: 'A001' }),
        club({ id: 3, code: 'C001' }),
      ],
      allocatedRows: [
        { club_id: 1, total: '1000.00' },
        { club_id: 2, total: '1000.00' },
        { club_id: 3, total: '5000.00' },
      ],
      committedRows: [
        { club_id: 1, projects: 1, total: '500.00', submitted: 0, closed: 0 },
        { club_id: 2, projects: 1, total: '900.00', submitted: 0, closed: 0 },
        { club_id: 3, projects: 1, total: '100.00', submitted: 0, closed: 0 },
      ],
    });

    const result = await spendingService.summary(actorWith('ADMIN'), { year: 2569 });

    // club 3 first (biggest allocation); between 1 and 2 (tied on allocation),
    // club 2 comes first for the higher committed amount.
    expect(result.byClub.map((c) => c.club.id)).toEqual([3, 2, 1]);
  });
});
