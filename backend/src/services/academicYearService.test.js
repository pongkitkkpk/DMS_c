/**
 * `academicYearService.js` decides which academic year the whole system is
 * in — every membership `requireAuth` resolves is scoped by it. Its own
 * header names the real incident this file exists to prevent: starting the
 * API before MariaDB once left the year permanently stuck on a date-derived
 * guess, silently resolving every account to `role: null`. `load()`'s
 * three-source priority and `setAcademicYear`'s "cannot enter a year with no
 * ADMIN" guard (which structurally prevents that lockout, rather than only
 * documenting it) are what these tests target.
 */
function makeConn(overrides = {}) {
  const state = {
    settingRow: null,       // load()'s stored row, or null for "no row yet"
    loadShouldThrow: false, // simulate an unreachable database
    adminsInTargetYear: 0,
    describeRow: { academic_year: 2569, changed_at: null, changed_by_name: null },
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('FROM academic_year_setting WHERE id = 1')) {
      if (state.loadShouldThrow) throw new Error('ECONNREFUSED (simulated)');
      return [state.settingRow ? [state.settingRow] : []];
    }
    if (text.includes('FROM academic_year_setting s')) {
      return [[state.describeRow]];
    }
    if (text.includes('AS admins')) return [[{ admins: state.adminsInTargetYear }]];
    if (text.startsWith('INSERT INTO academic_year_setting')) return [{ affectedRows: 1 }];

    throw new Error(`makeConn: unhandled query: ${text}, params=${JSON.stringify(params)}`);
  });

  return { query, state };
}

function loadAcademicYearService(connState = {}, envOverrides = {}) {
  jest.resetModules();
  Object.assign(process.env, { ACADEMIC_YEAR: '', NODE_ENV: 'test' }, envOverrides);

  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));

  const academicYearService = require('./academicYearService');
  const { config } = require('./../config');
  return { academicYearService, conn, state: conn.state, config };
}

const admin = { person: { id: 1, full_name_th: 'ผู้ดูแล' }, membership: { role: 'ADMIN' } };

describe('load — the three-source priority', () => {
  test('an ACADEMIC_YEAR override wins outright, and never queries the database', async () => {
    const { academicYearService, conn } = loadAcademicYearService({}, { ACADEMIC_YEAR: '2570' });
    const result = await academicYearService.load();
    expect(result).toEqual({ academicYear: 2570, source: 'env' });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('reads the stored row when one exists', async () => {
    const { academicYearService } = loadAcademicYearService({ settingRow: { academic_year: 2568 } });
    const result = await academicYearService.load();
    expect(result).toEqual({ academicYear: 2568, source: 'database' });
  });

  test('falls back to the date only when the database answers with no row — a fresh, unseeded install', async () => {
    const { academicYearService, config } = loadAcademicYearService({ settingRow: null });
    const result = await academicYearService.load();
    expect(result).toEqual({ academicYear: config.fallbackAcademicYear, source: 'derived from the date' });
  });

  test('an unreachable database is left unresolved — not silently treated as unseeded', async () => {
    const { academicYearService } = loadAcademicYearService({ loadShouldThrow: true });
    const result = await academicYearService.load();
    expect(result.source).toBe('unresolved');
    expect(academicYearService.isResolved()).toBe(false);
  });
});

describe('setAcademicYear', () => {
  test('refuses anyone who is not ADMIN', async () => {
    const { academicYearService } = loadAcademicYearService();
    const stuact = { person: { id: 1 }, membership: { role: 'STUACT' } };
    await expect(academicYearService.setAcademicYear(stuact, { academicYear: 2570 }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('refuses when the year is forced by ACADEMIC_YEAR — the screen cannot override a break-glass setting', async () => {
    const { academicYearService } = loadAcademicYearService({}, { ACADEMIC_YEAR: '2569' });
    await expect(academicYearService.setAcademicYear(admin, { academicYear: 2570 }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('refuses moving to the year already in effect', async () => {
    const { academicYearService, config } = loadAcademicYearService();
    await expect(academicYearService.setAcademicYear(admin, { academicYear: config.fallbackAcademicYear }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('refuses moving to a year with no ADMIN — the guard that makes the lockout structurally impossible', async () => {
    const { academicYearService, config } = loadAcademicYearService({ adminsInTargetYear: 0 });
    const target = config.fallbackAcademicYear + 1;
    await expect(academicYearService.setAcademicYear(admin, { academicYear: target }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('moves the year once the target has at least one ADMIN, and current() reflects it immediately', async () => {
    const { academicYearService, config } = loadAcademicYearService({ adminsInTargetYear: 1 });
    const target = config.fallbackAcademicYear + 1;

    const result = await academicYearService.setAcademicYear(admin, { academicYear: target });

    expect(result).toEqual({ academicYear: target, previousAcademicYear: config.fallbackAcademicYear });
    expect(academicYearService.current()).toBe(target);
  });
});

describe('describe', () => {
  const row = { academic_year: 2569, changed_at: '2026-01-01', changed_by_name: 'ผู้ดูแลคนก่อน' };

  test('hides who changed it and when, from someone who is not an officer', async () => {
    const { academicYearService } = loadAcademicYearService({ describeRow: row });
    const sh = { person: { id: 1 }, membership: { role: 'SH' } };
    const result = await academicYearService.describe(sh);
    expect(result.changedAt).toBeNull();
    expect(result.changedByName).toBeNull();
  });

  test('shows who changed it and when, to ADMIN and STUACT', async () => {
    const { academicYearService } = loadAcademicYearService({ describeRow: row });
    const stuact = { person: { id: 1 }, membership: { role: 'STUACT' } };
    const result = await academicYearService.describe(stuact);
    expect(result.changedAt).toBe('2026-01-01');
    expect(result.changedByName).toBe('ผู้ดูแลคนก่อน');
  });

  test('settable is true only for ADMIN, and only when not overridden by the environment', async () => {
    const { academicYearService: notOverridden } = loadAcademicYearService({ describeRow: row });
    expect((await notOverridden.describe(admin)).settable).toBe(true);

    const { academicYearService: overridden } = loadAcademicYearService({ describeRow: row }, { ACADEMIC_YEAR: '2569' });
    expect((await overridden.describe(admin)).settable).toBe(false);

    const { academicYearService: stuactCase } = loadAcademicYearService({ describeRow: row });
    const stuact = { person: { id: 1 }, membership: { role: 'STUACT' } };
    expect((await stuactCase.describe(stuact)).settable).toBe(false);
  });
});
