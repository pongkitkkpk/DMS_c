/**
 * Field validation for write paths.
 *
 * This file exists because of deviation 2. The old system had fourteen
 * `UPDATE … SET ?` sites (docs/business-rules.md, "Mass assignment"), the worst
 * of which let one request set `project_number`, `allow_budget` and `id_student`
 * on any project. Here a write can only touch fields that appear in an
 * allow-list, and every value is coerced to the column's type before it reaches
 * SQL.
 *
 * `pickFields` returns only the keys the caller actually sent, so PATCH means
 * "change these" rather than "blank everything else".
 */
const { HttpError } = require('./httpError');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `TEXT`'s capacity, in **bytes** — which is not the same thing as characters.
 *
 * Every explicit `max` below is a character count, because that is what
 * `VARCHAR(n)` counts: 255 means 255 characters however many bytes they take.
 * `TEXT` is the one that counts bytes, and Thai costs three of them per
 * character in `utf8mb4`. So a 22,000-character rationale is 66,000 bytes:
 * comfortably under a 65,535-*character* limit and over the column's real one.
 * MySQL then answers `ER_DATA_TOO_LONG` and the request became a **500** — the
 * exact shape of failure this file exists to turn into a named 400.
 *
 * Checked on every `text()`, not only the unbounded ones. For a `VARCHAR(255)`
 * column 255 characters can never exceed 1,020 bytes, so the test is inert
 * there; it costs one comparison and removes a class of 500 rather than one
 * instance of it.
 */
const TEXT_MAX_BYTES = 65535;

/**
 * Refuse the kinds of value that `String()` and `Number()` have a confident
 * answer for and no business receiving.
 *
 * `String({a:1})` is `'[object Object]'`, `String(['ก','ข'])` is `'ก,ข'` and
 * `Number([])` is `0` — so before this guard, `{"content":{"a":1}}` answered 200
 * and put the literal text `[object Object]` on a government form; a two-element
 * array became one row with a comma in it, silently turning two numbered boxes on
 * กนศ.04 into one; and `{"headcount":[]}` became a real attendance of zero. All
 * three were accepted, stored and printable (verified 2026-08-17).
 *
 * Strings and numbers are both allowed through: a phone number arriving as a JSON
 * number is a reasonable client, and every validator below narrows it further.
 * Everything else is a client sending the wrong kind of thing, which is worth a
 * message rather than a coercion.
 */
function scalar(value, label) {
  const type = typeof value;
  if (type === 'string' || type === 'number') return value;
  throw HttpError.badRequest(`${label}: ต้องเป็นข้อความหรือตัวเลข ไม่ใช่ ${Array.isArray(value) ? 'รายการ' : type}`);
}

const check = {
  /** @returns {function(*, string): (string|null)} */
  text({ max = 65535, required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุ`);
        return null;
      }
      const s = String(scalar(value, label)).trim();
      if (required && !s) throw HttpError.badRequest(`${label}: ต้องระบุ`);
      if (s.length > max) throw HttpError.badRequest(`${label}: ยาวเกิน ${max} ตัวอักษร`);
      // Bytes, separately, because the column's limit is in bytes and Thai is
      // three of them per character. Named as bytes in the message: telling
      // somebody they exceeded 65,535 characters when they typed 22,000 would
      // send them looking for a bug that is not there.
      const bytes = Buffer.byteLength(s, 'utf8');
      if (bytes > TEXT_MAX_BYTES) {
        throw HttpError.badRequest(
          `${label}: ข้อความยาวเกินที่ระบบเก็บได้ (${bytes} ไบต์ จากที่เก็บได้ ${TEXT_MAX_BYTES} ไบต์ — อักษรไทยนับ 3 ไบต์ต่อตัว)`
        );
      }
      return s || null;
    };
  },

  integer({ min = 0, max = 4294967295, required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุ`);
        return null;
      }
      // Digits, not "whatever `Number()` will read". `Number('0x10')` is 16 and
      // `Number('1e3')` is 1000, both of them integers by `Number.isInteger`,
      // so a headcount sent as `"0x10"` printed **16** on กนศ.06 — the same
      // shape as deviation 24, a confident answer to input nobody meant.
      // Decimal notation is still allowed and `12.0` still means twelve — a
      // number input can hand back exactly that. What is gone is the exotic
      // literal, which is where the wrong answers were.
      const s = String(scalar(value, label)).trim();
      const n = /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
      if (!Number.isInteger(n)) throw HttpError.badRequest(`${label}: ต้องเป็นจำนวนเต็ม`);
      if (n < min || n > max) throw HttpError.badRequest(`${label}: ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
      return n;
    };
  },

  /**
   * A fixed-2 decimal, returned as a **string** so it reaches SQL the way the
   * `DECIMAL(12,2)` column stores it.
   *
   * The old schema kept every money value in a text column and the migration
   * notes (Q37) list what that cost: `'-'`, `''` and `'ไม่มี'` all sitting where
   * a number belonged. A value that is not a number is named here rather than
   * coerced to 0, which is the whole point of that decision.
   *
   * More than two decimal places is an error, not a rounding opportunity: a
   * third digit means the caller is computing in units this system does not
   * have, and silently dropping it is how a total stops matching its lines.
   */
  decimal({ min = 0, max = 9999999999.99, required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุจำนวนเงิน`);
        return null;
      }
      const s = String(scalar(value, label)).trim().replace(/,/g, '');
      if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
        throw HttpError.badRequest(`${label}: ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง`);
      }
      const n = Number(s);
      if (n < min || n > max) {
        throw HttpError.badRequest(`${label}: ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
      }
      return n.toFixed(2);
    };
  },

  /**
   * `YYYY-MM-DD`, and a day that exists.
   *
   * The old data is full of `'0000-00-00'` (every row of `historyeditproject`),
   * which the pool's strict mode would now reject anyway — this rejects it
   * earlier, with a message that names the field.
   *
   * The shape test is not enough on its own: `2024-02-31` and `2024-06-31` are
   * well-formed and `Date.parse` accepts both, rolling them forward to the 2nd
   * of March and the 1st of July. MySQL does not roll anything forward — strict
   * mode answers `ER_TRUNCATED_WRONG_VALUE` and the request became a **500**
   * (verified 2026-08-18 on `PATCH /api/projects/1`). Round-tripping through
   * `Date.UTC` asks the calendar instead of the parser, so `2023-02-29` is
   * refused and `2024-02-29` is not.
   *
   * The first 10 characters are read, not the whole string — but anything past
   * them has to be a `T` (a `Date.toISOString()` value's time component,
   * `2024-01-01T10:30:00.000Z`) or nothing. This started as an unconditional
   * `.slice(0, 10)`, which is the same mistake as `scalar()` exists to catch
   * one level up: `"2024-01-01/2024-02-01"` and `"2024-01-01abcdefgh"` both
   * quietly became `2024-01-01`, a confident answer to a value that was
   * probably not meant as a plain date. No caller in this codebase sends a
   * date longer than 10 characters — the browser's own `<input type="date">`
   * never does — so the leniency was paying for a convenience nothing used,
   * at the cost of exactly the silent-coercion class of bug this file exists
   * to refuse.
   */
  date({ required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุวันที่`);
        return null;
      }
      const full = String(scalar(value, label));
      const s = full.slice(0, 10);
      if (full.length > 10 && full[10] !== 'T') {
        throw HttpError.badRequest(`${label}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)`);
      }
      if (!DATE_PATTERN.test(s)) {
        throw HttpError.badRequest(`${label}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)`);
      }
      const [year, month, day] = s.split('-').map(Number);
      const asDate = new Date(Date.UTC(year, month - 1, day));
      if (asDate.getUTCFullYear() !== year ||
          asDate.getUTCMonth() + 1 !== month ||
          asDate.getUTCDate() !== day) {
        throw HttpError.badRequest(`${label}: ไม่มีวันที่นี้ในปฏิทิน (${s})`);
      }
      return s;
    };
  },

  boolean() {
    return (value, label) => {
      if (value === true || value === 1 || value === '1' || value === 'true') return 1;
      if (value === false || value === 0 || value === '0' || value === 'false') return 0;
      if (value === null || value === undefined || value === '') return 0;
      throw HttpError.badRequest(`${label}: ต้องเป็น true หรือ false`);
    };
  },

  oneOf(values, { required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุ`);
        return null;
      }
      const s = String(scalar(value, label)).toUpperCase();
      if (!values.includes(s)) {
        throw HttpError.badRequest(`${label}: ต้องเป็นค่าใดค่าหนึ่งใน ${values.join(', ')}`);
      }
      return s;
    };
  },
};

/**
 * Validate `body` against `allowList`, keeping only the keys present in it.
 *
 * @param {object} body      the request body
 * @param {object} allowList `{ apiField: [columnName, validator] }`
 * @param {{requireAll?: boolean}} [options] `true` for create, where absent
 *        required fields must fail rather than be skipped
 * @returns {object} `{ column: value }`, ready to name in an INSERT/UPDATE
 */
function pickFields(body, allowList, { requireAll = false } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('รูปแบบข้อมูลไม่ถูกต้อง');
  }

  const out = {};
  for (const [field, [column, validator]] of Object.entries(allowList)) {
    const sent = Object.prototype.hasOwnProperty.call(body, field);
    if (!sent && !requireAll) continue;
    out[column] = validator(sent ? body[field] : undefined, field);
  }

  const unknown = Object.keys(body).filter((k) => !(k in allowList));
  if (unknown.length) {
    // Loudly, rather than ignoring them: a client sending `project_number`
    // should learn that it is not writable, not silently succeed at nothing.
    throw HttpError.badRequest(`ไม่รองรับฟิลด์: ${unknown.join(', ')}`);
  }

  return out;
}

/** Body must be `{ items: [...] }` — a bare array is rejected, so adding a sibling key later is not a breaking change. */
function pickList(body, field = 'items', { max = 200 } = {}) {
  const items = body && body[field];
  if (!Array.isArray(items)) throw HttpError.badRequest(`ต้องส่ง ${field} เป็นรายการ`);
  if (items.length > max) throw HttpError.badRequest(`${field}: เกิน ${max} รายการ`);
  return items;
}

module.exports = { check, pickFields, pickList };
