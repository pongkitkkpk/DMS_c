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

  const like = `%${term}%`;
  const [rows] = await pool.query(
    `SELECT id, id_student, prefix, full_name_th, email, account_type
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
      email: row.email,
      // The ICIT identity type, not a role — a `personel` account holds no more
      // authority than a `students` one until a membership says so.
      accountType: row.account_type,
    })),
  };
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

    // Handing out authority is worth a line in the server log whether or not
    // anyone is reading it today. There is no event table for memberships.
    console.info(
      `membership granted: ${role} to person ${personId} (${person.full_name_th}) ` +
      `for ${academicYear}${club ? ` at club ${club.id} (${club.name_th})` : ''} ` +
      `by person ${actor.person.id}`
    );

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

module.exports = { listMemberships, searchPeople, createMembership };
