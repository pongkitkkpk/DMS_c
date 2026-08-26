/**
 * `allocationService.js` is layer (c)'s ceiling — the old system had no table
 * for it at all, so a club could approve past whatever it had actually been
 * given and nothing would notice. Q33 is the subtle rule this file carries:
 * lowering an allocation below what is already committed is *allowed*, not
 * blocked — refusing it would only make the system's figure and the
 * university's disagree silently — but it must come back loud, as a warning
 * on the write and an `overCommitted` flag on every later read.
 */
function makeConn(overrides = {}) {
  const state = {
    yearRows: [],          // SELECT DISTINCT a.academic_year ...
    listRows: [],           // full listAllocations SELECT
    club: null,             // { id, name_th, campus_id, club_group_id }
    committed: '0.00',
    upsertedRow: null,      // the final re-read after INSERT ... ON DUPLICATE KEY UPDATE
    inserted: [],
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('SELECT DISTINCT a.academic_year')) return [state.yearRows];
    if (text.startsWith('SELECT id, name_th, campus_id, club_group_id FROM club')) {
      return [state.club ? [state.club] : []];
    }
    if (text.includes('FROM agency_allocation') && text.includes('FOR UPDATE') && !text.includes('SUM')) {
      return [[]]; // the existence-lock SELECT — nothing read from its rows
    }
    if (text.includes('AS committed') && text.includes('FOR UPDATE')) {
      return [[{ committed: state.committed }]];
    }
    if (text.startsWith('INSERT INTO agency_allocation')) {
      state.inserted.push(params);
      return [{ affectedRows: 1 }];
    }
    if (text.includes(') AS committed') && text.includes('agency_allocation a')) {
      // the ALLOCATION_COLUMNS re-read (list or post-write)
      return [state.upsertedRow ? [state.upsertedRow] : (state.listRows.length ? state.listRows : [])];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

function loadAllocationService(connState = {}) {
  jest.resetModules();
  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));
  const allocationService = require('./allocationService');
  return { allocationService, conn, state: conn.state };
}

const actorWith = (role, extra = {}) => ({
  person: { id: 1 },
  academicYear: 2569,
  membership: role ? { role, club_id: 10, jurisdiction_club_group_id: 5, ...extra } : null,
});

describe('present (via listAllocations)', () => {
  const row = (overrides = {}) => ({
    id: 1, club_id: 10, campus_id: 1, academic_year: 2569, amount: '5000.00', updated_at: null,
    club_code: 'A201', club_name: 'ชมรม', club_group_id: 5, club_group_name: null,
    campus_abbreviation: 'B', campus_name: 'บางซื่อ', created_by_name: 'ผู้ดูแล',
    committed: '0.00',
    ...overrides,
  });

  test('remaining is allocated minus committed, and overCommitted flags a negative remainder', async () => {
    const { allocationService } = loadAllocationService({
      listRows: [row({ amount: '5000.00', committed: '6000.00' })],
    });

    const { items } = await allocationService.listAllocations(actorWith('ADMIN'), {});

    expect(items[0].remaining).toBe('-1000.00');
    expect(items[0].overCommitted).toBe(true);
  });

  test('a club within its allocation is not over-committed', async () => {
    const { allocationService } = loadAllocationService({
      listRows: [row({ amount: '5000.00', committed: '3000.00' })],
    });

    const { items } = await allocationService.listAllocations(actorWith('ADMIN'), {});

    expect(items[0].overCommitted).toBe(false);
    expect(items[0].remaining).toBe('2000.00');
  });

  test('listAllocations surfaces the over-committed rows separately for the dashboard', async () => {
    const { allocationService } = loadAllocationService({
      listRows: [
        row({ id: 1, amount: '5000.00', committed: '6000.00' }),
        row({ id: 2, amount: '5000.00', committed: '1000.00' }),
      ],
    });

    const { overCommitted } = await allocationService.listAllocations(actorWith('ADMIN'), {});

    expect(overCommitted.map((r) => r.id)).toEqual([1]);
  });
});

describe('listAllocationYears', () => {
  test('unions the caller’s visible years with the current and next academic year, deduped and newest first', async () => {
    const { allocationService } = loadAllocationService({
      yearRows: [{ academic_year: 2567 }, { academic_year: 2569 }],
    });

    const years = await allocationService.listAllocationYears(actorWith('ADMIN'));

    expect(years).toEqual([2570, 2569, 2567]); // 2570 = actor.academicYear(2569) + 1
  });
});

describe('upsertAllocation', () => {
  test('refuses a club id that does not exist', async () => {
    const { allocationService } = loadAllocationService({ club: null });
    await expect(
      allocationService.upsertAllocation(actorWith('ADMIN'), { clubId: 999, academicYear: 2569, amount: 1000 })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('wires through scope’s rule: STUACT may not set an allocation outside its jurisdiction', async () => {
    const { allocationService } = loadAllocationService({
      club: { id: 10, name_th: 'ชมรม', campus_id: 1, club_group_id: 6 }, // outside jurisdiction 5
    });
    await expect(
      allocationService.upsertAllocation(
        actorWith('STUACT', { jurisdiction_club_group_id: 5 }),
        { clubId: 10, academicYear: 2569, amount: 1000 }
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  test('setting an allocation at or above what is already committed carries no warning', async () => {
    const { allocationService, state } = loadAllocationService({
      club: { id: 10, name_th: 'ชมรม', campus_id: 1, club_group_id: 5 },
      committed: '3000.00',
      upsertedRow: {
        id: 1, club_id: 10, campus_id: 1, academic_year: 2569, amount: '5000.00', updated_at: null,
        club_code: 'A201', club_name: 'ชมรม', club_group_id: 5, club_group_name: null,
        campus_abbreviation: 'B', campus_name: 'บางซื่อ', created_by_name: 'ผู้ดูแล', committed: '3000.00',
      },
    });

    const result = await allocationService.upsertAllocation(
      actorWith('ADMIN'), { clubId: 10, academicYear: 2569, amount: 5000 }
    );

    expect(result.warnings).toEqual([]);
    expect(state.inserted).toHaveLength(1);
  });

  test('Q33: lowering the allocation below what is already committed is allowed, loudly', async () => {
    const { allocationService } = loadAllocationService({
      club: { id: 10, name_th: 'ชมรม', campus_id: 1, club_group_id: 5 },
      committed: '6000.00',
      upsertedRow: {
        id: 1, club_id: 10, campus_id: 1, academic_year: 2569, amount: '5000.00', updated_at: null,
        club_code: 'A201', club_name: 'ชมรม', club_group_id: 5, club_group_name: null,
        campus_abbreviation: 'B', campus_name: 'บางซื่อ', created_by_name: 'ผู้ดูแล', committed: '6000.00',
      },
    });

    const result = await allocationService.upsertAllocation(
      actorWith('ADMIN'), { clubId: 10, academicYear: 2569, amount: 5000 }
    );

    // Not blocked — the write goes through and the allocation is set.
    expect(result.allocation.amount).toBe('5000.00');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'ALLOCATION_BELOW_COMMITTED', shortfall: '1000.00' }),
    ]);
    expect(result.allocation.overCommitted).toBe(true);
  });
});
