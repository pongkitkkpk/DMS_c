/**
 * `projectService.js` names three rules that hold everywhere in it: named
 * columns only (deviation 2 — the old system had fourteen `UPDATE … SET ?`
 * mass-assignment sites), scope applied in the query, and anything touching
 * more than one table runs in a transaction with its `project_event` row.
 * These tests drive `createProject`/`updateProject`/`replaceSection`/
 * `replaceTags`/`deleteProject` with a fake `conn`/`pool` (query dispatched by
 * SQL shape, same approach as the other service tests) — the mass-assignment
 * tests in particular are checking the actual defence deviation 2 replaced.
 */
const { HttpError } = require('../lib/httpError');

function makeConn(overrides = {}) {
  const state = {
    draftPhase: { id: 100 },       // SELECT id FROM phase WHERE code = 'DRAFT_PROPOSAL'
    advisorMembership: [{ 1: 1 }], // truthy rows -> advisor is valid; [] -> invalid
    club: { id: 10 },              // lockClubForNumbering's existence check
    nextDraftSequence: 1,
    knownTagIds: [],               // SELECT id FROM tag WHERE id IN (...)
    disbursementCount: 0,
    nextEventId: 1,
    inserted: [],                  // every INSERT's (table-ish, params)
    updates: [],                   // every UPDATE's (sql, params)
    deletes: [],
    events: [],
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes("FROM phase WHERE code = 'DRAFT_PROPOSAL'")) {
      return [state.draftPhase ? [state.draftPhase] : []];
    }
    if (text.includes('FROM membership') && text.includes("role = 'AD'")) {
      return [state.advisorMembership];
    }
    if (text.includes('FROM club WHERE id = ? FOR UPDATE')) {
      return [state.club ? [state.club] : []];
    }
    if (text.includes('MAX(draft_sequence)')) {
      return [[{ next: state.nextDraftSequence }]];
    }
    if (text.startsWith('INSERT INTO project (')) {
      const insertId = 1000;
      state.inserted.push({ table: 'project', params });
      return [{ insertId }];
    }
    if (text.startsWith('UPDATE project SET')) {
      state.updates.push({ sql: text, params });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO project_event')) {
      const id = state.nextEventId++;
      state.events.push({ id, params });
      return [{ insertId: id }];
    }
    if (text.startsWith('DELETE FROM `')) {
      state.deletes.push({ text, params });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO `')) {
      state.inserted.push({ table: text, params });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('SELECT id FROM tag WHERE id IN')) {
      return [state.knownTagIds.map((id) => ({ id }))];
    }
    if (text.startsWith('DELETE FROM project_tag WHERE project_id')) {
      state.deletes.push({ text, params });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO project_tag')) {
      state.inserted.push({ table: 'project_tag', params });
      return [{ affectedRows: 1 }];
    }
    if (text.includes('AS disbursements')) {
      return [[{ disbursements: state.disbursementCount }]];
    }
    if (text.startsWith('DELETE FROM project WHERE id')) {
      state.deletes.push({ text, params });
      return [{ affectedRows: 1 }];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

function loadProjectService(connState = {}) {
  jest.resetModules();
  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));
  const projectService = require('./projectService');
  return { projectService, conn, state: conn.state };
}

const actor = (personId = 1) => ({ person: { id: personId }, academicYear: 2569 });
const project = (overrides = {}) => ({
  id: 1, club_id: 10, academic_year: 2569, advisor_person_id: null, ...overrides,
});

describe('assertAdvisorIsValid (via createProject/updateProject)', () => {
  test('a null advisor is always accepted — nothing to check', async () => {
    const { projectService } = loadProjectService();
    await expect(
      projectService.createProject(actor(), { name: 'โครงการ' }, 10)
    ).resolves.toBeDefined();
  });

  test('an advisor who is not AD of this club/year is refused', async () => {
    const { projectService } = loadProjectService({ advisorMembership: [] });
    await expect(
      projectService.createProject(actor(), { name: 'โครงการ', advisorPersonId: 7 }, 10)
    ).rejects.toMatchObject({ status: 400 });
  });

  test('a genuine AD of this club/year is accepted', async () => {
    const { projectService } = loadProjectService({ advisorMembership: [{ 1: 1 }] });
    await expect(
      projectService.createProject(actor(), { name: 'โครงการ', advisorPersonId: 7 }, 10)
    ).resolves.toBeDefined();
  });
});

describe('createProject', () => {
  test('rejects any field outside the allow-list rather than silently dropping it', async () => {
    // Deviation 2's whole point: `club_id`, `phase_id`, `project_number` etc.
    // are the system's to issue, not the client's — the old
    // `PUT /student/project/edit/:id_project` accepted every one of them.
    const { projectService } = loadProjectService();
    await expect(
      projectService.createProject(actor(), { name: 'โครงการ', club_id: 999 }, 10)
    ).rejects.toMatchObject({ status: 400 });
  });

  test('fails loudly if the seed is missing the DRAFT_PROPOSAL phase, rather than writing a project with no phase', async () => {
    const { projectService } = loadProjectService({ draftPhase: null });
    await expect(projectService.createProject(actor(), { name: 'โครงการ' }, 10)).rejects.toThrow(
      /DRAFT_PROPOSAL/
    );
  });

  test('issues draft_sequence from the club’s own next number, and records a CREATED event', async () => {
    const { projectService, state } = loadProjectService({ nextDraftSequence: 4 });

    const id = await projectService.createProject(actor(9), { name: 'โครงการ' }, 10);

    expect(id).toBe(1000);
    const [{ params }] = state.inserted;
    // Row order follows Object.keys(row): {...values, club_id, owner_person_id,
    // academic_year, draft_sequence, phase_id} — club_id/owner/year/sequence/phase
    // come from the server, never the request body.
    expect(params).toEqual(expect.arrayContaining([10, 9, 2569, 4, 100]));
    expect(state.events).toHaveLength(1);
  });
});

describe('updateProject', () => {
  test('refuses a write with nothing recognised to change', async () => {
    const { projectService } = loadProjectService();
    await expect(projectService.updateProject(actor(), project(), {})).rejects.toMatchObject({ status: 400 });
  });

  test('rejects any field outside the allow-list', async () => {
    const { projectService } = loadProjectService();
    await expect(
      projectService.updateProject(actor(), project(), { name: 'ใหม่', phase_id: 999 })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('only the fields actually sent reach the UPDATE, and the row is unlocked by anything else', async () => {
    const { projectService, state } = loadProjectService();

    await projectService.updateProject(actor(), project(), { name: 'ชื่อใหม่' });

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql).toBe('UPDATE project SET name = ? WHERE id = ?');
    expect(state.events).toHaveLength(1);
  });

  test('re-validates the advisor only when advisorPersonId is actually sent', async () => {
    const { projectService, conn } = loadProjectService();

    await projectService.updateProject(actor(), project(), { name: 'ชื่อใหม่' });

    expect(conn.query).not.toHaveBeenCalledWith(expect.stringContaining("role = 'AD'"), expect.anything());
  });

  test('refuses an advisor change to someone who is not AD of this club/year', async () => {
    const { projectService } = loadProjectService({ advisorMembership: [] });
    await expect(
      projectService.updateProject(actor(), project(), { advisorPersonId: 7 })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('replaceSection', () => {
  test('refuses an unknown section name', async () => {
    const { projectService } = loadProjectService();
    await expect(
      projectService.replaceSection(actor(), project(), 'notASection', { items: [] })
    ).rejects.toMatchObject({ status: 404 });
  });

  test('assigns ordinals from array position for an ungrouped section', async () => {
    const { projectService, state } = loadProjectService();

    const count = await projectService.replaceSection(actor(), project(), 'objectives', {
      items: [{ content: 'หนึ่ง' }, { content: 'สอง' }],
    });

    expect(count).toBe(2);
    const rows = state.inserted.filter((r) => r.table.includes('project_objective'));
    // columns: [project_id, content, ordinal] — ordinal is appended after
    // whatever pickFields already put in the row, so it is always last.
    expect(rows.map((r) => r.params[r.params.length - 1])).toEqual([1, 2]);
  });

  test('restarts ordinals inside each group for a grouped section (attendance)', async () => {
    const { projectService, state } = loadProjectService();

    await projectService.replaceSection(actor(), project(), 'attendance', {
      items: [
        { variant: 'PLANNED', attendeeType: 'STUDENT', headcount: 10 },
        { variant: 'PLANNED', attendeeType: 'PROFESSOR', headcount: 2 },
        { variant: 'PLANNED', attendeeType: 'STUDENT', headcount: 12 },
      ],
    });

    const rows = state.inserted.filter((r) => r.table.includes('project_attendance'));
    // columns: [project_id, variant, attendee_type, headcount, ordinal] (label
    // is optional and unsent, so absent from the column list)
    const ordinalsByType = rows.map((r) => r.params[r.params.length - 1]);
    expect(ordinalsByType).toEqual([1, 1, 2]); // STUDENT restarts separately from PROFESSOR
  });
});

describe('replaceTags', () => {
  test('names every unknown tag id rather than silently dropping it', async () => {
    const { projectService } = loadProjectService({ knownTagIds: [1] });
    await expect(
      projectService.replaceTags(actor(), project(), { tagIds: [1, 2, 3] })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('replaces the tag set wholesale when every id is known', async () => {
    const { projectService, state } = loadProjectService({ knownTagIds: [1, 2] });

    const count = await projectService.replaceTags(actor(), project(), { tagIds: [1, 2, 1] });

    expect(count).toBe(2); // de-duplicated
    expect(state.deletes.some((d) => d.text.includes('project_tag'))).toBe(true);
    expect(state.inserted.filter((r) => r.table === 'project_tag')).toHaveLength(2);
  });
});

describe('deleteProject', () => {
  test('refuses to delete a project with disbursements on record', async () => {
    const { projectService } = loadProjectService({ disbursementCount: 2 });
    await expect(projectService.deleteProject(project())).rejects.toMatchObject({ status: 409 });
  });

  test('deletes a project with no disbursements', async () => {
    const { projectService, state } = loadProjectService({ disbursementCount: 0 });
    await projectService.deleteProject(project());
    expect(state.deletes.some((d) => d.text.startsWith('DELETE FROM project WHERE id'))).toBe(true);
  });
});
