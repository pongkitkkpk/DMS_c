/**
 * `routes/projects.js` carries a few pieces of logic that are the route's own,
 * not `projectService`'s or `scope`'s: `permissions.endorseAsAdvisor` is not a
 * pure function of the assertion alone (endorsing is a one-time action, so an
 * otherwise-eligible advisor who already endorsed must still read `false`),
 * the transition endpoint upper-cases `toPhaseCode` before it reaches the
 * phase machine, and `signatureImage` is deliberately *not* run through
 * `check.text` (it is base64, not Thai prose). `requireAuth`/`loadProject`
 * are stubbed like `attachments.test.js`; `scope.js` is left real so its
 * actual assertions are what the permissions block is tested against.
 */
const request = require('supertest');
const express = require('express');

function loadApp(project, actor, overrides = {}) {
  jest.resetModules();

  jest.doMock('../middleware/requireAuth', () => ({
    requireAuth: (req, res, next) => { req.actor = actor; next(); },
  }));
  jest.doMock('../middleware/loadProject', () => ({
    loadProject: (req, res, next) => { req.project = project; next(); },
  }));
  jest.doMock('../db/pool', () => ({ pool: {}, transaction: jest.fn(), isTransient: () => false }));
  jest.doMock('../services/projectService', () => ({
    presentProject: (p) => ({ id: p.id }),
    loadSections: jest.fn(async () => ({})),
    findProject: jest.fn(async () => project),
    SECTION_NAMES: [],
    ...overrides.projectService,
  }));
  jest.doMock('../services/budgetService', () => ({
    loadSummary: jest.fn(async () => ({ money: {}, warnings: [] })),
    ...overrides.budgetService,
  }));
  const performTransition = overrides.performTransition || jest.fn(async (a, p, toPhaseCode, opts) => ({ toPhaseCode, opts }));
  jest.doMock('../services/phaseService', () => ({
    availableTransitions: jest.fn(async () => []),
    performTransition,
  }));
  const hasSignature = overrides.hasSignature || jest.fn(async () => false);
  jest.doMock('../services/signatureService', () => ({
    hasSignature,
    listForProject: jest.fn(async () => []),
    endorseAsAdvisor: jest.fn(async () => ({ endorsed: true })),
    find: overrides.find || jest.fn(async () => null),
    readImage: jest.fn(async () => Buffer.from('png-bytes')),
  }));

  const router = require('./projects');
  const app = express();
  app.use(express.json({ limit: '1mb' })); // matches app.js's real limit
  app.use('/api', router);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.status || 500).json({ error: err.message });
  });
  return { app, performTransition, hasSignature };
}

const project = (overrides = {}) => ({
  id: 1, club_id: 10, phase_code: 'PROPOSAL_SUBMITTED', phase_name_th: 'ส่งข้อเสนอแล้ว',
  advisor_person_id: 7, owner_person_id: 1, ...overrides,
});

describe('GET /projects/:id — permissions.endorseAsAdvisor', () => {
  const advisor = { person: { id: 7 }, membership: { role: 'AD', club_id: 10 } };

  test('true for the project’s own advisor who has not endorsed yet', async () => {
    const { app } = loadApp(project(), advisor, { hasSignature: jest.fn(async () => false) });
    const res = await request(app).get('/api/projects/1');
    expect(res.body.permissions.endorseAsAdvisor).toBe(true);
  });

  test('false once already endorsed, even though the role/ownership assertion alone would still pass', async () => {
    const { app } = loadApp(project(), advisor, { hasSignature: jest.fn(async () => true) });
    const res = await request(app).get('/api/projects/1');
    expect(res.body.permissions.endorseAsAdvisor).toBe(false);
  });

  test('false for an AD of a different project’s advisor, regardless of the signature flag', async () => {
    const someoneElse = { person: { id: 999 }, membership: { role: 'AD', club_id: 10 } };
    const { app } = loadApp(project(), someoneElse, { hasSignature: jest.fn(async () => false) });
    const res = await request(app).get('/api/projects/1');
    expect(res.body.permissions.endorseAsAdvisor).toBe(false);
  });
});

describe('POST /projects/:id/transitions', () => {
  const actor = { person: { id: 1 }, membership: { role: 'SH', club_id: 10 } };

  test('upper-cases toPhaseCode before it reaches the phase machine', async () => {
    const { app, performTransition } = loadApp(project(), actor);
    await request(app).post('/api/projects/1/transitions').send({ toPhaseCode: 'proposal_submitted' });

    expect(performTransition).toHaveBeenCalledWith(
      actor, project(), 'PROPOSAL_SUBMITTED', expect.objectContaining({})
    );
  });

  test('a non-string signatureImage is coerced to null rather than passed through', async () => {
    const { app, performTransition } = loadApp(project(), actor);
    await request(app).post('/api/projects/1/transitions')
      .send({ toPhaseCode: 'X', signatureImage: { not: 'a string' } });

    expect(performTransition).toHaveBeenCalledWith(
      actor, project(), 'X', expect.objectContaining({ signatureImage: null })
    );
  });

  test('a real base64 signatureImage string passes through untouched — not run through check.text’s length limits', async () => {
    const longBase64 = 'A'.repeat(200000); // longer than check.text's usual byte caps
    const { app, performTransition } = loadApp(project(), actor);
    await request(app).post('/api/projects/1/transitions')
      .send({ toPhaseCode: 'X', signatureImage: longBase64 });

    expect(performTransition).toHaveBeenCalledWith(
      actor, project(), 'X', expect.objectContaining({ signatureImage: longBase64 })
    );
  });
});

describe('GET /projects/:id/signatures/:signatureId', () => {
  test('serves the PNG inline (not as an attachment) with nosniff still set', async () => {
    const row = { id: 1, project_id: 1, image_path: 'signatures/1/x.png' };
    const { app } = loadApp(project(), { person: { id: 1 }, membership: { role: 'ADMIN' } }, {
      find: jest.fn(async () => row),
    });

    const res = await request(app).get('/api/projects/1/signatures/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
  });

  test('answers 404 for a signature id that does not belong to this project', async () => {
    const { app } = loadApp(project(), { person: { id: 1 }, membership: { role: 'ADMIN' } }, {
      find: jest.fn(async () => null),
    });
    const res = await request(app).get('/api/projects/1/signatures/999');
    expect(res.status).toBe(404);
  });
});
