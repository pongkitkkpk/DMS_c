/**
 * `scope.js` is where visibility and edit rights live — the file's own header
 * names the two leaks it replaces: a club taken from the URL instead of the
 * caller's membership, and an `OR` clause that handed one agency's projects to
 * every caller. Every function here is pure (no `pool`, no `conn`), so these
 * are plain unit tests against the real module — no mocking at all.
 */
const scope = require('./scope');
const { HttpError } = require('../lib/httpError');

const actorWith = (role, extra = {}) => ({
  person: { id: 1 },
  membership: role ? { role, club_id: 10, jurisdiction_club_group_id: 5, ...extra } : null,
});

const project = (overrides = {}) => ({
  id: 1,
  club_id: 10,
  club_group_id: 5,
  campus_id: 1,
  phase_code: 'DRAFT_PROPOSAL',
  phase_name_th: 'ร่างข้อเสนอ',
  owner_person_id: 1,
  advisor_person_id: 7,
  ...overrides,
});

describe('visibilityClause / clubVisibilityClause', () => {
  test.each([
    ['no membership', null, undefined, '1 = 0', []],
    ['ADMIN', 'ADMIN', undefined, '1 = 1', []],
    ['STUACT', 'STUACT', { jurisdiction_club_group_id: 5 }, 'c.club_group_id = ?', [5]],
    ['SH', 'SH', { club_id: 10 }, 'p.club_id = ?', [10]],
    ['AD', 'AD', { club_id: 10 }, 'p.club_id = ?', [10]],
    ['an unrecognised role', 'BOGUS', undefined, '1 = 0', []],
  ])('%s', (_label, role, extra, sql, params) => {
    const actor = role ? actorWith(role, extra) : { membership: null };
    expect(scope.visibilityClause(actor)).toEqual({ sql, params });
  });

  test('clubVisibilityClause keys SH/AD off the club row itself, not the project', () => {
    expect(scope.clubVisibilityClause(actorWith('SH', { club_id: 10 })))
      .toEqual({ sql: 'c.id = ?', params: [10] });
  });

  test('a council SH sees its whole campus, not just its own club (TODO.md, 2026-08-27)', () => {
    const actor = actorWith('SH', { club_id: 10, is_council: 1, campus_id: 1 });
    expect(scope.visibilityClause(actor)).toEqual({ sql: 'c.campus_id = ?', params: [1] });
  });

  test('an ordinary SH (is_council falsy) still sees only its own club', () => {
    const actor = actorWith('SH', { club_id: 10, is_council: 0, campus_id: 1 });
    expect(scope.visibilityClause(actor)).toEqual({ sql: 'p.club_id = ?', params: [10] });
  });
});

describe('assertCanEnterAllocation', () => {
  test('ADMIN may set any club’s allocation', () => {
    expect(() => scope.assertCanEnterAllocation(actorWith('ADMIN'), { id: 1, club_group_id: 99 }))
      .not.toThrow();
  });

  test('STUACT may set an allocation inside its own jurisdiction', () => {
    const actor = actorWith('STUACT', { jurisdiction_club_group_id: 5 });
    expect(() => scope.assertCanEnterAllocation(actor, { id: 1, club_group_id: 5 })).not.toThrow();
  });

  test('STUACT may not set an allocation outside its jurisdiction', () => {
    const actor = actorWith('STUACT', { jurisdiction_club_group_id: 5 });
    expect(() => scope.assertCanEnterAllocation(actor, { id: 1, club_group_id: 6 }))
      .toThrow(HttpError);
  });

  test('SH/AD/no-membership may never set an allocation', () => {
    expect(() => scope.assertCanEnterAllocation(actorWith('SH'), { id: 1, club_group_id: 5 })).toThrow(HttpError);
    expect(() => scope.assertCanEnterAllocation(actorWith(null), { id: 1, club_group_id: 5 })).toThrow(HttpError);
  });
});

describe('assertCanGrantRole — GRANTABLE_ROLES and the jurisdiction escalation guard', () => {
  test('ADMIN may grant any role, including another ADMIN', () => {
    const actor = actorWith('ADMIN');
    for (const role of ['SH', 'AD', 'STUACT', 'ADMIN']) {
      expect(() => scope.assertCanGrantRole(actor, { role, club: { club_group_id: 5 } })).not.toThrow();
    }
  });

  test('STUACT may not grant ADMIN', () => {
    const actor = actorWith('STUACT', { jurisdiction_club_group_id: 5 });
    expect(() => scope.assertCanGrantRole(actor, { role: 'ADMIN' })).toThrow(HttpError);
  });

  test('STUACT may grant SH/AD only within its own jurisdiction', () => {
    const actor = actorWith('STUACT', { jurisdiction_club_group_id: 5 });
    expect(() =>
      scope.assertCanGrantRole(actor, { role: 'SH', club: { club_group_id: 5 } })
    ).not.toThrow();
    expect(() =>
      scope.assertCanGrantRole(actor, { role: 'SH', club: { club_group_id: 6 } })
    ).toThrow(HttpError);
  });

  test('STUACT may appoint a colleague STUACT in its own jurisdiction, never in another', () => {
    // This is the escalation this file's header calls out by name: a STUACT
    // that could appoint a STUACT into a *different* jurisdiction would reach
    // that jurisdiction in two steps even though every single call still
    // passes its own scope check.
    const actor = actorWith('STUACT', { jurisdiction_club_group_id: 5 });
    expect(() =>
      scope.assertCanGrantRole(actor, { role: 'STUACT', jurisdictionId: 5 })
    ).not.toThrow();
    expect(() =>
      scope.assertCanGrantRole(actor, { role: 'STUACT', jurisdictionId: 6 })
    ).toThrow(HttpError);
  });

  test('SH, AD, and no membership may grant nothing at all', () => {
    for (const actor of [actorWith('SH'), actorWith('AD'), actorWith(null)]) {
      expect(() => scope.assertCanGrantRole(actor, { role: 'SH', club: { club_group_id: 5 } }))
        .toThrow(HttpError);
    }
  });
});

describe('assertCanApproveBudget', () => {
  test.each(['ADMIN', 'STUACT'])('%s may approve budgets', (role) => {
    expect(() => scope.assertCanApproveBudget(actorWith(role))).not.toThrow();
  });

  test.each(['SH', 'AD', null])('%s may not approve budgets', (role) => {
    expect(() => scope.assertCanApproveBudget(actorWith(role))).toThrow(HttpError);
  });
});

describe('isInScope / assertVisible', () => {
  test.each([
    ['ADMIN sees any project', 'ADMIN', {}, true],
    ['STUACT sees its jurisdiction', 'STUACT', { club_group_id: 5 }, true],
    ['STUACT does not see another jurisdiction', 'STUACT', { club_group_id: 6 }, false],
    ['SH sees its own club', 'SH', { club_id: 10 }, true],
    ['SH does not see another club', 'SH', { club_id: 11 }, false],
    ['AD sees its own club', 'AD', { club_id: 10 }, true],
    ['no membership sees nothing', null, {}, false],
  ])('%s', (_label, role, overrides, expected) => {
    expect(scope.isInScope(actorWith(role), project(overrides))).toBe(expected);
  });

  test('a council SH sees any project on its own campus, in or out of its own club', () => {
    const councilHead = actorWith('SH', { club_id: 10, is_council: 1, campus_id: 1 });
    expect(scope.isInScope(councilHead, project({ club_id: 999, campus_id: 1 }))).toBe(true);
    expect(scope.isInScope(councilHead, project({ club_id: 999, campus_id: 2 }))).toBe(false);
  });

  test('assertVisible answers 404, not 403, for an out-of-scope project', () => {
    // Deliberate: a 403 here would confirm a project with this id exists in
    // some other club, which is the same leak in a smaller form.
    let caught;
    try {
      scope.assertVisible(actorWith('SH'), project({ club_id: 999 }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect(caught.status).toBe(404);
  });

  test('assertVisible answers 404 for a missing project too', () => {
    expect(() => scope.assertVisible(actorWith('ADMIN'), null)).toThrow(
      expect.objectContaining({ status: 404 })
    );
  });
});

describe('assertCanCreate', () => {
  test('only SH with a club may create a project', () => {
    expect(scope.assertCanCreate(actorWith('SH', { club_id: 10 }))).toBe(10);
  });

  test('SH with no club in this academic year may not create', () => {
    expect(() => scope.assertCanCreate(actorWith('SH', { club_id: null }))).toThrow(HttpError);
  });

  test.each(['STUACT', 'ADMIN', 'AD', null])('%s may not create a project', (role) => {
    expect(() => scope.assertCanCreate(actorWith(role))).toThrow(HttpError);
  });
});

describe('assertCanEdit', () => {
  test('out-of-scope is refused as not-found before any role check runs', () => {
    expect(() => scope.assertCanEdit(actorWith('SH'), project({ club_id: 999 })))
      .toThrow(expect.objectContaining({ status: 404 }));
  });

  test('nothing is editable once CLOSED, regardless of role', () => {
    for (const role of ['SH', 'STUACT', 'ADMIN']) {
      expect(() => scope.assertCanEdit(actorWith(role), project({ phase_code: 'CLOSED' })))
        .toThrow(expect.objectContaining({ status: 403 }));
    }
  });

  test('AD may never edit, even in scope and mid-draft', () => {
    expect(() => scope.assertCanEdit(actorWith('AD'), project())).toThrow(HttpError);
  });

  test.each(['DRAFT_PROPOSAL', 'DRAFT_REPORT'])('SH may edit its own project while drafting (%s)', (phase) => {
    expect(() => scope.assertCanEdit(actorWith('SH'), project({ phase_code: phase }))).not.toThrow();
  });

  test('SH may not edit once past drafting', () => {
    expect(() => scope.assertCanEdit(actorWith('SH'), project({ phase_code: 'PROPOSAL_SUBMITTED' })))
      .toThrow(HttpError);
  });

  test.each(['STUACT', 'ADMIN'])('%s may edit an in-scope project in any non-closed phase', (role) => {
    expect(() => scope.assertCanEdit(actorWith(role), project({ phase_code: 'PROPOSAL_SUBMITTED' })))
      .not.toThrow();
  });

  test.each(['STUACT', 'ADMIN'])(
    '%s may not edit content while BUDGET_APPROVED — locked pending the council/disbursement (TODO.md, 2026-08-27)',
    (role) => {
      expect(() => scope.assertCanEdit(actorWith(role), project({ phase_code: 'BUDGET_APPROVED' })))
        .toThrow(expect.objectContaining({ status: 403 }));
    }
  );

  test('SH regains edit rights once the project reaches DRAFT_REPORT — the lock is not "from here on"', () => {
    expect(() => scope.assertCanEdit(actorWith('SH'), project({ phase_code: 'DRAFT_REPORT' })))
      .not.toThrow();
  });
});

describe('assertCanManageAttachments — exempt from the BUDGET_APPROVED content lock', () => {
  test.each(['STUACT', 'ADMIN'])('%s may still attach a file while BUDGET_APPROVED', (role) => {
    expect(() => scope.assertCanManageAttachments(actorWith(role), project({ phase_code: 'BUDGET_APPROVED' })))
      .not.toThrow();
  });

  test('AD may still not attach anything — same base rule as assertCanEdit', () => {
    expect(() => scope.assertCanManageAttachments(actorWith('AD'), project())).toThrow(HttpError);
  });

  test('nothing is attachable once CLOSED, regardless of role', () => {
    expect(() => scope.assertCanManageAttachments(actorWith('ADMIN'), project({ phase_code: 'CLOSED' })))
      .toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('assertCanEndorseAsCouncil', () => {
  test('out-of-scope is not-found, not forbidden', () => {
    const councilHead = actorWith('SH', { is_council: 1, campus_id: 1 });
    expect(() => scope.assertCanEndorseAsCouncil(councilHead, project({ club_group_id: 6, campus_id: 2 })))
      .toThrow(expect.objectContaining({ status: 404 }));
  });

  test('an ordinary club SH — not the council — may not endorse, even in scope', () => {
    const ordinarySH = actorWith('SH', { is_council: 0, campus_id: 1, club_id: 10 });
    expect(() => scope.assertCanEndorseAsCouncil(ordinarySH, project({ club_id: 10, campus_id: 1 })))
      .toThrow(HttpError);
  });

  test('the council head of a different campus may not endorse', () => {
    const otherCampusCouncil = actorWith('SH', { is_council: 1, campus_id: 2 });
    // Widened visibility only reaches the council's own campus, so a project
    // on another campus is 404 before the role check ever runs — the same
    // "visibility first" shape every other assertion here follows.
    expect(() => scope.assertCanEndorseAsCouncil(otherCampusCouncil, project({ campus_id: 1 })))
      .toThrow(expect.objectContaining({ status: 404 }));
  });

  test('the campus council head may endorse any club’s project on that campus', () => {
    const councilHead = actorWith('SH', { is_council: 1, campus_id: 1, club_id: 20 });
    expect(() => scope.assertCanEndorseAsCouncil(councilHead, project({ club_id: 10, campus_id: 1 })))
      .not.toThrow();
  });

  test('a CLOSED project may not be endorsed even by the campus council head', () => {
    const councilHead = actorWith('SH', { is_council: 1, campus_id: 1, club_id: 20 });
    expect(() =>
      scope.assertCanEndorseAsCouncil(councilHead, project({ campus_id: 1, phase_code: 'CLOSED' }))
    ).toThrow(HttpError);
  });
});

describe('assertCanEndorseAsAdvisor', () => {
  test('out-of-scope is not-found, not forbidden', () => {
    expect(() => scope.assertCanEndorseAsAdvisor(actorWith('AD'), project({ club_id: 999 })))
      .toThrow(expect.objectContaining({ status: 404 }));
  });

  test('only the project’s own named advisor may endorse — not AD in general', () => {
    const otherAdvisor = actorWith('AD', { club_id: 10 });
    otherAdvisor.person.id = 999; // a different AD, of the same club
    expect(() => scope.assertCanEndorseAsAdvisor(otherAdvisor, project({ advisor_person_id: 7 })))
      .toThrow(HttpError);
  });

  test('the named advisor may endorse while the project is open', () => {
    const advisor = actorWith('AD', { club_id: 10 });
    advisor.person.id = 7;
    expect(() => scope.assertCanEndorseAsAdvisor(advisor, project({ advisor_person_id: 7 })))
      .not.toThrow();
  });

  test('a CLOSED project may not be endorsed even by its own advisor', () => {
    const advisor = actorWith('AD', { club_id: 10 });
    advisor.person.id = 7;
    expect(() =>
      scope.assertCanEndorseAsAdvisor(advisor, project({ advisor_person_id: 7, phase_code: 'CLOSED' }))
    ).toThrow(HttpError);
  });
});

describe('assertCanDelete', () => {
  test('out-of-scope is not-found', () => {
    expect(() => scope.assertCanDelete(actorWith('SH'), project({ club_id: 999 })))
      .toThrow(expect.objectContaining({ status: 404 }));
  });

  test('ADMIN may delete anything in scope, in any phase', () => {
    expect(() => scope.assertCanDelete(actorWith('ADMIN'), project({ phase_code: 'PROPOSAL_SUBMITTED' })))
      .not.toThrow();
  });

  test('SH may delete only their own still-undrafted proposal', () => {
    expect(() => scope.assertCanDelete(actorWith('SH'), project({ phase_code: 'DRAFT_PROPOSAL', owner_person_id: 1 })))
      .not.toThrow();
  });

  test('SH may not delete a club-mate’s draft', () => {
    expect(() => scope.assertCanDelete(actorWith('SH'), project({ phase_code: 'DRAFT_PROPOSAL', owner_person_id: 999 })))
      .toThrow(HttpError);
  });

  test('SH may not delete their own project once it has been submitted', () => {
    expect(() => scope.assertCanDelete(actorWith('SH'), project({ phase_code: 'PROPOSAL_SUBMITTED', owner_person_id: 1 })))
      .toThrow(HttpError);
  });

  test('STUACT may not delete at all', () => {
    expect(() => scope.assertCanDelete(actorWith('STUACT'), project({ phase_code: 'DRAFT_PROPOSAL' })))
      .toThrow(HttpError);
  });
});

describe('permits', () => {
  test('true when the assertion passes', () => {
    expect(scope.permits(() => {})).toBe(true);
  });

  test('false when the assertion throws an HttpError', () => {
    expect(scope.permits(() => { throw HttpError.forbidden(); })).toBe(false);
  });

  test('re-throws anything that is not an HttpError, rather than reading it as "not permitted"', () => {
    expect(() => scope.permits(() => { throw new TypeError('bug'); })).toThrow(TypeError);
  });
});
