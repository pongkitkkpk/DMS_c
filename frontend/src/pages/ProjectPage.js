/**
 * One project: the phase stepper, the transition controls, the child lists and
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
import { useParams, useHistory, Link } from 'react-router-dom';
import { Button, Alert } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';
import AttachmentsCard from '../components/AttachmentsCard';
import BudgetPanel from '../components/BudgetPanel';
import DocumentsCard from '../components/DocumentsCard';
import { calendarDate, Card, dateTime, PhasePill, PhaseStepper, Skeleton } from '../components/ui';

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

/**
 * A date as a Thai reader expects it — "1 มิ.ย. 2567", Buddhist year.
 *
 * This once printed "2024-06-01" on the schedule card while the timeline beside
 * it, the attachment list and both government forms printed Thai dates. The
 * schedule is the one card whose dates people actually plan around, so it was
 * the worst place to be four hundred and forty-three years out. It now shares
 * one helper with every other date on every screen, which is what stopped the
 * three of them drifting apart again.
 */
const date = calendarDate;

/** The same words the create form offers, so a row reads back as it was entered. */
const ATTENDEE_TYPE_LABELS = {
  STUDENT: 'นักศึกษา',
  PROFESSOR: 'อาจารย์',
  EXECUTIVE: 'ผู้บริหาร',
  EXPERT: 'วิทยากร / ผู้ทรงคุณวุฒิ',
  OTHER: 'อื่น ๆ',
};

const ATTENDANCE_VARIANTS = [
  ['PLANNED', 'ตามแผน', 'ตัวเลขที่พิมพ์บนแบบ กนศ.04'],
  ['ACTUAL', 'เข้าร่วมจริง', 'ตัวเลขที่พิมพ์บนแบบ กนศ.06'],
];

/** One row of a child list, rendered from whichever fields that section has. */
function SectionRow({ row }) {
  const text = row.content || row.topic || row.problem || row.expected_result || row.label || '—';
  return (
    <li style={{ marginBottom: 'var(--s-2)' }}>
      <span>{text}</span>
      {row.resolution && <div className="u-small u-dim">แนวทางแก้ไข: {row.resolution}</div>}
      {row.start_on && (
        <div className="u-small u-dim">{date(row.start_on)} — {date(row.end_on)}</div>
      )}
      {row.volume_target && <div className="u-small u-dim">เป้าหมาย: {row.volume_target}</div>}
    </li>
  );
}

/**
 * Attendance, split by variant.
 *
 * It used to go through `SectionRow` like every other child list, which printed
 * the rows in whatever order they arrived and showed the raw enum: "นักศึกษา
 * ผู้เข้าร่วม · STUDENT 100 คน" followed by "นักศึกษาผู้เข้าร่วม · STUDENT 92 คน".
 * Those are the *same* group of students planned and counted, and the card gave
 * a reader no way to know that — it read as two different groups, on the one
 * screen where the comparison between them is the point. กนศ.06 prints them as
 * two columns and works out the percentage between; the screen should not be
 * harder to read than the form it feeds.
 */
function AttendanceCard({ rows }) {
  const total = (list) => list.reduce((sum, row) => sum + Number(row.headcount || 0), 0);

  return (
    <Card title="ผู้เข้าร่วม" aside={`${rows.length} รายการ`}>
      {ATTENDANCE_VARIANTS.map(([variant, title, hint]) => {
        const group = rows.filter((row) => row.variant === variant);
        if (!group.length) return null;
        return (
          <div key={variant} className="mb-3">
            <div className="u-row" style={{ alignItems: 'baseline', gap: 'var(--s-2)' }}>
              <strong className="u-small">{title}</strong>
              <span className="u-small u-dim">{hint}</span>
              <span className="u-spacer u-small u-dim">รวม {total(group)} คน</span>
            </div>
            <ul className="mb-0 pl-3">
              {group.map((row) => (
                <li key={row.id}>
                  {ATTENDEE_TYPE_LABELS[row.attendee_type] || row.attendee_type}
                  {row.label ? ` — ${row.label}` : ''}
                  <span className="u-small u-dim"> · {row.headcount} คน</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Card>
  );
}

export default function ProjectPage() {
  const { id } = useParams();
  const history = useHistory();
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
      title: `เปลี่ยนสถานะเป็น “${transition.toPhaseNameTh}”?`,
      text: transition.requiresBudgetCheck
        ? 'ขั้นตอนนี้จะตรวจสอบงบประมาณ และจะไม่ผ่านหากเกินวงเงิน'
        : undefined,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
    });
    if (!confirmed.isConfirmed) return;

    setBusy(true);
    try {
      // Success is announced only after the server answers. The old screen
      // fired four unawaited calls and showed "สำเร็จ!" immediately, so a
      // failed phase write was reported as a success (business-rules.md).
      const result = await api.transition(id, transition.toPhaseCode);
      // Anything the transition did not block is still worth saying, and this
      // is the moment to say it — Q26 warns on submit so the problem is visible
      // for the whole of the phase in which it can still be fixed.
      const warnings = result.budgetWarnings || [];
      await Swal.fire({
        icon: warnings.length ? 'warning' : 'success',
        title: `สถานะเป็น “${result.toPhase.nameTh}” แล้ว`,
        text: [
          result.projectNumber ? `เลขที่โครงการ ${result.projectNumber}` : null,
          ...warnings.map((w) => w.message),
        ].filter(Boolean).join('\n') || undefined,
      });
      load();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Deleting cascades to every child table and there is no soft delete in v1,
   * so the confirmation names the project and requires a second click — and the
   * server still checks that this caller may do it.
   *
   * One thing it will not do: a project money has been paid out of is refused
   * with a 409 naming the payments, which arrives here as the server's own Thai
   * sentence. That refusal is deliberately not predicted on this side — the
   * disbursements are not loaded on this page, and a button that hides itself
   * on a guess is worse than one that explains why it could not.
   */
  const remove = async () => {
    const confirmed = await Swal.fire({
      title: 'ลบโครงการนี้?',
      html: `<div style="font-size:0.95rem">“${project.name}”<br><span style="color:#8a1c12">ข้อมูลทั้งหมดของโครงการจะถูกลบถาวร</span></div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ลบถาวร',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusCancel: true,
    });
    if (!confirmed.isConfirmed) return;

    try {
      await api.deleteProject(id);
      history.push('/projects');
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: messageOf(err) });
    }
  };

  if (error) {
    return (
      <Alert color="danger">
        {error} <Link to="/projects">กลับไปรายการโครงการ</Link>
      </Alert>
    );
  }
  if (!project) return <div className="card-x card-x__body"><Skeleton rows={6} /></div>;

  const available = project.transitions.filter((t) => t.allowedForCaller);
  const blocked = project.transitions.filter((t) => !t.allowedForCaller);
  const permissions = project.permissions || {};

  return (
    <>
      <Link to="/projects" className="u-small u-muted">← รายการโครงการ</Link>

      <div className="card-x mt-2 mb-4">
        <div className="card-x__body">
          <div className="u-row mb-2" style={{ flexWrap: 'wrap' }}>
            <PhasePill code={project.phase.code}>{project.phase.nameTh}</PhasePill>
            <span className="u-small u-dim u-mono">
              {project.projectNumber || `ร่างที่ ${project.draftSequence} · ยังไม่ออกเลขที่`}
            </span>
          </div>

          <h1 style={{ fontSize: '1.4rem', marginBottom: 'var(--s-2)' }}>{project.name}</h1>

          <div className="u-small u-muted mb-4">
            {project.club.nameTh} · ปีการศึกษา {project.academicYear}
            {project.owner && ` · ผู้รับผิดชอบ ${project.owner.nameTh}`}
            {project.advisor && ` · ที่ปรึกษา ${project.advisor.nameTh}`}
          </div>

          <PhaseStepper phases={phases} currentOrdinal={project.phase.ordinal} />
        </div>

        {(available.length > 0 || blocked.length > 0 || permissions.edit || permissions.delete) && (
          <div
            className="card-x__body u-row"
            style={{ borderTop: '1px solid var(--c-border)', background: 'var(--c-surface-2)', flexWrap: 'wrap' }}
          >
            {permissions.edit && (
              <Button outline color="secondary" tag={Link} to={`/projects/${id}/edit`}>แก้ไขข้อมูล</Button>
            )}
            {available.map((t) => (
              <Button key={t.toPhaseCode} color="primary" disabled={busy} onClick={() => advance(t)}>
                เปลี่ยนเป็น “{t.toPhaseNameTh}” →
              </Button>
            ))}
            {available.length === 0 && blocked.length > 0 && (
              <span className="u-small u-muted">
                ขั้นตอนถัดไป “{blocked[0].toPhaseNameTh}” ทำได้โดย {blocked[0].allowedRoles.join(', ')} เท่านั้น
              </span>
            )}
            {available.some((t) => t.requiresBudgetCheck) && (
              <span className="u-small u-dim">ขั้นตอนนี้มีการตรวจสอบงบประมาณ</span>
            )}
            {permissions.delete && (
              <Button className="u-spacer" size="sm" outline color="danger" onClick={remove}>
                ลบโครงการ
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="row">
        <div className="col-lg-7">
          <div className="u-stack">
            <Card title="กำหนดการ">
              <div className="stat-row">
                <span className="stat-row__label">เตรียมงาน</span>
                <span className="stat-row__value u-small">{date(project.prepareStartOn)} — {date(project.prepareEndOn)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-row__label">จัดกิจกรรม</span>
                <span className="stat-row__value u-small">{date(project.eventStartOn)} — {date(project.eventEndOn)}</span>
              </div>
              {project.contacts.length > 0 && (
                <div className="stat-row">
                  <span className="stat-row__label">ผู้ประสานงาน</span>
                  <span className="stat-row__value u-small">
                    {project.contacts.map((c) => `${c.name || '—'} ${c.phone || ''}`.trim()).join(', ')}
                  </span>
                </div>
              )}
            </Card>

            {Object.entries(SECTION_LABELS).map(([key, label]) => {
              const rows = project.sections[key] || [];
              if (!rows.length) return null;
              // Attendance is the one section whose rows mean nothing without
              // the variant they belong to — see `AttendanceCard`.
              if (key === 'attendance') return <AttendanceCard key={key} rows={rows} />;
              return (
                <Card key={key} title={label} aside={`${rows.length} รายการ`}>
                  <ol className="mb-0 pl-3">
                    {rows.map((row) => <SectionRow key={row.id} row={row} />)}
                  </ol>
                </Card>
              );
            })}

            {project.sections.tags.length > 0 && (
              <Card title="แท็ก" aside={`${project.sections.tags.length} รายการ`}>
                <div className="u-row" style={{ flexWrap: 'wrap', gap: 'var(--s-2)' }}>
                  {project.sections.tags.map((t) => (
                    <span key={t.id} className="pill pill--neutral pill--plain">
                      {t.tag_set_code} {t.ordinal}: {t.name_th}
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="col-lg-5">
          <div className="u-stack">
            <DocumentsCard projectId={id} key={project.phase.code} />

            <AttachmentsCard projectId={id} />

            <Card title="ประวัติ" aside={`${events.length} รายการ`}>
              <div className="timeline">
                {events.map((e) => (
                  <div key={e.id} className={`tl-item${e.event_type === 'PHASE_CHANGED' ? ' tl-item--phase' : ''}`}>
                    <div className="tl-item__title">
                      {EVENT_LABELS[e.event_type] || e.event_type}
                      {e.to_phase_name_th && ` → ${e.to_phase_name_th}`}
                      {e.edited_section && ` (${SECTION_LABELS[e.edited_section] || e.edited_section})`}
                    </div>
                    <div className="tl-item__meta">
                      {e.actor_name} · {dateTime(e.occurred_at)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Full width: the line tables need the room, and the money is a section
          of the project in its own right rather than a sidebar statistic. */}
      <div className="mt-4">
        <BudgetPanel projectId={id} onChange={load} />
      </div>
    </>
  );
}
