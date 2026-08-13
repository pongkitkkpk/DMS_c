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
const { requireAuth } = require('../middleware/requireAuth');

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

module.exports = router;
