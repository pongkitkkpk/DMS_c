/**
 * `loadProject` is the single place a path parameter is allowed to name a
 * project — shared by the project and budget routers specifically so there is
 * one such place rather than one per router, because the old system's
 * cross-club leak came from a second route that did its own lookup and forgot
 * the scope check. These call the middleware directly (it is a plain
 * function, and `asyncRoute` just forwards a rejection to `next`), with
 * `projectService.findProject` mocked and the real `scope.js` doing the
 * visibility check.
 */
function loadLoadProject(findProjectImpl) {
  jest.resetModules();
  jest.doMock('../services/projectService', () => ({ findProject: jest.fn(findProjectImpl) }));
  const { loadProject } = require('./loadProject');
  return { loadProject };
}

const actorWith = (role, extra = {}) => ({
  membership: role ? { role, club_id: 10, jurisdiction_club_group_id: 5, ...extra } : null,
});
const project = (overrides = {}) => ({ id: 1, club_id: 10, club_group_id: 5, ...overrides });

async function run(loadProject, { params, actor }) {
  const req = { params, actor };
  const res = {};
  const next = jest.fn();
  await loadProject(req, res, next);
  return { req, next };
}

describe('loadProject', () => {
  test('refuses a non-numeric id without ever calling findProject', async () => {
    const { loadProject } = loadLoadProject(async () => project());
    const { next } = await run(loadProject, { params: { id: 'not-a-number' }, actor: actorWith('ADMIN') });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });

  test('answers 404 for a project id that does not exist', async () => {
    const { loadProject } = loadLoadProject(async () => null);
    const { next } = await run(loadProject, { params: { id: '1' }, actor: actorWith('ADMIN') });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });

  test('answers 404, not 403, for a project outside the caller’s club', async () => {
    const { loadProject } = loadLoadProject(async () => project({ club_id: 999 }));
    const { next } = await run(loadProject, { params: { id: '1' }, actor: actorWith('SH') });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });

  test('attaches the project and calls next() with no error once scope allows it', async () => {
    const { loadProject } = loadLoadProject(async () => project());
    const { req, next } = await run(loadProject, { params: { id: '1' }, actor: actorWith('SH') });

    expect(next).toHaveBeenCalledWith(); // no arguments — success
    expect(req.project).toEqual(project());
  });

  test('an ADMIN reaches any project in scope, an STUACT only its own jurisdiction', async () => {
    const inJurisdiction = project({ club_id: 10, club_group_id: 5 });
    const outsideJurisdiction = project({ club_id: 11, club_group_id: 6 });

    const { loadProject: loadIn } = loadLoadProject(async () => inJurisdiction);
    const { next: nextIn } = await run(loadIn, { params: { id: '1' }, actor: actorWith('STUACT') });
    expect(nextIn).toHaveBeenCalledWith();

    const { loadProject: loadOut } = loadLoadProject(async () => outsideJurisdiction);
    const { next: nextOut } = await run(loadOut, { params: { id: '2' }, actor: actorWith('STUACT') });
    expect(nextOut).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });
});
