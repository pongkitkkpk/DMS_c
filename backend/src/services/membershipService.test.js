/**
 * `createMembership`/`revokeMembership` are, in this file's own words, "the
 * only place in the system that creates authority" — a mistake here is
 * somebody holding a power they were never given. These tests drive the real
 * functions with a fake `conn`/`pool` (query dispatched by SQL shape, same
 * approach as the other service tests) and `db/pool.transaction` mocked to
 * invoke the callback with it directly.
 */
const { HttpError } = require('../lib/httpError');

/** A fake `conn`/`pool` answering the membership-write queries by SQL shape. */
function makeConn(overrides = {}) {
  const state = {
    person: null,               // { id, full_name_th, account_type }
    club: null,                 // { id, name_th, club_group_id }
    jurisdictionGroup: null,    // { id } or null
    existingMembership: null,   // { id } or null — duplicate-grant check
    createdRow: null,           // full row for the post-insert re-read
    membershipRow: null,        // revoke's target row, or null for not-found
    remainingAdmins: 1,
    nextInsertId: 501,
    inserted: [],
    events: [],
    deleted: [],
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('AS remaining')) return [[{ remaining: state.remainingAdmins }]];
    if (text.includes('FOR UPDATE') && text.includes('FROM membership m')) {
      return [state.membershipRow ? [state.membershipRow] : []];
    }
    if (text.startsWith('SELECT id FROM membership WHERE person_id')) {
      return [state.existingMembership ? [state.existingMembership] : []];
    }
    if (text.startsWith('SELECT m.id, m.role') && text.includes('FROM membership m')) {
      return [state.createdRow ? [state.createdRow] : []];
    }
    if (text.startsWith('SELECT id, full_name_th, account_type FROM person WHERE id')) {
      return [state.person ? [state.person] : []];
    }
    if (text.startsWith('SELECT id, name_th, club_group_id FROM club WHERE id')) {
      return [state.club ? [state.club] : []];
    }
    if (text.startsWith('SELECT id FROM club_group WHERE id')) {
      return [state.jurisdictionGroup ? [state.jurisdictionGroup] : []];
    }
    if (text.startsWith('INSERT INTO membership_event')) {
      state.events.push(params);
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO membership')) {
      const insertId = state.nextInsertId++;
      state.inserted.push({ insertId, params });
      return [{ insertId }];
    }
    if (text.startsWith('DELETE FROM membership WHERE id')) {
      state.deleted.push(params[0]);
      return [{ affectedRows: 1 }];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

/** Fresh module registry per test, `db/pool` mocked and the academic year pinned. */
function loadMembershipService(connState = {}) {
  jest.resetModules();
  Object.assign(process.env, { NODE_ENV: 'test', ACADEMIC_YEAR: '2569' });

  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));

  const membershipService = require('./membershipService');
  return { membershipService, conn, state: conn.state };
}

const actorWith = (role, extra = {}) => ({
  person: { id: 1 },
  membership: role ? { id: 900, role, club_id: 10, jurisdiction_club_group_id: 5, ...extra } : null,
});

const validBody = (overrides = {}) => ({
  personId: 42,
  role: 'SH',
  academicYear: 2569,
  clubId: 10,
  ...overrides,
});

describe('createMembership — request shape and the academic-year window', () => {
  test('refuses a role that is not one of the four', async () => {
    const { membershipService } = loadMembershipService();
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody({ role: 'PRESIDENT', clubId: undefined }))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a past academic year, before reading the database', async () => {
    const { membershipService, conn } = loadMembershipService();
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody({ academicYear: 2568 }))
    ).rejects.toMatchObject({ status: 400 });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('refuses more than one year ahead', async () => {
    const { membershipService } = loadMembershipService();
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody({ academicYear: 2571 }))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('allows next year', async () => {
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'students' },
      club: { id: 10, name_th: 'ชมรม', club_group_id: 5 },
      createdRow: { id: 501, role: 'SH', academic_year: 2570, club_id: 10 },
    });
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody({ academicYear: 2570 }))
    ).resolves.toBeDefined();
  });

  test.each([
    ['SH with no club', { role: 'SH', clubId: undefined }],
    ['SH with a jurisdiction as well as no shape match', { role: 'SH', clubId: undefined, jurisdictionClubGroupId: 5 }],
    ['AD with a jurisdiction instead of a club', { role: 'AD', clubId: undefined, jurisdictionClubGroupId: 5 }],
    ['STUACT with no jurisdiction', { role: 'STUACT', clubId: undefined }],
    ['STUACT with a club instead of a jurisdiction', { role: 'STUACT', clubId: 10 }],
    ['ADMIN with a club', { role: 'ADMIN', clubId: 10 }],
    ['ADMIN with a jurisdiction', { role: 'ADMIN', clubId: undefined, jurisdictionClubGroupId: 5 }],
  ])('refuses a scope shape that does not match the role: %s', async (_label, overrides) => {
    const { membershipService } = loadMembershipService();
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody(overrides))
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('createMembership — the checks that run once the shape is right', () => {
  test('refuses a person who has never signed in', async () => {
    const { membershipService } = loadMembershipService({ person: null });
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody())
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses AD with no advisor agency', async () => {
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'personel' },
      club: { id: 10, name_th: 'ชมรม', club_group_id: 5 },
    });
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody({ role: 'AD', advisorAgency: undefined }))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses granting SH to a personel account — the self-approval path this closes', async () => {
    // A person who could hold SH (opens projects) and STUACT (approves their
    // money) could approve their own request; SH is a student role by
    // definition, so enforcing that closes the combination without a
    // separate separation-of-duties rule.
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'บุคลากร', account_type: 'personel' },
      club: { id: 10, name_th: 'ชมรม', club_group_id: 5 },
    });
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody({ role: 'SH' }))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a club id that does not exist', async () => {
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'students' },
      club: null,
    });
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody())
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a jurisdiction (club group) id that does not exist', async () => {
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'personel' },
      jurisdictionGroup: null,
    });
    await expect(
      membershipService.createMembership(
        actorWith('ADMIN'), validBody({ role: 'STUACT', clubId: undefined, jurisdictionClubGroupId: 99 })
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  test('wires through scope’s grant rule: a STUACT may not grant into another jurisdiction', async () => {
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'students' },
      club: { id: 10, name_th: 'ชมรม', club_group_id: 6 }, // outside the actor's jurisdiction (5)
    });
    await expect(
      membershipService.createMembership(actorWith('STUACT', { jurisdiction_club_group_id: 5 }), validBody())
    ).rejects.toMatchObject({ status: 403 });
  });

  test('refuses a duplicate grant rather than upserting it', async () => {
    const { membershipService } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'students' },
      club: { id: 10, name_th: 'ชมรม', club_group_id: 5 },
      existingMembership: { id: 777 },
    });
    await expect(
      membershipService.createMembership(actorWith('ADMIN'), validBody())
    ).rejects.toMatchObject({ status: 409 });
  });

  test('grants the role, records a GRANT event, and returns the created membership', async () => {
    const { membershipService, conn } = loadMembershipService({
      person: { id: 42, full_name_th: 'ทดสอบ', account_type: 'students' },
      club: { id: 10, name_th: 'ชมรม', club_group_id: 5 },
      createdRow: {
        id: 501, role: 'SH', academic_year: 2569, department_th: null, advisor_agency: null, created_at: '2026-01-01',
        person_id: 42, id_student: 'fixture.student', prefix: null, full_name_th: 'ทดสอบ', email: null,
        club_id: 10, club_code: 'A201', club_name: 'ชมรม', club_group_id: 5, club_group_name: null,
        jurisdiction_club_group_id: null, jurisdiction_name: null,
      },
    });

    const result = await membershipService.createMembership(actorWith('ADMIN'), validBody());

    expect(result.membership.id).toBe(501);
    expect(result.membership.person.idStudent).toBe('fixture.student');
    expect(conn.state.inserted).toHaveLength(1);
    expect(conn.state.events).toEqual([expect.arrayContaining(['GRANT'])]);
  });
});

describe('revokeMembership', () => {
  test('refuses a membership id that does not exist', async () => {
    const { membershipService } = loadMembershipService({ membershipRow: null });
    await expect(
      membershipService.revokeMembership(actorWith('ADMIN'), 1)
    ).rejects.toMatchObject({ status: 404 });
  });

  test('wires through scope’s grant rule: a STUACT may not revoke an ADMIN', async () => {
    const { membershipService } = loadMembershipService({
      membershipRow: { id: 1, person_id: 2, role: 'ADMIN', academic_year: 2569, club_id: null, jurisdiction_club_group_id: null, full_name_th: 'ผู้ดูแล', club_group_id: null, club_name: null },
    });
    await expect(
      membershipService.revokeMembership(actorWith('STUACT'), 1)
    ).rejects.toMatchObject({ status: 403 });
  });

  test('refuses to revoke the membership the caller is acting under', async () => {
    const { membershipService } = loadMembershipService({
      membershipRow: { id: 900, person_id: 1, role: 'STUACT', academic_year: 2569, club_id: null, jurisdiction_club_group_id: 5, full_name_th: 'ตัวเอง', club_group_id: null, club_name: null },
    });
    await expect(
      membershipService.revokeMembership(actorWith('ADMIN'), 900)
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses to revoke the last ADMIN of a year', async () => {
    const { membershipService } = loadMembershipService({
      membershipRow: { id: 2, person_id: 3, role: 'ADMIN', academic_year: 2569, club_id: null, jurisdiction_club_group_id: null, full_name_th: 'คนสุดท้าย', club_group_id: null, club_name: null },
      remainingAdmins: 0,
    });
    await expect(
      membershipService.revokeMembership(actorWith('ADMIN'), 2)
    ).rejects.toMatchObject({ status: 400 });
  });

  test('revokes the role and records a REVOKE event when another ADMIN remains', async () => {
    const { membershipService, conn } = loadMembershipService({
      membershipRow: { id: 2, person_id: 3, role: 'ADMIN', academic_year: 2569, club_id: null, jurisdiction_club_group_id: null, full_name_th: 'อีกคน', club_group_id: null, club_name: null },
      remainingAdmins: 1,
    });

    const result = await membershipService.revokeMembership(actorWith('ADMIN'), 2);

    expect(result.revoked.id).toBe(2);
    expect(conn.state.deleted).toEqual([2]);
    expect(conn.state.events).toEqual([expect.arrayContaining(['REVOKE'])]);
  });

  test('revokes a club role without checking the last-ADMIN rule at all', async () => {
    const { membershipService, conn } = loadMembershipService({
      membershipRow: { id: 3, person_id: 4, role: 'SH', academic_year: 2569, club_id: 10, jurisdiction_club_group_id: null, full_name_th: 'หัวหน้า', club_group_id: 5, club_name: 'ชมรม' },
    });

    const result = await membershipService.revokeMembership(actorWith('ADMIN'), 3);

    expect(result.revoked.role).toBe('SH');
    expect(conn.state.deleted).toEqual([3]);
  });
});
