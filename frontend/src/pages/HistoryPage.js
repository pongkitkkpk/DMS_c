/**
 * Every academic year on one screen.
 *
 * The rest of the system is deliberately single-year: a token resolves one
 * year's membership, the project list shows that year's projects, the
 * allocations page picks a year and stays there. That is right for doing the
 * work and useless for the question an officer actually asks at the end of a
 * year — was the money used, and did the projects finish?
 *
 * Two tables rather than one. Money and phase counts are both per year, but
 * they are read at different widths: the money is four numbers you compare down
 * a column, and the phase distribution is seven numbers you compare across a
 * row. Interleaving them makes both harder to read than either alone.
 *
 * Nothing here can be edited. Where a year invites action, it links to the
 * screen that owns it rather than growing a second way to do the same thing.
 */
import React, { useEffect, useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import { Alert } from 'reactstrap';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { Card, Empty, PhasePill, Skeleton, money, rowLinkClick } from '../components/ui';

/** Q30 again — who may set a ceiling, as opposed to read one. */
const MAY_ALLOCATE = ['ADMIN', 'STUACT'];

export default function HistoryPage() {
  const { session } = useAuth();
  const history = useHistory();
  const [data, setData] = useState(null);
  const [phases, setPhases] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.history(), api.phases()])
      .then(([h, p]) => {
        setData(h);
        setPhases(p.phases);
      })
      .catch((err) => setError(messageOf(err)));
  }, []);

  if (error) return <Alert color="danger">{error}</Alert>;
  if (!data) return <div className="card-x card-x__body"><Skeleton rows={8} /></div>;

  const years = data.items;
  const totalProjects = years.reduce((sum, y) => sum + y.projectCount, 0);

  // A year reports counts only for the phases it has projects in, so the matrix
  // is filled against the full ordered phase list rather than against whatever
  // each row happened to contain — otherwise the columns would not line up.
  const countFor = (year, code) => {
    const found = year.byPhase.find((p) => p.code === code);
    return found ? found.count : 0;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สรุปรายปี</h1>
          <div className="u-small u-dim">
            {years.length} ปีการศึกษา · {totalProjects} โครงการ ในขอบเขตของบัญชีนี้
          </div>
        </div>
        {/* Q30: only Admin and STUACT set a ceiling, everyone in scope reads
            one. Labelling this "กำหนดวงเงิน" for an adviser or a student sent
            them to a page where every control is hidden and the header says
            read-only — an invitation to do something the system had already
            decided they may not. */}
        <Link className="u-spacer u-small u-muted" to="/allocations">
          {MAY_ALLOCATE.includes(session.role) ? 'กำหนดวงเงิน →' : 'ดูวงเงินจัดสรร →'}
        </Link>
      </div>

      {years.length === 0 ? (
        <div className="card-x">
          <Empty mark="□" title="ยังไม่มีข้อมูลปีใดในขอบเขตของบัญชีนี้" />
        </div>
      ) : (
        <div className="u-stack">
          <Card title="งบประมาณรายปี" aside="สรุปจากข้อมูลจริง ไม่ได้เก็บเป็นยอดสะสม">
            <div style={{ overflowX: 'auto' }}>
              <table className="table-x">
                <thead>
                  <tr>
                    <th style={{ width: '12rem' }}>ปีการศึกษา</th>
                    <th style={{ width: '9rem', textAlign: 'right' }}>ชมรมที่จัดสรร</th>
                    <th style={{ width: '10rem', textAlign: 'right' }}>จัดสรร</th>
                    <th style={{ width: '10rem', textAlign: 'right' }}>อนุมัติแล้ว</th>
                    <th style={{ width: '10rem', textAlign: 'right' }}>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr
                      key={year.academicYear}
                      onClick={rowLinkClick(history, `/allocations?year=${year.academicYear}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        {/* Two tables on this page each link a bare year, and
                            the two go to different screens. "2567" twice tells
                            a reader which year and not which page. */}
                        <Link
                          to={`/allocations?year=${year.academicYear}`}
                          className="table-x__title"
                          aria-label={`วงเงินจัดสรร ปีการศึกษา ${year.academicYear}`}
                        >
                          {year.academicYear}
                        </Link>
                        {/* The count always shows. Swapping it out for the
                            "ปีปัจจุบัน" label made the one row a reader most
                            wants to compare the only row with nothing to
                            compare. */}
                        <div className="u-small u-dim">
                          {year.projectCount} โครงการ
                          {year.isCurrent && ' · ปีปัจจุบัน'}
                        </div>
                      </td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>
                        {year.clubsFunded}
                        {/* Q33 again: a year whose total looks healthy can still
                            contain a club that has overspent, so the per-club
                            count is reported next to the club count and not
                            folded into the year's remaining. */}
                        {year.clubsOverCommitted > 0 && (
                          <div className="u-small" style={{ color: 'var(--c-danger)' }}>
                            เกินวงเงิน {year.clubsOverCommitted}
                          </div>
                        )}
                      </td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>{money(year.allocated)}</td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>{money(year.committed)}</td>
                      <td
                        className="u-mono"
                        style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          color: year.overCommitted ? 'var(--c-danger)' : undefined,
                        }}
                      >
                        {money(year.remaining)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="โครงการตามสถานะ" aside={`${totalProjects} โครงการ`}>
            {totalProjects === 0 ? (
              <Empty mark="□" title="ยังไม่มีโครงการในขอบเขตของบัญชีนี้" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table-x">
                  <thead>
                    <tr>
                      <th style={{ width: '8rem' }}>ปีการศึกษา</th>
                      {phases.map((phase) => (
                        <th key={phase.code} style={{ textAlign: 'right' }}>
                          <PhasePill code={phase.code}>{phase.ordinal}</PhasePill>
                          <div className="u-small u-dim" style={{ fontWeight: 400 }}>
                            {phase.name_th}
                          </div>
                        </th>
                      ))}
                      <th style={{ width: '6rem', textAlign: 'right' }}>รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((year) => (
                      <tr
                        key={year.academicYear}
                        onClick={rowLinkClick(history, `/projects?year=${year.academicYear}`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <Link
                            to={`/projects?year=${year.academicYear}`}
                            className="table-x__title"
                            aria-label={`โครงการ ปีการศึกษา ${year.academicYear}`}
                          >
                            {year.academicYear}
                          </Link>
                        </td>
                        {phases.map((phase) => {
                          const count = countFor(year, phase.code);
                          return (
                            <td
                              key={phase.code}
                              className="u-mono"
                              style={{ textAlign: 'right' }}
                            >
                              {/* A zero is dimmed rather than blank: an empty
                                  cell reads as "no data", and "no projects in
                                  this phase" is a different, knowable thing. */}
                              <span className={count === 0 ? 'u-dim' : undefined}>{count}</span>
                            </td>
                          );
                        })}
                        <td className="u-mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                          {year.projectCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="u-small u-dim mt-3">
        ปีปัจจุบันคือ {session.academicYear} · ตัวเลขทั้งหมดคำนวณจากข้อมูลจริงทุกครั้งที่เปิดหน้านี้
      </div>
    </>
  );
}
