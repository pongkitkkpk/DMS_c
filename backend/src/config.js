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
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  academicYear: Number(process.env.ACADEMIC_YEAR || currentAcademicYear()),

  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  },

  authProvider: (process.env.AUTH_PROVIDER || 'mock').toLowerCase(),

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

  if (config.authProvider === 'mock' && config.isProduction) {
    problems.push('AUTH_PROVIDER=mock in production — mock accepts any password.');
  }

  if (config.authProvider === 'icit') {
    for (const key of ['authentication', 'information', 'token']) {
      if (!config.icit[key]) problems.push(`AUTH_PROVIDER=icit but ICIT_${key.toUpperCase()} is not set.`);
    }
  }

  if (!Number.isInteger(config.academicYear) || config.academicYear < 2400 || config.academicYear > 2700) {
    problems.push(`ACADEMIC_YEAR must be a 4-digit Buddhist-era year, got ${config.academicYear}.`);
  }

  if (process.env.ADMIN_USERNAME && config.isProduction) {
    problems.push('ADMIN_USERNAME is set in production — the local admin fallback is non-production only (Q17).');
  }

  if (problems.length) {
    throw new Error(`Configuration is not usable:\n  - ${problems.join('\n  - ')}`);
  }
}

module.exports = { config, assertValid, currentAcademicYear };
