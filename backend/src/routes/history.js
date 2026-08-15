/**
 * The year-by-year summary.
 *
 * A router of its own rather than a line in `budget.js`, because what it answers
 * spans both halves of the system — the money a year was given and the projects
 * that spent it — and burying that in the budget routes would make the next
 * person look for it in the wrong file.
 *
 * Read-only by construction: there is nothing here but a `GET`, and every figure
 * it returns is summed on read. Scope is asserted inside the service, in the
 * queries themselves, like every other list (Q16).
 */
const express = require('express');

const { asyncRoute } = require('../lib/asyncRoute');
const { requireAuth } = require('../middleware/requireAuth');
const history = require('../services/historyService');

const router = express.Router();

router.use(requireAuth);

router.get('/history', asyncRoute(async (req, res) => {
  res.json(await history.listYears(req.actor));
}));

/**
 * The same question asked of the year ahead. Officers only — it exists to tell
 * the people who would prepare a year whether anyone has.
 */
router.get('/readiness', asyncRoute(async (req, res) => {
  res.json(await history.nextYearReadiness(req.actor));
}));

module.exports = router;
