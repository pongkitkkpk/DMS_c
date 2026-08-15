/**
 * Reference data the project screens need in order to render a form: the phase
 * list and the eight tag vocabularies.
 *
 * Authenticated but unscoped — these are the same for everyone, and Q34 says
 * the seeded taxonomy is served from the API rather than shipped to the client
 * as a copy of `setCode.json`.
 */
const express = require('express');

const { pool } = require('../db/pool');
const { asyncRoute } = require('../lib/asyncRoute');
const { requireAuth } = require('../middleware/requireAuth');
const { clubVisibilityClause } = require('../services/scope');
const { LIMITS } = require('../documents/arity');

const router = express.Router();

router.use(requireAuth);

router.get('/reference/phases', async (req, res, next) => {
  try {
    const [phases] = await pool.query('SELECT id, code, ordinal, name_th FROM phase ORDER BY ordinal');
    const [transitions] = await pool.query(
      `SELECT f.code AS from_phase_code, t2.code AS to_phase_code,
              t.allowed_role, t.requires_budget_check
         FROM phase_transition t
         JOIN phase f  ON f.id  = t.from_phase_id
         JOIN phase t2 ON t2.id = t.to_phase_id
        ORDER BY f.ordinal, t2.ordinal, t.allowed_role`
    );
    res.json({ phases, transitions });
  } catch (err) {
    next(err);
  }
});

router.get('/reference/tags', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.code AS set_code, s.name_th AS set_name, t.id, t.ordinal, t.name_th
         FROM tag_set s JOIN tag t ON t.tag_set_id = s.id
        ORDER BY s.code, t.ordinal`
    );

    const sets = [];
    for (const row of rows) {
      let set = sets.find((s) => s.code === row.set_code);
      if (!set) {
        set = { code: row.set_code, nameTh: row.set_name, tags: [] };
        sets.push(set);
      }
      set.tags.push({ id: row.id, ordinal: row.ordinal, nameTh: row.name_th });
    }

    res.json({ tagSets: sets });
  } catch (err) {
    next(err);
  }
});

/**
 * The clubs in the caller's scope.
 *
 * Needed to set an allocation for a club that has none yet — `GET /allocations`
 * can only list the rows that exist, and Q30's whole point is that Admin and
 * STUACT create them. Scoped by the same clause as everything else, so a
 * student sees their own club and a STUACT its group.
 */
router.get('/reference/clubs', asyncRoute(async (req, res) => {
  const visibility = clubVisibilityClause(req.actor);

  const [rows] = await pool.query(
    `SELECT c.id, c.code, c.name_th, c.club_group_id, c.campus_id,
            cg.name_th AS club_group_name, cam.name_th AS campus_name
       FROM club c
       JOIN campus cam ON cam.id = c.campus_id
       LEFT JOIN club_group cg ON cg.id = c.club_group_id
      WHERE ${visibility.sql}
      ORDER BY c.code`,
    visibility.params
  );

  res.json({
    clubs: rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameTh: row.name_th,
      clubGroupId: row.club_group_id,
      clubGroupName: row.club_group_name,
      campusName: row.campus_name,
    })),
  });
}));

/**
 * The club groups — the jurisdictions a STUACT membership is scoped to.
 *
 * Not scoped by the caller, unlike the clubs above, and that is not an
 * oversight: a group is a name and a code, the same reference data the club
 * list already exposes one level down, and the only screen that needs the whole
 * list is the one where an Admin appoints a STUACT to a jurisdiction — which by
 * definition is not a jurisdiction they are already inside. Nothing here says
 * who belongs to what.
 */
router.get('/reference/club-groups', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, code, name_th FROM club_group ORDER BY code'
  );
  res.json({
    clubGroups: rows.map((row) => ({ id: row.id, code: row.code, nameTh: row.name_th })),
  });
}));

/**
 * How many rows of each list the government forms can actually print.
 *
 * Served rather than hard-coded in the client for the same reason the taxonomy
 * is (Q34): these numbers come from the templates themselves, via
 * `scripts/extract-template-tags.js`, and a copy in the frontend would be one
 * template change away from telling a student they may enter five when the form
 * holds three.
 *
 * The client uses them to warn while typing. It is not a client-side rule —
 * `documents/arity.js` refuses the download regardless.
 */
router.get('/reference/limits', asyncRoute(async (req, res) => {
  const sections = {};
  for (const [form, limits] of Object.entries(LIMITS)) {
    for (const [section, spec] of Object.entries(limits.sections)) {
      // Where the two forms disagree, the tighter one is what a project has to
      // satisfy to produce both.
      const current = sections[section];
      if (!current || spec.capacity < current.capacity) {
        sections[section] = { capacity: spec.capacity, label: spec.label, form };
      }
    }
  }
  res.json({ sections, budget: LIMITS.temp04.budget });
}));

/**
 * The advisers a project may name.
 *
 * `project.advisor_person_id` is a real foreign key, and `assertAdvisorIsValid`
 * refuses anyone who is not an `AD` of that club in that year. This is the list
 * that rule will accept, so the form offers exactly what the server will take
 * rather than a free-text box that can name a person who does not exist — which
 * is how 12 of the old system's 30 projects came to do so
 * (docs/DECISIONS.md, "What dropping `karoms` costs").
 *
 * Scoped by the caller's membership like every other list (Q16): a student sees
 * their own club's advisers, a STUACT its group's.
 */
router.get('/reference/advisors', asyncRoute(async (req, res) => {
  const visibility = clubVisibilityClause(req.actor);

  const [rows] = await pool.query(
    `SELECT p.id, p.prefix, p.full_name_th, p.email,
            m.club_id, m.advisor_agency, m.department_th,
            c.name_th AS club_name
       FROM membership m
       JOIN person p ON p.id = m.person_id
       JOIN club c   ON c.id = m.club_id
      WHERE m.role = 'AD' AND m.academic_year = ? AND ${visibility.sql}
      ORDER BY c.code, p.full_name_th`,
    [req.actor.academicYear, ...visibility.params]
  );

  res.json({
    advisors: rows.map((row) => ({
      id: row.id,
      prefix: row.prefix,
      fullNameTh: row.full_name_th,
      email: row.email,
      clubId: row.club_id,
      clubName: row.club_name,
      agency: row.advisor_agency || row.department_th,
    })),
  });
}));

module.exports = router;
