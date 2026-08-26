/**
 * `routes/documents.js` carries two pieces of real logic beyond dispatch: the
 * phase gate (`unavailableReason` — a recorded assumption, not a port, since
 * the old system had none at all) and combining "too early" with "too big to
 * print" into one availability answer. `loadDocument`/`overCapacity`/`render`
 * are stubbed; `requireAuth`/`loadProject` are stubbed the same way
 * `attachments.test.js` stubs them.
 */
const request = require('supertest');
const express = require('express');

function loadApp(project, { document = {}, overCapacityResult = [], renderResult } = {}) {
  jest.resetModules();

  jest.doMock('../middleware/requireAuth', () => ({
    requireAuth: (req, res, next) => { req.actor = { person: { id: 1 } }; next(); },
  }));
  jest.doMock('../middleware/loadProject', () => ({
    loadProject: (req, res, next) => { req.project = project; next(); },
  }));
  jest.doMock('../documents/assembler', () => ({ loadDocument: jest.fn(async () => document) }));
  jest.doMock('../documents/arity', () => ({ overCapacity: jest.fn(() => overCapacityResult) }));
  jest.doMock('../documents/render', () => ({
    FORMS: {
      temp04: { file: 'temp04.docx', code: 'กนศ.04', title: 'แบบเสนอโครงการ' },
      temp06: { file: 'temp06.docx', code: 'กนศ.06', title: 'แบบสรุปผลโครงการ' },
    },
    render: jest.fn(() => renderResult || { buffer: Buffer.from('docx-bytes'), filename: 'กนศ.04-B123.docx' }),
  }));

  const router = require('./documents');
  const app = express();
  app.use('/api', router);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

const project = (overrides = {}) => ({
  id: 1, phase_ordinal: 1, phase_name_th: 'ร่างข้อเสนอ', ...overrides,
});

describe('GET /projects/:id/documents — availability', () => {
  test('too early to produce either form when the project is still drafting', async () => {
    const res = await request(loadApp(project({ phase_ordinal: 1 }))).get('/api/projects/1/documents');

    const byForm = Object.fromEntries(res.body.documents.map((d) => [d.form, d]));
    expect(byForm.temp04.available).toBe(false);
    expect(byForm.temp04.reason).toMatch(/ดำเนินการขออนุมัติ/);
    expect(byForm.temp04.violations).toEqual([]); // not computed while too early
  });

  test('temp04 becomes available once the project reaches its gate phase, temp06 does not yet', async () => {
    const res = await request(loadApp(project({ phase_ordinal: 2, phase_name_th: 'ดำเนินการขออนุมัติ' })))
      .get('/api/projects/1/documents');

    const byForm = Object.fromEntries(res.body.documents.map((d) => [d.form, d]));
    expect(byForm.temp04.available).toBe(true);
    expect(byForm.temp06.available).toBe(false);
  });

  test('past the phase gate but over the form’s printable capacity is still unavailable, with the violation named', async () => {
    const overCapacityResult = [{ kind: 'section', name: 'objectives', label: 'วัตถุประสงค์', rows: 10, capacity: 5, message: 'วัตถุประสงค์: มี 10 รายการ แต่แบบฟอร์มพิมพ์ได้ 5 รายการ' }];
    const res = await request(loadApp(project({ phase_ordinal: 5, phase_name_th: 'ร่างสรุปผลโครงการ' }), { overCapacityResult }))
      .get('/api/projects/1/documents');

    const byForm = Object.fromEntries(res.body.documents.map((d) => [d.form, d]));
    expect(byForm.temp04.available).toBe(false);
    expect(byForm.temp04.reason).toBe(overCapacityResult[0].message);
    expect(byForm.temp04.violations).toEqual(overCapacityResult);
  });
});

describe('GET /projects/:id/documents/:form — download', () => {
  test('refuses an unknown form', async () => {
    const res = await request(loadApp(project({ phase_ordinal: 5 }))).get('/api/projects/1/documents/temp99');
    expect(res.status).toBe(404);
  });

  test('refuses to render before the phase gate, without calling render at all', async () => {
    const res = await request(loadApp(project({ phase_ordinal: 1 }))).get('/api/projects/1/documents/temp04');
    expect(res.status).toBe(400);
  });

  test('sends the rendered .docx with the correct content type and an RFC-5987 Thai filename', async () => {
    const renderResult = { buffer: Buffer.from('docx-bytes'), filename: 'กนศ.04-B690420100003.docx' };
    const res = await request(loadApp(project({ phase_ordinal: 2 }), { renderResult }))
      .get('/api/projects/1/documents/temp04');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml\.document/);
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent(renderResult.filename)}`
    );
    expect(res.headers['content-length']).toBe(String(renderResult.buffer.length));
  });
});
