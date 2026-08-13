/**
 * Where an authenticated identity becomes an authorized actor.
 *
 * Two halves, deliberately not mixed:
 *
 * - **Identity** belongs to ICIT. `upsertPerson` writes what the provider said
 *   about a human being — name, email, account type — and touches nothing else.
 * - **Role** belongs to this application. `loadMemberships` reads it out of
 *   `membership`, which no provider can write. A person who authenticates
 *   successfully but holds no membership is a real, expected state: they are
 *   known and permitted nothing.
 *
 * See docs/business-rules.md, "Why the token could not carry a role".
 */
const { pool } = require('../db/pool');

/**
 * Most privileged first. Used only to pick a default when one person holds
 * several memberships in the same year — a case A4 allows and the fixtures do
 * not yet exercise. If A4 collapses `membership` into `person`, every list here
 * is length 1 and the precedence becomes a no-op.
 */
const ROLE_PRECEDENCE = ['ADMIN', 'STUACT', 'AD', 'SH'];

/**
 * Insert or refresh the `person` row for a normalized provider identity.
 *
 * Named columns, never `SET ?` — deviation 2 in docs/DECISIONS.md exists because
 * the old system passed request bodies straight into `UPDATE … SET ?`. The
 * update list is identity fields only: nothing here can reach `membership`.
 */
async function upsertPerson(identity) {
  await pool.query(
    `INSERT INTO person
       (id_student, prefix, full_name_th, email, phone, account_type, level_desc, stu_status_desc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       prefix          = VALUES(prefix),
       full_name_th    = VALUES(full_name_th),
       email           = VALUES(email),
       phone           = VALUES(phone),
       account_type    = VALUES(account_type),
       level_desc      = VALUES(level_desc),
       stu_status_desc = VALUES(stu_status_desc)`,
    [
      identity.idStudent,
      identity.prefix,
      identity.fullNameTh,
      identity.email,
      identity.phone,
      identity.accountType,
      identity.levelDesc,
      identity.stuStatusDesc,
    ]
  );

  // Re-read rather than trusting insertId: on the duplicate-key path it is 0.
  return findPersonByIdStudent(identity.idStudent);
}

async function findPersonByIdStudent(idStudent) {
  const [rows] = await pool.query(
    `SELECT id, id_student, prefix, full_name_th, email, phone, account_type,
            level_desc, stu_status_desc
       FROM person WHERE id_student = ?`,
    [idStudent]
  );
  return rows[0] || null;
}

async function findPersonById(id) {
  const [rows] = await pool.query(
    `SELECT id, id_student, prefix, full_name_th, email, phone, account_type,
            level_desc, stu_status_desc
       FROM person WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Every membership this person holds in `academicYear`, with the scope each role
 * is actually judged by: a club for SH/AD, a club-group jurisdiction for STUACT,
 * neither for ADMIN. The `ck_membership_scope` CHECK guarantees exactly one of
 * those is populated, so the caller never has to reconcile both.
 */
async function loadMemberships(personId, academicYear) {
  const [rows] = await pool.query(
    `SELECT m.id, m.role, m.academic_year, m.department_th, m.advisor_agency,
            m.club_id, c.name_th AS club_name, c.code AS club_code,
            cam.id AS campus_id, cam.code AS campus_code, cam.name_th AS campus_name,
            COALESCE(m.jurisdiction_club_group_id, c.club_group_id) AS club_group_id,
            cg.code    AS club_group_code,
            cg.name_th AS club_group_name,
            m.jurisdiction_club_group_id,
            m.agency_id, a.name_th AS agency_name,
            m.work_group_id, wg.name_th AS work_group_name
       FROM membership m
       LEFT JOIN club       c   ON c.id  = m.club_id
       LEFT JOIN campus     cam ON cam.id = c.campus_id
       LEFT JOIN club_group cg  ON cg.id = COALESCE(m.jurisdiction_club_group_id, c.club_group_id)
       LEFT JOIN agency     a   ON a.id  = m.agency_id
       LEFT JOIN work_group wg  ON wg.id = m.work_group_id
      WHERE m.person_id = ? AND m.academic_year = ?`,
    [personId, academicYear]
  );

  return rows.sort(
    (x, y) => ROLE_PRECEDENCE.indexOf(x.role) - ROLE_PRECEDENCE.indexOf(y.role)
  );
}

/** Q15 keeps login logging. Never blocks or fails a login. */
async function recordLoginAttempt(idStudent, isSuccess) {
  try {
    await pool.query(
      'INSERT INTO login_attempt (id_student, is_success) VALUES (?, ?)',
      [String(idStudent || '').slice(0, 100), isSuccess ? 1 : 0]
    );
  } catch (err) {
    console.error('login_attempt not recorded:', err.message);
  }
}

module.exports = {
  upsertPerson,
  findPersonById,
  findPersonByIdStudent,
  loadMemberships,
  recordLoginAttempt,
  ROLE_PRECEDENCE,
};
