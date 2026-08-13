/**
 * The phase machine.
 *
 * The old system had no transition table. `ProjectDocument.js:181-196` looked
 * the current phase up in an array and wrote "the one after it" from a second
 * array offset by one, so the machine could not branch, could not reject and
 * could not skip — and the endpoint that performed the write was
 * unauthenticated and never sent a response
 * (docs/business-rules.md, "Transitions").
 *
 * Here a transition exists only if `phase_transition` has a row for
 * `(from, to, role)`. That table was seeded from the JSX gate table, which is
 * the only written statement of who may advance what.
 */
const { transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { buildClubCode, buildProjectNumber } = require('../lib/clubCode');
const { recordEvent, lockClubForNumbering } = require('./projectService');

/** Every transition out of `project`'s current phase, and whether this actor may take it. */
async function availableTransitions(conn, project, actor) {
  const role = actor.membership ? actor.membership.role : null;

  const [rows] = await conn.query(
    `SELECT t.allowed_role, t.requires_budget_check,
            ph.code AS to_phase_code, ph.name_th AS to_phase_name_th, ph.ordinal AS to_phase_ordinal
       FROM phase_transition t
       JOIN phase ph ON ph.id = t.to_phase_id
      WHERE t.from_phase_id = ?
      ORDER BY ph.ordinal`,
    [project.phase_id]
  );

  const byTarget = new Map();
  for (const row of rows) {
    const entry = byTarget.get(row.to_phase_code) || {
      toPhaseCode: row.to_phase_code,
      toPhaseNameTh: row.to_phase_name_th,
      toPhaseOrdinal: row.to_phase_ordinal,
      requiresBudgetCheck: Boolean(row.requires_budget_check),
      allowedRoles: [],
    };
    entry.allowedRoles.push(row.allowed_role);
    byTarget.set(row.to_phase_code, entry);
  }

  return [...byTarget.values()].map((entry) => ({
    ...entry,
    allowedForCaller: role !== null && entry.allowedRoles.includes(role),
  }));
}

/**
 * Issue `project_sequence` and `project_number` on first entry to
 * `PROJECT_APPROVED`.
 *
 * Q18/Q29, deviation 3. Three things the old system got wrong and this does not:
 * the number is composed from typed inputs instead of concatenated stored
 * strings; the sequence is scoped by `(club, academic_year)` rather than by
 * project *name*, which is what let two differently-named projects collide; and
 * it is issued inside the approving transaction, so a lost race violates
 * `uq_project_sequence` and rolls back rather than producing a duplicate.
 */
async function issueProjectNumber(conn, project) {
  if (project.project_number) return { sequence: project.project_sequence, number: project.project_number };

  const [[club]] = await conn.query(
    `SELECT c.code, c.work_group_code, d.code AS division_code, cam.abbreviation
       FROM club c
       JOIN division d ON d.id = c.division_id
       JOIN campus cam ON cam.id = c.campus_id
      WHERE c.id = ?`,
    [project.club_id]
  );
  if (!club) throw new Error(`club ${project.club_id} vanished mid-transaction`);

  await lockClubForNumbering(conn, project.club_id);
  const [[seq]] = await conn.query(
    `SELECT COALESCE(MAX(project_sequence), 0) + 1 AS next
       FROM project WHERE club_id = ? AND academic_year = ? FOR UPDATE`,
    [project.club_id, project.academic_year]
  );

  const clubCode = buildClubCode({
    campusAbbreviation: club.abbreviation,
    academicYear: project.academic_year,
    divisionCode: club.division_code,
    clubCode: club.code,
    workGroupCode: club.work_group_code,
  });

  // Throws past 99 rather than overflowing varchar(16) — the old system
  // silently truncated two live rows to a 12-character club code.
  const number = buildProjectNumber(clubCode, seq.next);

  await conn.query(
    'UPDATE project SET project_sequence = ?, project_number = ? WHERE id = ?',
    [seq.next, number, project.id]
  );

  return { sequence: seq.next, number };
}

/**
 * Advance a project.
 *
 * @param {object} actor    `req.actor`
 * @param {object} project  the row as read *before* the transaction
 * @param {string} toPhaseCode
 * @returns {Promise<object>} `{ fromPhase, toPhase, projectNumber }`
 */
async function performTransition(actor, project, toPhaseCode) {
  const role = actor.membership ? actor.membership.role : null;
  if (!role) throw HttpError.forbidden('บัญชีนี้ไม่มีสิทธิ์ในปีการศึกษานี้');

  return transaction(async (conn) => {
    // Re-read under the row lock: the phase may have moved between the read
    // that authorized this request and the write that performs it.
    const [[current]] = await conn.query(
      `SELECT p.id, p.club_id, p.academic_year, p.phase_id, p.project_sequence, p.project_number,
              ph.code AS phase_code, ph.name_th AS phase_name_th
         FROM project p JOIN phase ph ON ph.id = p.phase_id
        WHERE p.id = ? FOR UPDATE`,
      [project.id]
    );
    if (!current) throw HttpError.notFound('ไม่พบโครงการ');
    if (current.phase_id !== project.phase_id) {
      throw new HttpError(409, `สถานะโครงการถูกเปลี่ยนไปแล้วเป็น "${current.phase_name_th}" กรุณาโหลดใหม่`);
    }

    const [[target]] = await conn.query('SELECT id, code, name_th, ordinal FROM phase WHERE code = ?', [toPhaseCode]);
    if (!target) throw HttpError.badRequest(`ไม่รู้จักสถานะ ${toPhaseCode}`);

    // Does the transition exist at all, and is it open to this role? The two
    // failures are different and get different answers: an impossible move is a
    // 400, a move this role may not make is a 403.
    const [permitted] = await conn.query(
      `SELECT allowed_role, requires_budget_check
         FROM phase_transition WHERE from_phase_id = ? AND to_phase_id = ?`,
      [current.phase_id, target.id]
    );
    if (!permitted.length) {
      throw HttpError.badRequest(
        `เปลี่ยนสถานะจาก "${current.phase_name_th}" เป็น "${target.name_th}" ไม่ได้`
      );
    }

    const mine = permitted.find((row) => row.allowed_role === role);
    if (!mine) {
      const roles = permitted.map((row) => row.allowed_role).join(', ');
      throw HttpError.forbidden(`สถานะนี้เปลี่ยนได้โดย ${roles} เท่านั้น`);
    }

    // Q26 hard-block point. Phase 3 owns the three budget checks; until then a
    // flagged transition is allowed and says so, rather than pretending to
    // enforce a limit that is not implemented yet.
    if (mine.requires_budget_check) {
      // TODO(Phase 3): assertBudgetWithinLimits(conn, current) — build plan, Phase 3.
    }

    let issued = { sequence: current.project_sequence, number: current.project_number };
    if (target.code === 'PROJECT_APPROVED') {
      issued = await issueProjectNumber(conn, current);
    }

    await conn.query('UPDATE project SET phase_id = ? WHERE id = ?', [target.id, current.id]);

    // Same transaction as the phase change, which is the whole point of Q15:
    // the old pair of unawaited writes could leave the phase changed and the
    // log unwritten, and did — 16 orphaned log rows in the dump.
    await recordEvent(conn, {
      projectId: current.id,
      type: 'PHASE_CHANGED',
      actorPersonId: actor.person.id,
      fromPhaseId: current.phase_id,
      toPhaseId: target.id,
      detail: { role, projectNumber: issued.number || null },
    });

    return {
      fromPhase: { code: current.phase_code, nameTh: current.phase_name_th },
      toPhase: { code: target.code, nameTh: target.name_th, ordinal: target.ordinal },
      projectNumber: issued.number || null,
      projectSequence: issued.sequence || null,
      budgetCheckPending: Boolean(mine.requires_budget_check),
    };
  }, { retries: 3 });   // two approvals racing for the next project_number
}

module.exports = { availableTransitions, performTransition, issueProjectNumber };
