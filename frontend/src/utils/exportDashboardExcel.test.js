import { buildDashboardSheets } from './exportDashboardExcel';

const phases = [
  { code: 'P1', ordinal: 1, name_th: 'ร่างคำขออนุมัติ' },
  { code: 'P2', ordinal: 2, name_th: 'อนุมัติแล้ว' },
];

const allocations = {
  items: [
    {
      club: { code: 'C01', nameTh: 'ชมรมเอ' },
      campus: { nameTh: 'บางซื่อ' },
      amount: '10000.00',
      committed: '4000.00',
      remaining: '6000.00',
      overCommitted: false,
    },
    {
      club: { code: 'C02', nameTh: 'ชมรมบี' },
      campus: { nameTh: 'บางซื่อ' },
      amount: '5000.00',
      committed: '6000.00',
      remaining: '-1000.00',
      overCommitted: true,
    },
  ],
};

const unfundedClubs = [
  { code: 'C03', nameTh: 'ชมรมซี', campusName: 'บางซื่อ' },
];

function sheetByName(sheets, name) {
  return sheets.find((s) => s.sheet === name);
}

describe('buildDashboardSheets', () => {
  const build = (extra = {}) => buildDashboardSheets({
    academicYear: 2567,
    scopeLabel: 'ชมรมเอ',
    phases,
    counts: new Map([['P1', 3], ['P2', 1]]),
    projectsTotal: 4,
    allocations,
    unfundedClubs,
    ...extra,
  });

  test('carries every phase, including ones with zero projects', () => {
    const { data } = sheetByName(build(), 'สถานะโครงการ');
    // data[0] is the header row.
    expect(data).toHaveLength(3);
    expect(data[1][2].value).toBe(3);
    expect(data[2][2].value).toBe(1);
  });

  test('allocation sheet carries funded clubs as numbers and flags the over-committed one', () => {
    const { data } = sheetByName(build(), 'วงเงินจัดสรร');
    expect(data[1][3].value).toBe(10000);
    expect(data[2][6].value).toBe('เกินวงเงิน');
    expect(data[2][6].backgroundColor).toBeTruthy();
  });

  test('an unfunded club appears without amounts, marked as unfunded rather than zero', () => {
    const { data } = sheetByName(build(), 'วงเงินจัดสรร');
    const row = data.find((r) => r[0].value === 'C03');
    expect(row[3].value).toBeNull();
    expect(row[6].value).toBe('ยังไม่ได้กำหนดวงเงินปี 2567');
  });

  test('summary sheet names the scope and the year', () => {
    const { data } = sheetByName(build(), 'ภาพรวม');
    const flat = data.map((row) => row.map((cell) => cell && cell.value));
    expect(flat).toContainEqual(['ปีการศึกษา', 2567]);
    expect(flat).toContainEqual(['ขอบเขต', 'ชมรมเอ']);
  });

  test('anchors the chart image on the summary sheet when one is given', () => {
    const blob = new Blob(['fake-png-bytes'], { type: 'image/png' });
    const summary = sheetByName(build({ chartImage: { blob, width: 640, height: 360 } }), 'ภาพรวม');
    expect(summary.images).toHaveLength(1);
    expect(summary.images[0].content).toBe(blob);
    expect(summary.images[0].width).toBe(640);
  });

  test('adds no image when no chart was rendered (e.g. a year with zero projects)', () => {
    const summary = sheetByName(build({ chartImage: null }), 'ภาพรวม');
    expect(summary.images).toBeUndefined();
  });
});
