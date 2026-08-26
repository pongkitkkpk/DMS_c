/**
 * `validate.js` is deviation 2 itself — the old system had fourteen
 * `UPDATE … SET ?` mass-assignment sites, and every write path in this
 * codebase goes through `pickFields`/`check.*` instead. Its own comments cite
 * specific bugs it closes, each with the date it was verified against a real
 * request: `{"content":{"a":1}}` printing the literal text `[object Object]`
 * on a government form, a headcount sent as `"0x10"` printing 16, and
 * `2024-02-31` silently rolling forward to March 2nd. These tests are aimed
 * at exactly those cases, plus the two allow-list functions everything else
 * is built on. All pure — no mocking.
 */
const { check, pickFields, pickList } = require('./validate');
const { HttpError } = require('./httpError');

const run = (validator, value, label = 'field') => validator(value, label);
const throwsWith = (validator, value) => {
  try {
    run(validator, value);
    return null;
  } catch (err) {
    return err;
  }
};

describe('scalar rejection (via any check.* validator)', () => {
  test('an object is refused rather than stringified to "[object Object]"', () => {
    const err = throwsWith(check.text(), { a: 1 });
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
  });

  test('an array is refused rather than joined with commas', () => {
    const err = throwsWith(check.text(), ['ก', 'ข']);
    expect(err).toBeInstanceOf(HttpError);
  });

  test('an empty array — the "real attendance of zero" case — is still refused for an integer field', () => {
    expect(() => run(check.integer(), [])).toThrow(HttpError);
  });
});

describe('check.text', () => {
  test('required and missing throws; not required and missing returns null', () => {
    expect(() => run(check.text({ required: true }), undefined)).toThrow(HttpError);
    expect(run(check.text(), undefined)).toBeNull();
    expect(run(check.text(), '')).toBeNull();
  });

  test('required and only whitespace is still "not provided"', () => {
    expect(() => run(check.text({ required: true }), '   ')).toThrow(HttpError);
  });

  test('trims surrounding whitespace', () => {
    expect(run(check.text(), '  hello  ')).toBe('hello');
  });

  test('a plain number is accepted and stringified', () => {
    expect(run(check.text(), 42)).toBe('42');
  });

  test('refuses past the character max', () => {
    expect(() => run(check.text({ max: 5 }), 'abcdef')).toThrow(HttpError);
    expect(run(check.text({ max: 5 }), 'abcde')).toBe('abcde');
  });

  test('the byte limit is distinct from the character limit — Thai text costs 3 bytes/char', () => {
    // 21,845 Thai characters is under any character-count max but 65,535
    // bytes exactly — one more character crosses the column's real limit
    // while still reading as a short string by character count alone.
    const thaiChar = 'ก';
    const atByteLimit = thaiChar.repeat(Math.floor(65535 / 3));
    expect(() => run(check.text({ max: 100000 }), atByteLimit)).not.toThrow();
    expect(() => run(check.text({ max: 100000 }), atByteLimit + thaiChar)).toThrow(HttpError);
  });
});

describe('check.integer', () => {
  test('hex notation is refused, not silently read as its decimal value', () => {
    // The bug the file names: a headcount sent as "0x10" printed 16.
    expect(() => run(check.integer(), '0x10')).toThrow(HttpError);
  });

  test('exponential notation is refused', () => {
    expect(() => run(check.integer(), '1e3')).toThrow(HttpError);
  });

  test('plain decimal notation for a whole number is still accepted', () => {
    expect(run(check.integer(), '12.0')).toBe(12);
  });

  test('a real fraction is refused — not an integer', () => {
    expect(() => run(check.integer(), '12.5')).toThrow(HttpError);
  });

  test('enforces min/max bounds', () => {
    const v = check.integer({ min: 1, max: 10 });
    expect(() => run(v, 0)).toThrow(HttpError);
    expect(() => run(v, 11)).toThrow(HttpError);
    expect(run(v, 5)).toBe(5);
  });

  test('required/optional behave the same as check.text', () => {
    expect(() => run(check.integer({ required: true }), undefined)).toThrow(HttpError);
    expect(run(check.integer(), undefined)).toBeNull();
  });
});

describe('check.decimal', () => {
  test('strips comma thousands separators', () => {
    expect(run(check.decimal(), '1,234.50')).toBe('1234.50');
  });

  test('refuses more than two decimal places — no rounding', () => {
    expect(() => run(check.decimal(), '1.234')).toThrow(HttpError);
  });

  test('refuses non-numeric money values like the old text-column artifacts', () => {
    for (const bad of ['-', '', 'ไม่มี', 'NaN']) {
      // '' is treated as absent, not a format error — check separately below.
      if (bad === '') continue;
      expect(() => run(check.decimal(), bad)).toThrow(HttpError);
    }
  });

  test('always returns a fixed-2 string, even for a whole number', () => {
    expect(run(check.decimal(), '500')).toBe('500.00');
    expect(run(check.decimal(), 500)).toBe('500.00');
  });

  test('enforces min/max bounds', () => {
    const v = check.decimal({ min: 0, max: 100 });
    expect(() => run(v, '100.01')).toThrow(HttpError);
    expect(run(v, '100.00')).toBe('100.00');
  });

  test('required and missing throws; optional and missing returns null', () => {
    expect(() => run(check.decimal({ required: true }), '')).toThrow(HttpError);
    expect(run(check.decimal(), '')).toBeNull();
  });
});

describe('check.date', () => {
  const v = check.date();

  test('accepts a real calendar date', () => {
    expect(run(v, '2024-06-01')).toBe('2024-06-01');
  });

  test('refuses a date that would roll forward instead of erroring — 2024-02-31', () => {
    expect(() => run(v, '2024-02-31')).toThrow(HttpError);
  });

  test('leap day is accepted in a leap year and refused otherwise', () => {
    expect(run(v, '2024-02-29')).toBe('2024-02-29');
    expect(() => run(v, '2023-02-29')).toThrow(HttpError);
  });

  test('refuses trailing garbage after a well-formed date', () => {
    expect(() => run(v, '2024-01-01abcdefgh')).toThrow(HttpError);
  });

  test('refuses a date range or anything else glued onto a date with a slash', () => {
    expect(() => run(v, '2024-01-01/2024-02-01')).toThrow(HttpError);
  });

  test('accepts a full ISO timestamp by reading only its date portion', () => {
    expect(run(v, '2024-01-01T10:30:00.000Z')).toBe('2024-01-01');
  });

  test('required and missing throws; optional and missing returns null', () => {
    expect(() => run(check.date({ required: true }), undefined)).toThrow(HttpError);
    expect(run(v, undefined)).toBeNull();
  });
});

describe('check.boolean', () => {
  const v = check.boolean();

  test.each([true, 1, '1', 'true'])('%p reads as 1', (value) => {
    expect(run(v, value)).toBe(1);
  });

  test.each([false, 0, '0', 'false'])('%p reads as 0', (value) => {
    expect(run(v, value)).toBe(0);
  });

  test.each([null, undefined, ''])('%p (absent) reads as 0, not an error', (value) => {
    expect(run(v, value)).toBe(0);
  });

  test('anything else is refused rather than coerced', () => {
    expect(() => run(v, 'yes')).toThrow(HttpError);
    expect(() => run(v, 2)).toThrow(HttpError);
  });
});

describe('check.oneOf', () => {
  const v = check.oneOf(['PLANNED', 'ACTUAL']);

  test('normalizes to uppercase before matching', () => {
    expect(run(v, 'planned')).toBe('PLANNED');
  });

  test('refuses a value outside the list', () => {
    expect(() => run(v, 'BUDGETED')).toThrow(HttpError);
  });

  test('required and missing throws; optional and missing returns null', () => {
    expect(() => run(check.oneOf(['A'], { required: true }), undefined)).toThrow(HttpError);
    expect(run(v, undefined)).toBeNull();
  });
});

describe('pickFields', () => {
  const FIELDS = {
    name: ['name', check.text({ required: true })],
    age: ['age', check.integer()],
  };

  test('refuses a non-object body, including an array', () => {
    expect(() => pickFields(null, FIELDS)).toThrow(HttpError);
    expect(() => pickFields([1, 2], FIELDS)).toThrow(HttpError);
  });

  test('names every unsupported field, not just the first', () => {
    let caught;
    try {
      pickFields({ name: 'x', club_id: 1, phase_id: 2 }, FIELDS);
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toContain('club_id');
    expect(caught.message).toContain('phase_id');
  });

  test('without requireAll, a field the caller did not send is simply absent from the result', () => {
    const result = pickFields({ name: 'x' }, FIELDS);
    expect(result).toEqual({ name: 'x' });
    expect('age' in result).toBe(false);
  });

  test('with requireAll, an unsent required field still throws — the create-time shape', () => {
    expect(() => pickFields({}, FIELDS, { requireAll: true })).toThrow(HttpError);
  });

  test('with requireAll, an unsent optional field is validated as absent and included as null', () => {
    const result = pickFields({ name: 'x' }, FIELDS, { requireAll: true });
    expect(result).toEqual({ name: 'x', age: null });
  });

  test('maps the API field name to its column name', () => {
    const result = pickFields({ name: 'x' }, { name: ['full_name', check.text()] });
    expect(result).toEqual({ full_name: 'x' });
  });
});

describe('pickList', () => {
  test('refuses a body whose field is not an array', () => {
    expect(() => pickList({ items: 'not-an-array' })).toThrow(HttpError);
    expect(() => pickList({})).toThrow(HttpError);
  });

  test('refuses more items than the configured max', () => {
    expect(() => pickList({ items: [1, 2, 3] }, 'items', { max: 2 })).toThrow(HttpError);
  });

  test('returns the array unchanged when it is within bounds', () => {
    expect(pickList({ items: [1, 2] }, 'items', { max: 5 })).toEqual([1, 2]);
  });

  test('reads a custom field name', () => {
    expect(pickList({ tagIds: [1, 2] }, 'tagIds')).toEqual([1, 2]);
  });
});
