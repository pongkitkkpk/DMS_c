/**
 * Where a year's money stands — per campus, per club group, then per club.
 *
 * Three levels, widest first, because that is how the university is organised
 * and how an officer narrows down: which campus, then which group inside it,
 * then which club. The middle level is the one a STUACT is actually responsible
 * for — `membership.jurisdiction_club_group_id` is a club group — which is also
 * why a STUACT sees no chart of it: they hold exactly one, and a comparison of
 * one is not a comparison.
 *
 * The figures on this page are not new. `วงเงินจัดสรร` already lists every
 * allocation and every project already carries its approved amount and its
 * payments. What did not exist was a way to *compare* them: a column of
 * `500,000.00` beside `96,000.00` makes the reader work out the ratio, and do
 * it again for the next club, and hold both in their head to say which club is
 * behind. That is a job for a picture, so this page draws one.
 *
 * Officers only, and the server says so too — `GET /api/spending` refuses
 * anybody who is not ADMIN or STUACT rather than quietly narrowing. A student
 * or an adviser sees their own club's ceiling on the allocations screen (Q30);
 * a cross-club comparison is the view of somebody responsible for more than one
 * club. STUACT still sees only its own jurisdiction, ADMIN sees all of it, and
 * neither has to be told which — the scope is applied in the query.
 *
 * Every chart is followed by the same figures as a table. That is not a
 * fallback for a browser that cannot draw: a chart answers "which club is
 * behind" and a table answers "how much exactly", and the two questions arrive
 * together on a page about money.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useHistory } from 'react-router-dom';
import { Alert, Input } from 'reactstrap';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { Card, Empty, Skeleton, money } from '../components/ui';
import { MoneyMeter } from '../components/MoneyMeter';

/**
 * One headline figure. The dashboard's `.kpi` tile, reused rather than
 * reinvented — it already is a stat tile, down to the proportional figures.
 */
function StatTile({ label, value, note, tone }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value" style={tone ? { color: tone } : undefined}>{money(value)}</div>
      {note && <div className="kpi__note">{note}</div>}
    </div>
  );
}

/**
 * One level of the rollup: the chart, then the same figures as a table.
 *
 * The chart is what `MoneyMeter` decides to draw — it declines a single row,
 * because the shared scale exists for comparing rows and one row has nothing to
 * compare against. The spacing follows that decision rather than being hung on
 * the table unconditionally, so a section with no chart does not open with an
 * unexplained gap.
 */
function MoneySection({ rows, firstColumn }) {
  const charted = rows.length > 1;
  return (
    <>
      <MoneyMeter rows={rows} />
      <div style={charted ? { marginTop: 'var(--s-5)' } : undefined}>
        <MoneyTable rows={rows} firstColumn={firstColumn} />
      </div>
    </>
  );
}

/**
 * `committed ÷ allocated`, as a percentage — "how much of the ceiling has
 * been promised to a project", not "how much has actually been spent"
 * (that comparison is `disbursed ÷ allocated`, a different question, kept
 * separate rather than folded into this one number).
 *
 * A club with no ceiling has no ratio to report — `0 ÷ 0` is not "0%", it is
 * "not applicable", so it prints the same em dash `money()` uses for a
 * missing figure rather than a misleading `0.0%`.
 */
function usagePercent(allocated, committed) {
  // Both arrive as decimal strings (`"500000.00"`), like every other money
  // figure on this page — `!allocated` would miss `"0.00"`, which is truthy
  // as a non-empty string regardless of what number it spells.
  const denominator = Number(allocated);
  if (!denominator) return '—';
  return `${((Number(committed) / denominator) * 100).toFixed(1)}%`;
}

/** The table that carries the exact figures the chart above it draws. */
function MoneyTable({ rows, firstColumn }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table-x">
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th style={{ textAlign: 'right' }}>จัดสรร</th>
            <th style={{ textAlign: 'right' }}>อนุมัติแล้ว</th>
            <th style={{ textAlign: 'right' }}>% ใช้เงิน</th>
            <th style={{ textAlign: 'right' }}>จ่ายจริง</th>
            <th style={{ textAlign: 'right' }}>คงเหลือ</th>
            <th style={{ textAlign: 'right' }}>เสนออนุมัติ</th>
            <th style={{ textAlign: 'right' }}>ปิดโครงการ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <div className="table-x__title">{row.label}</div>
                {row.sublabel && <div className="u-small u-dim">{row.sublabel}</div>}
              </td>
              <td className="u-mono" style={{ textAlign: 'right' }}>{money(row.allocated)}</td>
              <td className="u-mono" style={{ textAlign: 'right' }}>{money(row.committed)}</td>
              <td className="u-mono" style={{ textAlign: 'right' }}>
                {usagePercent(row.allocated, row.committed)}
              </td>
              <td className="u-mono" style={{ textAlign: 'right' }}>{money(row.disbursed)}</td>
              <td
                className="u-mono"
                style={{
                  textAlign: 'right',
                  fontWeight: 600,
                  color: row.overCommitted ? 'var(--c-danger)' : undefined,
                }}
              >
                {money(row.remaining)}
                {row.overCommitted && <div className="u-small">เกินวงเงิน</div>}
              </td>
              <td className="u-mono" style={{ textAlign: 'right' }}>{row.submitted}</td>
              <td className="u-mono" style={{ textAlign: 'right' }}>{row.closed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SpendingPage() {
  const { session } = useAuth();
  const location = useLocation();
  const history = useHistory();

  // Seeded from the URL, like the allocations screen, so a particular year can
  // be sent to somebody rather than described to them.
  const [year, setYear] = useState(() => {
    const asked = Number(new URLSearchParams(location.search).get('year'));
    return Number.isInteger(asked) && asked > 2400 && asked < 2700 ? asked : session.academicYear;
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.spending({ year }).then(setData).catch((err) => setError(messageOf(err)));
  }, [year]);

  useEffect(load, [load]);

  const chooseYear = (next) => {
    setYear(next);
    setData(null);
    history.replace(`/spending?year=${next}`);
  };

  const years = (data && data.years.length ? data.years : [year]);

  const campusRows = data ? data.byCampus.map((row) => ({
    key: `campus-${row.campus.id}`,
    label: row.campus.nameTh,
    sublabel: `${row.activeClubs} จาก ${row.clubs} ชมรม`,
    ...row,
  })) : [];

  const groupRows = data ? data.byClubGroup.map((row) => ({
    key: `group-${row.clubGroup.id === null ? 'none' : row.clubGroup.id}`,
    label: row.clubGroup.nameTh,
    sublabel: `${row.activeClubs} จาก ${row.clubs} ชมรม`,
    ...row,
  })) : [];

  const clubRows = data ? data.byClub.map((row) => ({
    key: `club-${row.club.id}`,
    label: row.club.nameTh,
    sublabel: `${row.club.code} · ${row.campus.nameTh} · ${row.projects} โครงการ`,
    ...row,
  })) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สรุปการใช้เงิน</h1>
          <div className="u-small u-dim">
            เงินที่จัดสรร อนุมัติ และจ่ายจริง ในปีการศึกษาที่เลือก
          </div>
        </div>

        <div className="u-spacer u-row">
          <Link className="u-small u-muted" to="/allocations">กำหนดวงเงิน →</Link>
          <Input
            type="select"
            style={{ width: 'auto' }}
            aria-label="ปีการศึกษา"
            value={year}
            onChange={(e) => chooseYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                ปีการศึกษา {y}{y === session.academicYear ? ' (ปีปัจจุบัน)' : ''}
              </option>
            ))}
          </Input>
        </div>
      </div>

      {error && <Alert color="danger">{error}</Alert>}

      {!data && !error && <Card title="กำลังโหลด"><Skeleton rows={6} /></Card>}

      {data && (
        <div className="u-stack">
          {/*
            The headline row. Four numbers, not a chart: a single current value
            is a stat tile, and a one-bar bar chart of the same number would be
            decoration. "คงเหลือ" is the one that changes colour, because it is
            the only one that can be wrong.
          */}
          <div className="kpi-row">
            <StatTile label="จัดสรรทั้งหมด" value={data.totals.allocated}
              note={`${data.totals.activeClubs} ชมรมที่มีความเคลื่อนไหว`} />
            <StatTile label="อนุมัติแล้ว" value={data.totals.committed}
              note={`${data.totals.projects} โครงการ`} />
            <StatTile label="จ่ายจริง" value={data.totals.disbursed}
              note="เงินที่ออกจากบัญชีแล้ว" />
            <StatTile
              label="คงเหลือ"
              value={data.totals.remaining}
              tone={data.totals.overCommitted ? 'var(--c-danger)' : undefined}
              note={data.totals.overCommitted ? 'อนุมัติเกินวงเงินรวม' : 'ยังไม่ผูกกับโครงการใด'}
            />
          </div>

          {/*
            Campus, then club group, then club — the three levels the university
            organises itself by, widest first.

            Each level is drawn only when there is more than one of it to
            compare. A STUACT is responsible for exactly one club group, so its
            group chart would be a single bar restating the headline figure
            above it, and a bar chart of one value is not a chart. The same rule
            covers an officer whose whole scope sits on one campus.
          */}
          {campusRows.length > 1 && (
            <Card title="ตามวิทยาเขต" aside={`ปีการศึกษา ${data.academicYear}`}>
              <MoneySection rows={campusRows} firstColumn="วิทยาเขต" />
            </Card>
          )}

          {groupRows.length > 1 && (
            <Card
              title="ตามกลุ่มชมรม"
              aside={`${groupRows.length} กลุ่ม`}
            >
              <MoneySection rows={groupRows} firstColumn="กลุ่มชมรม" />
            </Card>
          )}

          <Card
            title="ตามชมรม"
            aside={
              data.totals.idleClubs > 0
                ? `${data.totals.activeClubs} ชมรมที่มีความเคลื่อนไหว · อีก ${data.totals.idleClubs} ชมรมยังไม่มี`
                : `${data.totals.activeClubs} ชมรม`
            }
          >
            {clubRows.length === 0
              ? (
                <Empty
                  mark="฿"
                  title={`ยังไม่มีชมรมใดเคลื่อนไหวในปี ${data.academicYear}`}
                  hint="เมื่อกำหนดวงเงินหรือมีโครงการเกิดขึ้น ชมรมนั้นจะปรากฏที่นี่"
                />
              )
              : (
                /* Sorted by allocation on the server. A chart of a comparison
                   sorted by club code makes the reader do the sorting. */
                <MoneySection rows={clubRows} firstColumn="ชมรม" />
              )}
          </Card>
        </div>
      )}
    </>
  );
}
