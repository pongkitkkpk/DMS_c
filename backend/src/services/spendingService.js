/**
 * Where one year's money actually stands, per club and per campus.
 *
 * The system already answers this one club at a time (`allocationService`) and
 * one year at a time (`historyService`). Neither answers the question an officer
 * actually asks at a desk — *which clubs have spent what they were given, and
 * how does one campus compare with another* — because both are lists of rows
 * and that question is a comparison.
 *
 * ## The three numbers, and why they are three
 *
 * Money moves through this system in three states, and the gap between them is
 * the whole point of the page:
 *
 * - **จัดสรร (allocated)** — `agency_allocation.amount`. What the club may spend
 *   this year. A ceiling, set by an officer, not a balance.
 * - **อนุมัติแล้ว (committed)** — `SUM(budget_plan_line.approved_amount)` over the
 *   club's projects. Promised to a project, whether or not it has been paid.
 * - **จ่ายจริง (disbursed)** — `SUM(disbursement.amount)`. Money that has actually
 *   left the university's account.
 *
 * All three are **summed on read**, never stored. That is the same bargain
 * `allocationService` makes and for the same reason: a stored total drifts from
 * its components and nothing notices. It also means every figure here matches
 * the club's own screen exactly, because the definitions are copied from it
 * rather than re-derived.
 *
 * ## What this deliberately does not do
 *
 * It does not invent a fourth number. "คงเหลือ" is `allocated - committed`, the
 * same subtraction `allocationService.present` does, and it can be negative —
 * Q33 allows an allocation to be lowered below what is already committed, and a
 * summary that clamped that to zero would hide the one row an officer needs to
 * see.
 *
 * It also does not restrict *which* clubs are counted by anything but scope.
 * A club with projects and no allocation is a real and interesting state — it
 * is spending against a ceiling nobody set — so it appears with `allocated: 0`
 * rather than being dropped for want of an `agency_allocation` row.
 */
const { pool } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { satang, fromSatang } = require('../lib/money');
const { clubVisibilityClause } = require('./scope');

/**
 * Officers only, by the same rule and the same wording as
 * `historyService.nextYearReadiness`.
 *
 * Not a scope narrowing but a refusal: a student or an adviser sees their own
 * club's ceiling on the allocations screen (Q30), and a cross-club comparison
 * is a different thing — it is the view of somebody responsible for more than
 * one club. STUACT still only sees its own jurisdiction; ADMIN sees all of it.
 */
function assertIsOfficer(actor) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN' && role !== 'STUACT') {
    throw HttpError.forbidden('ดูสรุปการใช้เงินได้เฉพาะผู้ดูแลระบบและกองกิจการนักศึกษา');
  }
}

/** Every club the caller may see, with the campus and group it belongs to. */
async function visibleClubs(actor) {
  const visibility = clubVisibilityClause(actor);
  const [rows] = await pool.query(
    `SELECT c.id, c.code, c.name_th, c.club_group_id,
            cg.name_th  AS club_group_name,
            cam.id      AS campus_id,
            cam.abbreviation AS campus_abbreviation,
            cam.name_th AS campus_name
       FROM club c
       JOIN campus cam         ON cam.id = c.campus_id
       LEFT JOIN club_group cg ON cg.id  = c.club_group_id
      WHERE ${visibility.sql}
      ORDER BY cam.abbreviation, c.code`,
    visibility.params
  );
  return rows;
}

/**
 * The three sums, one query each, all grouped by club and all scoped by the
 * same clause.
 *
 * Deliberately not one query with three joined aggregates: `budget_plan_line`
 * is one row per project but `disbursement` is many, so joining both at once
 * multiplies the plan lines by the payments and inflates `committed` — the
 * classic fan-out. Three narrow queries that each mean one thing beat one wide
 * one that quietly means something else.
 */
async function totalsByClub(actor, year) {
  const visibility = clubVisibilityClause(actor);
  const params = [year, ...visibility.params];

  const [allocated] = await pool.query(
    `SELECT a.club_id, COALESCE(SUM(a.amount), 0) AS total
       FROM agency_allocation a
       JOIN club c ON c.id = a.club_id
      WHERE a.academic_year = ? AND ${visibility.sql}
      GROUP BY a.club_id`,
    params
  );

  // `uq_plan_line_project` makes this at most one plan line per project, so the
  // LEFT JOIN cannot multiply the count. A project with no plan line yet still
  // counts as a project and contributes 0 — which is what a year in progress
  // looks like.
  const [committed] = await pool.query(
    `SELECT p.club_id,
            COUNT(*) AS projects,
            COALESCE(SUM(pl.approved_amount), 0) AS total
       FROM project p
       JOIN club c ON c.id = p.club_id
       LEFT JOIN budget_plan_line pl ON pl.project_id = p.id
      WHERE p.academic_year = ? AND ${visibility.sql}
      GROUP BY p.club_id`,
    params
  );

  const [disbursed] = await pool.query(
    `SELECT p.club_id, COALESCE(SUM(d.amount), 0) AS total
       FROM disbursement d
       JOIN project p ON p.id = d.project_id
       JOIN club c   ON c.id = p.club_id
      WHERE p.academic_year = ? AND ${visibility.sql}
      GROUP BY p.club_id`,
    params
  );

  const byClub = new Map();
  const at = (clubId) => {
    const key = Number(clubId);
    if (!byClub.has(key)) {
      byClub.set(key, { allocated: 0, committed: 0, disbursed: 0, projects: 0 });
    }
    return byClub.get(key);
  };

  for (const row of allocated) at(row.club_id).allocated = satang(row.total);
  for (const row of committed) {
    const entry = at(row.club_id);
    entry.committed = satang(row.total);
    entry.projects = Number(row.projects);
  }
  for (const row of disbursed) at(row.club_id).disbursed = satang(row.total);

  return byClub;
}

/** One entity's four figures, in the shape every screen reads them. */
function present(sums) {
  const remaining = sums.allocated - sums.committed;
  return {
    allocated: fromSatang(sums.allocated),
    committed: fromSatang(sums.committed),
    disbursed: fromSatang(sums.disbursed),
    remaining: fromSatang(remaining),
    // Q33's loud half, carried here exactly as `allocationService` carries it:
    // the state is legal and every read says so.
    overCommitted: remaining < 0,
    // Not sent as a percentage — the client decides how to draw it, and a
    // ratio against a zero ceiling has no answer worth inventing here.
    projects: sums.projects,
  };
}

const empty = () => ({ allocated: 0, committed: 0, disbursed: 0, projects: 0 });

function add(into, from) {
  into.allocated += from.allocated;
  into.committed += from.committed;
  into.disbursed += from.disbursed;
  into.projects += from.projects;
  return into;
}

/**
 * The years worth offering, newest first.
 *
 * The same three sources as `allocationService.listAllocationYears`, and for
 * the same reason: a picker built only from years that already have rows cannot
 * reach the year an officer is about to prepare. Projects are included as a
 * source too, because a year can have projects before it has allocations.
 */
async function listYears(actor) {
  const visibility = clubVisibilityClause(actor);
  const [rows] = await pool.query(
    `SELECT DISTINCT a.academic_year AS year
       FROM agency_allocation a JOIN club c ON c.id = a.club_id
      WHERE ${visibility.sql}
      UNION
     SELECT DISTINCT p.academic_year
       FROM project p JOIN club c ON c.id = p.club_id
      WHERE ${visibility.sql}`,
    [...visibility.params, ...visibility.params]
  );

  const years = new Set(rows.map((row) => Number(row.year)));
  if (actor.academicYear) {
    years.add(Number(actor.academicYear));
    years.add(Number(actor.academicYear) + 1);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * One year of money, rolled up two ways.
 *
 * Clubs with nothing at all are counted, not listed: an ADMIN sees 69 clubs and
 * in a fresh year 68 of them are three zeroes, which buries the one row that
 * says anything. `idleClubs` is the count, so the screen can say how many were
 * left out rather than silently shortening the list.
 */
async function summary(actor, query = {}) {
  assertIsOfficer(actor);

  const year = query.year
    ? check.integer({ min: 2400, max: 2700 })(query.year, 'year')
    : Number(actor.academicYear);

  const [clubs, sums, years] = await Promise.all([
    visibleClubs(actor),
    totalsByClub(actor, year),
    listYears(actor),
  ]);

  const byCampus = new Map();
  const byClub = [];
  let idleClubs = 0;
  const overall = empty();

  for (const club of clubs) {
    const entry = sums.get(Number(club.id)) || empty();
    const active = entry.allocated || entry.committed || entry.disbursed || entry.projects;

    const campusKey = Number(club.campus_id);
    if (!byCampus.has(campusKey)) {
      byCampus.set(campusKey, {
        campus: {
          id: campusKey,
          abbreviation: club.campus_abbreviation,
          nameTh: club.campus_name,
        },
        sums: empty(),
        clubs: 0,
        activeClubs: 0,
      });
    }
    const campus = byCampus.get(campusKey);
    campus.clubs += 1;

    if (!active) {
      idleClubs += 1;
      continue;
    }

    campus.activeClubs += 1;
    add(campus.sums, entry);
    add(overall, entry);

    byClub.push({
      club: {
        id: Number(club.id),
        code: club.code,
        nameTh: club.name_th,
        clubGroupId: club.club_group_id,
        clubGroupName: club.club_group_name,
      },
      campus: {
        id: campusKey,
        abbreviation: club.campus_abbreviation,
        nameTh: club.campus_name,
      },
      ...present(entry),
    });
  }

  // Biggest ceiling first — the chart is a comparison, and a comparison sorted
  // by club code makes the reader do the sorting. Ties fall back to what has
  // actually been committed, so two unfunded clubs still order sensibly.
  byClub.sort((x, y) =>
    satang(y.allocated) - satang(x.allocated) ||
    satang(y.committed) - satang(x.committed) ||
    x.club.code.localeCompare(y.club.code));

  return {
    academicYear: year,
    years,
    totals: { ...present(overall), clubs: clubs.length, activeClubs: byClub.length, idleClubs },
    byCampus: [...byCampus.values()]
      .map((row) => ({
        campus: row.campus,
        clubs: row.clubs,
        activeClubs: row.activeClubs,
        ...present(row.sums),
      }))
      .sort((x, y) => satang(y.allocated) - satang(x.allocated) ||
        x.campus.abbreviation.localeCompare(y.campus.abbreviation)),
    byClub,
  };
}

module.exports = { summary, assertIsOfficer };
