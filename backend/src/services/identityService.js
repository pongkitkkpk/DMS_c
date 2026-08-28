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
 * Most privileged first. Used to pick a default when one person holds several
 * memberships in the same year — a case A4 allows and the fixtures do not yet
 * exercise. A4 was confirmed on 2026-08-15 (docs/DECISIONS.md), so this is a
 * live path, not a contingency: people really do hold more than one role.
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
            m.club_id, c.name_th AS club_name, c.code AS club_code, c.is_council,
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

/**
 * Name and role for a handful of known usernames, for the demonstration
 * directory on the login screen.
 *
 * The roles are read out of `membership`, not written down beside the usernames
 * — the same rule as everywhere else in this file. A hardcoded list on the
 * login page would be a second statement of who is what, and the seed is free
 * to disagree with it; this one cannot.
 *
 * A username with no `person` row yet — nobody has logged in as it since the
 * last reset — is returned with `role: null` rather than dropped. It is still a
 * valid account to demonstrate with; it simply has no membership until it
 * exists, which is the honest thing to show.
 *
 * The scope comes back with the role, because the role alone does not identify
 * the account: two of the fixtures are both `SH`, and a directory that prints
 * "หัวหน้านักศึกษา" twice with nothing to separate them is unreadable on the one
 * screen where telling them apart is the entire point — the second exists to
 * demonstrate that a different club cannot be seen.
 *
 * @param {string[]} usernames
 * @returns {Promise<Array<{idStudent: string, fullNameTh: ?string, role: ?string,
 *                          scope: ?string}>>} in the order asked for.
 */
async function describeAccounts(usernames, academicYear) {
  if (!usernames.length) return [];

  const [rows] = await pool.query(
    `SELECT p.id_student, p.full_name_th, m.role,
            c.name_th  AS club_name,
            cg.name_th AS club_group_name
       FROM person p
       LEFT JOIN membership m
         ON m.person_id = p.id AND m.academic_year = ?
       LEFT JOIN club       c  ON c.id  = m.club_id
       LEFT JOIN club_group cg ON cg.id = COALESCE(m.jurisdiction_club_group_id, c.club_group_id)
      WHERE p.id_student IN (${usernames.map(() => '?').join(', ')})`,
    [academicYear, ...usernames]
  );

  // SH and AD are scoped to a club, STUACT to a jurisdiction, ADMIN to nothing
  // — the same three shapes `ck_membership_scope` enforces.
  const scopeOf = (row) => {
    if (row.role === 'SH' || row.role === 'AD') return row.club_name || null;
    if (row.role === 'STUACT') return row.club_group_name || null;
    return null;
  };

  const best = new Map();
  for (const row of rows) {
    const seen = best.get(row.id_student);
    // One person may hold several memberships in a year (A4). Show the one that
    // decides what they see, which is the one `requireAuth` would pick.
    const better = !seen || ROLE_PRECEDENCE.indexOf(row.role) < ROLE_PRECEDENCE.indexOf(seen.role);
    if (better) {
      best.set(row.id_student,
        { fullNameTh: row.full_name_th, role: row.role, scope: scopeOf(row) });
    }
  }

  return usernames.map((idStudent) => {
    const found = best.get(idStudent) || {};
    return {
      idStudent,
      fullNameTh: found.fullNameTh || null,
      role: found.role || null,
      scope: found.scope || null,
    };
  });
}

/**
 * Q15 keeps login logging. Never blocks or fails a login.
 *
 * These rows are no longer only a log: `services/loginThrottle.js` counts the
 * failures among them to decide whether the next attempt is allowed at all. So
 * **every** rejected credential must reach here, including the local admin
 * fallback — a path that records nothing is a path with no guessing limit.
 * `remoteIp` may be `null` when there is no trustworthy client address.
 */
async function recordLoginAttempt(idStudent, isSuccess, remoteIp = null) {
  try {
    await pool.query(
      'INSERT INTO login_attempt (id_student, is_success, remote_ip) VALUES (?, ?, ?)',
      [String(idStudent || '').slice(0, 100), isSuccess ? 1 : 0, remoteIp]
    );
  } catch (err) {
    console.error('login_attempt not recorded:', err.message);
  }
}

module.exports = {
  describeAccounts,
  upsertPerson,
  findPersonById,
  findPersonByIdStudent,
  loadMemberships,
  recordLoginAttempt,
  ROLE_PRECEDENCE,
};
