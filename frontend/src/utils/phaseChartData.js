/**
 * Turns phase + counts into pie-chart slices, kept separate from the actual
 * canvas drawing so this part — the numbers, the labels, the colours — can be
 * unit tested without a real `<canvas>`, which jsdom does not implement.
 *
 * Colours reuse `PHASE_TONE` rather than inventing a second palette: the
 * dashboard tiles and the exported chart should read as the same four
 * families (drafting → waiting on someone → approved → finished), not two
 * unrelated colour schemes for the same data.
 */
import { PHASE_TONE } from '../components/ui';

const TONE_BASE_COLOR = {
  neutral: '#5f5852',
  active: '#92620a',
  go: '#146c43',
  done: '#4a4744',
};

// A cap rather than letting `seen * SHADE_STEP` grow unbounded: past a
// handful of phases sharing one tone, further lightening washes out toward
// white and two late shades would stop being distinguishable anyway.
const SHADE_STEP = 0.35;
const MAX_SHADE = 0.75;

/**
 * The Nth phase sharing a tone gets progressively lighter, not just a
 * second, fixed shade — a tone with three or more phases (none exist today,
 * but `PHASE_TONE` is free to grow one) would otherwise give its 2nd and 3rd
 * phase the identical lightened colour.
 */
function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * One slice per phase that actually has a project, ordered by `ordinal`.
 * Zero-count phases are left out rather than drawn as an invisible sliver —
 * the legend they'd add is noise, not information.
 */
export function computePhaseChartSlices(phases, counts) {
  const shadeSeen = {};
  const total = phases.reduce((sum, phase) => sum + (counts.get(phase.code) || 0), 0);
  return [...phases]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((phase) => {
      const value = counts.get(phase.code) || 0;
      const tone = PHASE_TONE[phase.code] || 'neutral';
      const seen = shadeSeen[tone] || 0;
      shadeSeen[tone] = seen + 1;
      const base = TONE_BASE_COLOR[tone];
      return {
        code: phase.code,
        label: phase.name_th,
        value,
        percent: total ? (value / total) * 100 : 0,
        color: seen === 0 ? base : lighten(base, Math.min(seen * SHADE_STEP, MAX_SHADE)),
      };
    })
    .filter((slice) => slice.value > 0);
}
