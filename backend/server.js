#!/usr/bin/env node
/**
 * Entry point.
 *
 *   npm run dev     nodemon
 *   npm start       node server.js
 *
 * Configuration is validated before the port is bound, so a missing JWT_SECRET
 * or a production build still pointing at the mock provider fails loudly at
 * startup instead of quietly issuing unusable tokens.
 */
const { config, assertValid } = require('./src/config');
const { createApp } = require('./src/app');
const { pool } = require('./src/db/pool');

try {
  assertValid();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const server = createApp().listen(config.port, () => {
  console.log(`DMS API listening on http://localhost:${config.port}`);
  console.log(`  auth provider   ${config.authProvider}${config.authProvider === 'mock' ? '  (any password is accepted)' : ''}`);
  console.log(`  academic year   ${config.academicYear}`);
  console.log(`  cors origin     ${config.corsOrigin}`);
  if (config.localAdmin.enabled) {
    console.log(`  local admin     ${config.localAdmin.username}  (non-production fallback)`);
  }
});

// Finish in-flight requests and close the pool rather than dropping connections
// mid-transaction on a nodemon restart.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} — shutting down`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  });
}
