/**
 * Membership routes — where roles are handed out.
 *
 * Deliberately small: list, search, create, revoke. There is no update — a role
 * is not edited into a different role, it is taken away and another is given,
 * and both halves are then in `membership_event` where they can be read back.
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

/**
 * The log. Declared before `/memberships/:id/...` so "events" is never read as
 * an id — Express matches in definition order.
 */
router.get('/memberships/events', asyncRoute(async (req, res) => {
  res.json(await memberships.listMembershipEvents(req.actor, req.query));
}));

/**
 * What revoking this one would break, asked before it is done.
 *
 * Only meaningful for an adviser, and it is a warning rather than a refusal —
 * see `advisorImpact`.
 */
router.get('/memberships/:id/impact', asyncRoute(async (req, res) => {
  res.json(await memberships.advisorImpact(req.actor, req.params.id));
}));

router.delete('/memberships/:id', asyncRoute(async (req, res) => {
  res.json(await memberships.revokeMembership(req.actor, req.params.id));
}));

module.exports = router;
