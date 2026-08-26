/**
 * `thai.js` derives every Thai rendering — date, Buddhist year, spelled-out
 * amount — from the one stored value, at render time. The old schema stored
 * these pre-rendered and let them drift from what they described; `bahtText`
 * in particular replaces a version that returned an error *string* into a
 * government form field for amounts over 9,999,999.9999 and crashed on a
 * whole-baht input. All pure functions — no mocking needed.
 */
const { thaiDate, thaiYear, monthIndex, bahtText } = require('./thai');

describe('thaiDate / thaiYear / monthIndex', () => {
  test('renders a date in Buddhist era with the Thai month name', () => {
    expect(thaiDate('2024-06-01')).toBe('1 มิถุนายน 2567');
  });

  test('an absent date renders as an empty string, not "Invalid Date"', () => {
    expect(thaiDate(null)).toBe('');
    expect(thaiDate('')).toBe('');
    expect(thaiDate(undefined)).toBe('');
  });

  test('an unparsable date also renders as empty rather than throwing', () => {
    expect(thaiDate('not-a-date')).toBe('');
  });

  test('thaiYear is the Buddhist year alone', () => {
    expect(thaiYear('2024-06-01')).toBe('2567');
    expect(thaiYear(null)).toBe('');
  });

  test('monthIndex is a number, for the Gantt’s numeric comparisons', () => {
    expect(monthIndex('2024-10-01')).toBe(10);
    expect(typeof monthIndex('2024-10-01')).toBe('number');
    expect(monthIndex(null)).toBeNull();
  });
});

describe('bahtText', () => {
  test('a whole-baht amount ends in ถ้วน', () => {
    expect(bahtText('19200')).toBe('หนึ่งหมื่นเก้าพันสองร้อยบาทถ้วน');
  });

  test('zero is "ศูนย์บาทถ้วน", not an empty or missing string', () => {
    expect(bahtText('0')).toBe('ศูนย์บาทถ้วน');
    expect(bahtText('0.00')).toBe('ศูนย์บาทถ้วน');
  });

  test('a fractional amount spells satang instead of ถ้วน', () => {
    expect(bahtText('100.50')).toBe('หนึ่งร้อยบาทห้าสิบสตางค์');
  });

  test('เอ็ด replaces หนึ่ง in the units place only when something precedes it', () => {
    expect(bahtText('1')).toBe('หนึ่งบาทถ้วน');       // alone: หนึ่ง, not เอ็ด
    expect(bahtText('11')).toBe('สิบเอ็ดบาทถ้วน');      // สิบ + เอ็ด
    expect(bahtText('101')).toBe('หนึ่งร้อยเอ็ดบาทถ้วน'); // ร้อย + เอ็ด
  });

  test('ยี่ replaces สอง in the tens place, and the tens place omits หนึ่ง entirely', () => {
    expect(bahtText('20')).toBe('ยี่สิบบาทถ้วน');
    expect(bahtText('10')).toBe('สิบบาทถ้วน'); // not หนึ่งสิบ
  });

  test('a lone satang digit is หนึ่ง, not เอ็ด — the exact bug this file’s comment names', () => {
    // A zero-padded group ('01') is two characters whose value is one; the old
    // logic keyed off string length and printed เอ็ดสตางค์ for this amount.
    expect(bahtText('0.01')).toBe('หนึ่งสตางค์');
  });

  test('recurses through ล้าน for amounts past six digits', () => {
    expect(bahtText('1000000')).toBe('หนึ่งล้านบาทถ้วน');
    expect(bahtText('1000001')).toBe('หนึ่งล้านเอ็ดบาทถ้วน'); // เอ็ด carries across the ล้าน boundary
  });

  test('handles the largest amount the DECIMAL(12,2) column can hold, rather than erroring into the field', () => {
    // The old `ArabicNumberToText` returned the literal string
    // "ข้อมูลนำเข้าเกินขอบเขตที่ตั้งไว้" for anything past 9,999,999.9999 — a
    // sentence printed onto a government form with nothing to notice it.
    expect(() => bahtText('9999999999.99')).not.toThrow();
    expect(bahtText('9999999999.99')).toMatch(/ล้าน.*บาท.*สตางค์/);
  });

  test('a whole-baht input does not crash on a missing fractional part', () => {
    // The old implementation read `Number.split('.')[1]` unconditionally.
    expect(() => bahtText(500)).not.toThrow();
    expect(bahtText(500)).toBe('ห้าร้อยบาทถ้วน');
  });

  test('empty, null, and negative amounts render as an empty string rather than a number', () => {
    expect(bahtText(null)).toBe('');
    expect(bahtText(undefined)).toBe('');
    expect(bahtText('')).toBe('');
    expect(bahtText(-5)).toBe('');
  });
});
