/**
 * `routes/reference.js` is mostly a thin `pool.query` → JSON pass-through, but
 * two handlers reshape the rows into something the query alone does not
 * express: `/reference/tags` groups flat rows into nested tag sets, and
 * `/reference/limits` reconciles the two forms' printable capacities for a
 * section they share by taking the **tighter** one — a bug here would tell a
 * student they may enter more items than the form that actually binds them
 * can hold. `documents/arity.js` is left real, so the limits test reads the
 * same numbers `render.js` enforces rather than a copy that could drift.
 */
const request = require('supertest');
const express = require('express');
const { LIMITS } = require('../documents/arity');

function loadApp(queryImpl) {
  jest.resetModules();
  // `jest.doMock` registrations outlive `resetModules()` — undo any mock a
  // previous (synthetic-limits) test in this file left on `documents/arity`.
  jest.dontMock('../documents/arity');
  jest.doMock('../middleware/requireAuth', () => ({
    requireAuth: (req, res, next) => { req.actor = { academicYear: 2569, membership: { role: 'ADMIN' } }; next(); },
  }));
  jest.doMock('../db/pool', () => ({ pool: { query: jest.fn(queryImpl) } }));

  const router = require('./reference');
  const app = express();
  app.use('/api', router);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('GET /reference/tags — grouping flat rows into tag sets', () => {
  test('groups rows by set code, preserving each tag’s ordinal and name', async () => {
    const app = loadApp(async () => [[
      { set_code: 'SDG', set_name: 'เป้าหมายการพัฒนา', id: 1, ordinal: 1, name_th: 'ขจัดความยากจน' },
      { set_code: 'SDG', set_name: 'เป้าหมายการพัฒนา', id: 2, ordinal: 2, name_th: 'ขจัดความหิวโหย' },
      { set_code: 'SIDE', set_name: 'ด้าน', id: 3, ordinal: 1, name_th: 'ด้านที่หนึ่ง' },
    ]]);

    const res = await request(app).get('/api/reference/tags');

    expect(res.body.tagSets).toEqual([
      { code: 'SDG', nameTh: 'เป้าหมายการพัฒนา', tags: [
        { id: 1, ordinal: 1, nameTh: 'ขจัดความยากจน' },
        { id: 2, ordinal: 2, nameTh: 'ขจัดความหิวโหย' },
      ] },
      { code: 'SIDE', nameTh: 'ด้าน', tags: [{ id: 3, ordinal: 1, nameTh: 'ด้านที่หนึ่ง' }] },
    ]);
  });

  test('an empty tag table answers an empty list, not an error', async () => {
    const app = loadApp(async () => [[]]);
    const res = await request(app).get('/api/reference/tags');
    expect(res.body.tagSets).toEqual([]);
  });
});

describe('GET /reference/limits — the tighter form wins for a shared section', () => {
  /**
   * In the templates as they exist today, every section the two forms share
   * happens to have the same capacity in both (`locations`/`problems`/
   * `indicators`, all equal) — real data that cannot exercise the actual
   * comparison. `documents/arity` is mocked here with a synthetic case in
   * each direction so this test still means something if a future template
   * edit makes the two forms disagree.
   */
  function loadAppWithLimits(limits) {
    jest.resetModules();
    jest.doMock('../middleware/requireAuth', () => ({
      requireAuth: (req, res, next) => { req.actor = { academicYear: 2569, membership: { role: 'ADMIN' } }; next(); },
    }));
    jest.doMock('../db/pool', () => ({ pool: { query: jest.fn(async () => [[]]) } }));
    jest.doMock('../documents/arity', () => ({ LIMITS: limits }));
    const router = require('./reference');
    const app = express();
    app.use('/api', router);
    return app;
  }

  test('temp06 wins when it is the tighter of the two, even though temp04 is processed first', async () => {
    const app = loadAppWithLimits({
      temp04: { sections: { shared: { capacity: 10, label: 'ร่วม' } }, budget: {} },
      temp06: { sections: { shared: { capacity: 4, label: 'ร่วม' } }, budget: {} },
    });
    const res = await request(app).get('/api/reference/limits');
    expect(res.body.sections.shared).toEqual({ capacity: 4, label: 'ร่วม', form: 'temp06' });
  });

  test('temp04 wins when it is the tighter of the two', async () => {
    const app = loadAppWithLimits({
      temp04: { sections: { shared: { capacity: 3, label: 'ร่วม' } }, budget: {} },
      temp06: { sections: { shared: { capacity: 9, label: 'ร่วม' } }, budget: {} },
    });
    const res = await request(app).get('/api/reference/limits');
    expect(res.body.sections.shared).toEqual({ capacity: 3, label: 'ร่วม', form: 'temp04' });
  });

  test('a section only one form prints is reported at that form’s own capacity', async () => {
    const onlyTemp04 = Object.keys(LIMITS.temp04.sections).filter((s) => !LIMITS.temp06.sections[s]);
    expect(onlyTemp04.length).toBeGreaterThan(0);

    const app = loadApp(async () => [[]]);
    const res = await request(app).get('/api/reference/limits');

    const section = onlyTemp04[0];
    expect(res.body.sections[section]).toEqual({
      capacity: LIMITS.temp04.sections[section].capacity,
      label: LIMITS.temp04.sections[section].label,
      form: 'temp04',
    });
  });

  test('carries the budget capacities from temp04 verbatim — only temp04 prints a budget grid', async () => {
    const app = loadApp(async () => [[]]);
    const res = await request(app).get('/api/reference/limits');
    expect(res.body.budget).toEqual(LIMITS.temp04.budget);
  });
});
