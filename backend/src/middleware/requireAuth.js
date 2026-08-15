/**
 * Authentication + scope resolution for every protected route.
 *
 * The old `verifyToken` (`middleware/verifyToken.js:3-24`) verified the
 * signature, assigned `req.user`, and that was the end of it — `req.user` was
 * never read to make a decision anywhere in the codebase, so any valid token
 * granted every capability (docs/business-rules.md, "Rule as implemented: there
 * is none").
 *
 * This one resolves the caller's memberships from the database on every request
 * and hangs them on `req.actor`. Routes decide from `req.actor`, never from a
 * path parameter or a request body — deviation 1 in docs/DECISIONS.md.
 */
const { verifyToken, bearerFrom } = require('../auth/tokens');
const academicYear = require('../services/academicYearService');
const { HttpError } = require('../lib/httpError');
const { findPersonById, loadMemberships } = require('../services/identityService');

async function requireAuth(req, res, next) {
  try {
    const claims = verifyToken(bearerFrom(req));
    if (!claims) throw HttpError.unauthorized('กรุณาเข้าสู่ระบบใหม่');

    // The token proves who authenticated, not that they still exist: a person
    // deleted mid-session must stop working immediately.
    const person = await findPersonById(claims.personId);
    if (!person) throw HttpError.unauthorized('ไม่พบบัญชีผู้ใช้');

    const memberships = await loadMemberships(person.id, academicYear.current());

    req.actor = {
      person,
      academicYear: academicYear.current(),
      memberships,
      // Most privileged membership of the year, or null. A person with no
      // membership is authenticated and authorized for nothing.
      membership: memberships[0] || null,
      role: memberships.length ? memberships[0].role : null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
