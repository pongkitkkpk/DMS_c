/**
 * Membership routes — where roles are handed out.
 *
 * Deliberately small: list, search, create. There is no update and no delete.
 * Revoking authority is a real requirement and a different one — it has to
 * answer what happens to the projects a person is mid-way through and whether
 * the row should disappear or be marked ended — and inventing an answer here
 * would be worse than the gap. See DMS_REBUILD_STRATEGY.md.
 *
 * Who may do what is asserted inside the service, next to the rule it belongs
 * to, the same way the budget routes work.
 */
const express = require('express');

const { asyncRoute } = require('../lib/asyncRoute');
const { requireAuth } = require('../middleware/requireAuth');
const memberships = require('../services/membershipService');

const router = express.Router();

router.use(requireAuth);

router.get('/memberships', asyncRoute(async (req, res) => {
  res.json(await memberships.listMemberships(req.actor, req.query));
}));

/** A search over `person`, never a listing — see the service. */
router.get('/people', asyncRoute(async (req, res) => {
  res.json(await memberships.searchPeople(req.actor, req.query));
}));

router.post('/memberships', asyncRoute(async (req, res) => {
  res.status(201).json(await memberships.createMembership(req.actor, req.body));
}));

module.exports = router;
