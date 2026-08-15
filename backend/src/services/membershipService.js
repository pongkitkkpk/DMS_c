/**
 * Granting roles — the only place in the system that creates authority.
 *
 * Everywhere else, `membership` is read: `requireAuth` resolves it into an
 * actor, and `scope.js` judges every request against it. Until now those rows
 * only ever came from the seed, so the question "who may write one" had never
 * had to be answered. It is answered here, and deliberately in more than one
 * layer, because a mistake in this file is not a wrong number on a screen — it
 * is somebody holding a power they were never given.
 *
 * The rules, in the order they are enforced:
 *
 * 1. **The person must already exist.** A membership attaches to a `person`
 *    row, and `person` belongs to ICIT (`identityService`): it is written on
 *    login and nowhere else. So an officer grants a role to somebody who has
 *    signed in at least once — which they can always do, since authenticating
 *    while holding no membership is a supported state. The alternative would be
 *    this application inventing identities, which is the one thing the split
 *    between `person` and `membership` exists to prevent.
 * 2. **Only roles the actor may hand out** (`scope.assertCanGrantRole`) —
 *    ADMIN anything, STUACT the two club roles inside its own jurisdiction.
 * 3. **Not into a past year.** Settled with the owner on 2026-08-15: next year
 *    yes, a year that has closed no. Backdating a role would hand someone
 *    authority over projects that were already decided, and unlike a corrected
 *    allocation there is no figure to compare afterwards.
 * 4. **The shape the schema demands.** `ck_membership_scope` requires a club
 *    for SH/AD, a jurisdiction for STUACT and neither for ADMIN. That check is
 *    the real guarantee; what this file adds is a readable error instead of a
 *    constraint violation.
 */
const { pool, transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { config } = require('../config');
const { clubVisibilityClause, assertCanGrantRole, GRANTABLE_ROLES } = require('./scope');

const ROLES = ['SH', 'AD', 'STUACT', 'ADMIN'];

/**
 * Memberships the caller may see, for one academic year.
 *
 * Scoped by club like the allocations are, with one deliberate gap: ADMIN and
 * STUACT memberships hang off a jurisdiction or off nothing at all, so they
 * have no club to scope by and only ADMIN sees them. A STUACT listing its
 * jurisdiction sees the club roles it is responsible for and not the officers
 * beside it, which is the same shape as everything else it can see.
 */
async function listMemberships(actor, query = {}) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN' && role !== 'STUACT') {
    throw HttpError.forbidden('ดูรายชื่อผู้มีสิทธิ์ได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }

  const academicYear = query.year
    ? check.integer({ min: 2400, max: 2700 })(query.year, 'year')
    : Number(actor.academicYear);

  const visibility = clubVisibilityClause(actor);
  // ADMIN's clause is `1 = 1`, which would also match the club-less rows via the
  // LEFT JOIN; STUACT's names a club group, which cannot. That is the intended
  // difference, spelled out rather than left to the reader of a JOIN.
  const scoped = role === 'ADMIN' ? '1 = 1' : `m.club_id IS NOT NULL AND ${visibility.sql}`;
  const params = role === 'ADMIN' ? [] : visibility.params;

  const [rows] = await pool.query(
    `SELECT m.id, m.role, m.academic_year, m.department_th, m.advisor_agency, m.created_at,
            p.id AS person_id, p.id_student, p.prefix, p.full_name_th, p.email,
            m.club_id, c.code AS club_code, c.name_th AS club_name,
            cg.id AS club_group_id, cg.name_th AS club_group_name,
            m.jurisdiction_club_group_id, jg.name_th AS jurisdiction_name
       FROM membership m
       JOIN person p ON p.id = m.person_id
       LEFT JOIN club c        ON c.id  = m.club_id
       LEFT JOIN club_group cg ON cg.id = c.club_group_id
       LEFT JOIN club_group jg ON jg.id = m.jurisdiction_club_group_id
      WHERE m.academic_year = ? AND ${scoped}
      ORDER BY c.code, m.role, p.full_name_th`,
    [academicYear, ...params]
  );

  return {
    academicYear,
    grantableRoles: GRANTABLE_ROLES[role] || [],
    // Next year, never a past one — the same window the write enforces, so the
    // form cannot offer a year the server will refuse.
    grantableYears: [Number(config.academicYear), Number(config.academicYear) + 1],
    items: rows.map(present),
  };
}

function present(row) {
  return {
    id: row.id,
    role: row.role,
    academicYear: row.academic_year,
    person: {
      id: row.person_id,
      idStudent: row.id_student,
      prefix: row.prefix,
      fullNameTh: row.full_name_th,
      email: row.email,
    },
    club: row.club_id
      ? { id: row.club_id, code: row.club_code, nameTh: row.club_name,
          clubGroupId: row.club_group_id, clubGroupName: row.club_group_name }
      : null,
    jurisdiction: row.jurisdiction_club_group_id
      ? { id: row.jurisdiction_club_group_id, nameTh: row.jurisdiction_name }
      : null,
    departmentTh: row.department_th,
    advisorAgency: row.advisor_agency,
    createdAt: row.created_at,
  };
}

/**
 * The authority changes this caller may see, newest first.
 *
 * A log nobody can read is a log nobody trusts, so this exists as soon as the
 * log does. Scoped the same way the memberships are: ADMIN sees everything,
 * STUACT sees the club roles inside its jurisdiction and not the officers
 * beside it.
 *
 * Reads from the event's own copy of the club, not from a join back to a
 * membership — the whole point is that the membership may be gone.
 */
async function listMembershipEvents(actor, query = {}) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN' && role !== 'STUACT') {
    throw HttpError.forbidden('ดูประวัติสิทธิ์ได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }

  const limit = check.integer({ min: 1, max: 200 })(query.limit, 'limit') || 50;
  const where = [];
  const params = [];

  if (role === 'STUACT') {
    where.push('e.club_id IS NOT NULL AND c.club_group_id = ?');
    params.push(actor.membership.jurisdiction_club_group_id);
  }

  const [rows] = await pool.query(
    `SELECT e.id, e.action, e.role, e.academic_year, e.occurred_at,
            p.full_name_th AS person_name, p.id_student,
            a.full_name_th AS actor_name,
            c.code AS club_code, c.name_th AS club_name,
            g.name_th AS jurisdiction_name
       FROM membership_event e
       JOIN person p ON p.id = e.person_id
       JOIN person a ON a.id = e.actor_person_id
       LEFT JOIN club c       ON c.id = e.club_id
       LEFT JOIN club_group g ON g.id = e.jurisdiction_club_group_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT ?`,
    [...params, limit]
  );

  return {
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      role: row.role,
      academicYear: row.academic_year,
      occurredAt: row.occurred_at,
      personName: row.person_name,
      idStudent: row.id_student,
      actorName: row.actor_name,
      scope: row.club_name
        ? `${row.club_name} (${row.club_code})`
        : row.jurisdiction_name || null,
    })),
  };
}

/**
 * People who could be granted a role: a search, never a listing.
 *
 * Requiring a search term is the point. `person` is every human who has ever
 * signed in, with their name and university email, and an endpoint that
 * answered "all of them" would be a directory export available to any officer.
 * A caller who already knows who they are looking for loses nothing.
 */
async function searchPeople(actor, query = {}) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN' && role !== 'STUACT') {
    throw HttpError.forbidden('ค้นหาผู้ใช้ได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }

  const term = String(query.q || '').trim();
  if (term.length < 3) {
    throw HttpError.badRequest('พิมพ์ชื่อหรือรหัสนักศึกษาอย่างน้อย 3 ตัวอักษร');
  }

  // Name, username and account type — what it takes to pick the right person
  // out of a list and no more. Email was here and no screen used it, which is
  // exposure bought for nothing: this endpoint is a name search across every
  // human who has ever signed in, so the narrower the row the better.
  // The term is parameterised, so this is not an injection — but `%` and `_`
  // are wildcards *inside* a LIKE value, and an unescaped `%` turns a search
  // into "everyone", which is the listing this endpoint refuses to be. Escaped,
  // the three-character minimum means what it says.
  const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const [rows] = await pool.query(
    `SELECT id, id_student, prefix, full_name_th, account_type
       FROM person
      WHERE id_student LIKE ? OR full_name_th LIKE ?
      ORDER BY full_name_th
      LIMIT 20`,
    [like, like]
  );

  return {
    people: rows.map((row) => ({
      id: row.id,
      idStudent: row.id_student,
      prefix: row.prefix,
      fullNameTh: row.full_name_th,
      // The ICIT identity type, not a role — a `personel` account holds no more
      // authority than a `students` one until a membership says so.
      accountType: row.account_type,
    })),
  };
}

/**
 * Write the record of an authority change, inside the caller's transaction.
 *
 * Inside, not after: a grant that succeeded without its log entry would be a
 * role nobody can account for, which is the failure this table exists to make
 * impossible. If the log write fails the grant fails with it.
 *
 * The membership is copied rather than referenced — see the migration. A REVOKE
 * row is read after the row it describes has been deleted.
 */
async function recordMembershipEvent(conn, action, actor, m) {
  await conn.query(
    `INSERT INTO membership_event
       (action, person_id, role, academic_year, club_id,
        jurisdiction_club_group_id, actor_person_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [action, m.personId, m.role, m.academicYear, m.clubId || null,
     m.jurisdictionId || null, actor.person.id]
  );
}

/**
 * Create one membership.
 *
 * Runs in a transaction because the club has to be read before it can be
 * judged, and the row written against that judgement — reading the club outside
 * the transaction would let it move between groups in between, which is
 * unlikely and free to prevent.
 */
async function createMembership(actor, body) {
  const personId = check.integer({ min: 1, required: true })(body && body.personId, 'personId');
  const role = check.text({ max: 16, required: true })(body && body.role, 'role');
  const academicYear = check.integer({ min: 2400, max: 2700, required: true })(
    body && body.academicYear, 'academicYear'
  );
  const clubId = check.integer({ min: 1 })(body && body.clubId, 'clubId');
  const jurisdictionId = check.integer({ min: 1 })(
    body && body.jurisdictionClubGroupId, 'jurisdictionClubGroupId'
  );
  const departmentTh = check.text({ max: 255 })(body && body.departmentTh, 'departmentTh');
  const advisorAgency = check.text({ max: 255 })(body && body.advisorAgency, 'advisorAgency');

  if (!ROLES.includes(role)) throw HttpError.badRequest(`role: ต้องเป็น ${ROLES.join(', ')}`);

  // A past year is refused before anything is read: a request that cannot
  // succeed should not first ask the database whether a club exists.
  if (academicYear < Number(config.academicYear)) {
    throw HttpError.badRequest(
      `กำหนดสิทธิ์ย้อนหลังไม่ได้ — ปี ${academicYear} ผ่านไปแล้ว (ปีปัจจุบันคือ ${config.academicYear})`
    );
  }
  if (academicYear > Number(config.academicYear) + 1) {
    throw HttpError.badRequest(
      `กำหนดสิทธิ์ล่วงหน้าได้ถึงปี ${Number(config.academicYear) + 1} เท่านั้น`
    );
  }

  // The shape `ck_membership_scope` will insist on, refused here with a sentence
  // rather than there with a constraint name.
  if (role === 'SH' || role === 'AD') {
    if (!clubId) throw HttpError.badRequest('ต้องระบุชมรมสำหรับสิทธิ์หัวหน้านักศึกษาและอาจารย์ที่ปรึกษา');
    if (jurisdictionId) throw HttpError.badRequest('สิทธิ์ระดับชมรมกำหนดกลุ่มที่รับผิดชอบไม่ได้');
  } else if (role === 'STUACT') {
    if (!jurisdictionId) throw HttpError.badRequest('ต้องระบุกลุ่มชมรมที่รับผิดชอบสำหรับกองกิจการนักศึกษา');
    if (clubId) throw HttpError.badRequest('สิทธิ์กองกิจการนักศึกษาสังกัดชมรมไม่ได้');
  } else if (clubId || jurisdictionId) {
    throw HttpError.badRequest('สิทธิ์ผู้ดูแลระบบไม่สังกัดชมรมหรือกลุ่มชมรม');
  }

  return transaction(async (conn) => {
    const [[person]] = await conn.query(
      'SELECT id, full_name_th FROM person WHERE id = ?', [personId]
    );
    // The chicken-and-egg this design deliberately does not have: they sign in
    // once, holding nothing, and then they can be given something.
    if (!person) throw HttpError.badRequest('ไม่พบผู้ใช้ — ผู้รับสิทธิ์ต้องเคยเข้าสู่ระบบอย่างน้อยหนึ่งครั้ง');

    let club = null;
    if (clubId) {
      const [[found]] = await conn.query(
        'SELECT id, name_th, club_group_id FROM club WHERE id = ?', [clubId]
      );
      if (!found) throw HttpError.badRequest('ไม่พบชมรม');
      club = found;
    }
    if (jurisdictionId) {
      const [[group]] = await conn.query('SELECT id FROM club_group WHERE id = ?', [jurisdictionId]);
      if (!group) throw HttpError.badRequest('ไม่พบกลุ่มชมรม');
    }

    assertCanGrantRole(actor, { role, club });

    // A4: one person may hold several memberships, so a duplicate is only a
    // duplicate on the whole key. Answering 409 rather than silently upserting
    // matters here — an officer who thinks they just granted something should
    // not be told "done" about a row that already existed.
    const [[existing]] = await conn.query(
      `SELECT id FROM membership
        WHERE person_id = ? AND academic_year = ? AND role = ?
          AND ((club_id IS NULL AND ? IS NULL) OR club_id = ?)`,
      [personId, academicYear, role, clubId, clubId]
    );
    if (existing) throw HttpError.conflict('ผู้ใช้รายนี้มีสิทธิ์นี้อยู่แล้วในปีการศึกษาที่เลือก');

    const [result] = await conn.query(
      `INSERT INTO membership
         (person_id, role, academic_year, club_id, jurisdiction_club_group_id,
          department_th, advisor_agency)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [personId, role, academicYear, clubId, jurisdictionId, departmentTh, advisorAgency]
    );

    await recordMembershipEvent(conn, 'GRANT', actor, {
      personId, role, academicYear, clubId, jurisdictionId,
    });

    const [[row]] = await conn.query(
      `SELECT m.id, m.role, m.academic_year, m.department_th, m.advisor_agency, m.created_at,
              p.id AS person_id, p.id_student, p.prefix, p.full_name_th, p.email,
              m.club_id, c.code AS club_code, c.name_th AS club_name,
              cg.id AS club_group_id, cg.name_th AS club_group_name,
              m.jurisdiction_club_group_id, jg.name_th AS jurisdiction_name
         FROM membership m
         JOIN person p ON p.id = m.person_id
         LEFT JOIN club c        ON c.id  = m.club_id
         LEFT JOIN club_group cg ON cg.id = c.club_group_id
         LEFT JOIN club_group jg ON jg.id = m.jurisdiction_club_group_id
        WHERE m.id = ?`,
      [result.insertId]
    );

    return { membership: present(row) };
  });
}

/**
 * Take a role away.
 *
 * The row goes; the record of it stays in `membership_event`. Nothing else has
 * to be repaired: every other table references `person`, so the projects this
 * person owns, the transitions they made and the money they approved are all
 * untouched, and `requireAuth` re-reads memberships on every request, so the
 * access ends on their next click rather than when a token expires.
 *
 * Three refusals, in the order they are cheapest to check:
 *
 * 1. **Only what the actor could have granted** — the same rule as
 *    `createMembership`, so nobody can remove authority they could not confer.
 * 2. **Not your own.** Revoking the membership you are acting under takes away
 *    the page you are standing on, and for the last ADMIN it is unrecoverable.
 *    If someone is standing down, another officer removes them.
 * 3. **Not the last ADMIN of a year.** Belt and braces, and **unreachable
 *    today**: only an ADMIN may revoke an ADMIN (rule 1) and no one may revoke
 *    their own (rule 2), so at least one always survives. It is kept, and
 *    labelled, because the day rule 2 is relaxed — "let an officer stand
 *    themselves down" is a reasonable-sounding request — this is the only thing
 *    standing between that change and a system with no ADMIN, which nobody
 *    could ever grant a role in again.
 */
async function revokeMembership(actor, membershipId) {
  const id = check.integer({ min: 1, required: true })(membershipId, 'id');

  return transaction(async (conn) => {
    const [[row]] = await conn.query(
      `SELECT m.id, m.person_id, m.role, m.academic_year, m.club_id,
              m.jurisdiction_club_group_id,
              p.full_name_th, c.club_group_id, c.name_th AS club_name
         FROM membership m
         JOIN person p ON p.id = m.person_id
         LEFT JOIN club c ON c.id = m.club_id
        WHERE m.id = ?
        FOR UPDATE`,
      [id]
    );
    if (!row) throw HttpError.notFound('ไม่พบสิทธิ์ที่ต้องการถอน');

    assertCanGrantRole(actor, {
      role: row.role,
      club: row.club_id ? { id: row.club_id, club_group_id: row.club_group_id } : null,
    });

    if (Number(row.id) === Number(actor.membership && actor.membership.id)) {
      throw HttpError.badRequest('ถอนสิทธิ์ที่ตัวเองกำลังใช้งานอยู่ไม่ได้ — ให้เจ้าหน้าที่อีกคนเป็นผู้ถอน');
    }

    if (row.role === 'ADMIN') {
      const [[{ remaining }]] = await conn.query(
        `SELECT COUNT(*) AS remaining FROM membership
          WHERE role = 'ADMIN' AND academic_year = ? AND id <> ?`,
        [row.academic_year, id]
      );
      if (remaining === 0) {
        throw HttpError.badRequest(
          `ถอนไม่ได้ — นี่คือผู้ดูแลระบบคนสุดท้ายของปี ${row.academic_year} ` +
          'ถ้าไม่มีผู้ดูแลระบบเหลืออยู่ จะไม่มีใครกำหนดสิทธิ์ให้ใครได้อีก'
        );
      }
    }

    await recordMembershipEvent(conn, 'REVOKE', actor, {
      personId: row.person_id,
      role: row.role,
      academicYear: row.academic_year,
      clubId: row.club_id,
      jurisdictionId: row.jurisdiction_club_group_id,
    });

    await conn.query('DELETE FROM membership WHERE id = ?', [id]);

    return {
      revoked: {
        id: row.id,
        role: row.role,
        academicYear: row.academic_year,
        personName: row.full_name_th,
        clubName: row.club_name,
      },
    };
  });
}

/**
 * How many projects still name this person as their adviser in this year.
 *
 * Not a blocker — the projects keep their `advisor_person_id`, which is a
 * `person` reference and stays valid. But `assertAdvisorIsValid` re-checks the
 * adviser's `AD` membership on every edit, so revoking it means those projects
 * can no longer be saved until somebody names a different adviser. That is a
 * real consequence of an otherwise invisible click, so the screen is given the
 * number to warn with.
 */
async function advisorImpact(actor, membershipId) {
  const id = check.integer({ min: 1, required: true })(membershipId, 'id');

  const [[row]] = await pool.query(
    `SELECT m.person_id, m.role, m.academic_year, m.club_id, c.club_group_id
       FROM membership m
       LEFT JOIN club c ON c.id = m.club_id
      WHERE m.id = ?`,
    [id]
  );
  if (!row) throw HttpError.notFound('ไม่พบสิทธิ์');

  // The same gate as revoking, deliberately: this endpoint exists to describe a
  // revocation before it happens, so it must refuse in exactly the cases the
  // revocation would. Checking only the caller's *role* and not their *scope*
  // let a STUACT ask about an adviser in another jurisdiction and be told how
  // many projects that club has — a smaller version of deviation 1, reached
  // through a membership id instead of a club id.
  assertCanGrantRole(actor, {
    role: row.role,
    club: row.club_id ? { id: row.club_id, club_group_id: row.club_group_id } : null,
  });

  if (row.role !== 'AD') return { projects: 0 };

  const [[{ projects }]] = await pool.query(
    `SELECT COUNT(*) AS projects FROM project
      WHERE advisor_person_id = ? AND club_id = ? AND academic_year = ?`,
    [row.person_id, row.club_id, row.academic_year]
  );
  return { projects: Number(projects) };
}

module.exports = {
  listMemberships,
  listMembershipEvents,
  searchPeople,
  createMembership,
  revokeMembership,
  advisorImpact,
};
