/**
 * `assertValid()` is the gate `server.js` runs before binding a port — the
 * file's own header explains why it exists: the old system read `process.env`
 * at the point of use and fell back to literals when a value was missing, so
 * a missing `JWT_SECRET` silently signed forgeable tokens instead of stopping
 * the process. Every branch here is a way a deployment that looks fine on day
 * one is already compromised, so each one gets its own test: a baseline that
 * passes, and one env var flipped to the value that should fail it.
 */
const GOOD_PROD_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(32),
  AUTH_PROVIDER: 'icit',
  MOCK_PASSWORD: '',
  ALLOW_MOCK_AUTH: '',
  ICIT_AUTHENTICATION: 'https://icit.example/auth',
  ICIT_INFORMATION: 'https://icit.example/info',
  ICIT_TOKEN: 'a-real-token',
  ACADEMIC_YEAR: '2569',
  CORS_ORIGIN: 'https://dms.example.ac.th',
  ADMIN_USERNAME: '',
  ADMIN_PASSWORD: '',
  LOGIN_WINDOW_SECONDS: '900',
  LOGIN_MAX_PER_USERNAME: '8',
  LOGIN_MAX_PER_ADDRESS: '60',
  DB_PASS: 'a-real-database-password',
  DB_USER: 'dms_app',
  ALLOW_INSECURE_ORIGINS: '',
};

const GOOD_DEV_ENV = {
  ...GOOD_PROD_ENV,
  NODE_ENV: 'test',
  AUTH_PROVIDER: 'mock',
  CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
  DB_PASS: '',
  DB_USER: 'root',
};

/** Fresh module registry per test, so `config.js` reads exactly this test's environment. */
function loadConfig(overrides = {}, base = GOOD_PROD_ENV) {
  jest.resetModules();
  Object.assign(process.env, base, overrides);
  return require('./config');
}

function messagesFrom(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.message;
  }
}

describe('a correctly configured deployment', () => {
  test('production: does not throw', () => {
    const { assertValid } = loadConfig();
    expect(() => assertValid()).not.toThrow();
  });

  test('development: does not throw', () => {
    const { assertValid } = loadConfig({}, GOOD_DEV_ENV);
    expect(() => assertValid()).not.toThrow();
  });
});

describe('JWT_SECRET', () => {
  test('missing entirely is refused', () => {
    const { assertValid } = loadConfig({ JWT_SECRET: '' });
    expect(messagesFrom(assertValid)).toMatch(/JWT_SECRET is not set/);
  });

  test('shorter than 32 characters is refused', () => {
    const { assertValid } = loadConfig({ JWT_SECRET: 'too-short' });
    expect(messagesFrom(assertValid)).toMatch(/JWT_SECRET is 9 characters/);
  });
});

describe('AUTH_PROVIDER', () => {
  test('anything other than mock or icit is refused', () => {
    const { assertValid } = loadConfig({ AUTH_PROVIDER: 'ldap' });
    expect(messagesFrom(assertValid)).toMatch(/AUTH_PROVIDER must be "mock" or "icit"/);
  });

  test('icit missing any of its three endpoints is refused', () => {
    const { assertValid } = loadConfig({ ICIT_TOKEN: '' });
    expect(messagesFrom(assertValid)).toMatch(/ICIT_TOKEN is not set/);
  });

  describe('mock in production — the demonstration-deployment escape hatch', () => {
    test('refused without ALLOW_MOCK_AUTH', () => {
      const { assertValid } = loadConfig({ AUTH_PROVIDER: 'mock' });
      expect(messagesFrom(assertValid)).toMatch(/AUTH_PROVIDER=mock in production/);
    });

    test('refused with ALLOW_MOCK_AUTH=1 but a short MOCK_PASSWORD', () => {
      const { assertValid } = loadConfig({ AUTH_PROVIDER: 'mock', ALLOW_MOCK_AUTH: '1', MOCK_PASSWORD: 'short' });
      expect(messagesFrom(assertValid)).toMatch(/MOCK_PASSWORD of at least 8 characters/);
    });

    test('allowed with ALLOW_MOCK_AUTH=1 and a real MOCK_PASSWORD — the deliberate opt-in', () => {
      const { assertValid } = loadConfig({ AUTH_PROVIDER: 'mock', ALLOW_MOCK_AUTH: '1', MOCK_PASSWORD: 'a-real-password' });
      expect(() => assertValid()).not.toThrow();
    });

    test('mock is unrestricted outside production', () => {
      const { assertValid } = loadConfig({}, GOOD_DEV_ENV);
      expect(() => assertValid()).not.toThrow();
    });
  });
});

describe('ACADEMIC_YEAR', () => {
  test.each(['1000', '9999', 'not-a-year'])('%s outside a 4-digit Buddhist-era year is refused', (year) => {
    const { assertValid } = loadConfig({ ACADEMIC_YEAR: year });
    expect(messagesFrom(assertValid)).toMatch(/ACADEMIC_YEAR must be a 4-digit/);
  });
});

describe('CORS_ORIGIN', () => {
  test('empty is refused — no browser origin could call the API at all', () => {
    const { assertValid } = loadConfig({ CORS_ORIGIN: '' });
    expect(messagesFrom(assertValid)).toMatch(/no browser origin may call/);
  });

  test('a bare wildcard is refused', () => {
    const { assertValid } = loadConfig({ CORS_ORIGIN: '*' });
    expect(messagesFrom(assertValid)).toMatch(/CORS_ORIGIN=\* would let any site/);
  });
});

describe('the local-admin fallback (Q17)', () => {
  test('ADMIN_USERNAME set in production is refused', () => {
    const { assertValid } = loadConfig({ ADMIN_USERNAME: 'backdoor' });
    expect(messagesFrom(assertValid)).toMatch(/local admin fallback is non-production only/);
  });

  test('ADMIN_USERNAME set outside production is fine', () => {
    const { assertValid } = loadConfig({ ADMIN_USERNAME: 'devadmin' }, GOOD_DEV_ENV);
    expect(() => assertValid()).not.toThrow();
  });
});

describe('loginThrottle', () => {
  test.each([
    ['LOGIN_MAX_PER_USERNAME', '0'],
    ['LOGIN_MAX_PER_ADDRESS', '-5'],
    ['LOGIN_WINDOW_SECONDS', 'not-a-number'],
  ])('a non-positive-integer %s is refused', (key, value) => {
    const { assertValid } = loadConfig({ [key]: value });
    expect(messagesFrom(assertValid)).toMatch(/must be a positive integer/);
  });
});

describe('production-only checks', () => {
  test('an empty DB_PASS is refused in production', () => {
    const { assertValid } = loadConfig({ DB_PASS: '' });
    expect(messagesFrom(assertValid)).toMatch(/DB_PASS is empty in production/);
  });

  test('DB_USER=root is refused in production', () => {
    const { assertValid } = loadConfig({ DB_USER: 'root' });
    expect(messagesFrom(assertValid)).toMatch(/DB_USER=root in production/);
  });

  test('a plain-http CORS origin is refused in production without ALLOW_INSECURE_ORIGINS', () => {
    const { assertValid } = loadConfig({ CORS_ORIGIN: 'http://dms.example.ac.th' });
    expect(messagesFrom(assertValid)).toMatch(/tokens would travel in the clear/);
  });

  test('a plain-http CORS origin is allowed in production with the explicit opt-in', () => {
    const { assertValid } = loadConfig({ CORS_ORIGIN: 'http://dms.example.ac.th', ALLOW_INSECURE_ORIGINS: '1' });
    expect(() => assertValid()).not.toThrow();
  });

  test('none of the production-only checks apply outside production', () => {
    const { assertValid } = loadConfig(
      { DB_PASS: '', DB_USER: 'root', CORS_ORIGIN: 'http://localhost:3000' },
      GOOD_DEV_ENV
    );
    expect(() => assertValid()).not.toThrow();
  });
});

describe('multiple simultaneous problems', () => {
  test('every problem is listed, not just the first', () => {
    const { assertValid } = loadConfig({ JWT_SECRET: '', CORS_ORIGIN: '', DB_PASS: '' });
    const message = messagesFrom(assertValid);
    expect(message).toMatch(/JWT_SECRET is not set/);
    expect(message).toMatch(/no browser origin may call/);
    expect(message).toMatch(/DB_PASS is empty in production/);
  });
});
