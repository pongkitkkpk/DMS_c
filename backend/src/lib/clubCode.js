/**
 * Club code and project number composition.
 *
 * The old system STORED these strings — `users.codebooksome`, `projects.codeclub`
 * — copied onto ten of its fifteen tables, and built them by interpolating a raw
 * `yearly` state that was initialised to a four-digit `2667`. Two live rows ended
 * up with a 12-character club code, which would have produced a 14-character
 * project number and been silently truncated by varchar(12).
 *
 * Here the code is composed from typed inputs on demand and never stored, so the
 * width cannot drift. See docs/domain-model.md, "Identifiers".
 *
 *   club_code      = campus(1) + year(2) + division(2) + club(3) + workgroup(2)  = 10
 *   project_number = club_code + sequence(2)                                     = 12
 */

/** 2567 -> '67'. Accepts a Buddhist-era year as a number or a numeric string. */
function shortYear(academicYear) {
  const n = Number(academicYear);
  if (!Number.isInteger(n) || n < 2400 || n > 2700) {
    throw new Error(`academic year out of range: ${academicYear} (expected a 4-digit Buddhist-era year)`);
  }
  return String(n % 100).padStart(2, '0');
}

/** 'D04' -> '04', 'A201' -> '201'. Strips non-digits, then pads to `width`. */
function numericPart(code, width, label) {
  const digits = String(code == null ? '' : code).replace(/\D/g, '');
  if (!digits) throw new Error(`${label} has no numeric part: ${JSON.stringify(code)}`);
  if (digits.length > width) {
    throw new Error(`${label} numeric part ${digits} exceeds ${width} characters`);
  }
  return digits.padStart(width, '0');
}

/**
 * @param {object} p
 * @param {string} p.campusAbbreviation 'B' | 'P' | 'R'
 * @param {number} p.academicYear       2567
 * @param {string} p.divisionCode       'D04'
 * @param {string} p.clubCode           'A201'
 * @param {string} [p.workGroupCode]    '00'
 * @returns {string} 10-character club code
 */
function buildClubCode({ campusAbbreviation, academicYear, divisionCode, clubCode, workGroupCode = '00' }) {
  if (!campusAbbreviation || campusAbbreviation.length !== 1) {
    throw new Error(`campus abbreviation must be one character: ${JSON.stringify(campusAbbreviation)}`);
  }
  const code =
    campusAbbreviation +
    shortYear(academicYear) +
    numericPart(divisionCode, 2, 'division code') +
    numericPart(clubCode, 3, 'club code') +
    String(workGroupCode).replace(/\D/g, '').padStart(2, '0');

  if (code.length !== 10) throw new Error(`composed club code is ${code.length} chars, expected 10: ${code}`);
  return code;
}

/** club code + a 2-digit sequence. Throws past 99 rather than overflowing. */
function buildProjectNumber(clubCode, sequence) {
  const n = Number(sequence);
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new Error(`project sequence out of range: ${sequence} (1-99)`);
  }
  if (clubCode.length !== 10) throw new Error(`club code must be 10 chars, got ${clubCode.length}`);
  return clubCode + String(n).padStart(2, '0');
}

module.exports = { buildClubCode, buildProjectNumber, shortYear, numericPart };
