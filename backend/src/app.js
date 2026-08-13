/**
 * The Express application.
 *
 * Kept separate from `server.js` so the app can be built and exercised without
 * binding a port.
 *
 * Two shapes from the old server are not reproduced:
 *
 * - **Routers are mounted once.** The old `server.js:23-25` mounted every router
 *   a second time at the root, exposing every `GET` at an unprefixed path where
 *   writes would silently fail for want of a parsed body.
 * - **No route is defined outside a router.** The old inline group
 *   (`server.js:158-376`) held the phase machine and the money ledger and had no
 *   authentication at all. See docs/business-rules.md, "Routes".
 */
const express = require('express');
const cors = require('cors');

const { config } = require('./config');
const { pool } = require('./db/pool');
const { HttpError } = require('./lib/httpError');
const authRoutes = require('./routes/auth');

function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'ok', academicYear: config.academicYear });
    } catch (err) {
      res.status(503).json({ status: 'degraded', database: err.code || 'error' });
    }
  });

  app.use('/api', authRoutes);

  app.use((req, res, next) => next(HttpError.notFound(`ไม่พบเส้นทาง ${req.method} ${req.path}`)));

  // Single error handler: every failure answers exactly once, and only
  // HttpError text reaches the client. Anything else is logged in full and
  // returned as a bare 500 so driver messages and SQL never leak.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.detail || {}) });
    }
    console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  });

  return app;
}

module.exports = { createApp };
