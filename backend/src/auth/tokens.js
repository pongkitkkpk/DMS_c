/**
 * JWT issue and verify.
 *
 * The payload carries an identity and nothing else: `sub` (person id) and `uid`
 * (ICIT username, for logs). **No role, no club, no jurisdiction.** The old
 * system signed `{ username, role }` and then never checked the role
 * (docs/business-rules.md, "Authorization"); worse, a signed role would still be
 * stale the moment a membership changed. Scope is resolved from `membership` on
 * every request instead — see `../middleware/requireAuth.js`.
 */
const jwt = require('jsonwebtoken');
const { config } = require('../config');

function signToken(person) {
  return jwt.sign(
    { uid: person.id_student },
    config.jwt.secret,
    { subject: String(person.id), expiresIn: config.jwt.expiresIn }
  );
}

/**
 * @returns {{personId: number, uid: string}|null} `null` for any token that is
 *   missing, malformed, expired or not signed by us — the caller does not get to
 *   tell those apart, and does not need to.
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const personId = Number(decoded.sub);
    if (!Number.isInteger(personId) || personId <= 0) return null;
    return { personId, uid: decoded.uid };
  } catch {
    return null;
  }
}

/** `Authorization: Bearer <token>`, which is what the old frontend sends. */
function bearerFrom(req) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  return scheme && scheme.toLowerCase() === 'bearer' && value ? value : null;
}

module.exports = { signToken, verifyToken, bearerFrom };
