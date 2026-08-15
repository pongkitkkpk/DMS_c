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

/** Admin and STUACT enter allocations; adviser and student read them (Q30). */
const MAY_ALLOCATE = ['ADMIN', 'STUACT'];

export default function DashboardPage() {
  const { session } = useAuth();
  const [projects, setProjects] = useState(null);
  const [allocations, setAllocations] = useState(null);
  const [clubs, setClubs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [error, setError] = useState(null);

  const mayAllocate = MAY_ALLOCATE.includes(session.role);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api.listProjects({ pageSize: 200 }),
      // Pinned to the current year on purpose. Asking with no year returns
      // every year the actor may see, and this table renders the club name
      // alone — so the moment a second year existed, each club appeared twice
      // with nothing to tell the two rows apart. The year-by-year view lives on
      // /allocations, which asks the question properly.
      api.allocations({ year: session.academicYear }),
      api.phases(),
      mayAllocate ? api.clubs() : Promise.resolve({ clubs: [] }),
    ])
      .then(([p, a, r, c]) => {
        setProjects(p);
        setAllocations(a);
        setPhases(r.phases);
        setClubs(c.clubs);
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
        <Link className="u-spacer u-small u-muted" to="/projects">ดูรายการโครงการทั้งหมด →</Link>
      </div>

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
                  to={`/projects?phase=${phase.code}`}
                  className="kpi"
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
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
                          <Button size="sm" outline color="secondary"
                            onClick={() => editAllocation(a.club.id, a.club.nameTh, a.amount)}>
                            แก้ไข
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}

                  {unfunded.map((club) => (
                    <tr key={`u${club.id}`}>
                      <td>
                        <div className="table-x__title">{club.nameTh}</div>
                        <div className="u-small u-dim u-mono">{club.code} · {club.campusName}</div>
                      </td>
                      <td colSpan={3} className="u-small u-muted">
                        ยังไม่ได้กำหนดวงเงิน — อนุมัติเงินโครงการของชมรมนี้ไม่ได้จนกว่าจะกำหนด
                      </td>
                      {mayAllocate && (
                        <td>
                          {/* Outline, not accent: a jurisdiction has dozens of
                              clubs and most have no projects yet, so a column of
                              filled buttons would put the loudest colour on the
                              least urgent thing on the page. */}
                          <Button size="sm" outline color="secondary"
                            onClick={() => editAllocation(club.id, club.nameTh, null)}>
                            กำหนด
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
