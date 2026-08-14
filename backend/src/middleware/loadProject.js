/**
 * Load the project named in `:id` and check it against the caller's scope
 * before any handler runs.
 *
 * This is the single place a path parameter is allowed to name a project, and
 * it is immediately narrowed by the caller's membership — Q16 and deviation 1.
 * Shared by the project and budget routers precisely so there is one such place
 * rather than one per router: the old system's cross-club leak came from a
 * second route that did its own lookup and forgot the check.
 *
 * Out of scope answers 404 rather than 403 — see `scope.assertVisible`.
 */
const { check } = require('../lib/validate');
const { asyncRoute } = require('../lib/asyncRoute');
const scope = require('../services/scope');
const projects = require('../services/projectService');

const loadProject = asyncRoute(async (req, res, next) => {
  const id = check.integer({ min: 1, required: true })(req.params.id, 'id');
  const project = await projects.findProject(id);
  scope.assertVisible(req.actor, project);
  req.project = project;
  next();
});

module.exports = { loadProject };
