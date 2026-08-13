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
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { requireAuth } = require('../middleware/requireAuth');
const scope = require('../services/scope');
const projects = require('../services/projectService');
const { availableTransitions, performTransition } = require('../services/phaseService');

const router = express.Router();

router.use(requireAuth);

/** Express 4 does not catch rejected promises; this does. */
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Load the project named in the path and check it against the caller's scope
 * before any handler runs.
 *
 * Out of scope answers 404 rather than 403 — see `scope.assertVisible`. This is
 * the single place a path parameter is allowed to name a project, and it is
 * immediately narrowed by the caller's membership.
 */
const loadProject = asyncRoute(async (req, res, next) => {
  const id = check.integer({ min: 1, required: true })(req.params.id, 'id');
  const project = await projects.findProject(id);
  scope.assertVisible(req.actor, project);
  req.project = project;
  next();
});

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
  const [sections, budget, transitions] = await Promise.all([
    projects.loadSections(req.project.id),
    projects.loadBudgetStatus(req.project.id),
    availableTransitions(pool, req.project, req.actor),
  ]);

  res.json({
    ...projects.presentProject(req.project),
    sections,
    budget,
    transitions,
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
  const result = await performTransition(req.actor, req.project, toPhaseCode.toUpperCase());
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

module.exports = router;
