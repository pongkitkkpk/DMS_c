/**
 * The date and money helpers every screen shares.
 *
 * These exist because of the 2026-08-17 browser pass: the pool declared
 * `timezone: 'Z'` for columns that hold Thai wall-clock time, so a row written
 * at 00:03 rendered as **07:03** — on the one card whose whole job is to say
 * when something happened. Five date sites in three shapes were then folded
 * into these two helpers so they could not drift apart again, and nothing has
 * held them there since except the person looking at the screen.
 *
 * The assertions are on what must be true rather than on the exact locale
 * string: month abbreviations come from the host's ICU data, and a test that
 * pins them fails on a different Node build without anything being wrong.
 */
import { calendarDate, dateTime, money } from './ui';

describe('calendarDate', () => {
  it('is the Buddhist year, not the Gregorian one', () => {
    const rendered = calendarDate('2024-06-01');
    expect(rendered).toContain('2567');
    expect(rendered).not.toContain('2024');
  });

  it('keeps the day it was given, rather than a UTC-midnight guess of it', () => {
    // `new Date('2024-06-01')` is UTC midnight, which in Thailand is already the
    // 1st — but west of Greenwich it is the 31st of May. The helper reads the
    // digits instead, so the day cannot move.
    expect(calendarDate('2024-06-01')).toMatch(/(^|\D)1(\D|$)/);
    expect(calendarDate('2024-12-31')).toMatch(/31/);
  });

  it('says nothing rather than "Invalid Date" when there is no date', () => {
    expect(calendarDate(null)).toBe('—');
    expect(calendarDate('')).toBe('—');
    expect(calendarDate('not a date')).toBe('—');
  });
});

describe('dateTime', () => {
  it('prints the wall-clock time in the string, with no timezone applied to it', () => {
    // The defect this pins: 00:03:18 rendered as 07:03 because the driver
    // claimed UTC for a column that holds local time.
    const rendered = dateTime('2026-08-17 00:03:18');
    expect(rendered).toContain('00:03');
    expect(rendered).not.toContain('07:03');
  });

  it('carries the date part as well, in the Buddhist year', () => {
    expect(dateTime('2026-08-17 14:30:00')).toContain('2569');
    expect(dateTime('2026-08-17 14:30:00')).toContain('14:30');
  });

  it('is a dash for an absent timestamp', () => {
    expect(dateTime(null)).toBe('—');
  });
});

describe('money', () => {
  it('always shows both satang digits, because money on this screen feeds a form', () => {
    expect(money('19200')).toBe('19,200.00');
    expect(money('0.5')).toBe('0.50');
  });

  it('reads the string the API sends rather than a float it made itself', () => {
    // `DECIMAL` arrives as a string on purpose (backend/src/lib/money.js).
    expect(money('0.1')).toBe('0.10');
    expect(money(0)).toBe('0.00');
  });

  it('is a dash for a value nobody has set, not 0.00', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
});
