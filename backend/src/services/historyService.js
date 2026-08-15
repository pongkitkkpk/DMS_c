/**
 * How a year is doing — looking back across all of them, and forward at the one
 * that has not started.
 *
 * `listYears` gives one row per academic year: what was allocated, what was
 * approved against it, and how the year's projects ended up distributed across
 * the phase machine. `nextYearReadiness` asks the same kind of question of the
 * year ahead, where every count is expected to be zero until somebody prepares
 * it.
 *
 * Nothing here is new information. Every figure already existed somewhere —
 * `allocationService` computes allocated/committed/remaining per (club, year),
 * and the project list carries a phase — but only ever for one year at a time,
 * which is exactly the shape that cannot answer "how did last year go".
 *
 * Two rules this file keeps, both borrowed rather than reinvented:
 *
 * - **Scope is applied in the query** (Q16). Allocations are restricted by
 *   `clubVisibilityClause` and projects by `visibilityClause`, the same two
 *   clauses the single-year screens use. A student sees their club's history, a
 *   STUACT its group's. There is no year parameter that widens anything.
 * - **Nothing is stored.** Every total is summed on read, so a year's summary
 *   cannot drift from the rows it summarises — the same bargain
 *   `allocationService` makes, for the same reason.
 */
const { pool } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { satang, fromSatang } = require('../lib/money');
const { clubVisibilityClause, visibilityClause } = require('./scope');

/**
 * Allocation totals per year, plus how many clubs are over their ceiling.
 *
 * The over-committed test is per club, not per year: a group whose total
 * allocation covers its total approvals can still contain a club that has
 * overspent, and rolling the comparison up to the year would hide exactly the
 * case Q33 exists to keep visible. The correlated subquery is the same one
 * `allocationService.ALLOCATION_COLUMNS` uses, so both screens agree by
 * construction rather than by two authors remembering the same rule.
 */
async function allocationTotals(actor) {
  const visibility = clubVisibilityClause(actor);
  const committedForRow = `
    COALESCE((SELECT SUM(pl.approved_amount)
                FROM budget_plan_line pl
                JOIN project p ON p.id = pl.project_id
               WHERE p.club_id = a.club_id
                 AND p.academic_year = a.academic_year
                 AND pl.approved_amount IS NOT NULL), 0)`;

  const [rows] = await pool.query(
    `SELECT a.academic_year                       AS year,
            COUNT(*)                              AS clubs_funded,
            COALESCE(SUM(a.amount), 0)            AS allocated,
            SUM(CASE WHEN ${committedForRow} > a.amount THEN 1 ELSE 0 END) AS clubs_over
       FROM agency_allocation a
       JOIN club c ON c.id = a.club_id
      WHERE ${visibility.sql}
      GROUP BY a.academic_year`,
    visibility.params
  );

  return new Map(rows.map((row) => [Number(row.year), row]));
}

/**
 * Project counts and approved money per (year, phase).
 *
 * `budget_plan_line` is unique per project (`uq_plan_line_project`), so the
 * LEFT JOIN cannot multiply the count — a project with no plan line yet simply
 * contributes 0 to the sum and still counts as a project, which is what a
 * summary of a year in progress should show.
 */
async function projectTotals(actor) {
  const visibility = visibilityClause(actor);
  const [rows] = await pool.query(
    `SELECT p.academic_year AS year,
            ph.code AS phase_code, ph.ordinal AS phase_ordinal, ph.name_th AS phase_name_th,
            COUNT(*) AS projects,
            COALESCE(SUM(pl.approved_amount), 0) AS approved
       FROM project p
       JOIN club c  ON c.id  = p.club_id
       JOIN phase ph ON ph.id = p.phase_id
       LEFT JOIN budget_plan_line pl ON pl.project_id = p.id
      WHERE ${visibility.sql}
      GROUP BY p.academic_year, ph.id
      ORDER BY p.academic_year DESC, ph.ordinal`,
    visibility.params
  );

  const byYear = new Map();
  for (const row of rows) {
    const year = Number(row.year);
    const entry = byYear.get(year) || { total: 0, approved: 0, byPhase: [] };
    entry.total += Number(row.projects);
    entry.approved += satang(row.approved);
    entry.byPhase.push({
      code: row.phase_code,
      ordinal: Number(row.phase_ordinal),
      nameTh: row.phase_name_th,
      count: Number(row.projects),
    });
    byYear.set(year, entry);
  }
  return byYear;
}

/**
 * Every year the caller has anything to look at, newest first.
 *
 * A year qualifies on either side — it has allocations, or it has projects, or
 * it is the current year. Requiring both would drop the two states that matter
 * most at the edges of a year: money set aside before any project exists, and
 * projects created before an officer has set the ceiling (which is the state
 * that blocks their first approval).
 */
async function listYears(actor) {
  const [allocations, projects] = await Promise.all([
    allocationTotals(actor),
    projectTotals(actor),
  ]);

  const years = new Set([...allocations.keys(), ...projects.keys()]);
  if (actor.academicYear) years.add(Number(actor.academicYear));

  const items = [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const money = allocations.get(year);
      const work = projects.get(year) || { total: 0, approved: 0, byPhase: [] };

      // `allocated` comes from the allocation rows; `committed` from the
      // projects. They are counted from different tables on purpose — that is
      // what makes a disagreement between them visible instead of arithmetic.
      const allocated = money ? money.allocated : 0;
      const remaining = satang(allocated) - work.approved;

      return {
        academicYear: year,
        isCurrent: year === Number(actor.academicYear),
        clubsFunded: money ? Number(money.clubs_funded) : 0,
        clubsOverCommitted: money ? Number(money.clubs_over) : 0,
        allocated: fromSatang(satang(allocated)),
        committed: fromSatang(work.approved),
        remaining: fromSatang(remaining),
        overCommitted: remaining < 0,
        projectCount: work.total,
        byPhase: work.byPhase,
      };
    });

  return { items };
}

/**
 * Whether next year has been set up yet, for the officers who would set it up.
 *
 * Three things now have to be prepared before an academic year can be worked
 * in — its allocations, its roles, and the year itself — and all three became
 * preparable in advance without anything ever saying that they should be. A
 * club with no ceiling cannot have money approved; a year with no `SH` has
 * nobody who can open a project. Both fail at the moment someone needs them,
 * which is the worst moment to discover a form nobody filled in.
 *
 * Deliberately **not** time-based. Nagging in June would mean trusting the
 * June boundary, which is still the unconfirmed guess recorded in the open
 * questions (`config.currentAcademicYear`), and a reminder built on a guess
 * about when the year turns is a reminder that will be wrong once a year. This
 * just reports the state and lets the reader decide whether it is early.
 *
 * Scoped like everything else, so a STUACT sees its own group's readiness and
 * an Admin the whole institution's.
 */
async function nextYearReadiness(actor) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN' && role !== 'STUACT') {
    throw HttpError.forbidden('ดูความพร้อมของปีถัดไปได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }

  const academicYear = Number(actor.academicYear) + 1;
  const visibility = clubVisibilityClause(actor);

  const [[clubs]] = await pool.query(
    `SELECT COUNT(*) AS total FROM club c WHERE ${visibility.sql}`,
    visibility.params
  );
  const [[funded]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM agency_allocation a
       JOIN club c ON c.id = a.club_id
      WHERE a.academic_year = ? AND ${visibility.sql}`,
    [academicYear, ...visibility.params]
  );

  // Club roles only, and counted by club rather than by person: what matters is
  // whether each club has someone who can act, not how many people hold cards.
  const [roleRows] = await pool.query(
    `SELECT m.role, COUNT(DISTINCT m.club_id) AS clubs
       FROM membership m
       JOIN club c ON c.id = m.club_id
      WHERE m.academic_year = ? AND m.role IN ('SH','AD') AND ${visibility.sql}
      GROUP BY m.role`,
    [academicYear, ...visibility.params]
  );
  const byRole = new Map(roleRows.map((row) => [row.role, Number(row.clubs)]));

  const clubsTotal = Number(clubs.total);
  const clubsFunded = Number(funded.total);
  const clubsWithHead = byRole.get('SH') || 0;
  const clubsWithAdvisor = byRole.get('AD') || 0;

  return {
    academicYear,
    clubsTotal,
    clubsFunded,
    clubsWithHead,
    clubsWithAdvisor,
    // One flag rather than three, because the screen's question is "is there
    // anything to do here", and a club that is funded but has no student head
    // is no more ready than one with neither.
    ready: clubsTotal > 0 && clubsFunded === clubsTotal && clubsWithHead === clubsTotal,
  };
}

module.exports = { listYears, nextYearReadiness };
