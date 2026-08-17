/**
 * The one chart in this application.
 *
 * A row is an entity — a club, a campus — and its bar is that entity's
 * allocation split into the three states money can be in: paid, promised, still
 * free. Every row is drawn against **one scale shared by the whole chart**, so a
 * row can be compared with the rows above it and not only with itself. That is
 * the entire reason this exists rather than another table: the question an
 * officer brings to this page is a comparison, and a column of numbers makes
 * the reader do the comparing.
 *
 * ## Why a stacked bar and not three bars
 *
 * The three figures are not three independent measures — they nest. Disbursed
 * is part of committed, committed is part of allocated. Three grouped bars
 * would draw them as rivals and triple the height of the chart for no
 * information; the stack shows both the total and the split in one mark, and
 * the parts sum to exactly the whole.
 *
 * ## Over-commitment
 *
 * When committed exceeds allocated (legal — see Q33) there is no "คงเหลือ"
 * segment to draw and the bar runs past the ceiling. The overrun is drawn in
 * the reserved danger colour **with a hatch**, and a rule marks where the
 * allocation ended. The colour alone is not trusted to carry it: that red and
 * the ramp's darkest step are near neighbours, so the row also says
 * "เกินวงเงิน" in words.
 *
 * ## What is deliberately absent
 *
 * No second axis, no percentages painted on segments, no value on every part.
 * The row's own total sits at its end, the axis carries the rest, and the
 * tooltip and the table under every chart carry all four figures exactly. A
 * number on every segment is chaos and goes unread.
 */
import React, { useRef, useState } from 'react';

import { money } from './ui';

/**
 * The three states, in the order money travels through them — which is also
 * left-to-right along the bar and top-to-bottom in the legend.
 *
 * `key` names the field on a row; `className` picks the ramp step. The overrun
 * is not in this list because it is a status, not a state of the ramp.
 */
export const MONEY_STATES = [
  { key: 'disbursed', className: 'spent', label: 'จ่ายจริง' },
  { key: 'committedNotDisbursed', className: 'committed', label: 'อนุมัติแล้ว ยังไม่จ่าย' },
  { key: 'free', className: 'free', label: 'คงเหลือในวงเงิน' },
];

const OVER_STATE = { className: 'over', label: 'เกินวงเงิน' };

/**
 * A round number at or above `value`, for the axis.
 *
 * Ticks that read 483,271 are not ticks, they are a second set of data. This
 * snaps to 1 / 2 / 2.5 / 5 × 10ⁿ, which is the smallest set that keeps a
 * halfway tick round as well.
 */
function niceMax(value) {
  if (!(value > 0)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => scaled <= candidate);
  return step * magnitude;
}

/** Compact for an axis tick: 500,000 → "500K". The exact figure lives elsewhere. */
function compact(value) {
  if (value >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `${Number((value / 1e3).toFixed(0))}K`;
  return String(Math.round(value));
}

/**
 * One row's four figures turned into the widths that draw it.
 *
 * Everything is clamped at zero. `disbursed` should never exceed `committed`
 * and `committed` may legally exceed `allocated`, but a chart that renders a
 * negative width silently draws the wrong picture, so neither is assumed.
 */
function segmentsOf(row) {
  const allocated = Number(row.allocated) || 0;
  const committed = Number(row.committed) || 0;
  const disbursed = Number(row.disbursed) || 0;

  // What the bar is long enough to hold: normally the allocation, but a club
  // that committed past its ceiling has a bar longer than the ceiling.
  const promised = Math.max(committed, disbursed);

  /*
   * The bands are cut at the ceiling, and the overrun is what is left.
   *
   * Getting this wrong is not a rounding error, it is a longer bar: the first
   * version measured the committed band from zero and then added the overrun on
   * top, so a club with 96,000 committed against 70,000 allocated drew a bar
   * 122,000 long — the 26,000 counted once inside the band and once again
   * outside it. Every band below is clipped to `allocated`, so the four widths
   * sum to exactly `allocated` when the club is inside its ceiling and to
   * exactly `promised` when it is not.
   *
   * What this costs: inside an overrun the split between paid and merely
   * promised is not drawn. That is deliberate — past the ceiling the fact that
   * matters is the overrun itself, and the tooltip and the table still carry
   * all three figures exactly.
   */
  const withinCeiling = Math.min(promised, allocated);
  const paidWithinCeiling = Math.min(disbursed, allocated);

  return {
    // The figures. What the club actually has, was promised and has paid —
    // these are what the tooltip and the label quote, and they are never
    // clipped by anything the drawing needed.
    allocated,
    committed,
    disbursed,
    committedNotDisbursed: Math.max(committed - disbursed, 0),
    free: Math.max(allocated - committed, 0),
    over: Math.max(promised - allocated, 0),

    /*
     * The widths. Not the same thing, and conflating them is how the tooltip
     * first came to report "อนุมัติแล้ว ยังไม่จ่าย 10,000" for a club that had
     * 36,000 promised and unpaid: 10,000 is where that band stops, because the
     * band stops at the ceiling and the rest of it is drawn as the overrun.
     *
     * The bands sum to exactly `allocated` when the club is inside its ceiling
     * and to exactly `promised` when it is not.
     */
    bands: {
      spent: paidWithinCeiling,
      committed: Math.max(withinCeiling - paidWithinCeiling, 0),
      free: Math.max(allocated - promised, 0),
      over: Math.max(promised - allocated, 0),
    },
    total: Math.max(allocated, promised),
  };
}

export function MoneyLegend({ showOver }) {
  const items = showOver ? [...MONEY_STATES, OVER_STATE] : MONEY_STATES;
  return (
    <div className="meter-legend u-small u-muted">
      {items.map((item) => (
        <span className="meter-legend__item" key={item.label}>
          <span
            className={`meter-legend__swatch meter-row__seg--${item.className}`}
            style={{ position: 'static' }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * @param {object[]} rows  `{ key, label, sublabel, allocated, committed, disbursed }`
 * @param {string}   valueOf  which figure prints at the end of the bar
 */
export function MoneyMeter({ rows, emptyText = 'ไม่มีข้อมูลในปีนี้' }) {
  const [tip, setTip] = useState(null);
  // The panel is positioned against the chart, so its coordinates have to be
  // measured against the chart — not against whichever element the pointer
  // happens to be over, whose origin is a legend's height away.
  const chart = useRef(null);

  const tipAt = (event, row) => {
    const box = chart.current.getBoundingClientRect();
    return { row, x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const measured = rows.map((row) => ({ ...row, seg: segmentsOf(row) }));
  const scale = niceMax(Math.max(0, ...measured.map((row) => row.seg.total)));

  if (!measured.length) {
    return <div className="u-small u-dim" style={{ padding: 'var(--s-4) 0' }}>{emptyText}</div>;
  }

  // Everything is drawn to this scale, including a row of all zeroes — which
  // draws as an empty track rather than being dropped, because "this club was
  // given nothing" is an answer the reader came for.
  const width = (amount) => (scale > 0 ? `${(amount / scale) * 100}%` : '0%');
  const showOver = measured.some((row) => row.seg.over > 0);

  return (
    <div ref={chart} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
      <MoneyLegend showOver={showOver} />

      <div style={{ marginTop: 'var(--s-3)' }}>
        {measured.map((row) => {
          const { seg } = row;
          const parts = [
            { className: 'spent', amount: seg.bands.spent },
            { className: 'committed', amount: seg.bands.committed },
            { className: 'free', amount: seg.bands.free },
            { className: 'over', amount: seg.bands.over },
          ].filter((part) => part.amount > 0);

          let offset = 0;
          return (
            <div
              className="meter-row"
              key={row.key}
              // Both events, not just the move: a pointer that arrives at a row
              // and stops — which is what a pointer does when it has arrived
              // somewhere on purpose — fires no `mousemove` at all, and the
              // panel would only appear for a reader who kept fidgeting.
              onMouseEnter={(event) => setTip(tipAt(event, row))}
              onMouseMove={(event) => setTip(tipAt(event, row))}
            >
              <div className="meter-row__label">
                <div style={{ fontWeight: 500 }}>{row.label}</div>
                {row.sublabel && <div className="u-small u-dim">{row.sublabel}</div>}
              </div>

              <div
                className="meter-row__track"
                role="img"
                // The bar is a picture of four numbers; this is those numbers.
                // Without it the chart is decoration to anybody not looking at
                // it, and the table below would be the only way in.
                aria-label={
                  `${row.label} — จัดสรร ${money(seg.allocated)} บาท` +
                  ` · อนุมัติแล้ว ${money(seg.committed)}` +
                  ` · จ่ายจริง ${money(seg.disbursed)}` +
                  (seg.over > 0 ? ` · เกินวงเงิน ${money(seg.over)}` : '')
                }
              >
                {parts.map((part, index) => {
                  const left = offset;
                  offset += part.amount;
                  const only = parts.length === 1;
                  return (
                    <div
                      key={part.className}
                      className={
                        `meter-row__seg meter-row__seg--${part.className}` +
                        (only ? ' meter-row__seg--only'
                          : index === 0 ? ' meter-row__seg--first'
                            : index === parts.length - 1 ? ' meter-row__seg--last' : '')
                      }
                      style={{ left: width(left), width: width(part.amount) }}
                    />
                  );
                })}

                {/* Only drawn when the bar runs past it: on a row that is inside
                    its ceiling the rule would sit exactly on the bar's end and
                    say nothing the end does not already say. */}
                {seg.over > 0 && seg.allocated > 0 && (
                  <div className="meter-row__limit" style={{ left: width(seg.allocated) }} />
                )}
              </div>

              <div className="meter-row__value u-small">
                {money(seg.allocated)}
                {seg.over > 0 && (
                  <div className="u-small" style={{ color: 'var(--c-danger)' }}>เกินวงเงิน</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The axis rides the same grid as the rows rather than being positioned
          against the whole chart — a second copy of the column widths is a
          second thing to keep in step, and it would drift the first time the
          label column changed. */}
      <div className="meter-row meter-row--axis">
        <div />
        <div className="meter-axis u-small u-dim">
          {[0, 0.5, 1].map((fraction) => (
            <span
              key={fraction}
              className="meter-axis__tick"
              style={{ left: `${fraction * 100}%` }}
            >
              {compact(scale * fraction)}
            </span>
          ))}
        </div>
        <div />
      </div>

      {tip && (
        <div
          className="meter-tip"
          style={{
            left: Math.max(0, tip.x - 90),
            top: tip.y + 16,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tip.row.label}</div>
          {[
            ...MONEY_STATES.map((state) => ({ ...state, amount: tip.row.seg[state.key] })),
            ...(tip.row.seg.over > 0 ? [{ ...OVER_STATE, amount: tip.row.seg.over }] : []),
          ].map((state) => (
            <div className="meter-tip__row u-small" key={state.label}>
              <span
                className={`meter-legend__swatch meter-row__seg--${state.className}`}
                style={{ position: 'static' }}
                aria-hidden="true"
              />
              <span className="u-muted">{state.label}</span>
              <span className="meter-tip__amount">{money(state.amount)}</span>
            </div>
          ))}
          <div
            className="meter-tip__row u-small"
            style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--c-border)' }}
          >
            <span className="u-muted">จัดสรรทั้งหมด</span>
            <span className="meter-tip__amount" style={{ fontWeight: 600 }}>
              {money(tip.row.seg.allocated)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
