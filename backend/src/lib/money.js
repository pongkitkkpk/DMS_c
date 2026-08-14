/**
 * Money arithmetic, in satang.
 *
 * Every money column is `DECIMAL(12,2)` and the pool is configured with
 * `decimalNumbers: false`, so the driver hands them back as strings — on
 * purpose, because `0.1 + 0.2` is the reason the old system's totals drifted
 * from their components. Nothing here ever adds two floats: values are
 * converted to whole satang, compared or summed as integers, and rendered back
 * to a fixed-2 string at the edge.
 *
 * `DECIMAL(12,2)` tops out at 9,999,999,999.99 — 999,999,999,999 satang, well
 * inside `Number.MAX_SAFE_INTEGER`, so integer satang is exact for every value
 * the schema can hold.
 */

/** A `DECIMAL` string (or number) as whole satang. `null`/`undefined` → 0. */
function satang(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`not a money value: ${value}`);
  return Math.round(n * 100);
}

/** Whole satang back to the `DECIMAL(12,2)` string shape the columns use. */
function fromSatang(total) {
  return (total / 100).toFixed(2);
}

/** For Thai messages: `19200` → `"19,200.00"`. Accepts satang-free amounts. */
function baht(value) {
  const n = satang(value) / 100;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { satang, fromSatang, baht };
