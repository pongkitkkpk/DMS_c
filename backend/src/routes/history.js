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
const academicYear = require('../services/academicYearService');
const history = require('../services/historyService');
const spending = require('../services/spendingService');

const router = express.Router();

router.use(requireAuth);

router.get('/history', asyncRoute(async (req, res) => {
  res.json(await history.listYears(req.actor));
}));

/**
 * One year's money rolled up per club and per campus, for the officers who hold
 * more than one club. Same year-by-year family as `/history`, one level down:
 * that one asks how each year went, this one asks where inside a year the money
 * currently is.
 */
router.get('/spending', asyncRoute(async (req, res) => {
  res.json(await spending.summary(req.actor, req.query));
}));

/**
 * The same question asked of the year ahead. Officers only — it exists to tell
 * the people who would prepare a year whether anyone has.
 */
router.get('/readiness', asyncRoute(async (req, res) => {
  res.json(await history.nextYearReadiness(req.actor));
}));

/**
 * The academic year the system is in, and whether this caller may move it.
 *
 * Lives beside the readiness report on purpose: the two answer the same
 * question from either side — "is next year ready" and "are we in it yet".
 */
router.get('/academic-year', asyncRoute(async (req, res) => {
  res.json(await academicYear.describe(req.actor));
}));

router.put('/academic-year', asyncRoute(async (req, res) => {
  res.json(await academicYear.setAcademicYear(req.actor, req.body));
}));

module.exports = router;
