/**
 * The dashboard, as a workbook — built entirely from what `DashboardPage`
 * already holds in state.
 *
 * There is no second fetch here and no server endpoint behind it. The page's
 * data arrived through APIs the server already scopes to the caller (a club
 * sees its own row, STUACT its jurisdiction, ADMIN everything); reusing that
 * same data for the export is what keeps the file scoped identically to the
 * screen, without a second copy of that authorization logic to get wrong.
 *
 * Uses `write-excel-file` rather than the `xlsx` package already in this repo
 * (see `docs/DECISIONS.md`, "xlsx has two unpatched CVEs"): that decision
 * kept `xlsx` to a write-only path because its free tier cannot embed images
 * or style cells on write at all, and this export needs both.
 *
 * `write-excel-file` was the second library tried here, not the first —
 * ExcelJS (the more commonly recommended one) looked right on paper but its
 * browser bundle turned out to depend on Node's `stream` module deeply enough
 * that `workbook.xlsx.writeBuffer()` hung forever under every browser stream
 * polyfill tried, discovered only by actually clicking the button and
 * watching it hang, not from anything in ExcelJS's docs or issues.
 * `write-excel-file` has no such problem: its only dependency is `fflate`
 * (a zip library with zero Node built-ins), and `browser/index.js` doesn't
 * touch `fs`/`stream`/`crypto` at all — confirmed by unzipping actual spike
 * output rather than trusting the README a second time.
 */
import writeExcelFile from 'write-excel-file/browser';

import { computePhaseChartSlices } from './phaseChartData';
import { renderPieChartPng } from './pieChartImage';

const BRAND = '#AC3520';
const BRAND_TEXT = '#FFFFFF';
const OVER_COMMITTED_FILL = '#FCF3E3';
const MONEY_FORMAT = '#,##0.00';

function headerCell(value) {
  return { value, fontWeight: 'bold', backgroundColor: BRAND, textColor: BRAND_TEXT };
}

function phaseSheetData(phases, counts) {
  const rows = [
    [headerCell('ลำดับ'), headerCell('สถานะ'), headerCell('จำนวนโครงการ')],
  ];
  for (const phase of phases) {
    rows.push([
      { value: phase.ordinal, type: Number },
      { value: phase.name_th },
      { value: counts.get(phase.code) || 0, type: Number },
    ]);
  }
  return rows;
}

function allocationSheetData(allocations, unfundedClubs, academicYear) {
  const rows = [
    [
      headerCell('รหัสชมรม'), headerCell('ชื่อชมรม'), headerCell('วิทยาเขต'),
      headerCell('จัดสรร (บาท)'), headerCell('อนุมัติแล้ว (บาท)'), headerCell('คงเหลือ (บาท)'),
      headerCell('สถานะ'),
    ],
  ];
  for (const a of allocations.items) {
    const fill = a.overCommitted ? { backgroundColor: OVER_COMMITTED_FILL } : {};
    rows.push([
      { value: a.club.code, ...fill },
      { value: a.club.nameTh, ...fill },
      { value: a.campus.nameTh, ...fill },
      { value: Number(a.amount), type: Number, format: MONEY_FORMAT, ...fill },
      { value: Number(a.committed), type: Number, format: MONEY_FORMAT, ...fill },
      { value: Number(a.remaining), type: Number, format: MONEY_FORMAT, ...fill },
      { value: a.overCommitted ? 'เกินวงเงิน' : 'ปกติ', ...fill },
    ]);
  }
  for (const club of unfundedClubs) {
    rows.push([
      { value: club.code },
      { value: club.nameTh },
      { value: club.campusName || '' },
      { value: null },
      { value: null },
      { value: null },
      { value: `ยังไม่ได้กำหนดวงเงินปี ${academicYear}` },
    ]);
  }
  return rows;
}

function summarySheetData({ academicYear, scopeLabel, totalProjects, generatedAt }) {
  return [
    [{ value: 'ภาพรวมโครงการกิจกรรมนักศึกษา', fontWeight: 'bold', fontSize: 16, textColor: BRAND }],
    [],
    [{ value: 'ปีการศึกษา', fontWeight: 'bold' }, { value: academicYear, type: Number }],
    [{ value: 'ขอบเขต', fontWeight: 'bold' }, { value: scopeLabel || 'ทั้งระบบ' }],
    [{ value: 'จำนวนโครงการทั้งหมด', fontWeight: 'bold' }, { value: totalProjects, type: Number }],
    [{ value: 'ออกรายงานเมื่อ', fontWeight: 'bold' }, { value: generatedAt }],
  ];
}

// Doubled versus the image's *logical* size: `pieChartImage.js` renders the
// canvas at 2x for crispness, and a doubled DPI is the standard way to tell
// a `.xlsx` viewer "this many raw pixels, but display them at half that" —
// the same idea as a `@2x` asset.
const CHART_DPI = 192;

/**
 * `unfundedClubs` and `allocations`/`phases`/`counts` mirror exactly what
 * `DashboardPage` already computed for the screen — passed in rather than
 * recomputed, so the two can never drift apart.
 *
 * `chartImage`, when given, is `{ blob, width, height }` from
 * `renderPieChartPng` — anchored on the summary sheet. It is a parameter
 * rather than rendered in here so this function stays plain-data and
 * testable without a real `<canvas>`, which jsdom (this repo's test
 * environment) does not implement; tests pass a tiny fixture PNG instead.
 */
export function buildDashboardSheets({
  academicYear, scopeLabel, phases, counts, projectsTotal, allocations, unfundedClubs, chartImage,
}) {
  const generatedAt = new Date().toLocaleString('th-TH');

  const summarySheet = {
    sheet: 'ภาพรวม',
    data: summarySheetData({ academicYear, scopeLabel, totalProjects: projectsTotal, generatedAt }),
    columns: [{ width: 24 }, { width: 30 }],
  };
  if (chartImage) {
    summarySheet.images = [{
      content: chartImage.blob,
      contentType: 'image/png',
      width: chartImage.width,
      height: chartImage.height,
      dpi: CHART_DPI,
      anchor: { row: 6, column: 0 },
    }];
  }

  return [
    summarySheet,
    {
      sheet: 'สถานะโครงการ',
      data: phaseSheetData(phases, counts),
      columns: [{ width: 10 }, { width: 24 }, { width: 16 }],
      stickyRowsCount: 1,
    },
    {
      sheet: 'วงเงินจัดสรร',
      data: allocationSheetData(allocations, unfundedClubs, academicYear),
      columns: [
        { width: 12 }, { width: 26 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 22 },
      ],
      stickyRowsCount: 1,
    },
  ];
}

export async function downloadDashboardExcel(args) {
  const slices = computePhaseChartSlices(args.phases, args.counts);
  const chartImage = slices.length
    ? await renderPieChartPng(slices, 'สัดส่วนโครงการตามสถานะ')
    : null;

  const sheets = buildDashboardSheets({ ...args, chartImage });

  // A club or group name is free text and could carry a path separator; the
  // filename is built from it, so that gets scrubbed before it reaches the OS.
  const safeScope = args.scopeLabel ? args.scopeLabel.replace(/[\\/:*?"<>|]/g, ' ').trim() : '';
  const scopeSuffix = safeScope ? `_${safeScope}` : '';
  await writeExcelFile(sheets).toFile(`dashboard_${args.academicYear}${scopeSuffix}.xlsx`);
}
