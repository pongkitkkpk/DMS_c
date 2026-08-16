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
const academicYear = require('./src/services/academicYearService');

try {
  assertValid();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

/**
 * Say plainly, once, at startup whether the database is reachable.
 *
 * A refused connection surfaces otherwise as an aggregate ECONNREFUSED for
 * ::1 and 127.0.0.1 with a Node stack, which names the port and nothing a
 * person can act on. The usual cause here is simply that MariaDB is not
 * running. The server still starts — `GET /api/health` reports the database
 * separately, and a database that comes up a moment later should not require
 * restarting the API.
 */
async function reportDatabase() {
  try {
    await pool.query('SELECT 1');
    console.log(`  database        ${process.env.DB_NAME || 'dms'} ที่ ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306} — เชื่อมต่อได้`);
  } catch (err) {
    console.error(`\n  ⚠ ต่อฐานข้อมูลไม่ได้ (${err.code}) — ทุก endpoint ที่อ่านข้อมูลจะล้มเหลว`);
    if (err.code === 'ECONNREFUSED') {
      console.error('    ไม่มีอะไรฟังอยู่ที่พอร์ต 3306 — ส่วนใหญ่แปลว่า MariaDB ยังไม่ได้เปิด');
      console.error('    เปิด MySQL จาก XAMPP control panel แล้วรัน: npm run db:reset');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.error(`    ยังไม่มีฐานข้อมูล ${process.env.DB_NAME || 'dms'} — สร้างแล้วรัน: npm run db:reset`);
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('    DB_USER / DB_PASS ใน .env ไม่ถูกต้อง');
    }
    console.error('');
  }
}

// The academic year decides what every user may do, so it is loaded *before*
// the port is bound and not in `listen`'s callback: that callback runs after
// the socket is already accepting, which leaves a window in which a request
// could be served against a stale year and resolve the wrong memberships.
async function start() {
const yearSource = await academicYear.load();
// The database was not up. Serving on a guessed year is what put every account
// on `role: null` the one time this happened, so the API keeps asking rather
// than settling for the guess and waiting to be restarted.
academicYear.retryUntilResolved();

const server = createApp().listen(config.port, () => {
  console.log(`DMS API listening on http://localhost:${config.port}`);
  console.log(`  auth provider   ${config.authProvider}${config.authProvider === 'mock' ? '  (any password is accepted)' : ''}`);
  if (yearSource.source === 'unresolved') {
    console.log(`  academic year   ${yearSource.academicYear}  ⚠ เดาจากวันที่ — ยังอ่านจากฐานข้อมูลไม่ได้`);
    console.log('                  ทุกบัญชีจะยังไม่มีสิทธิ์จนกว่าจะอ่านค่าจริงได้ (ระบบจะลองใหม่เอง)');
  } else {
    console.log(`  academic year   ${yearSource.academicYear}  (${yearSource.source})`);
  }
  console.log(`  cors origins    ${config.corsOrigins.join(', ')}${config.isProduction ? '' : '  (+ any http://localhost:* in development)'}`);
  if (config.localAdmin.enabled) {
    console.log(`  local admin     ${config.localAdmin.username}  (non-production fallback)`);
  }
  reportDatabase();
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
}

start().catch((err) => {
  console.error('failed to start:', err.message);
  process.exit(1);
});
