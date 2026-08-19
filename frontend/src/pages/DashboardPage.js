/**
 * The dashboard — where the phase machine and the money are visible at once.
 *
 * It carries the one signal Phase 3 built an API for and nothing rendered:
 * **Q33's over-committed allocation**. Lowering a club's yearly ceiling below
 * what has already been approved is *allowed* — the money has been promised, and
 * refusing to record the smaller number would only make the system's figure and
 * the university's disagree quietly. The bargain is that it is loud, and this is
 * where it is loud.
 *
 * Everything here is scoped by the server. There is no club selector that widens
 * what a caller can see; the lists are simply what their membership reaches.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Input } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { Card, Empty, PhasePill, Skeleton, money } from '../components/ui';
import { downloadDashboardExcel } from '../utils/exportDashboardExcel';

/** Admin and STUACT enter allocations; adviser and student read them (Q30). */
const MAY_ALLOCATE = ['ADMIN', 'STUACT'];

export default function DashboardPage() {
  const { session } = useAuth();
  const [projects, setProjects] = useState(null);
  const [allocations, setAllocations] = useState(null);
  const [clubs, setClubs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [error, setError] = useState(null);

  const mayAllocate = MAY_ALLOCATE.includes(session.role);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      // Scoped to the year this page says it is showing, for the same reason
      // the allocations below are. Found by rolling the academic year forward
      // and looking: the header read 2568, the money card read 2568, and the
      // phase tiles counted eight projects of which one was 2568's. A year's
      // overview that silently includes every previous year is worse than no
      // overview, because it looks like an answer.
      api.listProjects({ pageSize: 200, year: session.academicYear }),
      // Pinned to the current year on purpose. Asking with no year returns
      // every year the actor may see, and this table renders the club name
      // alone — so the moment a second year existed, each club appeared twice
      // with nothing to tell the two rows apart. The year-by-year view lives on
      // /allocations, which asks the question properly.
      api.allocations({ year: session.academicYear }),
      api.phases(),
      mayAllocate ? api.clubs() : Promise.resolve({ clubs: [] }),
      // Officers only, and never allowed to break the page it sits on: a
      // dashboard that fails to load because a readiness banner could not be
      // computed would be a poor trade for a reminder.
      mayAllocate ? api.readiness().catch(() => null) : Promise.resolve(null),
    ])
      .then(([p, a, r, c, next]) => {
        setProjects(p);
        setAllocations(a);
        setPhases(r.phases);
        setClubs(c.clubs);
        setReadiness(next);
      })
      .catch((err) => setError(messageOf(err)));
  }, [mayAllocate, session.academicYear]);

  useEffect(load, [load]);

  const editAllocation = async (clubId, clubName, current) => {
    const asked = await Swal.fire({
      title: `วงเงินจัดสรร — ${clubName}`,
      input: 'text',
      inputValue: current === null || current === undefined ? '' : String(Number(current)),
      inputLabel: `ปีการศึกษา ${session.academicYear} (บาท)`,
      showCancelButton: true,
      confirmButtonText: 'บันทึก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
    });
    if (!asked.isConfirmed) return;

    try {
      const result = await api.setAllocation({
        clubId, academicYear: session.academicYear, amount: asked.value,
      });
      // Q33: the write succeeds and says so. This is the loud half.
      if (result.warnings.length) {
        await Swal.fire({ icon: 'warning', title: 'บันทึกแล้ว แต่โปรดทราบ', text: result.warnings[0].message });
      }
      load();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: messageOf(err) });
    }
  };

  /**
   * Move the whole system into the next academic year.
   *
   * Named in full and confirmed, because nothing else on this site changes what
   * every other user may do. The refusal path matters as much as the happy one:
   * the server's message says exactly which piece is missing, so it is shown
   * rather than replaced with a generic failure.
   */
  const advanceYear = async (year) => {
    const confirmed = await Swal.fire({
      icon: 'warning',
      title: `เปลี่ยนปีการศึกษาเป็น ${year}`,
      html:
        `<div style="text-align:left">` +
        `<div>ทั้งระบบจะย้ายไปปี <strong>${year}</strong> ทันที</div>` +
        `<div class="mt-2">สิทธิ์ วงเงิน และโครงการ จะอ้างอิงปี ${year} — ` +
        `ผู้ที่ไม่ได้รับสิทธิ์ของปีนั้นจะใช้งานอะไรไม่ได้จนกว่าจะได้รับ</div>` +
        `<div class="mt-2">เปลี่ยนกลับได้ ถ้าปีเดิมยังมีผู้ดูแลระบบอยู่</div>` +
        `</div>`,
      showCancelButton: true,
      confirmButtonText: `เปลี่ยนเป็นปี ${year}`,
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
    });
    if (!confirmed.isConfirmed) return;

    try {
      await api.setAcademicYear(year);
      // Everything on every screen is scoped by the year, including this
      // session's own resolved role. A reload is the honest way to redraw it.
      window.location.reload();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'เปลี่ยนปีไม่สำเร็จ', text: messageOf(err) });
    }
  };

  if (error) return <Alert color="danger">{error}</Alert>;
  if (!projects || !allocations) return <div className="card-x card-x__body"><Skeleton rows={8} /></div>;

  const counts = new Map();
  for (const project of projects.items) {
    counts.set(project.phase.code, (counts.get(project.phase.code) || 0) + 1);
  }

  // Clubs with no allocation row yet are shown alongside the ones that have
  // one: a missing ceiling is not a blank space, it is the thing that will
  // block the club's next money approval.
  const funded = new Set(allocations.items.map((a) => a.club.id));
  const unfunded = clubs.filter((club) => !funded.has(club.id));

  // What this page covers, named the way the token actually scopes it. A club
  // member — SH or AD — belongs to a club group, but sees none of the group's
  // other clubs, so naming the group here claimed a reach the table below it
  // contradicts. Only STUACT is scoped to a whole group, and that membership is
  // the one with no club of its own; ADMIN is scoped to everything and says
  // nothing. So: the club when there is one, the group when there is not.
  const membership = session.membership;
  const scopeLabel = (membership && (membership.club_name || membership.club_group_name)) || '';

  const exportExcel = () => {
    downloadDashboardExcel({
      academicYear: session.academicYear,
      scopeLabel,
      phases,
      counts,
      projectsTotal: projects.total,
      allocations,
      unfundedClubs: unfunded,
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ภาพรวม</h1>
          <div className="u-small u-dim">
            ปีการศึกษา {session.academicYear}
            {scopeLabel && ` · ${scopeLabel}`}
          </div>
        </div>
        <div className="u-spacer u-row">
          <Button size="sm" outline color="secondary" onClick={exportExcel}>
            ดาวน์โหลด Excel
          </Button>
          <Link className="u-small u-muted" to="/projects">ดูรายการโครงการทั้งหมด →</Link>
        </div>
      </div>

      {/* Three things have to exist before a year can be worked in — its
          allocations, its roles, and the year itself — and all three can now be
          prepared in advance while nothing anywhere says they should be. A club
          with no ceiling cannot have money approved and a year with no student
          head has nobody who can open a project; both fail at the moment
          somebody needs them. Shown as state rather than as a deadline: the
          June boundary is still a guess, and a reminder built on a guess about
          when the year turns would be wrong once a year. */}
      {readiness && !readiness.ready && (
        <div className="notice mb-4">
          <span className="notice__mark" aria-hidden="true">i</span>
          <span>
            ปีการศึกษา <strong>{readiness.academicYear}</strong> ยังไม่ได้เตรียม —{' '}
            วงเงิน {readiness.clubsFunded}/{readiness.clubsTotal} ชมรม ·{' '}
            หัวหน้านักศึกษา {readiness.clubsWithHead}/{readiness.clubsTotal} ชมรม ·{' '}
            อาจารย์ที่ปรึกษา {readiness.clubsWithAdvisor}/{readiness.clubsTotal} ชมรม{' '}
            <Link to={`/allocations?year=${readiness.academicYear}`}>กำหนดวงเงิน</Link>
            {' · '}
            <Link to="/roles">กำหนดสิทธิ์</Link>
            {/* The move lives here because this is where the evidence for it
                already is. Offered only to an Admin, and only once the target
                year has an Admin of its own — the server refuses otherwise, and
                a button that exists to be refused teaches people to ignore
                buttons. Until then the banner says which piece is missing. */}
            {session.role === 'ADMIN' && (
              readiness.hasAdmin ? (
                <>
                  {' · '}
                  <Button size="sm" color="primary" className="ml-2"
                    onClick={() => advanceYear(readiness.academicYear)}>
                    เปลี่ยนเป็นปี {readiness.academicYear}
                  </Button>
                </>
              ) : (
                <div className="u-small mt-1">
                  ยังเปลี่ยนปีไม่ได้ — ปี {readiness.academicYear} ต้องมีผู้ดูแลระบบอย่างน้อยหนึ่งคนก่อน
                </div>
              )
            )}
          </span>
        </div>
      )}

      {allocations.overCommitted.length > 0 && (
        <div className="notice notice--danger mb-4">
          <span className="notice__mark" aria-hidden="true">!</span>
          <span>
            <strong>{allocations.overCommitted.length} ชมรม</strong> มียอดอนุมัติเกินวงเงินจัดสรรของปีนี้ —{' '}
            {allocations.overCommitted.map((a) => a.club.nameTh).join(', ')}
          </span>
        </div>
      )}

      <div className="u-stack">
        <Card title="โครงการตามสถานะ" aside={`${projects.total} โครงการ`}>
          {projects.total === 0 ? (
            <Empty mark="□" title="ยังไม่มีโครงการในขอบเขตของบัญชีนี้" />
          ) : (
            <div className="kpi-row">
              {phases.map((phase) => (
                <Link
                  key={phase.code}
                  // Carries the year too, so the list a tile opens shows the
                  // number the tile promised rather than every year's.
                  to={`/projects?year=${session.academicYear}&phase=${phase.code}`}
                  className="kpi"
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  // The tile is a number over a pill, and a name assembled from
                  // those two elements is "21. ร่างคำขออนุมัติ" — the count and
                  // the ordinal colliding into one number nobody can read
                  // apart. Said here in the order the eye takes them.
                  aria-label={`${phase.name_th} — ${counts.get(phase.code) || 0} โครงการ`}
                >
                  <div className="kpi__value">{counts.get(phase.code) || 0}</div>
                  <div className="kpi__note" style={{ marginTop: 'var(--s-2)' }}>
                    <PhasePill code={phase.code}>{phase.ordinal}. {phase.name_th}</PhasePill>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={`วงเงินจัดสรรรายชมรม · ปีการศึกษา ${session.academicYear}`}
          aside={
            <>
              {mayAllocate ? 'แก้ไขได้' : 'อ่านอย่างเดียว'}
              {' · '}
              {/* This card says what each club was given; the summary says what
                  each has done with it. Offered to the same two roles the
                  server lets read it, so the link cannot lead to a 403. */}
              {mayAllocate && (
                <>
                  <Link className="u-muted" to="/spending">สรุปการใช้เงิน →</Link>
                  {' · '}
                </>
              )}
              <Link className="u-muted" to="/allocations">ดูรายปี →</Link>
            </>
          }
        >
          {allocations.items.length === 0 && unfunded.length === 0 ? (
            <Empty mark="฿" title="ยังไม่มีวงเงินจัดสรรในขอบเขตของบัญชีนี้" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table-x">
                <thead>
                  <tr>
                    <th>ชมรม</th>
                    <th style={{ width: '9rem', textAlign: 'right' }}>จัดสรร</th>
                    <th style={{ width: '9rem', textAlign: 'right' }}>อนุมัติแล้ว</th>
                    <th style={{ width: '9rem', textAlign: 'right' }}>คงเหลือ</th>
                    {mayAllocate && <th style={{ width: '6rem' }} />}
                  </tr>
                </thead>
                <tbody>
                  {allocations.items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="table-x__title">{a.club.nameTh}</div>
                        <div className="u-small u-dim u-mono">{a.club.code} · {a.campus.nameTh}</div>
                      </td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>{money(a.amount)}</td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>{money(a.committed)}</td>
                      <td
                        className="u-mono"
                        style={{ textAlign: 'right', color: a.overCommitted ? 'var(--c-danger)' : undefined, fontWeight: 600 }}
                      >
                        {money(a.remaining)}
                        {a.overCommitted && <div className="u-small">เกินวงเงิน</div>}
                      </td>
                      {mayAllocate && (
                        <td>
                          {/* One per club, all reading "แก้ไข" — the club is in
                              the first cell of the row, which a screen reader
                              does not carry across to the last. */}
                          <Button size="sm" outline color="secondary"
                            aria-label={`แก้ไขวงเงินจัดสรรของ ${a.club.nameTh} ปี ${session.academicYear}`}
                            onClick={() => editAllocation(a.club.id, a.club.nameTh, a.amount)}>
                            แก้ไข
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}

                  {/* Counted, not listed. Every unfunded club used to get its
                      own row and its own button here, which was right while
                      this card was the only way to reach an allocation at all.
                      With /allocations built, an Admin's dashboard became 69
                      rows and 68 of them said the same sentence — 89% of a page
                      called "ภาพรวม", pushing the actual overview off the top of
                      it. The fact still matters, so it stays; the list and the
                      buttons belong on the page that is about them. */}
                  {unfunded.length > 0 && (
                    <tr>
                      <td colSpan={mayAllocate ? 5 : 4} className="u-small u-muted">
                        อีก <strong>{unfunded.length} ชมรม</strong> ยังไม่ได้กำหนดวงเงินของปี{' '}
                        {session.academicYear} — อนุมัติเงินโครงการของชมรมเหล่านั้นไม่ได้จนกว่าจะกำหนด{' '}
                        <Link to="/allocations">กำหนดวงเงิน →</Link>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
