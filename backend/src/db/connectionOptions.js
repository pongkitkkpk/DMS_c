const fs = require('fs');

/**
 * The connection fields every `mysql.createConnection`/`createPool` call in
 * this codebase needs, read from `process.env` in one place.
 *
 * Existed as four separate copies before this — `pool.js`, `migrate.js`,
 * `seed.js` and `scripts/grant-admin.js` each built the same host/port/user
 * object by hand. Harmless while every one of them talked to XAMPP with no
 * TLS, but deploying against a managed host (Aiven, PlanetScale, RDS) means
 * every one of those four needs the same TLS option added, and four copies is
 * four chances to add it to three of them.
 *
 * TLS is opt-in, in the shape a managed provider actually hands out: a CA
 * certificate file. `DB_SSL_CA_PATH` points at it — a path rather than the PEM
 * text itself, because that is what a platform's "secret file" feature
 * mounts, and pasting a multi-line certificate into a single-line environment
 * variable is where it usually goes wrong. `DB_SSL=1` alone (no CA path) is
 * the fallback for a host that terminates TLS without a certificate this
 * process is meant to verify — accepted, not the default, and never the only
 * option offered.
 */
function dbConnectionOptions() {
  const ssl = process.env.DB_SSL_CA_PATH
    ? { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH) }
    : process.env.DB_SSL === '1'
      ? { rejectUnauthorized: false }
      : undefined;

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'dms',
    charset: 'utf8mb4_unicode_ci',
    ...(ssl ? { ssl } : {}),
  };
}

module.exports = { dbConnectionOptions };
