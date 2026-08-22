/**
 * Project routes.
 *
 * Every handler here ends in exactly one response. Six of the old ones never
 * called `res.send()` at all — `updateState`, `insertlogState` and
 * `firstupdateState` among them — so the request hung until the client timed
 * out while the UI had already announced success
 * (docs/business-rules.md, "Transitions"). The `asyncRoute` wrapper below makes
 * the failure path just as certain: a rejected promise reaches the error
 * handler instead of vanishing.
 */
const express = require('express');

const { pool } = require('../db/pool');
const { asyncRoute } = require('../lib/asyncRoute');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { loadProject } = require('../middleware/loadProject');
const { requireAuth } = require('../middleware/requireAuth');
const scope = require('../services/scope');
const projects = require('../services/projectService');
const budgetService = require('../services/budgetService');
const signatures = require('../services/signatureService');
const { availableTransitions, performTransition } = require('../services/phaseService');

const router = express.Router();

router.use(requireAuth);

// --------------------------------------------------------------------------
// Collection
// --------------------------------------------------------------------------

router.get('/projects', asyncRoute(async (req, res) => {
  res.json(await projects.listProjects(req.actor, req.query));
}));

router.post('/projects', asyncRoute(async (req, res) => {
  const clubId = scope.assertCanCreate(req.actor);
  const id = await projects.createProject(req.actor, req.body, clubId);
  const created = await projects.findProject(id);
  res.status(201).json(projects.presentProject(created));
}));

// --------------------------------------------------------------------------
// One project
// --------------------------------------------------------------------------

router.get('/projects/:id', loadProject, asyncRoute(async (req, res) => {
  const [sections, budget, transitions, advisorEndorsed] = await Promise.all([
    projects.loadSections(req.project.id),
    budgetService.loadSummary(req.project),
    availableTransitions(pool, req.project, req.actor),
    signatures.hasSignature(req.project.id, 'AD'),
  ]);

  res.json({
    ...projects.presentProject(req.project),
    sections,
    budget: budget.money,
    budgetWarnings: budget.warnings,
    transitions,
    // Asked of the same assertions the writes run, so the screen cannot offer
    // an action the server would refuse or hide one it would allow. A
    // convenience, not a defence — every write re-runs the rule.
    permissions: {
      edit: scope.permits(() => scope.assertCanEdit(req.actor, req.project)),
      delete: scope.permits(() => scope.assertCanDelete(req.actor, req.project)),
      // A fact about the role and ownership *and* about whether it has
      // already happened once — unlike `edit`/`delete`, this permission is
      // not a pure function of the assertion alone (`endorseAsAdvisor` is a
      // one-time action), so it is folded in here rather than left for the
      // client to combine with a separate "already endorsed" read.
      endorseAsAdvisor: scope.permits(() => scope.assertCanEndorseAsAdvisor(req.actor, req.project)) && !advisorEndorsed,
    },
  });
}));

router.patch('/projects/:id', loadProject, asyncRoute(async (req, res) => {
  scope.assertCanEdit(req.actor, req.project);
  await projects.updateProject(req.actor, req.project, req.body);
  res.json(projects.presentProject(await projects.findProject(req.project.id)));
}));

router.delete('/projects/:id', loadProject, asyncRoute(async (req, res) => {
  scope.assertCanDelete(req.actor, req.project);
  await projects.deleteProject(req.project);
  res.json({ deleted: req.project.id });
}));

// --------------------------------------------------------------------------
// Child lists
// --------------------------------------------------------------------------

router.put('/projects/:id/sections/:section', loadProject, asyncRoute(async (req, res) => {
  scope.assertCanEdit(req.actor, req.project);
  const { section } = req.params;
  if (!projects.SECTION_NAMES.includes(section)) {
    throw HttpError.notFound(`ไม่รู้จักส่วน ${section} (มี: ${projects.SECTION_NAMES.join(', ')})`);
  }
  const count = await projects.replaceSection(req.actor, req.project, section, req.body);
  res.json({ section, count, items: (await projects.loadSections(req.project.id))[section] });
}));

router.put('/projects/:id/tags', loadProject, asyncRoute(async (req, res) => {
  scope.assertCanEdit(req.actor, req.project);
  const count = await projects.replaceTags(req.actor, req.project, req.body);
  res.json({ count, tags: (await projects.loadSections(req.project.id)).tags });
}));

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

router.get('/projects/:id/transitions', loadProject, asyncRoute(async (req, res) => {
  res.json({ transitions: await availableTransitions(pool, req.project, req.actor) });
}));

router.post('/projects/:id/transitions', loadProject, asyncRoute(async (req, res) => {
  const toPhaseCode = check.text({ max: 32, required: true })(req.body && req.body.toPhaseCode, 'toPhaseCode');
  // Not run through `check.text` — it is base64, not something a length or
  // byte-count limit meant for Thai prose should apply to. `signatureService`
  // validates its shape (a real PNG, size-capped) before anything reaches disk.
  const signatureImage = req.body && typeof req.body.signatureImage === 'string' ? req.body.signatureImage : null;
  const result = await performTransition(req.actor, req.project, toPhaseCode.toUpperCase(), {
    signatureImage,
    ip: req.ip,
  });
  res.json(result);
}));

/**
 * The event log — Q15's replacement for `status_project` +
 * `logstatus_project` + `historyeditproject`. Read-only by construction: there
 * is no route that writes it, only transactions that append to it.
 */
router.get('/projects/:id/events', loadProject, asyncRoute(async (req, res) => {
  res.json({ events: await projects.loadEvents(req.project.id) });
}));

/**
 * Signatures captured on this project's approvals (DECISIONS.md,
 * "E-signature", closed 2026-08-22). Read-only for the same reason the event
 * log is: a signature exists only as a side effect of `performTransition` or
 * `advisor-endorsement`, below — never written directly.
 */
router.get('/projects/:id/signatures', loadProject, asyncRoute(async (req, res) => {
  res.json({ signatures: await signatures.listForProject(req.project.id) });
}));

/**
 * The advisor's one-time endorsement (migration 007) — not a phase
 * transition, because AD does not own one of its own
 * (`PROPOSAL_SUBMITTED -> PROJECT_APPROVED` is shared with ADMIN/STUACT).
 * `assertCanEndorseAsAdvisor` checks both that the caller is AD and that they
 * are *this* project's advisor; `endorseAsAdvisor` itself refuses a second
 * call with a 409 naming why.
 */
router.post('/projects/:id/advisor-endorsement', loadProject, asyncRoute(async (req, res) => {
  scope.assertCanEndorseAsAdvisor(req.actor, req.project);
  const signatureImage = req.body && typeof req.body.signatureImage === 'string' ? req.body.signatureImage : null;
  const result = await signatures.endorseAsAdvisor(req.actor, req.project, { signatureImage, ip: req.ip });
  res.json(result);
}));

/**
 * The PNG itself, inline. Unlike an attachment (deviation 40 — never rendered
 * inline, because its content-type is a claim from whoever uploaded it), this
 * file's bytes were verified to actually be a PNG before they were written to
 * disk (`signatureService.decodeImage`), so there is no uploaded content this
 * route could be tricked into serving as something that runs.
 */
router.get('/projects/:id/signatures/:signatureId', loadProject, asyncRoute(async (req, res) => {
  const id = check.integer({ min: 1, required: true })(req.params.signatureId, 'signatureId');
  const row = await signatures.find(req.project.id, id);
  if (!row) throw HttpError.notFound('ไม่พบลายเซ็นนี้');
  const buffer = await signatures.readImage(row);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline; filename="signature.png"');
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));

module.exports = router;
