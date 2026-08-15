/**
 * Who may see and touch which projects.
 *
 * Every rule here reads `req.actor` — resolved from `membership` by
 * `requireAuth` — and never a path parameter or a request body. That is Q16 and
 * deviation 1. The old system did the opposite: `stuactRoutes.js:7` took the
 * club name out of the URL, so editing the path read another club's projects,
 * and its `OR responsible_agency = 'กองกิจการนักศึกษา'` returned that agency's
 * projects to every caller regardless (docs/business-rules.md, "Authorization").
 *
 * Visibility is expressed as a SQL fragment rather than a post-filter so a
 * caller cannot page past their scope, and so the database never assembles rows
 * the caller may not see.
 */
const { HttpError } = require('../lib/httpError');

/** Phases in which the student side may still edit. */
const STUDENT_EDIT_PHASES = ['DRAFT_PROPOSAL', 'DRAFT_REPORT'];

/**
 * A `WHERE` fragment restricting `project p` (joined to `club c`) to what
 * `actor` may see.
 *
 * - `ADMIN`   — everything.
 * - `STUACT`  — clubs inside the club group they oversee (`jurisdiction_club_group_id`).
 * - `SH`/`AD` — their own club. Adviser is read-only, which is a separate rule below.
 * - no membership — nothing. Not an error: a person can be known and enrolled in nothing.
 */
function visibilityClause(actor) {
  const membership = actor.membership;
  if (!membership) return { sql: '1 = 0', params: [] };

  switch (membership.role) {
    case 'ADMIN':
      return { sql: '1 = 1', params: [] };
    case 'STUACT':
      return { sql: 'c.club_group_id = ?', params: [membership.jurisdiction_club_group_id] };
    case 'SH':
    case 'AD':
      return { sql: 'p.club_id = ?', params: [membership.club_id] };
    default:
      return { sql: '1 = 0', params: [] };
  }
}

/**
 * The same restriction expressed against `club c` alone, for the rows that hang
 * off a club rather than off a project — the yearly allocations.
 *
 * Kept separate from `visibilityClause` rather than parameterised: the two
 * differ in which table carries the club id, and a single clause that guessed
 * would be one edit away from restricting nothing.
 */
function clubVisibilityClause(actor) {
  const membership = actor.membership;
  if (!membership) return { sql: '1 = 0', params: [] };

  switch (membership.role) {
    case 'ADMIN':
      return { sql: '1 = 1', params: [] };
    case 'STUACT':
      return { sql: 'c.club_group_id = ?', params: [membership.jurisdiction_club_group_id] };
    case 'SH':
    case 'AD':
      return { sql: 'c.id = ?', params: [membership.club_id] };
    default:
      return { sql: '1 = 0', params: [] };
  }
}

/**
 * Who may set a club's yearly allocation: Admin anywhere, STUACT inside its own
 * jurisdiction, nobody else (Q30 — adviser and student are read-only).
 *
 * `club` is a row carrying `id` and `club_group_id`.
 */
function assertCanEnterAllocation(actor, club) {
  const membership = actor.membership;
  const role = membership ? membership.role : null;

  if (role === 'ADMIN') return;
  if (role === 'STUACT') {
    if (club.club_group_id != null &&
        Number(club.club_group_id) === Number(membership.jurisdiction_club_group_id)) {
      return;
    }
    // Outside the jurisdiction the club is not the caller's to fund, and saying
    // so plainly leaks nothing: club names are reference data, unlike projects.
    throw HttpError.forbidden('ชมรมนี้อยู่นอกกลุ่มที่รับผิดชอบ');
  }
  throw HttpError.forbidden('กำหนดวงเงินจัดสรรได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
}

/**
 * Which roles each role may hand out.
 *
 * A membership row *is* authority in this system — it is what every other rule
 * in this file reads — so granting one is the most privileged thing an officer
 * can do, and it is the one place where the usual "STUACT and ADMIN are
 * equivalent inside a jurisdiction" shorthand has to stop.
 *
 * ADMIN may grant anything. STUACT may grant the two club roles **and another
 * STUACT** — the owner's call, 2026-08-15 — but never an ADMIN, which would be
 * handing out authority above its own level.
 *
 * **The escalation this could have opened, and what closes it.** A STUACT that
 * could appoint a STUACT *to another jurisdiction* would reach that jurisdiction
 * in two steps: appoint a colleague there, and everything they may do is now
 * reachable. The scope check below would still pass every individual call while
 * the boundary as a whole leaked. So the jurisdiction rule the owner already
 * settled — "เฉพาะในฝ่ายตัวเอง" — is applied to this role too: a STUACT may
 * appoint another STUACT **to its own jurisdiction and no other**. Appointing a
 * colleague beside you extends nobody's reach, which is the difference between
 * sharing a job and escalating.
 */
const GRANTABLE_ROLES = {
  ADMIN: ['SH', 'AD', 'STUACT', 'ADMIN'],
  STUACT: ['SH', 'AD', 'STUACT'],
};

/**
 * Who may create a membership, and for whom.
 *
 * `target` carries the role being granted and the scope it attaches to — a
 * `club` (a row with `id` and `club_group_id`) for `SH`/`AD`, or a
 * `jurisdictionId` for `STUACT`. `ADMIN` has neither.
 *
 * The two scopes are checked separately rather than through one clause that
 * guesses which is present. `ck_membership_scope` guarantees exactly one of them
 * is set, and a single clause that read the wrong column would refuse
 * everything — or, worse, pass everything.
 */
function assertCanGrantRole(actor, target) {
  const membership = actor.membership;
  const role = membership ? membership.role : null;
  const grantable = GRANTABLE_ROLES[role];

  if (!grantable) {
    throw HttpError.forbidden('กำหนดสิทธิ์ได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }
  if (!grantable.includes(target.role)) {
    throw HttpError.forbidden(`สิทธิ์ระดับ ${target.role} กำหนดได้เฉพาะผู้ดูแลระบบ`);
  }
  if (role === 'ADMIN') return;

  // STUACT from here down. Its own jurisdiction is the whole of its reach, for
  // both kinds of target.
  const mine = Number(membership.jurisdiction_club_group_id);

  if (target.role === 'STUACT') {
    // Appointing a colleague beside you, never one in another group — see the
    // escalation note on GRANTABLE_ROLES.
    if (target.jurisdictionId == null || Number(target.jurisdictionId) !== mine) {
      throw HttpError.forbidden('กำหนดเจ้าหน้าที่ได้เฉพาะกลุ่มชมรมที่ตนรับผิดชอบ');
    }
    return;
  }

  const groupId = target.club ? target.club.club_group_id : null;
  if (groupId == null || Number(groupId) !== mine) {
    throw HttpError.forbidden('ชมรมนี้อยู่นอกกลุ่มที่รับผิดชอบ');
  }
}

/**
 * Who may approve a project's money and record its disbursements: the same two
 * roles that own the `PROJECT_APPROVED → BUDGET_APPROVED` transition. Approving
 * one's own request is the thing this exists to prevent.
 */
function assertCanApproveBudget(actor) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN' && role !== 'STUACT') {
    throw HttpError.forbidden('อนุมัติวงเงินได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }
}

/** True if `project` (a row carrying `club_id` and `club_group_id`) is inside the actor's scope. */
function isInScope(actor, project) {
  const membership = actor.membership;
  if (!membership) return false;

  switch (membership.role) {
    case 'ADMIN':
      return true;
    case 'STUACT':
      return project.club_group_id != null &&
        Number(project.club_group_id) === Number(membership.jurisdiction_club_group_id);
    case 'SH':
    case 'AD':
      return Number(project.club_id) === Number(membership.club_id);
    default:
      return false;
  }
}

/**
 * Out-of-scope reads answer 404, not 403.
 *
 * 403 would confirm that a project with that id exists in some other club, which
 * is the same leak in a smaller form. Within scope, a genuine 403 is still a 403
 * — see `assertCanEdit`.
 */
function assertVisible(actor, project) {
  if (!project || !isInScope(actor, project)) throw HttpError.notFound('ไม่พบโครงการ');
}

/** Only a student head may open a project, and only in their own club. */
function assertCanCreate(actor) {
  const membership = actor.membership;
  if (!membership || membership.role !== 'SH') {
    throw HttpError.forbidden('เฉพาะหัวหน้านักศึกษา (SH) เท่านั้นที่สร้างโครงการได้');
  }
  if (!membership.club_id) {
    throw HttpError.forbidden('บัญชีนี้ไม่ได้สังกัดชมรมในปีการศึกษานี้');
  }
  return membership.club_id;
}

/**
 * Edit rights. **This rule is new** — the old system had none, so every one of
 * its edit endpoints accepted any token for any project in any phase. The shape
 * below is the conservative reading of the gate table in
 * docs/business-rules.md; it is recorded as an assumption in
 * docs/DECISIONS.md → "Editing rights" and is the one part of Phase 2 that is
 * a judgement call rather than a port.
 *
 * - Nothing is editable once `CLOSED`.
 * - `SH` may edit their own club's project only while it is in a drafting phase.
 * - `STUACT`/`ADMIN` may edit anything in scope, in any phase before `CLOSED`.
 * - `AD` may not edit at all (Q5 — the adviser is a viewer in v1).
 */
function assertCanEdit(actor, project) {
  assertVisible(actor, project);

  if (project.phase_code === 'CLOSED') {
    throw HttpError.forbidden('โครงการปิดแล้ว ไม่สามารถแก้ไขได้');
  }

  const role = actor.membership.role;

  if (role === 'AD') throw HttpError.forbidden('อาจารย์ที่ปรึกษาดูข้อมูลได้อย่างเดียว');

  if (role === 'SH' && !STUDENT_EDIT_PHASES.includes(project.phase_code)) {
    throw HttpError.forbidden(
      `แก้ไขได้เฉพาะช่วงร่างเท่านั้น (สถานะปัจจุบัน: ${project.phase_name_th})`
    );
  }
}

/**
 * Would `assert` allow it?
 *
 * The screens need to know which controls to draw, and the honest way to answer
 * is to ask the rule rather than to restate it: the old frontend restated it,
 * rendering every control from `storedUser.position` in JSX, and the two drifted
 * until the UI offered buttons the server refused and hid ones it allowed.
 * A predicate derived from the assertion cannot drift from it.
 *
 * Only an `HttpError` counts as a refusal — anything else is a real failure and
 * is re-thrown, so a broken rule cannot quietly read as "not permitted".
 */
function permits(assert) {
  try {
    assert();
    return true;
  } catch (err) {
    if (err instanceof HttpError) return false;
    throw err;
  }
}

/**
 * Deleting cascades to every child table, so it is narrower than editing: an
 * owner may abandon a draft they have not submitted, and otherwise only an
 * admin may delete. Soft delete is explicitly not in v1 (build plan, "What is
 * explicitly not in v1").
 */
function assertCanDelete(actor, project) {
  assertVisible(actor, project);

  const role = actor.membership.role;
  if (role === 'ADMIN') return;

  if (role === 'SH' &&
      project.phase_code === 'DRAFT_PROPOSAL' &&
      Number(project.owner_person_id) === Number(actor.person.id)) {
    return;
  }

  throw HttpError.forbidden('ลบได้เฉพาะร่างของตนเองที่ยังไม่ได้เสนอ หรือโดยผู้ดูแลระบบ');
}

module.exports = {
  visibilityClause,
  clubVisibilityClause,
  assertCanEnterAllocation,
  assertCanGrantRole,
  GRANTABLE_ROLES,
  assertCanApproveBudget,
  permits,
  isInScope,
  assertVisible,
  assertCanCreate,
  assertCanEdit,
  assertCanDelete,
  STUDENT_EDIT_PHASES,
};
