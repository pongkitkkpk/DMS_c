/**
 * Which academic year the system is in, and the only safe way to change it.
 *
 * This is the most consequential single value in the system: `requireAuth`
 * resolves every membership against it, so it decides what every user may do,
 * and the money rules and both government forms are scoped by it. It used to
 * live in `.env`.
 *
 * **Three sources, in order, each with a reason.**
 *
 * 1. `ACADEMIC_YEAR` in the environment, if set. Wins over everything and makes
 *    the setting read-only. This is the rehearsal and break-glass path — it is
 *    how a throwaway server can be pointed at another year without touching
 *    shared state (`DMS_REBUILD_STRATEGY.md`, "Year-rollover rehearsal").
 * 2. The `academic_year_setting` row. The normal case: an Admin sets it from a
 *    screen, no shell and no restart.
 * 3. The date, via `config.currentAcademicYear`. Only reached before the row
 *    exists — a fresh database that has not been seeded. The June boundary is
 *    still an unconfirmed guess, which is precisely why it is the last resort
 *    rather than the mechanism.
 *
 * **The value is cached in memory** and read synchronously by everything else,
 * because it is read on every single request and changes about once a year.
 * `load()` fills the cache at startup; `setAcademicYear` updates it in the same
 * breath as the database. A second API process would not see another's change
 * until restarted — acceptable here (one process, one machine) and written down
 * rather than discovered.
 */
const { pool, transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { config } = require('../config');

/** Set by `load()`. Never read directly — `current()` is the accessor. */
let cached = null;

/** True when the environment is forcing the year, which makes it unsettable. */
const isOverridden = () => Boolean(process.env.ACADEMIC_YEAR);

/**
 * Read the stored year into the cache. Called once, at startup, before the port
 * is bound — a request served with the wrong year would resolve the wrong
 * memberships, so there is no "load it lazily on first use".
 */
async function load() {
  if (isOverridden()) {
    cached = Number(process.env.ACADEMIC_YEAR);
    return { academicYear: cached, source: 'env' };
  }
  try {
    const [[row]] = await pool.query(
      'SELECT academic_year FROM academic_year_setting WHERE id = 1'
    );
    if (row) {
      cached = Number(row.academic_year);
      return { academicYear: cached, source: 'database' };
    }
  } catch (err) {
    // A database that is not up yet must not stop the API from starting —
    // `server.js` reports that separately and the year falls back to the date.
    console.error('academic year: could not be read from the database:', err.message);
  }
  cached = Number(config.fallbackAcademicYear);
  return { academicYear: cached, source: 'derived from the date' };
}

/** The year everything else asks for. Synchronous on purpose — see the header. */
function current() {
  return cached === null ? Number(config.fallbackAcademicYear) : cached;
}

/**
 * Move the system into another academic year.
 *
 * The guard is the reason this exists rather than an `.env` edit. **A year with
 * no `ADMIN` membership cannot be entered**, because on arrival nobody could
 * grant one: every account would resolve to `role: null`, and granting a role
 * requires an Admin. That single condition is what makes the lockout
 * structurally impossible rather than merely documented.
 *
 * Everything else about readiness — allocations, student heads — is a warning
 * and not a refusal. A year can legitimately open with clubs still unfunded;
 * it cannot legitimately open with nobody able to fund them.
 */
async function setAcademicYear(actor, body) {
  const role = actor.membership ? actor.membership.role : null;
  if (role !== 'ADMIN') {
    throw HttpError.forbidden('เปลี่ยนปีการศึกษาได้เฉพาะผู้ดูแลระบบ');
  }
  if (isOverridden()) {
    throw HttpError.badRequest(
      'ปีการศึกษาถูกกำหนดไว้ด้วย ACADEMIC_YEAR ใน environment — เปลี่ยนผ่านหน้าจอไม่ได้'
    );
  }

  const academicYear = check.integer({ min: 2400, max: 2700, required: true })(
    body && body.academicYear, 'academicYear'
  );
  if (academicYear === current()) {
    throw HttpError.badRequest(`ระบบอยู่ที่ปีการศึกษา ${academicYear} อยู่แล้ว`);
  }

  return transaction(async (conn) => {
    const [[{ admins }]] = await conn.query(
      `SELECT COUNT(*) AS admins FROM membership
        WHERE role = 'ADMIN' AND academic_year = ?`,
      [academicYear]
    );
    if (admins === 0) {
      throw HttpError.badRequest(
        `ยังไม่มีผู้ดูแลระบบของปี ${academicYear} — ถ้าเปลี่ยนไปตอนนี้จะไม่มีใครกำหนดสิทธิ์ให้ใครได้อีก ` +
        `กรุณากำหนดสิทธิ์ผู้ดูแลระบบของปี ${academicYear} ก่อน`
      );
    }

    await conn.query(
      `INSERT INTO academic_year_setting (id, academic_year, changed_by)
            VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE academic_year = VALUES(academic_year),
                               changed_by    = VALUES(changed_by)`,
      [academicYear, actor.person.id]
    );

    const from = current();
    cached = academicYear;
    // The one action that changes what every user of the system may do. It gets
    // a line in the server log whether or not anyone is reading it today.
    console.info(
      `academic year changed: ${from} -> ${academicYear} by person ${actor.person.id} (${actor.person.full_name_th})`
    );

    return { academicYear, previousAcademicYear: from };
  });
}

/** What the settings screen needs: the value, where it came from, who set it. */
async function describe(actor) {
  const role = actor.membership ? actor.membership.role : null;
  const [[row]] = await pool.query(
    `SELECT s.academic_year, s.changed_at, p.full_name_th AS changed_by_name
       FROM academic_year_setting s
       LEFT JOIN person p ON p.id = s.changed_by
      WHERE s.id = 1`
  );
  // Everyone may know which year they are in — it is on every screen already,
  // and in `/me`. Who last moved it, and when, is operational detail that only
  // the people who could move it have any use for.
  const isOfficer = role === 'ADMIN' || role === 'STUACT';

  return {
    academicYear: current(),
    // An officer looking at a year they cannot change should be told why, not
    // left to wonder where the button went.
    settable: role === 'ADMIN' && !isOverridden(),
    overriddenByEnvironment: isOverridden(),
    changedAt: isOfficer && row ? row.changed_at : null,
    changedByName: isOfficer && row ? row.changed_by_name : null,
  };
}

module.exports = { load, current, setAcademicYear, describe, isOverridden };
