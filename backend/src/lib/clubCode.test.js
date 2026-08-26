/**
 * `clubCode.js` composes the club code and project number on demand instead
 * of storing them — the old system stored both, built by string
 * interpolation off a `yearly` state initialised to a literal `2667`, and two
 * live rows ended up with a 12-character club code that would have produced
 * a 14-character project number silently truncated by a `varchar(12)`.
 * These tests are aimed at the boundaries that class of bug lived in: a
 * numeric part that overflows its field width, and a sequence past 99.
 */
const { buildClubCode, buildProjectNumber, shortYear, numericPart } = require('./clubCode');

describe('shortYear', () => {
  test('takes the last two digits of a Buddhist-era year', () => {
    expect(shortYear(2567)).toBe('67');
  });

  test('pads a year whose last two digits are under 10', () => {
    expect(shortYear(2505)).toBe('05');
  });

  test('accepts a numeric string the same as a number', () => {
    expect(shortYear('2567')).toBe('67');
  });

  test('refuses a year outside the plausible Buddhist-era range', () => {
    expect(() => shortYear(2399)).toThrow();
    expect(() => shortYear(2701)).toThrow();
    expect(() => shortYear(1969)).toThrow(); // a Gregorian year passed by mistake
  });
});

describe('numericPart', () => {
  test('strips non-digit characters and pads to width', () => {
    expect(numericPart('D04', 2, 'division code')).toBe('04');
    expect(numericPart('A201', 3, 'club code')).toBe('201');
  });

  test('refuses a code with no digits in it at all', () => {
    expect(() => numericPart('ABC', 2, 'division code')).toThrow(/no numeric part/);
  });

  test('refuses digits that overflow the field width — the old system’s truncation bug, caught before it can recur', () => {
    expect(() => numericPart('D1234', 2, 'division code')).toThrow(/exceeds 2 characters/);
  });
});

describe('buildClubCode', () => {
  const valid = { campusAbbreviation: 'B', academicYear: 2567, divisionCode: 'D04', clubCode: 'A201', workGroupCode: '00' };

  test('composes campus + year + division + club + work group into exactly 10 characters', () => {
    const code = buildClubCode(valid);
    expect(code).toBe('B6704201' + '00');
    expect(code).toHaveLength(10);
  });

  test('defaults workGroupCode to "00" when omitted', () => {
    const { workGroupCode, ...withoutWorkGroup } = valid;
    expect(buildClubCode(withoutWorkGroup)).toBe(buildClubCode(valid));
  });

  test('refuses a campus abbreviation that is not exactly one character', () => {
    expect(() => buildClubCode({ ...valid, campusAbbreviation: 'BK' })).toThrow();
    expect(() => buildClubCode({ ...valid, campusAbbreviation: '' })).toThrow();
  });

  test('refuses a division or club code that would overflow its field, rather than composing a code of the wrong width', () => {
    expect(() => buildClubCode({ ...valid, clubCode: 'A99999' })).toThrow();
  });
});

describe('buildProjectNumber', () => {
  const clubCode = 'B670420100'; // 10 characters

  test('appends a zero-padded two-digit sequence', () => {
    expect(buildProjectNumber(clubCode, 7)).toBe(`${clubCode}07`);
    expect(buildProjectNumber(clubCode, 42)).toBe(`${clubCode}42`);
  });

  test('accepts the boundary sequence 99', () => {
    expect(buildProjectNumber(clubCode, 99)).toBe(`${clubCode}99`);
  });

  test('refuses sequence 0 and anything past 99 — the old varchar(16) overflow this replaces', () => {
    expect(() => buildProjectNumber(clubCode, 0)).toThrow(/1-99/);
    expect(() => buildProjectNumber(clubCode, 100)).toThrow(/1-99/);
  });

  test('refuses a club code that is not exactly 10 characters', () => {
    expect(() => buildProjectNumber('SHORT', 1)).toThrow(/must be 10 chars/);
  });
});
