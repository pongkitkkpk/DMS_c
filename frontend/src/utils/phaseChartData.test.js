import { computePhaseChartSlices } from './phaseChartData';

const phases = [
  { code: 'DRAFT_PROPOSAL', ordinal: 1, name_th: 'ร่างข้อเสนอ' },
  { code: 'PROPOSAL_SUBMITTED', ordinal: 2, name_th: 'รออนุมัติข้อเสนอ' },
  { code: 'PROJECT_APPROVED', ordinal: 3, name_th: 'อนุมัติโครงการแล้ว' },
  { code: 'BUDGET_APPROVED', ordinal: 4, name_th: 'อนุมัติงบแล้ว' },
  { code: 'CLOSED', ordinal: 7, name_th: 'ปิดโครงการ' },
];

describe('computePhaseChartSlices', () => {
  test('drops phases with zero projects instead of drawing an invisible sliver', () => {
    const counts = new Map([['DRAFT_PROPOSAL', 2], ['CLOSED', 2]]);
    const slices = computePhaseChartSlices(phases, counts);
    expect(slices.map((s) => s.code)).toEqual(['DRAFT_PROPOSAL', 'CLOSED']);
  });

  test('orders slices by ordinal regardless of input order', () => {
    const reordered = [...phases].reverse();
    const counts = new Map([['DRAFT_PROPOSAL', 1], ['CLOSED', 1], ['BUDGET_APPROVED', 1]]);
    const slices = computePhaseChartSlices(reordered, counts);
    expect(slices.map((s) => s.code)).toEqual(['DRAFT_PROPOSAL', 'BUDGET_APPROVED', 'CLOSED']);
  });

  test('percentages sum to 100 across all slices', () => {
    const counts = new Map([['DRAFT_PROPOSAL', 1], ['PROPOSAL_SUBMITTED', 2], ['CLOSED', 1]]);
    const slices = computePhaseChartSlices(phases, counts);
    const total = slices.reduce((sum, s) => sum + s.percent, 0);
    expect(total).toBeCloseTo(100);
  });

  test('two phases sharing a tone (PROJECT_APPROVED, BUDGET_APPROVED both "go") get distinct colours', () => {
    const counts = new Map([['PROJECT_APPROVED', 1], ['BUDGET_APPROVED', 1]]);
    const slices = computePhaseChartSlices(phases, counts);
    expect(slices[0].color).not.toBe(slices[1].color);
  });

  test('an all-zero year produces no slices', () => {
    const slices = computePhaseChartSlices(phases, new Map());
    expect(slices).toHaveLength(0);
  });

  test('three phases sharing a tone still get three distinct colours', () => {
    // No real phase code repeats a tone three times today, so this uses
    // unknown codes — `computePhaseChartSlices` falls back to 'neutral' for
    // any code `PHASE_TONE` doesn't list, which puts all three in one tone.
    const threeNeutral = [
      { code: 'FAKE_A', ordinal: 1, name_th: 'A' },
      { code: 'FAKE_B', ordinal: 2, name_th: 'B' },
      { code: 'FAKE_C', ordinal: 3, name_th: 'C' },
    ];
    const counts = new Map([['FAKE_A', 1], ['FAKE_B', 1], ['FAKE_C', 1]]);
    const slices = computePhaseChartSlices(threeNeutral, counts);
    expect(new Set(slices.map((s) => s.color)).size).toBe(3);
  });
});
