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

const { config, isOriginAllowed } = require('./config');
const academicYear = require('./services/academicYearService');
const { pool, isTransient } = require('./db/pool');
const { HttpError } = require('./lib/httpError');
const attachmentRoutes = require('./routes/attachments');
const authRoutes = require('./routes/auth');
const budgetRoutes = require('./routes/budget');
const documentRoutes = require('./routes/documents');
const historyRoutes = require('./routes/history');
const membershipRoutes = require('./routes/memberships');
const projectRoutes = require('./routes/projects');
const referenceRoutes = require('./routes/reference');

/**
 * Response headers that hold whatever the handler forgot.
 *
 * This API answers JSON and one stream of bytes, so the list is short and each
 * line earns its place rather than being a framework's default set:
 *
 * - `X-Powered-By` is removed. It tells an attacker which server to look up
 *   advisories for and tells a legitimate client nothing.
 * - `nosniff` stops a browser deciding for itself that a JSON error body is
 *   HTML. The attachment download sets this too; here it covers everything.
 * - `DENY` and a `frame-ancestors` of `'none'` keep this API out of an iframe
 *   on someone else's page.
 * - The CSP is the one that suits a JSON API: **nothing may load**. It is not
 *   the frontend's policy — that is served by whatever hosts the built React
 *   app — it is a floor under any response that somehow reaches a browser as a
 *   document, including the 404 and 500 bodies.
 * - `no-referrer` keeps project ids out of the `Referer` of anything a user
 *   navigates to next.
 * - `Cross-Origin-Resource-Policy: same-site` stops another origin embedding
 *   these responses as a subresource, which CORS alone does not prevent.
 *
 * HSTS is deliberately absent: it belongs on the TLS terminator, and an API
 * that may legitimately be reached over http inside a private network should
 * not be the thing that pins a browser to https for a whole domain.
 */
function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}

function createApp() {
  const app = express();

  // Off by default, and never `true`. What this decides is whether `req.ip` is
  // the socket's address or a header the client can write — and `req.ip` is
  // what the login throttle charges. See `config.trustProxy`.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(securityHeaders);

  // A request with no Origin is not a browser (curl, a health probe, a
  // server-to-server call) and CORS has nothing to say about it. An unlisted
  // origin is refused by omitting the header rather than by throwing, so the
  // browser reports a CORS failure instead of the API reporting a 500.
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || isOriginAllowed(origin)),
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  // Same cap as the JSON parser. Without an explicit limit the two body parsers
  // disagree about how large a request may be, and the smaller number is the
  // one anybody reasons about.
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // A reachable database is not on its own a healthy system: if the API started
  // before MariaDB, the academic year is still a guess until the retry lands,
  // and every membership resolves against it. Both facts are reported.
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      const resolved = academicYear.isResolved();
      res.status(resolved ? 200 : 503).json({
        status: resolved ? 'ok' : 'degraded',
        database: 'ok',
        academicYear: academicYear.current(),
        academicYearResolved: resolved,
      });
    } catch (err) {
      res.status(503).json({ status: 'degraded', database: err.code || 'error' });
    }
  });

  app.use('/api', authRoutes);
  app.use('/api', referenceRoutes);
  app.use('/api', projectRoutes);
  app.use('/api', budgetRoutes);
  app.use('/api', documentRoutes);
  app.use('/api', historyRoutes);
  app.use('/api', membershipRoutes);
  // Note what is NOT here: any `express.static` over the upload directory. The
  // old system had one, which is why a guessable filename returned somebody
  // else's document (Q21). Attachments leave only through authorized handlers.
  app.use('/api', attachmentRoutes);

  app.use((req, res, next) => next(HttpError.notFound(`ไม่พบเส้นทาง ${req.method} ${req.path}`)));

  // Single error handler: every failure answers exactly once, and only
  // HttpError text reaches the client. Anything else is logged in full and
  // returned as a bare 500 so driver messages and SQL never leak.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) {
      // A 429 that does not say how long to wait invites the caller to retry
      // immediately, which is the behaviour the 429 exists to stop.
      if (err.status === 429 && err.detail && err.detail.retryAfter) {
        res.setHeader('Retry-After', String(err.detail.retryAfter));
      }
      return res.status(err.status).json({ error: err.message, ...(err.detail || {}) });
    }

    // Contention that outlived its retries is the caller's to retry, not a
    // server fault: 409, with the database's own advice.
    if (isTransient(err)) {
      console.warn(`${req.method} ${req.originalUrl}: ${err.code} after retries`);
      return res.status(409).json({ error: 'ระบบกำลังมีการใช้งานพร้อมกัน กรุณาลองใหม่อีกครั้ง' });
    }

    console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  });

  return app;
}

module.exports = { createApp };
