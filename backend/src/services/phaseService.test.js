/**
 * `performTransition` is the phase machine — the file's own header names the
 * old bug this replaces: a hardcoded array offset with no transition table,
 * so a move could not be rejected, could not branch, and the endpoint that
 * performed it was unauthenticated and never answered. These tests drive the
 * real function with a fake `conn` (query dispatched by SQL shape, the same
 * approach as `budgetService.test.js`) and `db/pool.transaction` mocked to
 * just invoke the callback with that `conn` — no real transaction, retry, or
 * database involved. `signatureService` is mocked wholesale: staging and
 * verifying a PNG is that module's own concern, not the phase machine's.
 */
const { HttpError } = require('../lib/httpError');
const { buildClubCode, buildProjectNumber } = require('../lib/clubCode');

/** A fake `conn` answering the phase-machine and budget-check queries `performTransition` issues. */
function makeConn(overrides = {}) {
  const state = {
    current: null,       // the re-read project+phase row, or null to 404
    targetPhase: null,   // { id, code, name_th, ordinal }, or null for an unknown target
    permitted: [],        // [{ allowed_role, requires_budget_check, requires_signature }]
    // Budget layers, same shape as budgetService.test.js's fake conn.
    plan: null,
    requestedTotal: '0.00',
    actualTotal: '0.00',
    disbursedTotal: '0.00',
    allocation: null,
    committed: '0.00',
    // issueProjectNumber
    club: null,           // { code, work_group_code, division_code, abbreviation }
    nextSequence: 1,
    nextEventId: 1,
    events: [],
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('FROM project p JOIN phase ph')) return [state.current ? [state.current] : []];
    if (text.includes('FROM phase WHERE code = ?')) return [state.targetPhase ? [state.targetPhase] : []];
    if (text.includes('FROM phase_transition WHERE from_phase_id')) return [state.permitted];

    if (text.includes('budget_plan_line pl')) return [[{ committed: state.committed }]];
    if (text.includes('FROM budget_plan_line WHERE project_id')) return [state.plan ? [state.plan] : []];
    if (text.includes('FROM budget_line WHERE project_id')) {
      return [[{ requested_total: state.requestedTotal, actual_total: state.actualTotal }]];
    }
    if (text.includes('FROM disbursement WHERE project_id')) return [[{ disbursed_total: state.disbursedTotal }]];
    if (text.includes('FROM agency_allocation')) return [state.allocation ? [state.allocation] : []];

    if (text.includes('FROM club c JOIN division d')) return [state.club ? [state.club] : []];
    if (text.includes('FROM club WHERE id = ?')) return [[{ id: params[0] }]];
    if (text.includes('MAX(project_sequence)')) return [[{ next: state.nextSequence }]];

    if (text.startsWith('UPDATE project SET project_sequence')) return [{ affectedRows: 1 }];
    if (text.startsWith('UPDATE project SET phase_id')) return [{ affectedRows: 1 }];

    if (text.startsWith('INSERT INTO project_event')) {
      const id = state.nextEventId++;
      state.events.push({ id, params });
      return [{ insertId: id }];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

/** Fresh module registry per test, `db/pool` and `signatureService` replaced. */
function loadPhaseService(connState = {}) {
  jest.resetModules();
  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: {},
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));
  const signature = {
    isRequired: jest.fn(async () => false),
    stage: jest.fn(async () => ({ relativePath: 'sig.png', fullPath: '/tmp/sig.png', byteSize: 10 })),
    record: jest.fn(async () => {}),
    discard: jest.fn(async () => {}),
    // The council-endorsement gate (migration 008, TODO.md) — true unless a
    // test says otherwise, so every existing PROJECT_APPROVED -> anything
    // test (none of which target BUDGET_APPROVED) is unaffected.
    hasSignature: jest.fn(async () => true),
  };
  jest.doMock('./signatureService', () => signature);

  const phaseService = require('./phaseService');
  return { phaseService, conn, state: conn.state, signature };
}

const baseCurrent = (overrides = {}) => ({
  id: 1,
  club_id: 10,
  academic_year: 2569,
  phase_id: 100,
  project_sequence: null,
  project_number: null,
  phase_code: 'DRAFT_SUBMITTED',
  phase_name_th: 'ส่งร่างแล้ว',
  phase_ordinal: 1,
  ...overrides,
});
const baseProject = () => ({ id: 1, club_id: 10, academic_year: 2569, phase_id: 100 });
const baseActor = (role) => ({ person: { id: 5 }, membership: role ? { role } : null });

describe('performTransition', () => {
  test('refuses a caller with no membership, before touching the database', async () => {
    const { phaseService, conn } = loadPhaseService();

    await expect(
      phaseService.performTransition(baseActor(null), baseProject(), 'PROPOSAL_SUBMITTED')
    ).rejects.toMatchObject({ status: 403 });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('refuses when the project has moved to another phase since it was read', async () => {
    const { phaseService } = loadPhaseService({ current: baseCurrent({ phase_id: 999 }) });

    await expect(
      phaseService.performTransition(baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED')
    ).rejects.toMatchObject({ status: 409 });
  });

  test('refuses an unknown target phase code', async () => {
    const { phaseService } = loadPhaseService({ current: baseCurrent() });

    await expect(
      phaseService.performTransition(baseActor('SH'), baseProject(), 'NOT_A_REAL_PHASE')
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a move with no transition row at all', async () => {
    const { phaseService } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 200, code: 'PROPOSAL_SUBMITTED', name_th: 'ส่งข้อเสนอแล้ว', ordinal: 2 },
      permitted: [],
    });

    await expect(
      phaseService.performTransition(baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED')
    ).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a real transition when the caller’s role is not among the allowed ones', async () => {
    const { phaseService } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 200, code: 'PROPOSAL_SUBMITTED', name_th: 'ส่งข้อเสนอแล้ว', ordinal: 2 },
      permitted: [{ allowed_role: 'ADMIN', requires_budget_check: 0, requires_signature: 0 }],
    });

    await expect(
      phaseService.performTransition(baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED')
    ).rejects.toMatchObject({ status: 403 });
  });

  test('advances the phase and records the event when no budget check or signature is required', async () => {
    const { phaseService, conn } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 200, code: 'PROPOSAL_SUBMITTED', name_th: 'ส่งข้อเสนอแล้ว', ordinal: 2 },
      permitted: [{ allowed_role: 'SH', requires_budget_check: 0, requires_signature: 0 }],
    });

    const result = await phaseService.performTransition(baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED');

    expect(result.toPhase.code).toBe('PROPOSAL_SUBMITTED');
    expect(result.budgetChecked).toBe(false);
    expect(result.signed).toBe(false);
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE project SET phase_id'), [200, 1]);
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO project_event'), expect.anything());
  });

  test('refuses a budget-checked transition when the money gate fails, and leaves the phase unchanged', async () => {
    const { phaseService, conn } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 201, code: 'PROJECT_APPROVED', name_th: 'โครงการอนุมัติ', ordinal: 3 },
      permitted: [{ allowed_role: 'STUACT', requires_budget_check: 1, requires_signature: 0 }],
      plan: { planned_amount: '1000.00' },
      requestedTotal: '5000.00', // over plan — layer (a) blocks PROJECT_APPROVED
    });

    await expect(
      phaseService.performTransition(baseActor('STUACT'), baseProject(), 'PROJECT_APPROVED')
    ).rejects.toMatchObject({ status: 422 });
    expect(conn.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE project SET phase_id'), expect.anything());
  });

  test('issues the project number on first entry to PROJECT_APPROVED', async () => {
    const club = { code: 'A201', work_group_code: '00', division_code: 'D04', abbreviation: 'B' };
    const { phaseService } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 201, code: 'PROJECT_APPROVED', name_th: 'โครงการอนุมัติ', ordinal: 3 },
      permitted: [{ allowed_role: 'STUACT', requires_budget_check: 0, requires_signature: 0 }],
      club,
      nextSequence: 7,
    });

    const result = await phaseService.performTransition(baseActor('STUACT'), baseProject(), 'PROJECT_APPROVED');

    const expectedClubCode = buildClubCode({
      campusAbbreviation: club.abbreviation,
      academicYear: 2569,
      divisionCode: club.division_code,
      clubCode: club.code,
      workGroupCode: club.work_group_code,
    });
    expect(result.projectSequence).toBe(7);
    expect(result.projectNumber).toBe(buildProjectNumber(expectedClubCode, 7));
  });

  test('does not re-issue a project number the project already has', async () => {
    const { phaseService, conn } = loadPhaseService({
      current: baseCurrent({ project_sequence: 3, project_number: 'B690420100003' }),
      targetPhase: { id: 201, code: 'PROJECT_APPROVED', name_th: 'โครงการอนุมัติ', ordinal: 3 },
      permitted: [{ allowed_role: 'STUACT', requires_budget_check: 0, requires_signature: 0 }],
    });

    const result = await phaseService.performTransition(baseActor('STUACT'), baseProject(), 'PROJECT_APPROVED');

    expect(result.projectNumber).toBe('B690420100003');
    expect(conn.query).not.toHaveBeenCalledWith(expect.stringContaining('MAX(project_sequence)'), expect.anything());
  });

  test('refuses to change phase when a signature is required but none was staged', async () => {
    const { phaseService, signature } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 200, code: 'PROPOSAL_SUBMITTED', name_th: 'ส่งข้อเสนอแล้ว', ordinal: 2 },
      permitted: [{ allowed_role: 'SH', requires_budget_check: 0, requires_signature: 1 }],
    });
    // The pre-transaction check (which decides whether to stage an image)
    // disagrees with the row read inside the transaction — a real case only
    // if the two races apart, but the refusal must hold regardless of why.
    signature.isRequired.mockResolvedValue(false);

    await expect(
      phaseService.performTransition(baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED')
    ).rejects.toMatchObject({ status: 400 });
    expect(signature.record).not.toHaveBeenCalled();
  });

  test('records a signature when the transition requires one and it was staged', async () => {
    const { phaseService, signature } = loadPhaseService({
      current: baseCurrent(),
      targetPhase: { id: 200, code: 'PROPOSAL_SUBMITTED', name_th: 'ส่งข้อเสนอแล้ว', ordinal: 2 },
      permitted: [{ allowed_role: 'SH', requires_budget_check: 0, requires_signature: 1 }],
    });
    signature.isRequired.mockResolvedValue(true);

    const result = await phaseService.performTransition(
      baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED', { signatureImage: 'data:image/png;base64,x' }
    );

    expect(result.signed).toBe(true);
    expect(signature.record).toHaveBeenCalledTimes(1);
  });

  test('refuses PROJECT_APPROVED -> BUDGET_APPROVED without a council endorsement on record (TODO.md, 2026-08-27)', async () => {
    const { phaseService, signature } = loadPhaseService({
      current: baseCurrent({ phase_code: 'PROJECT_APPROVED', phase_ordinal: 3 }),
      targetPhase: { id: 202, code: 'BUDGET_APPROVED', name_th: 'เงินโครงการอนุมัติ', ordinal: 4 },
      permitted: [{ allowed_role: 'STUACT', requires_budget_check: 1, requires_signature: 1 }],
      plan: { planned_amount: '1000.00' },
      requestedTotal: '500.00',
      allocation: { id: 1, amount: '5000.00', campus_id: 1 },
    });
    signature.hasSignature.mockResolvedValue(false);
    signature.isRequired.mockResolvedValue(true);

    await expect(
      phaseService.performTransition(
        baseActor('STUACT'), baseProject(), 'BUDGET_APPROVED', { signatureImage: 'data:image/png;base64,x' }
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(signature.hasSignature).toHaveBeenCalledWith(1, 'COUNCIL', expect.anything());
  });

  test('allows PROJECT_APPROVED -> BUDGET_APPROVED once the council has endorsed', async () => {
    const { phaseService, signature } = loadPhaseService({
      current: baseCurrent({ phase_code: 'PROJECT_APPROVED', phase_ordinal: 3 }),
      targetPhase: { id: 202, code: 'BUDGET_APPROVED', name_th: 'เงินโครงการอนุมัติ', ordinal: 4 },
      permitted: [{ allowed_role: 'STUACT', requires_budget_check: 1, requires_signature: 1 }],
      plan: { planned_amount: '1000.00' },
      requestedTotal: '500.00',
      allocation: { id: 1, amount: '5000.00', campus_id: 1 },
    });
    signature.hasSignature.mockResolvedValue(true);
    signature.isRequired.mockResolvedValue(true);

    const result = await phaseService.performTransition(
      baseActor('STUACT'), baseProject(), 'BUDGET_APPROVED', { signatureImage: 'data:image/png;base64,x' }
    );
    expect(result.toPhase.code).toBe('BUDGET_APPROVED');
  });

  test('does not gate other transitions on a council endorsement — only PROJECT_APPROVED -> BUDGET_APPROVED', async () => {
    const { phaseService, signature } = loadPhaseService({
      current: baseCurrent(), // phase_code: 'DRAFT_SUBMITTED'
      targetPhase: { id: 200, code: 'PROPOSAL_SUBMITTED', name_th: 'ส่งข้อเสนอแล้ว', ordinal: 2 },
      permitted: [{ allowed_role: 'SH', requires_budget_check: 0, requires_signature: 0 }],
    });
    signature.hasSignature.mockResolvedValue(false);

    const result = await phaseService.performTransition(baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED');
    expect(result.toPhase.code).toBe('PROPOSAL_SUBMITTED');
    expect(signature.hasSignature).not.toHaveBeenCalled();
  });

  test('discards a staged signature image when the transaction fails after staging', async () => {
    const { phaseService, signature } = loadPhaseService({
      current: baseCurrent({ phase_id: 999 }), // stale -> 409 thrown inside the transaction
    });
    signature.isRequired.mockResolvedValue(true);

    await expect(
      phaseService.performTransition(
        baseActor('SH'), baseProject(), 'PROPOSAL_SUBMITTED', { signatureImage: 'data:image/png;base64,x' }
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(signature.discard).toHaveBeenCalledTimes(1);
  });
});

describe('availableTransitions', () => {
  test('marks which of the listed transitions this caller’s role may take', async () => {
    const { phaseService, conn } = loadPhaseService();
    conn.query.mockImplementation(async (sql) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.includes('FROM phase_transition t JOIN phase ph')) {
        return [[
          { allowed_role: 'SH', requires_budget_check: 0, requires_signature: 0, to_phase_code: 'PROPOSAL_SUBMITTED', to_phase_name_th: 'ส่งข้อเสนอแล้ว', to_phase_ordinal: 2 },
          { allowed_role: 'ADMIN', requires_budget_check: 1, requires_signature: 1, to_phase_code: 'PROJECT_APPROVED', to_phase_name_th: 'โครงการอนุมัติ', to_phase_ordinal: 3 },
          { allowed_role: 'STUACT', requires_budget_check: 1, requires_signature: 1, to_phase_code: 'PROJECT_APPROVED', to_phase_name_th: 'โครงการอนุมัติ', to_phase_ordinal: 3 },
        ]];
      }
      throw new Error(`unhandled query: ${text}`);
    });

    const transitions = await phaseService.availableTransitions(conn, baseCurrent(), baseActor('SH'));

    const byCode = Object.fromEntries(transitions.map((t) => [t.toPhaseCode, t]));
    expect(byCode.PROPOSAL_SUBMITTED.allowedForCaller).toBe(true);
    // SH may not approve — the row exists (for ADMIN/STUACT) but not for this role.
    expect(byCode.PROJECT_APPROVED.allowedForCaller).toBe(false);
    expect(byCode.PROJECT_APPROVED.allowedRoles.sort()).toEqual(['ADMIN', 'STUACT']);
  });
});
