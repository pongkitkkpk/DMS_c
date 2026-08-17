/**
 * Login and the current session.
 *
 *   POST /api/auth/login   { username, password } -> { token, ...me }
 *   GET  /api/me                                  -> the caller's identity + role
 *
 * The old endpoint was `POST /api/authen` (`server.js:85`), which signed
 * `{ username, role: response.message.position || "user" }` — a role read from
 * the identity provider, which never returns one, so every real account was
 * signed as the literal `"user"`. Here the provider settles identity and the
 * database settles role.
 */
const express = require('express');

const { config } = require('../config');
const academicYear = require('../services/academicYearService');
const { getAuthProvider } = require('../auth/providers');
const { normalizeIcitPayload } = require('../auth/identity');
const { signToken } = require('../auth/tokens');
const { HttpError } = require('../lib/httpError');
const { requireAuth } = require('../middleware/requireAuth');
const { addressOf, assertWithinBudget } = require('../services/loginThrottle');
const {
  upsertPerson,
  findPersonByIdStudent,
  loadMemberships,
  recordLoginAttempt,
} = require('../services/identityService');

const router = express.Router();

/** The session payload. One shape, returned by both login and `GET /me`. */
function sessionBody(person, memberships) {
  return {
    person: {
      id: person.id,
      idStudent: person.id_student,
      prefix: person.prefix,
      fullNameTh: person.full_name_th,
      email: person.email,
      accountType: person.account_type,   // ICIT identity type — NOT a role
      levelDesc: person.level_desc,
      stuStatusDesc: person.stu_status_desc,
    },
    academicYear: academicYear.current(),
    // The application role, resolved from `membership`. `null` means the person
    // is known to ICIT but enrolled in nothing this year.
    role: memberships.length ? memberships[0].role : null,
    membership: memberships[0] || null,
    // A4 is open (docs/DECISIONS.md): one person may hold several memberships.
    // The list is returned so the client never has to guess whether it is
    // seeing all of them.
    memberships,
  };
}

/**
 * Q17's local admin fallback: identity only, and still no role of its own.
 * Whoever `ADMIN_USERNAME` names must hold a `membership` like anyone else, so
 * the backdoor can never mint privileges that are not in the database.
 * `config.assertValid()` refuses to start if it is configured in production.
 */
function localAdminIdentity(username, password) {
  const { localAdmin } = config;
  if (!localAdmin.enabled) return null;
  if (username !== localAdmin.username || password !== localAdmin.password) return null;

  return {
    idStudent: localAdmin.username,
    prefix: null,
    fullNameTh: localAdmin.username,
    email: null,
    phone: null,
    accountType: 'personel',
    levelDesc: null,
    stuStatusDesc: null,
  };
}

router.post('/auth/login', async (req, res, next) => {
  const { username, password } = req.body || {};
  const remoteIp = addressOf(req);

  try {
    if (!username || !password) {
      throw HttpError.badRequest('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    }

    // Before anything is checked, and before the identity provider is called at
    // all: a spent budget must not cost ICIT a request either. A missing field
    // above is not charged — it is a broken client, not a guess.
    await assertWithinBudget(username, remoteIp);

    let identity = localAdminIdentity(username, password);

    // The fallback rejecting a wrong password is a failed guess like any other,
    // and it names an account that exists. Left unrecorded it would be the one
    // credential in the system that could be tried without limit.
    if (!identity && config.localAdmin.enabled && username === config.localAdmin.username) {
      await recordLoginAttempt(username, false, remoteIp);
      throw HttpError.unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    if (!identity) {
      const provider = getAuthProvider();
      let payload;
      try {
        payload = await provider.authenticate(String(username), String(password));
      } catch (err) {
        // The provider failed, which is not the same as the credentials being
        // wrong. Say so, rather than telling a student their password is bad.
        console.error(`auth provider "${provider.name}" failed:`, err.message);
        throw new HttpError(502, 'ระบบยืนยันตัวตนไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง');
      }

      if (!payload) {
        await recordLoginAttempt(username, false, remoteIp);
        throw HttpError.unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }

      identity = normalizeIcitPayload(payload);
    }

    // Identity fields are refreshed from the provider on every login; a name or
    // an email that changed upstream should not need an admin to retype it.
    const person = (await upsertPerson(identity)) || (await findPersonByIdStudent(identity.idStudent));
    if (!person) throw new Error(`person row missing after upsert: ${identity.idStudent}`);

    const memberships = await loadMemberships(person.id, academicYear.current());
    await recordLoginAttempt(person.id_student, true, remoteIp);

    res.json({ token: signToken(person), ...sessionBody(person, memberships) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(sessionBody(req.actor.person, req.actor.memberships));
});

module.exports = router;
