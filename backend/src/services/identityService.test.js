/**
 * `identityService.js` is where a signed-in identity turns into an ordered
 * list of memberships — `requireAuth` and `sessionBody` both take
 * `memberships[0]` as "the" role for someone who holds more than one (A4).
 * `loadMemberships`'s `ROLE_PRECEDENCE` sort and `describeAccounts`'s
 * best-role selection for the login directory are the two places that
 * ordering is actually decided, so these tests target them directly through
 * a fake `pool`.
 */
function makeConn(overrides = {}) {
  const state = {
    membershipRows: [],
    describeRows: [],
    ...overrides,
  };

  const query = jest.fn(async (sql) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('FROM membership m') && text.includes('LEFT JOIN club')) {
      return [state.membershipRows];
    }
    if (text.includes('FROM person p') && text.includes('LEFT JOIN membership m')) {
      return [state.describeRows];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

function loadIdentityService(connState = {}) {
  jest.resetModules();
  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));
  const identityService = require('./identityService');
  return { identityService, conn, state: conn.state };
}

describe('loadMemberships — ROLE_PRECEDENCE ordering', () => {
  test('sorts ADMIN, STUACT, AD, SH in that order regardless of row order', async () => {
    const { identityService } = loadIdentityService({
      membershipRows: [
        { id: 1, role: 'SH' },
        { id: 2, role: 'AD' },
        { id: 3, role: 'ADMIN' },
        { id: 4, role: 'STUACT' },
      ],
    });

    const memberships = await identityService.loadMemberships(1, 2569);

    expect(memberships.map((m) => m.role)).toEqual(['ADMIN', 'STUACT', 'AD', 'SH']);
  });

  test('an already-sorted or partial set is left in the same relative precedence', async () => {
    const { identityService } = loadIdentityService({
      membershipRows: [{ id: 1, role: 'AD' }, { id: 2, role: 'SH' }],
    });
    const memberships = await identityService.loadMemberships(1, 2569);
    expect(memberships.map((m) => m.role)).toEqual(['AD', 'SH']);
  });
});

describe('describeAccounts — the login directory', () => {
  test('shows the most privileged role for someone holding more than one membership', async () => {
    const { identityService } = loadIdentityService({
      describeRows: [
        { id_student: 'fixture.admin', full_name_th: 'ผู้ดูแล', role: 'SH', club_name: 'ชมรม', club_group_name: null },
        { id_student: 'fixture.admin', full_name_th: 'ผู้ดูแล', role: 'ADMIN', club_name: null, club_group_name: null },
      ],
    });

    const [entry] = await identityService.describeAccounts(['fixture.admin'], 2569);

    expect(entry.role).toBe('ADMIN');
  });

  test('a username with no person row yet still appears, with null role', async () => {
    const { identityService } = loadIdentityService({ describeRows: [] });
    const [entry] = await identityService.describeAccounts(['fixture.new'], 2569);
    expect(entry).toEqual({ idStudent: 'fixture.new', fullNameTh: null, role: null, scope: null });
  });

  test('SH/AD scope by club name; STUACT scopes by club-group name; ADMIN has no scope', async () => {
    const { identityService } = loadIdentityService({
      describeRows: [
        { id_student: 'a', full_name_th: 'หนึ่ง', role: 'SH', club_name: 'ชมรมกีฬา', club_group_name: null },
        { id_student: 'b', full_name_th: 'สอง', role: 'STUACT', club_name: null, club_group_name: 'ฝ่ายกีฬา' },
        { id_student: 'c', full_name_th: 'สาม', role: 'ADMIN', club_name: null, club_group_name: null },
      ],
    });

    const results = await identityService.describeAccounts(['a', 'b', 'c'], 2569);

    expect(results.find((r) => r.idStudent === 'a').scope).toBe('ชมรมกีฬา');
    expect(results.find((r) => r.idStudent === 'b').scope).toBe('ฝ่ายกีฬา');
    expect(results.find((r) => r.idStudent === 'c').scope).toBeNull();
  });

  test('preserves the order the usernames were asked for, not the order rows came back in', async () => {
    const { identityService } = loadIdentityService({
      describeRows: [
        { id_student: 'second', full_name_th: 'สอง', role: null, club_name: null, club_group_name: null },
        { id_student: 'first', full_name_th: 'หนึ่ง', role: null, club_name: null, club_group_name: null },
      ],
    });

    const results = await identityService.describeAccounts(['first', 'second'], 2569);

    expect(results.map((r) => r.idStudent)).toEqual(['first', 'second']);
  });

  test('an empty username list is an empty result, with no query at all', async () => {
    const { identityService, conn } = loadIdentityService();
    const results = await identityService.describeAccounts([], 2569);
    expect(results).toEqual([]);
    expect(conn.query).not.toHaveBeenCalled();
  });
});
