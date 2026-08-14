/**
 * Budget routes.
 *
 * The old system's money endpoints were the worst of it: they lived in the
 * unauthenticated inline group in `server.js`, they wrote `allow_budget` through
 * `UPDATE … SET ?`, and the disbursement route let the client send the remaining
 * balance it had computed itself (docs/business-rules.md, "Budget"). Every one
 * of those three is closed by construction here — the router is authenticated as
 * a whole, every field passes an allow-list, and no total is ever accepted from
 * a caller.
 *
 * Who may do what is asserted inside the services, not here — `loadOverview`
 * has to answer the same question to tell the screen which controls to draw, and
 * one rule asked twice is one rule. In outline:
 *
 * - lines and the plan follow `scope.assertCanEdit`, the same rule as any other
 *   part of a project, so a student may state them while drafting and not after;
 * - approving an amount and recording money out are Admin/STUACT only, and only
 *   from the phase at which each becomes meaningful;
 * - allocations are Admin/STUACT to write and everyone in scope to read (Q30).
 */
const express = require('express');

const { asyncRoute } = require('../lib/asyncRoute');
const { loadProject } = require('../middleware/loadProject');
const { requireAuth } = require('../middleware/requireAuth');
const budget = require('../services/budgetService');
const allocations = require('../services/allocationService');

const router = express.Router();

router.use(requireAuth);

// --------------------------------------------------------------------------
// One project's money
// --------------------------------------------------------------------------

router.get('/projects/:id/budget', loadProject, asyncRoute(async (req, res) => {
  res.json(await budget.loadOverview(req.actor, req.project));
}));

/**
 * Replace one variant's lines. `PLANNED` is the request, `ACTUAL` is what was
 * spent; both are the same table and the same shape, which is what makes the
 * plan-versus-actual comparison Q13 asks for possible at all — the old กนศ.06
 * stored aggregates only, so there was nothing to compare against.
 */
router.put('/projects/:id/budget/lines/:variant', loadProject, asyncRoute(async (req, res) => {
  res.json(await budget.replaceLines(req.actor, req.project, req.params.variant, req.body));
}));

router.put('/projects/:id/budget/plan', loadProject, asyncRoute(async (req, res) => {
  res.json(await budget.setPlan(req.actor, req.project, req.body));
}));

/**
 * Approve the project's money. Allowed from `PROJECT_APPROVED` onward: the
 * project itself has to be approved before there is anything to fund, and the
 * `BUDGET_APPROVED` transition is what commits the decision made here.
 */
router.post('/projects/:id/budget/approve', loadProject, asyncRoute(async (req, res) => {
  res.json(await budget.approveAmount(req.actor, req.project, req.body));
}));

router.get('/projects/:id/disbursements', loadProject, asyncRoute(async (req, res) => {
  res.json({ disbursements: await budget.loadDisbursements(req.project.id) });
}));

/**
 * Record money going out. Append-only: there is no PUT and no DELETE, because
 * "remaining" is a subtraction over these rows and a ledger you can edit is not
 * a ledger (Q28/Q41).
 */
router.post('/projects/:id/disbursements', loadProject, asyncRoute(async (req, res) => {
  res.status(201).json(await budget.addDisbursement(req.actor, req.project, req.body));
}));

// --------------------------------------------------------------------------
// Yearly allocations — layer (c)'s ceiling
// --------------------------------------------------------------------------

router.get('/allocations', asyncRoute(async (req, res) => {
  res.json(await allocations.listAllocations(req.actor, req.query));
}));

router.put('/allocations', asyncRoute(async (req, res) => {
  res.json(await allocations.upsertAllocation(req.actor, req.body));
}));

module.exports = router;
