/**
 * Environment configuration, read once and validated at startup.
 *
 * The old system read `process.env` at the point of use and fell back to
 * literals when a value was missing — `server.js:107` signed tokens with
 * whatever `JWT_SECRET` happened to be. Here a missing or short secret stops the
 * process instead of producing forgeable tokens.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/**
 * Thai academic year (Buddhist era) that "now" belongs to.
 *
 * The old system stored this per user (`users.yearly`) and initialised it to a
 * literal `2667` in one place, so there is no rule to port. The boundary below —
 * a new academic year starts in June — matches the university calendar but is
 * NOT confirmed by any source document; see docs/DECISIONS.md, open item
 * "Academic year boundary". Set `ACADEMIC_YEAR` explicitly to override it.
 */
function currentAcademicYear(now = new Date()) {
  const gregorian = now.getFullYear();
  return (now.getMonth() + 1 >= 6 ? gregorian : gregorian - 1) + 543;
}

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  isProduction,
  port: Number(process.env.PORT || 3001),
  /**
   * How many reverse proxies sit in front of this API, or `false` for none.
   *
   * This decides what `req.ip` means, which decides whose budget a failed login
   * spends (`services/loginThrottle.js`). It defaults to **off**: with no proxy
   * in front, honouring `X-Forwarded-For` lets any caller name their own
   * address and mint a fresh budget per request. Behind nginx, set
   * `TRUST_PROXY=1` — the number of hops you actually control, not `true`,
   * which trusts the whole chain including the part the client wrote.
   */
  trustProxy: (() => {
    const raw = (process.env.TRUST_PROXY || '').trim();
    if (!raw || raw === 'false' || raw === '0') return false;
    return /^\d+$/.test(raw) ? Number(raw) : raw;
  })(),
  /**
   * Allowed browser origins, comma-separated.
   *
   * `localhost:3000` and `127.0.0.1:3000` are the same server to a person and
   * two different origins to a browser, and CRA prints a LAN URL as a
   * suggestion — so a single-origin default turns an ordinary way of opening
   * the app into a blocked request that reaches the user as
   * "ติดต่อเซิร์ฟเวอร์ไม่ได้", with the API perfectly healthy. Development
   * therefore allows both loopback spellings; production must name its origins
   * explicitly (see `assertValid`) and gets no default at all.
   */
  corsOrigins: (process.env.CORS_ORIGIN ||
    (isProduction ? '' : 'http://localhost:3000,http://127.0.0.1:3000'))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * **The fallback only — not the year the system is in.** That lives in
   * `academic_year_setting` and is read through `academicYearService.current()`.
   * This is what it falls back to when the row does not exist yet, and it is
   * named `fallback…` so nothing reads it expecting the truth: during the change
   * that moved the year into the database, a check script kept reading this and
   * compared a date-derived 2569 against a system sitting at 2567.
   */
  fallbackAcademicYear: Number(process.env.ACADEMIC_YEAR || currentAcademicYear()),

  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  },

  authProvider: (process.env.AUTH_PROVIDER || 'mock').toLowerCase(),

  /**
   * A single shared password for the mock provider — a demo's front door.
   *
   * The mock accepts any non-empty password by design (there is nothing to
   * check against), which is correct on a laptop and indefensible on a host
   * with a public address: `fixture.admin` is a published username, so the
   * whole system is one guess away from an Admin session. Set this and the mock
   * requires it exactly, which turns the fixture directory from "anyone" into
   * "anyone who was given the password".
   *
   * Blank keeps the old behaviour, which is what development wants. It is
   * **required** when a production start is allowed to run on the mock at all
   * (`ALLOW_MOCK_AUTH=1`) — see `assertValid`.
   */
  mockPassword: process.env.MOCK_PASSWORD || '',

  /**
   * Guessing budgets for `POST /api/auth/login` — see `services/loginThrottle.js`.
   *
   * The per-address budget is much larger than the per-username one on purpose:
   * a campus NAT can put a whole building behind one address, and a budget
   * tight enough to stop spraying quickly would lock out people who typed
   * nothing wrong. Tune it for the deployment rather than leaving it to be
   * discovered during an exam week.
   */
  loginThrottle: {
    windowSeconds: Number(process.env.LOGIN_WINDOW_SECONDS || 900),
    maxPerUsername: Number(process.env.LOGIN_MAX_PER_USERNAME || 8),
    maxPerAddress: Number(process.env.LOGIN_MAX_PER_ADDRESS || 60),
  },

  /**
   * Where uploaded files live (Q21).
   *
   * Resolved to an absolute path **here, once**, because it is the boundary
   * every stored path is checked against: `project_attachment.storage_path` is
   * relative, and a download resolves it under this root and refuses anything
   * that escapes. A root computed per call could differ between the write and
   * the read, which is how containment checks stop containing.
   *
   * Outside the repository tree by default is tempting but wrong for a system
   * that is run from a checkout; `backend/uploads` is gitignored instead.
   */
  uploadRoot: path.resolve(__dirname, '..', process.env.UPLOAD_ROOT || 'uploads'),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024),

  icit: {
    authentication: process.env.ICIT_AUTHENTICATION || '',
    information: process.env.ICIT_INFORMATION || '',
    token: process.env.ICIT_TOKEN || '',
  },

  // Q17: kept, but only outside production and only when both halves are set.
  localAdmin: {
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
    get enabled() {
      return !isProduction && Boolean(this.username) && Boolean(this.password);
    },
  },
};

/** Any port on the loopback host, e.g. `http://localhost:3002`. */
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * May this browser origin call the API?
 *
 * Outside production the answer is "any loopback origin". A dev server whose
 * port is already taken silently moves to the next one — 3000 becomes 3002 —
 * and pinning the allowed origin to a port turns that ordinary event into a
 * blocked request that looks exactly like the API being down. In production
 * only the explicit `CORS_ORIGIN` list is honoured: loopback means nothing
 * there, and a wildcard would let any site spend a signed-in user's token.
 */
function isOriginAllowed(origin) {
  if (config.corsOrigins.includes(origin)) return true;
  return !config.isProduction && LOOPBACK_ORIGIN.test(origin);
}

/** Throws on anything that would otherwise fail silently or unsafely at runtime. */
function assertValid() {
  const problems = [];

  if (!config.jwt.secret) {
    problems.push('JWT_SECRET is not set — tokens cannot be signed. Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  } else if (config.jwt.secret.length < 32) {
    problems.push(`JWT_SECRET is ${config.jwt.secret.length} characters; use at least 32.`);
  }

  if (!['mock', 'icit'].includes(config.authProvider)) {
    problems.push(`AUTH_PROVIDER must be "mock" or "icit", got ${JSON.stringify(config.authProvider)}.`);
  }

  /**
   * The mock in production, and the one way it is allowed.
   *
   * This system is a demonstration and the mock is where it is meant to stop —
   * ICIT is not being integrated. The refusal below therefore had a perverse
   * effect: the only way to deploy the demo was to leave `NODE_ENV` unset,
   * which switches off *every* production check at once — the empty database
   * password, the plain-http origin, the local admin fallback, all of it — to
   * avoid the one that was in the way.
   *
   * So it becomes a deliberate, single-purpose opt-in instead, and it comes
   * with the condition that makes it survivable: a shared password. A published
   * fixture directory reachable by anyone who can type `fixture.admin` is not a
   * demo, it is an open Admin session.
   */
  if (config.authProvider === 'mock' && config.isProduction) {
    if (process.env.ALLOW_MOCK_AUTH !== '1') {
      problems.push(
        'AUTH_PROVIDER=mock in production — mock accepts any password for a published list of ' +
        'fixture usernames. If this is the demonstration deployment and that is intended, set ' +
        'ALLOW_MOCK_AUTH=1 together with MOCK_PASSWORD.'
      );
    } else if (config.mockPassword.length < 8) {
      problems.push(
        'ALLOW_MOCK_AUTH=1 requires MOCK_PASSWORD of at least 8 characters — without it every ' +
        'fixture account, `fixture.admin` included, is open to anyone who finds the URL.'
      );
    }
  }

  if (config.authProvider === 'icit') {
    for (const key of ['authentication', 'information', 'token']) {
      if (!config.icit[key]) problems.push(`AUTH_PROVIDER=icit but ICIT_${key.toUpperCase()} is not set.`);
    }
  }

  if (!Number.isInteger(config.fallbackAcademicYear) ||
      config.fallbackAcademicYear < 2400 || config.fallbackAcademicYear > 2700) {
    problems.push(`ACADEMIC_YEAR must be a 4-digit Buddhist-era year, got ${config.fallbackAcademicYear}.`);
  }

  if (!config.corsOrigins.length) {
    problems.push('CORS_ORIGIN is not set — no browser origin may call this API. In production it must be listed explicitly.');
  }
  if (config.corsOrigins.includes('*')) {
    problems.push('CORS_ORIGIN=* would let any site call this API with a user\'s token. List the origins instead.');
  }

  if (process.env.ADMIN_USERNAME && config.isProduction) {
    problems.push('ADMIN_USERNAME is set in production — the local admin fallback is non-production only (Q17).');
  }

  for (const [key, value] of Object.entries(config.loginThrottle)) {
    if (!Number.isInteger(value) || value < 1) {
      problems.push(`loginThrottle.${key} must be a positive integer, got ${JSON.stringify(value)}.`);
    }
  }

  /**
   * The rest applies to production only, and each item is a way a deployment
   * that works perfectly on the first day is already compromised.
   *
   * Development is left alone deliberately: XAMPP ships `root` with no password
   * and http on localhost, and refusing to start on those would make the checks
   * something people switch off rather than something they satisfy.
   */
  if (config.isProduction) {
    // The database holds every project, every budget line and the membership
    // table that decides who may do what. An empty password on it means the
    // access control above is a formality to anyone who reaches port 3306.
    if (!process.env.DB_PASS) {
      problems.push('DB_PASS is empty in production — the database would accept anyone who can reach it.');
    }
    if ((process.env.DB_USER || 'root') === 'root') {
      problems.push('DB_USER=root in production — give the API an account with rights on its own schema only.');
    }

    // A bearer token on a plain-http origin is readable by anything on the
    // path, and this token is the whole session.
    const insecure = config.corsOrigins.filter((origin) => origin.startsWith('http://'));
    if (insecure.length && process.env.ALLOW_INSECURE_ORIGINS !== '1') {
      problems.push(
        `CORS_ORIGIN names plain-http origin(s) in production: ${insecure.join(', ')} — ` +
        'tokens would travel in the clear. Use https, or set ALLOW_INSECURE_ORIGINS=1 if this ' +
        'is an isolated network and you mean it.'
      );
    }
  }

  if (problems.length) {
    throw new Error(`Configuration is not usable:\n  - ${problems.join('\n  - ')}`);
  }
}

module.exports = { config, assertValid, currentAcademicYear, isOriginAllowed };
