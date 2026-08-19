import * as XLSX from 'xlsx';

import { buildDashboardWorkbook } from './exportDashboardExcel';

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

function sheetRows(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name]);
}

describe('buildDashboardWorkbook', () => {
  const build = () => buildDashboardWorkbook({
    academicYear: 2567,
    scopeLabel: 'ชมรมเอ',
    phases,
    counts: new Map([['P1', 3], ['P2', 1]]),
    projectsTotal: 4,
    allocations,
    unfundedClubs,
  });

  test('carries every phase, including ones with zero projects', () => {
    const rows = sheetRows(build(), 'สถานะโครงการ');
    expect(rows).toHaveLength(2);
    expect(rows[0]['จำนวนโครงการ']).toBe(3);
    expect(rows[1]['จำนวนโครงการ']).toBe(1);
  });

  test('allocation sheet carries funded clubs as numbers and flags the over-committed one', () => {
    const rows = sheetRows(build(), 'วงเงินจัดสรร');
    expect(rows[0]['จัดสรร (บาท)']).toBe(10000);
    expect(rows[1]['สถานะ']).toBe('เกินวงเงิน');
  });

  test('an unfunded club appears without amounts, marked as unfunded rather than zero', () => {
    const rows = sheetRows(build(), 'วงเงินจัดสรร');
    const row = rows.find((r) => r['รหัสชมรม'] === 'C03');
    expect(row['จัดสรร (บาท)']).toBeNull();
    expect(row['สถานะ']).toBe('ยังไม่ได้กำหนดวงเงินปี 2567');
  });

  test('summary sheet names the scope and the year', () => {
    const rows = XLSX.utils.sheet_to_json(build().Sheets['ภาพรวม'], { header: 1 });
    expect(rows).toContainEqual(['ปีการศึกษา', 2567]);
    expect(rows).toContainEqual(['ขอบเขต', 'ชมรมเอ']);
  });
});
