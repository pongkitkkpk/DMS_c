/**
 * The yearly ceiling a club's approvals are drawn against — layer (c).
 *
 * There was no table for this and no rule enforcing it: the old system's
 * `netprojectbudget` held per-project figures only, so a club could approve past
 * whatever it had actually been given and nothing anywhere would notice. Q20/Q25
 * add the ceiling; Q31 puts its grain at `(club, campus, year)`; Q30 says Admin
 * and STUACT enter it and everyone else reads it.
 *
 * Two things are deliberately *not* enforced here:
 *
 * - **Lowering an allocation below what is already committed is allowed** (Q33).
 *   The money has been promised; refusing to write down the smaller number would
 *   only mean the system's figure and the university's disagree silently.
 *   The write answers with a warning and every read of the row carries
 *   `overCommitted`, which is what the STUACT dashboard shows.
 * - **Nothing here is a total.** `committed` is summed from the approved amounts
 *   it covers on every read, so an allocation cannot drift from its projects.
 */
const { pool, transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { satang, fromSatang, baht } = require('../lib/money');
const { clubVisibilityClause, assertCanEnterAllocation } = require('./scope');

const ALLOCATION_COLUMNS = `
  a.id, a.club_id, a.campus_id, a.academic_year, a.amount, a.updated_at,
  c.code AS club_code, c.name_th AS club_name, c.club_group_id,
  cg.name_th AS club_group_name,
  cam.abbreviation AS campus_abbreviation, cam.name_th AS campus_name,
  editor.full_name_th AS created_by_name,
  COALESCE((SELECT SUM(pl.approved_amount)
              FROM budget_plan_line pl
              JOIN project p ON p.id = pl.project_id
             WHERE p.club_id = a.club_id
               AND p.academic_year = a.academic_year
               AND pl.approved_amount IS NOT NULL), 0) AS committed`;

const ALLOCATION_JOINS = `
    FROM agency_allocation a
    JOIN club c        ON c.id = a.club_id
    JOIN campus cam    ON cam.id = a.campus_id
    LEFT JOIN club_group cg ON cg.id = c.club_group_id
    JOIN person editor ON editor.id = a.created_by`;

function present(row) {
  const remaining = satang(row.amount) - satang(row.committed);
  return {
    id: row.id,
    academicYear: row.academic_year,
    amount: row.amount,
    committed: String(row.committed),
    remaining: fromSatang(remaining),
    // Q33's loud half: the row is legal, and it says so on every read.
    overCommitted: remaining < 0,
    club: {
      id: row.club_id,
      code: row.club_code,
      nameTh: row.club_name,
      clubGroupId: row.club_group_id,
      clubGroupName: row.club_group_name,
    },
    campus: {
      id: row.campus_id,
      abbreviation: row.campus_abbreviation,
      nameTh: row.campus_name,
    },
    createdByName: row.created_by_name,
    updatedAt: row.updated_at,
  };
}

/**
 * Every allocation the caller may see, newest year first.
 *
 * Scoped in the query like everything else (Q16): a student sees their own
 * club's ceiling, a STUACT sees its group's, and nobody pages past that.
 */
async function listAllocations(actor, query = {}) {
  const visibility = clubVisibilityClause(actor);
  const where = [visibility.sql];
  const params = [...visibility.params];

  if (query.year) {
    where.push('a.academic_year = ?');
    params.push(check.integer({ min: 2400, max: 2700 })(query.year, 'year'));
  }
  if (query.clubId) {
    where.push('a.club_id = ?');
    params.push(check.integer({ min: 1 })(query.clubId, 'clubId'));
  }

  const [rows] = await pool.query(
    `SELECT ${ALLOCATION_COLUMNS} ${ALLOCATION_JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY a.academic_year DESC, c.code`,
    params
  );

  const items = rows.map(present);
  return { items, overCommitted: items.filter((item) => item.overCommitted) };
}

/**
 * Set a club's ceiling for a year. Idempotent on `uq_allocation`, so the same
 * call sets it or changes it.
 *
 * The lock order is the one every money path uses — allocation, then the
 * projects behind it — and the committed sum is read `FOR UPDATE` rather than
 * from the transaction's snapshot, which was fixed before the wait for the lock
 * and so would not include an approval that had just committed.
 */
async function upsertAllocation(actor, body) {
  const clubId = check.integer({ min: 1, required: true })(body && body.clubId, 'clubId');
  const academicYear = check.integer({ min: 2400, max: 2700, required: true })(
    body && body.academicYear, 'academicYear'
  );
  const amount = check.decimal({ required: true })(body && body.amount, 'amount');

  return transaction(async (conn) => {
    const [[club]] = await conn.query(
      'SELECT id, name_th, campus_id, club_group_id FROM club WHERE id = ?',
      [clubId]
    );
    if (!club) throw HttpError.badRequest('ไม่พบชมรม');
    assertCanEnterAllocation(actor, club);

    await conn.query(
      `SELECT id FROM agency_allocation
        WHERE club_id = ? AND academic_year = ? FOR UPDATE`,
      [clubId, academicYear]
    );

    const [[{ committed }]] = await conn.query(
      `SELECT COALESCE(SUM(pl.approved_amount), 0) AS committed
         FROM budget_plan_line pl
         JOIN project p ON p.id = pl.project_id
        WHERE p.club_id = ? AND p.academic_year = ? AND pl.approved_amount IS NOT NULL
        FOR UPDATE`,
      [clubId, academicYear]
    );

    // `campus_id` is the club's own — Q31's key names it, but a club belongs to
    // exactly one campus, so it is derived and never accepted from the caller.
    await conn.query(
      `INSERT INTO agency_allocation (club_id, campus_id, academic_year, amount, created_by)
            VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), created_by = VALUES(created_by)`,
      [clubId, club.campus_id, academicYear, amount, actor.person.id]
    );

    const shortfall = satang(committed) - satang(amount);
    const warnings = shortfall > 0 ? [{
      code: 'ALLOCATION_BELOW_COMMITTED',
      message: `วงเงินจัดสรร ${baht(amount)} บาท ต่ำกว่ายอดที่อนุมัติไปแล้ว ${baht(committed)} บาท (ขาด ${baht(fromSatang(shortfall))} บาท)`,
      allocation: amount,
      committed: String(committed),
      shortfall: fromSatang(shortfall),
    }] : [];

    if (warnings.length) {
      // Loud, per Q33 — the response carries it, and so does every later read
      // of the row, but the server log is where an operator finds it after.
      console.warn(
        `allocation lowered below committed: club ${clubId} (${club.name_th}) ` +
        `year ${academicYear}: ${amount} < ${committed}`
      );
    }

    const [[row]] = await conn.query(
      `SELECT ${ALLOCATION_COLUMNS} ${ALLOCATION_JOINS}
        WHERE a.club_id = ? AND a.academic_year = ?`,
      [clubId, academicYear]
    );

    return { allocation: present(row), warnings };
  }, { retries: 2 });
}

module.exports = { listAllocations, upsertAllocation };
