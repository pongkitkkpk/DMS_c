/**
 * Guessing limits on `POST /api/auth/login`.
 *
 * This is the only endpoint in the system reachable without a token, and until
 * now it had no cost: `login_attempt` recorded every failure since migration
 * 001 and nothing ever read the table, so an attacker could try a password list
 * as fast as the network allowed and the only trace was a row nobody looked at.
 * A recorded attack is not a prevented one.
 *
 * Two budgets, because there are two attacks:
 *
 * - **Per username** — guessing one person's password. Small budget: a human
 *   who has genuinely forgotten theirs does not need forty tries.
 * - **Per source address** — *spraying*, one attempt each against many
 *   usernames. This trips no per-username counter, and the usernames here are
 *   ICIT accounts, which are guessable by construction. Bigger budget, because
 *   a university NAT can put a whole building behind one address and a shared
 *   budget that is too tight locks out people who did nothing.
 *
 * Both budgets are sliding windows over the `login_attempt` rows, not counters
 * in memory: they survive a restart, which a `Map` does not, and restarting the
 * API is not something an attacker should be able to use as a reset button.
 *
 * The username budget clears on a successful login. The address budget does
 * not — one person succeeding behind a shared address says nothing about the
 * attempts around it.
 *
 * ## What this does not do
 *
 * It does not lock an account. A lockout that outlives its window is a denial
 * of service against the named user: anyone who knows an ICIT username could
 * keep its owner out indefinitely, which trades one attack for a cheaper one.
 * Every refusal here expires on its own.
 */
const { config } = require('../config');
const { pool } = require('../db/pool');
const { HttpError } = require('../lib/httpError');

/**
 * A failure older than the window has expired and no longer counts. The count
 * only ever looks at failures — a success does not consume anyone's budget.
 */
const { windowSeconds, maxPerUsername, maxPerAddress } = config.loginThrottle;

/**
 * Seconds still to wait, from the oldest failure that is still inside the
 * window. Computed in SQL rather than in JS: `DATETIME` columns come back as
 * strings with no timezone (see `db/pool.js`), and re-parsing them here to
 * subtract from a JS clock is exactly the offset bug that put every timestamp
 * in this system seven hours out.
 */
const COUNT_SQL = `
  SELECT COUNT(*) AS failures,
         GREATEST(TIMESTAMPDIFF(SECOND, NOW(), MIN(attempted_at) + INTERVAL ? SECOND), 1)
           AS retry_after`;

/** `::ffff:127.0.0.1` is an IPv4 address wearing a v6 hat; store it as itself. */
function normalizeAddress(address) {
  if (!address) return null;
  const value = String(address);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  return (mapped ? mapped[1] : value).slice(0, 45);
}

/**
 * The client's address, or `null` when there is no honest answer.
 *
 * `req.ip` is the socket address unless `trust proxy` is configured, in which
 * case Express resolves it from `X-Forwarded-For` — which is why `TRUST_PROXY`
 * exists and why it defaults to off. Trusting that header without a proxy in
 * front lets any caller set their own address and mint a fresh budget per
 * request, turning this whole file into decoration.
 */
function addressOf(req) {
  return normalizeAddress(req.ip || (req.socket && req.socket.remoteAddress));
}

async function countFailures(where, params) {
  const [[row]] = await pool.query(`${COUNT_SQL} FROM login_attempt WHERE ${where}`,
    [windowSeconds, ...params]);
  return { failures: Number(row.failures), retryAfter: Number(row.retry_after) };
}

/** Failures for one username since its last success, inside the window. */
function usernameFailures(username) {
  return countFailures(
    `id_student = ?
       AND is_success = 0
       AND attempted_at > NOW() - INTERVAL ? SECOND
       AND attempted_at > COALESCE(
             (SELECT MAX(attempted_at) FROM login_attempt
               WHERE id_student = ? AND is_success = 1),
             '1000-01-01 00:00:00')`,
    [username, windowSeconds, username]
  );
}

/** Failures from one address inside the window, whatever username they named. */
function addressFailures(address) {
  return countFailures(
    'remote_ip = ? AND is_success = 0 AND attempted_at > NOW() - INTERVAL ? SECOND',
    [address, windowSeconds]
  );
}

function tooMany(retryAfter) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return new HttpError(429, `พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ ${minutes} นาทีแล้วลองใหม่`,
    { retryAfter });
}

/**
 * Refuse the attempt before any credential is checked, if either budget is spent.
 *
 * Called *before* the provider, so a spent budget costs the identity provider
 * nothing — an SSO being hammered on this system's behalf is its own outage.
 *
 * A database that cannot answer fails **open**. The alternative is that a
 * database blip locks every account in the system out at once, which is a worse
 * failure than the one this file exists to prevent; and login cannot succeed
 * without the database anyway, so nothing is granted by letting the request
 * through.
 *
 * @throws {HttpError} 429, carrying `retryAfter` in seconds.
 */
async function assertWithinBudget(username, address) {
  try {
    const byUsername = await usernameFailures(String(username).slice(0, 100));
    if (byUsername.failures >= maxPerUsername) throw tooMany(byUsername.retryAfter);

    if (address) {
      const byAddress = await addressFailures(address);
      if (byAddress.failures >= maxPerAddress) throw tooMany(byAddress.retryAfter);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('login throttle could not read login_attempt:', err.message);
  }
}

module.exports = { addressOf, assertWithinBudget, normalizeAddress };
