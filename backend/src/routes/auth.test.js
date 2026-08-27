/**
 * `POST /api/auth/login`, the one endpoint reachable without a token.
 *
 * `db/pool` is replaced with `test-support/fakePool` rather than hit a real
 * database: everything this route touches (the throttle counts, `person`,
 * `membership`, `login_attempt`) goes through `pool.query`, and a fake that
 * answers by query shape is enough to drive every branch without a MariaDB
 * instance. Each test reloads the app with `jest.resetModules()` so that
 * `config.js` (which reads `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`JWT_SECRET`
 * once, at require time) picks up that test's environment.
 */
const request = require('supertest');

const { createFakePool } = require('../test-support/fakePool');

// `app.js` pulls in the full route graph (docxtemplater, pizzip, mysql2, ...),
// and the first `require('../app')` below pays for instrumenting all of it —
// `jest.resetModules()` clears the module registry per test but not that
// one-time compile cost, so only the first test needs the room.
jest.setTimeout(20000);

const BASE_ENV = {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(32),
  AUTH_PROVIDER: 'mock',
  MOCK_PASSWORD: '',
  ADMIN_USERNAME: '',
  ADMIN_PASSWORD: '',
  LOGIN_WINDOW_SECONDS: '900',
  LOGIN_MAX_PER_USERNAME: '8',
  LOGIN_MAX_PER_ADDRESS: '60',
  TRUST_PROXY: '',
};

/** Fresh module registry + env, so `config.js` reads this test's settings. */
function loadApp(envOverrides = {}, poolState = {}) {
  jest.resetModules();
  Object.assign(process.env, BASE_ENV, envOverrides);

  const fakePool = createFakePool(poolState);
  jest.doMock('../db/pool', () => ({
    pool: fakePool.pool,
    transaction: jest.fn(),
    isTransient: () => false,
  }));

  const { createApp } = require('../app');
  // From the same fresh module registry as `createApp`, so it signs with
  // whatever `JWT_SECRET` this test set.
  const { signToken } = require('../auth/tokens');
  return { app: createApp(), state: fakePool.state, query: fakePool.pool.query, signToken };
}

describe('POST /api/auth/login', () => {
  test('rejects a request missing username or password before touching the database', async () => {
    const { app, query } = loadApp();

    const res = await request(app).post('/api/auth/login').send({ username: 'someone' });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('refuses once the per-username guessing budget is spent, before any credential is checked', async () => {
    const { app, state } = loadApp(
      {},
      { usernameFailures: { failures: 8, retry_after: 120 } }
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'fixture.student', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    // Neither the local-admin compare nor the provider ran, so nothing new
    // was recorded — the budget check happens before either is reached.
    expect(state.recordedAttempts).toHaveLength(0);
  });

  test('logs in through the local-admin fallback when the credentials match', async () => {
    const { app, state } = loadApp(
      { ADMIN_USERNAME: 'localadmin', ADMIN_PASSWORD: 'supersecret123' },
      {
        personRow: {
          id: 1,
          id_student: 'localadmin',
          prefix: null,
          full_name_th: 'localadmin',
          email: null,
          phone: null,
          account_type: 'personel',
          level_desc: null,
          stu_status_desc: null,
        },
        membershipRows: [{ id: 10, role: 'ADMIN' }],
      }
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'localadmin', password: 'supersecret123' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.role).toBe('ADMIN');
    expect(res.body.person.idStudent).toBe('localadmin');
    expect(state.recordedAttempts).toEqual([
      { idStudent: 'localadmin', isSuccess: true, remoteIp: expect.anything() },
    ]);
  });

  test('rejects the local-admin fallback on a wrong password, and records the failure', async () => {
    const { app, state } = loadApp(
      { ADMIN_USERNAME: 'localadmin', ADMIN_PASSWORD: 'supersecret123' },
      { personRow: null }
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'localadmin', password: 'not-the-password' });

    expect(res.status).toBe(401);
    expect(state.recordedAttempts).toEqual([
      { idStudent: 'localadmin', isSuccess: false, remoteIp: expect.anything() },
    ]);
  });

  test('logs in through the mock provider, with no membership yet resolving to no role', async () => {
    const { app, state } = loadApp(
      // Local admin left disabled, same as most deployments.
      { ADMIN_USERNAME: '', ADMIN_PASSWORD: '' },
      {
        personRow: {
          id: 2,
          id_student: 'fixture.student',
          prefix: 'นาย',
          full_name_th: 'สมชาย นักศึกษา',
          email: 'student@example.test',
          phone: null,
          account_type: 'students',
          level_desc: 'ปริญญาตรี',
          stu_status_desc: 'กำลังศึกษา',
        },
        membershipRows: [],
      }
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'fixture.student', password: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.person.idStudent).toBe('fixture.student');
    expect(res.body.role).toBeNull();
    expect(res.body.membership).toBeNull();
    expect(state.recordedAttempts).toEqual([
      { idStudent: 'fixture.student', isSuccess: true, remoteIp: expect.anything() },
    ]);
  });

  test('rejects an unknown mock username, and records the failure', async () => {
    const { app, state } = loadApp({ ADMIN_USERNAME: '', ADMIN_PASSWORD: '' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody.here', password: 'anything' });

    expect(res.status).toBe(401);
    expect(state.recordedAttempts).toEqual([
      { idStudent: 'nobody.here', isSuccess: false, remoteIp: expect.anything() },
    ]);
  });
});

describe('GET /api/auth/mode', () => {
  test('lists the mock directory and says no shared password is required, when none is set', async () => {
    const { app } = loadApp({ AUTH_PROVIDER: 'mock', MOCK_PASSWORD: '' });

    const res = await request(app).get('/api/auth/mode');

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('mock');
    expect(res.body.requiresSharedPassword).toBe(false);
    // The six fixtures from `auth/providers/mock.js`'s DIRECTORY, none of
    // which has a `person` row yet in this test's fake database.
    expect(res.body.accounts).toHaveLength(6);
    expect(res.body.accounts).toContainEqual(
      { idStudent: 'fixture.admin', fullNameTh: null, role: null, scope: null }
    );
  });

  test('says a shared password is required once MOCK_PASSWORD is set', async () => {
    const { app } = loadApp({ AUTH_PROVIDER: 'mock', MOCK_PASSWORD: 'letmein12' });

    const res = await request(app).get('/api/auth/mode');

    expect(res.body.requiresSharedPassword).toBe(true);
  });

  test('reports no directory for the ICIT provider, and never queries the database', async () => {
    const { app, query } = loadApp({ AUTH_PROVIDER: 'icit' });

    const res = await request(app).get('/api/auth/mode');

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('icit');
    expect(res.body.accounts).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('falls back to a bare username list when the directory query fails', async () => {
    const { app } = loadApp(
      { AUTH_PROVIDER: 'mock', MOCK_PASSWORD: '' },
      { describeError: new Error('ER_NO_SUCH_TABLE') }
    );

    const res = await request(app).get('/api/auth/mode');

    // Still usable: the screen just cannot show a role beside each name.
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(6);
    expect(res.body.accounts).toContainEqual(
      { idStudent: 'fixture.admin', fullNameTh: null, role: null, scope: null }
    );
  });
});

/**
 * `GET /api/me` is the thinnest route behind `requireAuth`, which makes it the
 * cheapest way to test that middleware directly: the old `verifyToken` checked
 * a signature and stopped there, so any valid token — including one for a
 * person since deleted — granted every capability. `requireAuth` re-reads the
 * person and their memberships on every request instead; these tests are
 * against that regression.
 */
describe('GET /api/me', () => {
  test('refuses a request with no token', async () => {
    const { app } = loadApp();

    const res = await request(app).get('/api/me');

    expect(res.status).toBe(401);
  });

  test('refuses a malformed token', async () => {
    const { app } = loadApp();

    const res = await request(app).get('/api/me').set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
  });

  test('refuses a validly-signed token for a person no longer in the database', async () => {
    const { app, signToken } = loadApp({}, { personRow: null });
    const token = signToken({ id: 999, id_student: 'ghost' });

    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  test('resolves an authenticated person with no membership to role: null', async () => {
    const personRow = {
      id: 3,
      id_student: 'fixture.stuact',
      prefix: null,
      full_name_th: 'สมศักดิ์ กิจการ',
      email: null,
      phone: null,
      account_type: 'personel',
      level_desc: null,
      stu_status_desc: null,
    };
    const { app, signToken } = loadApp({}, { personRow, membershipRows: [] });
    const token = signToken(personRow);

    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBeNull();
    expect(res.body.person.idStudent).toBe('fixture.stuact');
  });

  test('resolves an authenticated person to their membership role', async () => {
    const personRow = {
      id: 4,
      id_student: 'fixture.admin',
      prefix: null,
      full_name_th: 'ผู้ดูแล ระบบ',
      email: null,
      phone: null,
      account_type: 'personel',
      level_desc: null,
      stu_status_desc: null,
    };
    const { app, signToken } = loadApp({}, { personRow, membershipRows: [{ id: 20, role: 'ADMIN' }] });
    const token = signToken(personRow);

    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
  });
});
