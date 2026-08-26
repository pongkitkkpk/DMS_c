/**
 * `money.js` is the one place this codebase does money arithmetic — every
 * other file sums/compares in satang and only calls back into `fromSatang`/
 * `baht` at the edge. Its own header names why: `0.1 + 0.2` is why the old
 * system's totals drifted from their components. These tests exist mainly to
 * pin the string-in/integer-out contract, since a bug here would corrupt
 * every money comparison in the system silently — `budgetService`'s tests
 * already exercise this indirectly, but only through amounts that happen not
 * to expose float drift.
 */
const { satang, fromSatang, baht } = require('./money');

describe('satang', () => {
  test('converts a DECIMAL string to whole satang', () => {
    expect(satang('19200.50')).toBe(1920050);
  });

  test('null, undefined, and empty string are all zero', () => {
    expect(satang(null)).toBe(0);
    expect(satang(undefined)).toBe(0);
    expect(satang('')).toBe(0);
  });

  test('accepts a plain number as well as a string', () => {
    expect(satang(19200.5)).toBe(1920050);
  });

  test('two values that would drift under raw float addition sum exactly in satang', () => {
    // The reason this file exists, made concrete: 0.1 + 0.2 !== 0.3 in raw
    // JS floats, but summing as integer satang has no such gap.
    expect(satang('0.10') + satang('0.20')).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3); // the float behaviour this sidesteps
  });

  test('a value whose raw *100 lands off-integer is still rounded to the exact satang total', () => {
    // `1.15 * 100` is `114.99999999999999` in raw JS float arithmetic —
    // `satang` has to round, not merely multiply, to answer 115.
    expect(satang('1.15')).toBe(115);
  });

  test('refuses a value that is not a number, rather than silently reading it as zero', () => {
    expect(() => satang('ไม่มี')).toThrow(TypeError);
    expect(() => satang('-')).toThrow(TypeError);
  });

  test('handles the DECIMAL(12,2) ceiling exactly, as an integer', () => {
    expect(satang('9999999999.99')).toBe(999999999999);
    expect(Number.isSafeInteger(satang('9999999999.99'))).toBe(true);
  });

  test('negative amounts are preserved, not clamped', () => {
    expect(satang('-500.00')).toBe(-50000);
  });
});

describe('fromSatang', () => {
  test('renders whole satang back to a fixed-2 DECIMAL string', () => {
    expect(fromSatang(1920050)).toBe('19200.50');
  });

  test('round-trips through satang without drift', () => {
    expect(fromSatang(satang('123.45'))).toBe('123.45');
  });

  test('renders a negative total with its sign', () => {
    expect(fromSatang(-50000)).toBe('-500.00');
  });
});

describe('baht', () => {
  test('formats with a thousands separator and two decimals', () => {
    expect(baht('19200')).toBe('19,200.00');
  });

  test('accepts a satang-free amount directly, the same as satang() does', () => {
    expect(baht(500)).toBe('500.00');
  });

  test('zero and absent both render as 0.00, not blank', () => {
    expect(baht('0.00')).toBe('0.00');
    expect(baht(null)).toBe('0.00');
  });
});
