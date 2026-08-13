/**
 * One project: the phase strip, the transition controls, the child lists and
 * the event log.
 *
 * The transition buttons come from `GET /projects/:id` → `transitions`, which
 * the server built from `phase_transition` and marked with `allowedForCaller`.
 * The client renders what the server permits instead of deciding for itself —
 * the old screen rendered each control from `storedUser.position` in JSX
 * (`ProjectDocument.js:286-364`) against endpoints that checked nothing.
 * Hiding a button here is a convenience; the refusal is the server's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button, Alert, Spinner, Table, Badge } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';

const SECTION_LABELS = {
  objectives: 'วัตถุประสงค์',
  rationales: 'หลักการและเหตุผล',
  locations: 'สถานที่',
  types: 'ลักษณะโครงการ',
  problems: 'ปัญหาและการแก้ไข',
  activities: 'ขั้นตอนการดำเนินงาน',
  indicators: 'ตัวชี้วัด',
  attendance: 'ผู้เข้าร่วม',
};

const EVENT_LABELS = {
  CREATED: 'สร้างโครงการ',
  PHASE_CHANGED: 'เปลี่ยนสถานะ',
  EDITED: 'แก้ไขข้อมูล',
  BUDGET_APPROVED: 'อนุมัติงบประมาณ',
  DISBURSED: 'เบิกจ่าย',
  ATTACHMENT_ADDED: 'แนบไฟล์',
};

export default function ProjectPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [events, setEvents] = useState([]);
  const [phases, setPhases] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.getProject(id), api.events(id), api.phases()])
      .then(([p, e, ref]) => { setProject(p); setEvents(e.events); setPhases(ref.phases); })
      .catch((err) => setError(messageOf(err)));
  }, [id]);

  useEffect(load, [load]);

  const advance = async (transition) => {
    const confirmed = await Swal.fire({
      title: `เปลี่ยนสถานะเป็น "${transition.toPhaseNameTh}"?`,
      text: transition.requiresBudgetCheck ? 'ขั้นตอนนี้จะมีการตรวจสอบงบประมาณ (ยังไม่เปิดใช้งาน)' : undefined,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
    });
    if (!confirmed.isConfirmed) return;

    setBusy(true);
    try {
      // Success is announced only after the server answers. The old screen
      // fired four unawaited calls and showed "สำเร็จ!" immediately, so a
      // failed phase write was reported as a success (business-rules.md).
      const result = await api.transition(id, transition.toPhaseCode);
      await Swal.fire({
        icon: 'success',
        title: `สถานะเป็น "${result.toPhase.nameTh}" แล้ว`,
        text: result.projectNumber ? `เลขที่โครงการ ${result.projectNumber}` : undefined,
      });
      load();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert color="danger">{error} <Link to="/projects">กลับไปรายการโครงการ</Link></Alert>;
  if (!project) return <div className="text-center p-5"><Spinner /></div>;

  const available = project.transitions.filter((t) => t.allowedForCaller);
  const blocked = project.transitions.filter((t) => !t.allowedForCaller);

  return (
    <>
      <Link to="/projects" className="dms-muted">← รายการโครงการ</Link>

      <div className="dms-card p-4 mt-2 mb-3">
        <h5>{project.name}</h5>
        <div className="dms-muted mb-3">
          {project.club.nameTh} · ปีการศึกษา {project.academicYear} ·{' '}
          {project.projectNumber ? `เลขที่ ${project.projectNumber}` : `ร่างที่ ${project.draftSequence} (ยังไม่ออกเลข)`}
        </div>

        <div className="d-flex flex-wrap mb-3" style={{ gap: '0.4rem' }}>
          {phases.map((p) => (
            <span
              key={p.code}
              className={`dms-phase-step${p.ordinal === project.phase.ordinal ? ' dms-phase-step--current' : ''}`}
            >
              {p.ordinal}. {p.name_th}
            </span>
          ))}
        </div>

        {available.map((t) => (
          <Button key={t.toPhaseCode} color="primary" className="mr-2" disabled={busy} onClick={() => advance(t)}>
            เปลี่ยนเป็น “{t.toPhaseNameTh}”
          </Button>
        ))}
        {available.length === 0 && blocked.length > 0 && (
          <div className="dms-muted">
            ขั้นตอนถัดไป “{blocked[0].toPhaseNameTh}” ทำได้โดย {blocked[0].allowedRoles.join(', ')} เท่านั้น
          </div>
        )}
        {project.transitions.length === 0 && <div className="dms-muted">โครงการปิดแล้ว</div>}
      </div>

      <div className="row">
        <div className="col-md-7">
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const rows = project.sections[key] || [];
            if (!rows.length) return null;
            return (
              <div className="dms-card p-3 mb-3" key={key}>
                <div className="mb-2"><strong>{label}</strong> <span className="dms-muted">({rows.length})</span></div>
                <ol className="mb-0 pl-3">
                  {rows.map((row) => (
                    <li key={row.id}>
                      {row.content || row.topic || row.problem || row.expected_result || row.label}
                      {row.headcount !== undefined && <span className="dms-muted"> — {row.headcount} คน ({row.attendee_type})</span>}
                      {row.start_on && <span className="dms-muted"> — {String(row.start_on).slice(0, 10)} ถึง {String(row.end_on).slice(0, 10)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}

          {project.sections.tags.length > 0 && (
            <div className="dms-card p-3 mb-3">
              <div className="mb-2"><strong>แท็ก</strong></div>
              {project.sections.tags.map((t) => (
                <Badge key={t.id} color="light" className="mr-1 mb-1">{t.tag_set_code} {t.ordinal}: {t.name_th}</Badge>
              ))}
            </div>
          )}
        </div>

        <div className="col-md-5">
          {project.budget && (
            <div className="dms-card p-3 mb-3">
              <div className="mb-2"><strong>งบประมาณ</strong> <span className="dms-muted">(อ่านอย่างเดียว — Phase 3)</span></div>
              <Table size="sm" borderless className="mb-0">
                <tbody>
                  <tr><td className="dms-muted">ขอมา</td><td className="text-right">{project.budget.requested_total}</td></tr>
                  <tr><td className="dms-muted">ตามแผน</td><td className="text-right">{project.budget.planned_amount ?? '—'}</td></tr>
                  <tr><td className="dms-muted">อนุมัติ</td><td className="text-right">{project.budget.approved_amount ?? '—'}</td></tr>
                  <tr><td className="dms-muted">เบิกแล้ว</td><td className="text-right">{project.budget.disbursed_total}</td></tr>
                  <tr><td className="dms-muted">ใช้จริง</td><td className="text-right">{project.budget.actual_total}</td></tr>
                </tbody>
              </Table>
            </div>
          )}

          <div className="dms-card p-3">
            <div className="mb-2"><strong>ประวัติ</strong></div>
            <ul className="list-unstyled mb-0" style={{ fontSize: '0.9rem' }}>
              {events.map((e) => (
                <li key={e.id} className="mb-2">
                  <div>
                    {EVENT_LABELS[e.event_type] || e.event_type}
                    {e.to_phase_name_th && ` → ${e.to_phase_name_th}`}
                    {e.edited_section && ` (${SECTION_LABELS[e.edited_section] || e.edited_section})`}
                  </div>
                  <div className="dms-muted">
                    {e.actor_name} · {new Date(e.occurred_at).toLocaleString('th-TH')}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
