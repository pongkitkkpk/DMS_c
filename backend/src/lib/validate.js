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

const check = {
  /** @returns {function(*, string): (string|null)} */
  text({ max = 65535, required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุ`);
        return null;
      }
      const s = String(value).trim();
      if (required && !s) throw HttpError.badRequest(`${label}: ต้องระบุ`);
      if (s.length > max) throw HttpError.badRequest(`${label}: ยาวเกิน ${max} ตัวอักษร`);
      return s || null;
    };
  },

  integer({ min = 0, max = 4294967295, required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุ`);
        return null;
      }
      const n = Number(value);
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
      const s = String(value).trim().replace(/,/g, '');
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
   * `YYYY-MM-DD` only. The old data is full of `'0000-00-00'` (every row of
   * `historyeditproject`), which the pool's strict mode would now reject anyway
   * — this rejects it earlier, with a message that names the field.
   */
  date({ required = false } = {}) {
    return (value, label) => {
      if (value === null || value === undefined || value === '') {
        if (required) throw HttpError.badRequest(`${label}: ต้องระบุวันที่`);
        return null;
      }
      const s = String(value).slice(0, 10);
      if (!DATE_PATTERN.test(s) || Number.isNaN(Date.parse(s))) {
        throw HttpError.badRequest(`${label}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)`);
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
      const s = String(value).toUpperCase();
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
