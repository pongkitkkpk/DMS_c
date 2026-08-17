/**
 * Projects: reads, writes, and the ordered child lists.
 *
 * Three rules hold everywhere in this file:
 *
 * 1. **Named columns only.** Nothing reaches SQL that did not come through an
 *    allow-list in `../lib/validate.js` (deviation 2).
 * 2. **Scope is applied in the query**, not after it (`./scope.js`).
 * 3. **Anything that changes more than one table runs in a transaction**, and
 *    the `project_event` row is written inside it. The old system fired
 *    independent unawaited writes, so `status_project` and `logstatus_project`
 *    could disagree (docs/business-rules.md, "Transitions").
 */
const { pool, transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check, pickFields, pickList } = require('../lib/validate');
const { visibilityClause } = require('./scope');

/**
 * The writable core of `project`.
 *
 * Deliberately absent, because they are the system's to issue and not the
 * client's to state: `club_id`, `owner_person_id`, `academic_year`,
 * `draft_sequence`, `project_sequence`, `project_number`, `phase_id`. The old
 * `PUT /student/project/edit/:id_project` accepted every one of them.
 */
const PROJECT_FIELDS = {
  name:              ['name',                check.text({ max: 255, required: true })],
  academicTerm:      ['academic_term',       check.text({ max: 10 })],
  advisorPersonId:   ['advisor_person_id',   check.integer({ min: 1 })],
  isNewProject:      ['is_new_project',      check.boolean()],
  isContinueProject: ['is_continue_project', check.boolean()],
  prepareStartOn:    ['prepare_start_on',    check.date()],
  prepareEndOn:      ['prepare_end_on',      check.date()],
  eventStartOn:      ['event_start_on',      check.date()],
  eventEndOn:        ['event_end_on',        check.date()],
  reportDueOn:       ['report_due_on',       check.date()],
  contact1Name:      ['contact1_name',       check.text({ max: 255 })],
  contact1Phone:     ['contact1_phone',      check.text({ max: 32 })],
  contact2Name:      ['contact2_name',       check.text({ max: 255 })],
  contact2Phone:     ['contact2_phone',      check.text({ max: 32 })],
  contact3Name:      ['contact3_name',       check.text({ max: 255 })],
  contact3Phone:     ['contact3_phone',      check.text({ max: 32 })],
};

/**
 * The ordered child lists, replaced whole.
 *
 * `ordinal` is assigned from array position and never accepted from the client:
 * it is what the document assembler will use to place a row in a fixed-arity
 * form (docs/template-contract.md), so a client-chosen ordinal could silently
 * move a line to another box on a government document.
 */
const SECTIONS = {
  objectives: {
    table: 'project_objective',
    fields: { content: ['content', check.text({ required: true })] },
  },
  rationales: {
    table: 'project_rationale',
    fields: { content: ['content', check.text({ required: true })] },
  },
  locations: {
    table: 'project_location',
    fields: { content: ['content', check.text({ required: true })] },
  },
  types: {
    table: 'project_type',
    fields: { content: ['content', check.text({ max: 255, required: true })] },
  },
  problems: {
    table: 'project_problem',
    fields: {
      problem:    ['problem',    check.text({ required: true })],
      resolution: ['resolution', check.text()],
    },
  },
  activities: {
    table: 'project_activity',
    fields: {
      topic:       ['topic',       check.text({ required: true })],
      startOn:     ['start_on',    check.date({ required: true })],
      endOn:       ['end_on',      check.date({ required: true })],
      responsible: ['responsible', check.text({ max: 255 })],
    },
  },
  indicators: {
    table: 'project_indicator',
    fields: {
      expectedResult: ['expected_result', check.text()],
      qualityTarget:  ['quality_target',  check.text()],
      volumeTarget:   ['volume_target',   check.text()],
      etcFollow:      ['etc_follow',      check.text()],
    },
  },
  attendance: {
    table: 'project_attendance',
    // Unique by (project, variant, attendee_type, ordinal), so the ordinal
    // restarts inside each group rather than running across the whole list.
    groupBy: ['variant', 'attendee_type'],
    fields: {
      variant:      ['variant',       check.oneOf(['PLANNED', 'ACTUAL'], { required: true })],
      attendeeType: ['attendee_type', check.oneOf(['STUDENT', 'PROFESSOR', 'EXECUTIVE', 'EXPERT', 'OTHER'], { required: true })],
      label:        ['label',         check.text({ max: 255 })],
      headcount:    ['headcount',     check.integer({ min: 0, required: true })],
    },
  },
};

const SECTION_NAMES = Object.keys(SECTIONS);

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

const PROJECT_COLUMNS = `
  p.id, p.club_id, p.owner_person_id, p.advisor_person_id,
  p.academic_year, p.academic_term, p.name,
  p.draft_sequence, p.project_sequence, p.project_number,
  p.phase_id, p.is_new_project, p.is_continue_project,
  p.prepare_start_on, p.prepare_end_on, p.event_start_on, p.event_end_on, p.report_due_on,
  p.contact1_name, p.contact1_phone, p.contact2_name, p.contact2_phone,
  p.contact3_name, p.contact3_phone, p.created_at, p.updated_at,
  c.name_th AS club_name, c.code AS club_code, c.club_group_id, c.campus_id,
  cg.name_th AS club_group_name,
  cam.abbreviation AS campus_abbreviation, cam.name_th AS campus_name,
  ph.code AS phase_code, ph.ordinal AS phase_ordinal, ph.name_th AS phase_name_th,
  owner.full_name_th AS owner_name, owner.id_student AS owner_id_student,
  adv.full_name_th AS advisor_name`;

const PROJECT_JOINS = `
    FROM project p
    JOIN club c        ON c.id  = p.club_id
    JOIN campus cam    ON cam.id = c.campus_id
    LEFT JOIN club_group cg ON cg.id = c.club_group_id
    JOIN phase ph      ON ph.id = p.phase_id
    JOIN person owner  ON owner.id = p.owner_person_id
    LEFT JOIN person adv ON adv.id = p.advisor_person_id`;

/**
 * One project row with its club, phase and people resolved — or `null`.
 * Callers pass the result to `scope.assertVisible` before using it; the row
 * carries `club_id` and `club_group_id` for exactly that reason.
 */
async function findProject(id, conn = pool) {
  const [rows] = await conn.query(
    `SELECT ${PROJECT_COLUMNS} ${PROJECT_JOINS} WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Scoped, filtered, paged list.
 *
 * `clubId` narrows *within* the caller's scope — it is an additional predicate,
 * never a replacement for the visibility clause, so passing another club's id
 * returns nothing rather than that club's projects.
 */
async function listProjects(actor, query = {}) {
  const visibility = visibilityClause(actor);
  const where = [visibility.sql];
  const params = [...visibility.params];

  if (query.year) {
    where.push('p.academic_year = ?');
    params.push(check.integer({ min: 2400, max: 2700 })(query.year, 'year'));
  }
  if (query.phase) {
    where.push('ph.code = ?');
    params.push(check.text({ max: 32 })(query.phase, 'phase'));
  }
  if (query.clubId) {
    where.push('p.club_id = ?');
    params.push(check.integer({ min: 1 })(query.clubId, 'clubId'));
  }
  if (query.q) {
    where.push('(p.name LIKE ? OR p.project_number LIKE ?)');
    const like = `%${String(query.q).trim()}%`;
    params.push(like, like);
  }

  const pageSize = Math.min(Number(query.pageSize) || 50, 200);
  const page = Math.max(Number(query.page) || 1, 1);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total ${PROJECT_JOINS} WHERE ${where.join(' AND ')}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT ${PROJECT_COLUMNS} ${PROJECT_JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY p.academic_year DESC, p.draft_sequence DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { items: rows.map(presentProject), total, page, pageSize };
}

/** Every child list of one project, in ordinal order. */
async function loadSections(projectId, conn = pool) {
  const out = {};
  for (const [name, spec] of Object.entries(SECTIONS)) {
    const columns = ['id', 'ordinal', ...Object.values(spec.fields).map(([column]) => column)];
    // Grouped sections order by their group first: `ordinal` restarts inside
    // each group, so ordering by it alone interleaves the groups and the client
    // sees STUDENT 1, PROFESSOR 1, STUDENT 2.
    const order = [...(spec.groupBy || []), 'ordinal'].join(', ');
    const [rows] = await conn.query(
      `SELECT ${columns.join(', ')} FROM \`${spec.table}\` WHERE project_id = ? ORDER BY ${order}`,
      [projectId]
    );
    out[name] = rows;
  }

  const [tags] = await conn.query(
    `SELECT t.id, t.ordinal, t.name_th, s.code AS tag_set_code, s.name_th AS tag_set_name
       FROM project_tag pt
       JOIN tag t     ON t.id = pt.tag_id
       JOIN tag_set s ON s.id = t.tag_set_id
      WHERE pt.project_id = ?
      ORDER BY s.code, t.ordinal`,
    [projectId]
  );
  out.tags = tags;

  return out;
}

// Money used to be read here, from the `project_budget_status` view. Phase 3
// moved it to `budgetService`, which reads the same components directly because
// a view cannot be locked and every figure that decides whether a write may
// commit has to be read `FOR UPDATE`. The view survives in the schema as the
// SQL-level report shape; it is no longer on any request path, so there is one
// implementation of these totals rather than two that could drift.

async function loadEvents(projectId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT e.id, e.event_type, e.edited_section, e.detail, e.occurred_at,
            fromp.code AS from_phase_code, fromp.name_th AS from_phase_name_th,
            top.code   AS to_phase_code,   top.name_th   AS to_phase_name_th,
            actor.full_name_th AS actor_name, actor.id_student AS actor_id_student
       FROM project_event e
       LEFT JOIN phase fromp ON fromp.id = e.from_phase_id
       LEFT JOIN phase top   ON top.id   = e.to_phase_id
       JOIN person actor     ON actor.id = e.actor_person_id
      WHERE e.project_id = ?
      ORDER BY e.occurred_at, e.id`,
    [projectId]
  );
  return rows;
}

/** camelCase for the wire; the database keeps snake_case. */
function presentProject(row) {
  return {
    id: row.id,
    name: row.name,
    academicYear: row.academic_year,
    academicTerm: row.academic_term,
    draftSequence: row.draft_sequence,
    projectSequence: row.project_sequence,
    projectNumber: row.project_number,
    phase: {
      id: row.phase_id,
      code: row.phase_code,
      ordinal: row.phase_ordinal,
      nameTh: row.phase_name_th,
    },
    club: {
      id: row.club_id,
      code: row.club_code,
      nameTh: row.club_name,
      clubGroupId: row.club_group_id,
      clubGroupName: row.club_group_name,
      campusId: row.campus_id,
      campusName: row.campus_name,
    },
    owner: { id: row.owner_person_id, nameTh: row.owner_name, idStudent: row.owner_id_student },
    advisor: row.advisor_person_id ? { id: row.advisor_person_id, nameTh: row.advisor_name } : null,
    isNewProject: Boolean(row.is_new_project),
    isContinueProject: Boolean(row.is_continue_project),
    prepareStartOn: row.prepare_start_on,
    prepareEndOn: row.prepare_end_on,
    eventStartOn: row.event_start_on,
    eventEndOn: row.event_end_on,
    reportDueOn: row.report_due_on,
    contacts: [1, 2, 3]
      .map((n) => ({ name: row[`contact${n}_name`], phone: row[`contact${n}_phone`] }))
      .filter((contact) => contact.name || contact.phone),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --------------------------------------------------------------------------
// Writes
// --------------------------------------------------------------------------

/**
 * Serialize sequence issue for one club.
 *
 * Both sequences are `MAX(...) + 1` within `(club, academic_year)`, which needs
 * two things that are easy to mistake for one:
 *
 * 1. **Serialization.** Taking `FOR UPDATE` on the aggregate alone locks a
 *    *range*, so concurrent writers each hold part of the gap and wait for the
 *    rest — InnoDB breaks the cycle by killing one with a deadlock. Locking a
 *    single existing row first, the club, makes them queue instead.
 * 2. **A current read.** InnoDB's default REPEATABLE READ fixes a transaction's
 *    snapshot at its first read, which happens *before* it starts waiting here.
 *    A plain `SELECT MAX(...)` after the wait would therefore still not see the
 *    row the previous holder just committed, and would compute the same number.
 *    The `FOR UPDATE` on the aggregate is what forces it to read current data.
 *
 * Both are required. With only the lock, a race produces `ER_DUP_ENTRY` on
 * `uq_project_draft`; with only `FOR UPDATE`, it produces deadlocks. The unique
 * keys remain the backstop either way — the design is that a collision fails
 * loudly, and this is what keeps routine contention from reaching that point.
 */
async function lockClubForNumbering(conn, clubId) {
  const [rows] = await conn.query('SELECT id FROM club WHERE id = ? FOR UPDATE', [clubId]);
  if (!rows.length) throw HttpError.badRequest('ไม่พบชมรม');
}

/** Append to the log. Always called with the same connection as the change it describes. */
async function recordEvent(conn, { projectId, type, actorPersonId, fromPhaseId = null, toPhaseId = null, section = null, detail = null }) {
  await conn.query(
    `INSERT INTO project_event
       (project_id, event_type, from_phase_id, to_phase_id, edited_section, actor_person_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [projectId, type, fromPhaseId, toPhaseId, section, actorPersonId, detail ? JSON.stringify(detail) : null]
  );
}

/**
 * An adviser must be an `AD` of the same club in the same year.
 *
 * The old system stored the adviser as free text on the project row, which is
 * how 12 of its 30 projects ended up pointing at a person who did not exist
 * (docs/DECISIONS.md, "What dropping `karoms` costs").
 */
async function assertAdvisorIsValid(conn, advisorPersonId, clubId, academicYear) {
  if (advisorPersonId == null) return;
  const [rows] = await conn.query(
    `SELECT 1 FROM membership
      WHERE person_id = ? AND role = 'AD' AND club_id = ? AND academic_year = ?`,
    [advisorPersonId, clubId, academicYear]
  );
  if (!rows.length) {
    throw HttpError.badRequest('advisorPersonId: ไม่ใช่อาจารย์ที่ปรึกษาของชมรมนี้ในปีการศึกษานี้');
  }
}

/**
 * Create a draft.
 *
 * `draft_sequence` is issued here rather than by the client — Q18/Q29,
 * deviation 3. The read and the insert share one transaction, and
 * `uq_project_draft` is what makes a lost race fail loudly instead of
 * duplicating a number the way the old `MAX(yearly_count)+1` did.
 */
async function createProject(actor, body, clubId) {
  const values = pickFields(body, PROJECT_FIELDS, { requireAll: true });

  return transaction(async (conn) => {
    const [[phase]] = await conn.query("SELECT id FROM phase WHERE code = 'DRAFT_PROPOSAL'");
    if (!phase) throw new Error('phase DRAFT_PROPOSAL is missing — reference data not seeded');

    const academicYear = actor.academicYear;
    await assertAdvisorIsValid(conn, values.advisor_person_id, clubId, academicYear);

    await lockClubForNumbering(conn, clubId);
    const [[seq]] = await conn.query(
      `SELECT COALESCE(MAX(draft_sequence), 0) + 1 AS next
         FROM project WHERE club_id = ? AND academic_year = ? FOR UPDATE`,
      [clubId, academicYear]
    );

    const row = {
      ...values,
      club_id: clubId,
      owner_person_id: actor.person.id,
      academic_year: academicYear,
      draft_sequence: seq.next,
      phase_id: phase.id,
    };

    const columns = Object.keys(row);
    const [result] = await conn.query(
      `INSERT INTO project (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => row[column])
    );

    await recordEvent(conn, {
      projectId: result.insertId,
      type: 'CREATED',
      actorPersonId: actor.person.id,
      toPhaseId: phase.id,
    });

    return result.insertId;
  }, { retries: 3 });   // two students opening a draft at the same moment
}

/** Update the core row. Only the fields the caller sent, only from the allow-list. */
async function updateProject(actor, project, body) {
  const values = pickFields(body, PROJECT_FIELDS);
  if (!Object.keys(values).length) throw HttpError.badRequest('ไม่มีข้อมูลที่จะแก้ไข');

  await transaction(async (conn) => {
    if ('advisor_person_id' in values) {
      await assertAdvisorIsValid(conn, values.advisor_person_id, project.club_id, project.academic_year);
    }

    const columns = Object.keys(values);
    await conn.query(
      `UPDATE project SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...columns.map((c) => values[c]), project.id]
    );

    await recordEvent(conn, {
      projectId: project.id,
      type: 'EDITED',
      actorPersonId: actor.person.id,
      section: 'core',
      detail: { fields: columns },
    });
  });
}

/**
 * Replace one child list wholesale.
 *
 * Delete-then-insert inside a transaction, because these are ordered lists: a
 * per-row merge would have to reconcile ordinals against a client that may have
 * reordered, inserted and removed in one edit. The old system's equivalent —
 * insert 15 stub rows, then bulk-update them (Q19) — is what this replaces.
 */
async function replaceSection(actor, project, sectionName, body) {
  const spec = SECTIONS[sectionName];
  if (!spec) throw HttpError.notFound(`ไม่รู้จักส่วน ${sectionName}`);

  const items = pickList(body);
  const rows = items.map((item) => pickFields(item, spec.fields, { requireAll: true }));

  // Ordinals are ours to assign: sequential, or restarting per group where the
  // table's unique key is grouped (attendance).
  const counters = new Map();
  rows.forEach((row, index) => {
    if (!spec.groupBy) {
      row.ordinal = index + 1;
      return;
    }
    // NUL as the separator because no validated value can contain one, so two
    // different groups cannot collide into one key — which a comma would let
    // them do the moment a grouped column held a comma. Written as the escape
    // `'\0'`: the byte itself was in this file until 2026-08-17, and it made
    // grep and ripgrep classify the whole module as binary and skip it.
    const key = spec.groupBy.map((column) => row[column]).join('\0');
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    row.ordinal = next;
  });

  await transaction(async (conn) => {
    await conn.query(`DELETE FROM \`${spec.table}\` WHERE project_id = ?`, [project.id]);

    for (const row of rows) {
      const columns = ['project_id', ...Object.keys(row)];
      await conn.query(
        `INSERT INTO \`${spec.table}\` (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        [project.id, ...Object.keys(row).map((column) => row[column])]
      );
    }

    await recordEvent(conn, {
      projectId: project.id,
      type: 'EDITED',
      actorPersonId: actor.person.id,
      section: sectionName,
      detail: { count: rows.length },
    });
  });

  return rows.length;
}

/** Replace the whole tag selection. Unknown tag ids are named, not ignored. */
async function replaceTags(actor, project, body) {
  const ids = pickList(body, 'tagIds', { max: 200 })
    .map((value, index) => check.integer({ min: 1, required: true })(value, `tagIds[${index}]`));
  const unique = [...new Set(ids)];

  await transaction(async (conn) => {
    if (unique.length) {
      const [known] = await conn.query(
        `SELECT id FROM tag WHERE id IN (${unique.map(() => '?').join(',')})`,
        unique
      );
      const missing = unique.filter((id) => !known.some((row) => row.id === id));
      if (missing.length) throw HttpError.badRequest(`ไม่พบ tag: ${missing.join(', ')}`);
    }

    await conn.query('DELETE FROM project_tag WHERE project_id = ?', [project.id]);
    for (const tagId of unique) {
      await conn.query('INSERT INTO project_tag (project_id, tag_id) VALUES (?, ?)', [project.id, tagId]);
    }

    await recordEvent(conn, {
      projectId: project.id,
      type: 'EDITED',
      actorPersonId: actor.person.id,
      section: 'tags',
      detail: { count: unique.length },
    });
  });

  return unique.length;
}

/**
 * Hard delete; children cascade. `project_event` goes with it — there is
 * nothing left to log against.
 *
 * **Except `disbursement`, which does not cascade** — its foreign key is the
 * one of the fourteen pointing at `project` that never said `ON DELETE`, so it
 * restricts. Left alone, that made `DELETE /projects/:id` answer a bare 500 for
 * exactly the projects where money had moved, with the driver's constraint name
 * in the server log and "เกิดข้อผิดพลาดภายในระบบ" on the screen.
 *
 * Turned into a refusal rather than into a cascade, on purpose. A disbursement
 * records that money left the university's account, and whether an Admin may
 * erase that by deleting the project is a question for whoever runs the
 * process — not something to settle by adding a keyword to a migration.
 * Refusing is the answer that cannot destroy anything while it waits, and if
 * the answer comes back "cascade", it is a one-line migration.
 */
async function deleteProject(project) {
  const [[{ disbursements }]] = await pool.query(
    'SELECT COUNT(*) AS disbursements FROM disbursement WHERE project_id = ?',
    [project.id]
  );
  if (disbursements > 0) {
    throw HttpError.conflict(
      `โครงการนี้มีการเบิกจ่ายแล้ว ${disbursements} รายการ จึงลบไม่ได้ ` +
      'เพราะจะทำให้หลักฐานการจ่ายเงินหายไปด้วย',
      { disbursements }
    );
  }
  await pool.query('DELETE FROM project WHERE id = ?', [project.id]);
}

module.exports = {
  PROJECT_FIELDS,
  SECTIONS,
  SECTION_NAMES,
  findProject,
  listProjects,
  loadSections,
  loadEvents,
  presentProject,
  createProject,
  lockClubForNumbering,
  updateProject,
  replaceSection,
  replaceTags,
  deleteProject,
  recordEvent,
};
