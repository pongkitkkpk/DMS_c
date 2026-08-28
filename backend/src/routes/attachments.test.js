/**
 * `routes/attachments.js` carries real behaviour of its own, beyond dispatch
 * to `attachmentService`: the download route's headers are what makes "there
 * is no `express.static` mount" actually safe — `Content-Disposition:
 * attachment` and `nosniff` are what stop an uploaded `.html` from running as
 * script in this origin — and `receiveOne` translates multer's English,
 * non-`HttpError` errors into the Thai 400s the rest of the API answers with.
 * `requireAuth`/`loadProject` are stubbed (both are tested on their own
 * elsewhere); `attachmentService` is stubbed except where a test is about
 * multer itself, which never reaches the service at all. `phaseCode` is
 * overridable per test so the `BUDGET_APPROVED` content lock's attachment
 * exemption (`scope.assertCanManageAttachments`, TODO.md 2026-08-27) can be
 * exercised without a real database.
 */
const request = require('supertest');
const express = require('express');

function loadApp(actor, { findResult = null, serviceOverrides = {}, phaseCode = 'DRAFT_PROPOSAL' } = {}) {
  jest.resetModules();
  process.env.UPLOAD_MAX_BYTES = '10'; // tiny, so the size-limit test is cheap

  jest.doMock('../middleware/requireAuth', () => ({
    requireAuth: (req, res, next) => { req.actor = actor; next(); },
  }));
  jest.doMock('../middleware/loadProject', () => ({
    loadProject: (req, res, next) => {
      req.project = { id: Number(req.params.id), phase_code: phaseCode, club_id: actor.membership && actor.membership.club_id };
      next();
    },
  }));
  jest.doMock('../services/attachmentService', () => ({
    ALLOWED_EXTENSIONS: new Map([['.pdf', 'application/pdf']]),
    list: jest.fn(async () => []),
    add: jest.fn(async () => ({ id: 1, originalName: 'x.pdf', byteSize: 3 })),
    find: jest.fn(async () => findResult),
    read: jest.fn(async () => Buffer.from('hi')),
    remove: jest.fn(async () => true),
    ...serviceOverrides,
  }));

  const router = require('./attachments');
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

const actorWith = (role) => ({ person: { id: 1 }, membership: { role, club_id: 10 } });

describe('GET /projects/:id/attachments/:attachmentId — download headers', () => {
  test('forces a download rather than an inline render, whatever was uploaded', async () => {
    const app = loadApp(actorWith('SH'), { findResult: { id: 1, original_name: 'เอกสารแนบ.pdf' } });

    const res = await request(app).get('/api/projects/1/attachments/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    // RFC 5987 filename* carries the Thai name; the plain `filename=` is a
    // safe ASCII fallback, never the real (non-ASCII) name.
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('เอกสารแนบ.pdf')}`
    );
  });

  test('an attachment id that does not belong to this project answers 404', async () => {
    const app = loadApp(actorWith('SH'), { findResult: null });
    const res = await request(app).get('/api/projects/1/attachments/999');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /projects/:id/attachments/:attachmentId — wired to assertCanManageAttachments', () => {
  test('an adviser (view-only) may not delete an attachment', async () => {
    const app = loadApp(actorWith('AD'), { findResult: { id: 1, original_name: 'x.pdf' } });
    const res = await request(app).delete('/api/projects/1/attachments/1');
    expect(res.status).toBe(403);
  });

  test('the project’s own SH may delete', async () => {
    const app = loadApp(actorWith('SH'), { findResult: { id: 1, original_name: 'x.pdf' } });
    const res = await request(app).delete('/api/projects/1/attachments/1');
    expect(res.status).toBe(200);
  });

  test('ADMIN may still delete an attachment while BUDGET_APPROVED — exempt from the content lock (TODO.md)', async () => {
    const app = loadApp(actorWith('ADMIN'), {
      findResult: { id: 1, original_name: 'x.pdf' },
      phaseCode: 'BUDGET_APPROVED',
    });
    const res = await request(app).delete('/api/projects/1/attachments/1');
    expect(res.status).toBe(200);
  });
});

describe('POST /projects/:id/attachments — multer error translation', () => {
  test('a file over the configured size limit answers a Thai 400, not multer’s raw English error', async () => {
    const app = loadApp(actorWith('SH'));

    const res = await request(app)
      .post('/api/projects/1/attachments')
      .attach('file', Buffer.from('this is more than ten bytes'), 'report.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ไฟล์ใหญ่เกินไป/);
  });

  test('a file within the limit is accepted and reaches the service', async () => {
    const add = jest.fn(async () => ({ id: 1, originalName: 'ok.pdf', byteSize: 3 }));
    const app = loadApp(actorWith('SH'), { serviceOverrides: { add } });

    const res = await request(app)
      .post('/api/projects/1/attachments')
      .attach('file', Buffer.from('ok'), 'ok.pdf');

    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledTimes(1);
  });

  test('an adviser (view-only) may not upload', async () => {
    const app = loadApp(actorWith('AD'));
    const res = await request(app)
      .post('/api/projects/1/attachments')
      .attach('file', Buffer.from('ok'), 'ok.pdf');
    expect(res.status).toBe(403);
  });
});
