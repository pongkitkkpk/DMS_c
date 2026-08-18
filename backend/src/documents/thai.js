/**
 * The Thai renderings the forms print and the database deliberately does not
 * store.
 *
 * The old schema stored all of these: 41 columns of pre-rendered Thai date
 * strings, 30 columns of month indices, and `thailistSAll`, the spelled-out
 * amount. Every one of them was computed in the browser and posted alongside
 * the value it described, so the two could — and did — disagree: editing a date
 * through a path that did not also recompute its `thai*` twin left the form
 * printing the old date. Q19 removes them from the schema, which puts the
 * obligation here: derived at render time, from the one stored value, every
 * time.
 */

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** `YYYY-MM-DD` (or a Date) → its parts, or `null` if there is no usable date. */
function parts(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [, year, month, day] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: Number(year), month: m, day: d };
}

/**
 * `2024-06-01` → `1 มิถุนายน 2567`.
 *
 * The Gregorian year is converted to Buddhist Era by hand rather than by
 * `toLocaleDateString('th-TH', …)`, which is what the old frontend used. That
 * call depends on the host's ICU build for both the calendar and the numbering
 * system, and a Node built with `small-icu` silently answers in English — on a
 * government form, silently. The month names are right here in the file, so
 * there is nothing to depend on.
 *
 * An absent date renders as an empty string, not as "Invalid Date": a blank on
 * the form is a blank, and the old `new Date(null)` printed `1 มกราคม 2513`.
 */
function thaiDate(value) {
  const p = parts(value);
  if (!p) return '';
  return `${p.day} ${THAI_MONTHS[p.month - 1]} ${p.year + 543}`;
}

/** The Buddhist-era year alone, as a string. `''` when there is no date. */
function thaiYear(value) {
  const p = parts(value);
  return p ? String(p.year + 543) : '';
}

/**
 * The calendar month, 1–12, for the Gantt's `startM`/`endM` comparisons.
 *
 * Calendar month is what the old system used (`CSD_timestep.js:442`,
 * `getMonth() + 1`) and therefore what the form's columns mean. It is returned
 * as a **number**: the old columns were `text`, and angular-expressions
 * comparing strings makes `"10" <= 9` true, which is a live source of wrong
 * shading today (`docs/template-contract.md`, "The Gantt chart").
 *
 * `null` for an absent date, so a row with no dates fails every comparison and
 * shades nothing, rather than behaving like month zero.
 */
function monthIndex(value) {
  const p = parts(value);
  return p ? p.month : null;
}

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/**
 * One group of up to six digits, spelled out.
 *
 * `เอ็ด` replaces `หนึ่ง` in the units place only when something non-zero comes
 * before it — สิบเอ็ด, หนึ่งร้อยเอ็ด, หนึ่งล้านเอ็ด, but plain หนึ่ง on its own.
 * That is a fact about the *number*, not about the string, and this once tested
 * `length > 1`: a group is zero-padded (satang to two digits, every group after
 * the first to six), so `'01'` was a two-character string whose value is one and
 * `0.01` printed **เอ็ดสตางค์** on กนศ.04. `hasHigherPart` carries the same
 * question across a group boundary, which is what keeps หนึ่งล้านเอ็ด correct.
 */
function spellGroup(text, hasHigherPart = false) {
  let out = '';
  const length = text.length;
  let anythingBefore = hasHigherPart;
  for (let i = 0; i < length; i++) {
    const digit = Number(text[i]);
    if (digit === 0) continue;
    const place = length - i - 1;
    if (place === 0 && digit === 1 && anythingBefore) out += 'เอ็ด';
    else if (place === 1 && digit === 2) out += 'ยี่';
    else if (place === 1 && digit === 1) out += '';
    else out += DIGITS[digit];
    out += PLACES[place];
    anythingBefore = true;
  }
  return out;
}

/**
 * `19200` → `หนึ่งหมื่นเก้าพันสองร้อยบาทถ้วน`.
 *
 * Two things the old `ArabicNumberToText` got wrong, and this does not.
 *
 * It refused anything above 9,999,999.9999 by **returning the string
 * `"ข้อมูลนำเข้าเกินขอบเขตที่ตั้งไว้"`** — an error message, into a field on a
 * government form, with nothing to notice it. The money columns are
 * `DECIMAL(12,2)`, so values above that ceiling are representable and a club
 * with a large allocation can reach one. Groups of six digits are recursed on
 * `ล้าน` here, which is how Thai actually spells large numbers, so the whole
 * range the schema permits is covered.
 *
 * And it read `Number.split(".")[1]` without checking that a decimal point was
 * present, so a whole-baht input threw on `.length` of `undefined`. Amounts
 * arrive here as `DECIMAL` strings that may or may not carry a fraction.
 */
function bahtText(value) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '';

  const [wholeText, fractionText = ''] = Number(amount).toFixed(2).split('.');
  const satang = Number(fractionText);

  let baht;
  if (wholeText === '0') {
    baht = satang > 0 ? '' : 'ศูนย์บาท';
  } else {
    // Split into six-digit groups from the right; each `ล้าน` is one group up.
    const groups = [];
    for (let end = wholeText.length; end > 0; end -= 6) {
      groups.unshift(wholeText.slice(Math.max(0, end - 6), end));
    }
    let higherGroupSpelled = false;
    baht = groups
      .map((group, index) => {
        const spelled = spellGroup(group, higherGroupSpelled);
        if (!spelled) return '';
        higherGroupSpelled = true;
        return spelled + 'ล้าน'.repeat(groups.length - index - 1);
      })
      .join('') + 'บาท';
  }

  // `ถ้วน` on every whole-baht amount, zero included: a receipt for nothing
  // still reads ศูนย์บาทถ้วน, and the word is what says no satang were dropped.
  if (satang === 0) return `${baht}ถ้วน`;
  return `${baht}${spellGroup(String(satang).padStart(2, '0'))}สตางค์`;
}

module.exports = { THAI_MONTHS, thaiDate, thaiYear, monthIndex, bahtText };
