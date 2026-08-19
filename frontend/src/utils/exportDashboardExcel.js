/**
 * The dashboard, as a workbook — built entirely from what `DashboardPage`
 * already holds in state.
 *
 * There is no second fetch here and no server endpoint behind it. The page's
 * data arrived through APIs the server already scopes to the caller (a club
 * sees its own row, STUACT its jurisdiction, ADMIN everything); reusing that
 * same data for the export is what keeps the file scoped identically to the
 * screen, without a second copy of that authorization logic to get wrong.
 */
import * as XLSX from 'xlsx';

function phaseSheet(phases, counts) {
  const rows = phases.map((phase) => ({
    'ลำดับ': phase.ordinal,
    'สถานะ': phase.name_th,
    'จำนวนโครงการ': counts.get(phase.code) || 0,
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function allocationSheet(allocations, unfundedClubs, academicYear) {
  const rows = allocations.items.map((a) => ({
    'รหัสชมรม': a.club.code,
    'ชื่อชมรม': a.club.nameTh,
    'วิทยาเขต': a.campus.nameTh,
    'จัดสรร (บาท)': Number(a.amount),
    'อนุมัติแล้ว (บาท)': Number(a.committed),
    'คงเหลือ (บาท)': Number(a.remaining),
    'สถานะ': a.overCommitted ? 'เกินวงเงิน' : 'ปกติ',
  }));
  for (const club of unfundedClubs) {
    rows.push({
      'รหัสชมรม': club.code,
      'ชื่อชมรม': club.nameTh,
      'วิทยาเขต': club.campusName || '',
      'จัดสรร (บาท)': null,
      'อนุมัติแล้ว (บาท)': null,
      'คงเหลือ (บาท)': null,
      'สถานะ': `ยังไม่ได้กำหนดวงเงินปี ${academicYear}`,
    });
  }
  return XLSX.utils.json_to_sheet(rows);
}

function summarySheet({ academicYear, scopeLabel, totalProjects, generatedAt }) {
  const rows = [
    { 'รายการ': 'ปีการศึกษา', 'ค่า': academicYear },
    { 'รายการ': 'ขอบเขต', 'ค่า': scopeLabel || 'ทั้งระบบ' },
    { 'รายการ': 'จำนวนโครงการทั้งหมด', 'ค่า': totalProjects },
    { 'รายการ': 'ออกรายงานเมื่อ', 'ค่า': generatedAt },
  ];
  return XLSX.utils.json_to_sheet(rows, { skipHeader: true });
}

/**
 * `unfundedClubs` and `allocations`/`phases`/`counts` mirror exactly what
 * `DashboardPage` already computed for the screen — passed in rather than
 * recomputed, so the two can never drift apart.
 */
export function buildDashboardWorkbook({
  academicYear, scopeLabel, phases, counts, projectsTotal, allocations, unfundedClubs,
}) {
  const wb = XLSX.utils.book_new();
  const generatedAt = new Date().toLocaleString('th-TH');
  XLSX.utils.book_append_sheet(
    wb,
    summarySheet({ academicYear, scopeLabel, totalProjects: projectsTotal, generatedAt }),
    'ภาพรวม',
  );
  XLSX.utils.book_append_sheet(wb, phaseSheet(phases, counts), 'สถานะโครงการ');
  XLSX.utils.book_append_sheet(
    wb,
    allocationSheet(allocations, unfundedClubs, academicYear),
    'วงเงินจัดสรร',
  );
  return wb;
}

export function downloadDashboardExcel(args) {
  const wb = buildDashboardWorkbook(args);
  // A club or group name is free text and could carry a path separator; the
  // filename is built from it, so that gets scrubbed before it reaches the OS.
  const safeScope = args.scopeLabel ? args.scopeLabel.replace(/[\\/:*?"<>|]/g, ' ').trim() : '';
  const scopeSuffix = safeScope ? `_${safeScope}` : '';
  XLSX.writeFile(wb, `dashboard_${args.academicYear}${scopeSuffix}.xlsx`);
}
