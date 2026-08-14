/**
 * Create and edit a project — the old `NewProjectDocument`, plus the
 * `TableAdd/List*` screens it needed to be usable.
 *
 * One page for both, because they are the same form: `/projects/new` posts a
 * core row and then fills its lists, `/projects/:id/edit` patches the row and
 * replaces the lists. Splitting them would mean maintaining the same fifteen
 * fields and eight lists twice, which is roughly what the old frontend did.
 *
 * Three things this screen does not do, on purpose:
 *
 * - **It never sends an ordinal.** Position in each list is the order; the
 *   server numbers the rows (deviation 16), because an ordinal decides which
 *   box a row prints in on a government form.
 * - **It never decides who may save.** The controls are drawn from what the
 *   server said, and the server refuses regardless — a save that should not be
 *   allowed comes back 403 with its own Thai sentence.
 * - **It never announces success before the server answers.** The old screen
 *   fired unawaited writes and showed "สำเร็จ!" immediately
 *   (docs/business-rules.md, "Transitions").
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useHistory, Link } from 'react-router-dom';
import { Button, Input, Alert, Label } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import ListEditor from '../components/ListEditor';
import TagPicker from '../components/TagPicker';
import { Card, Skeleton } from '../components/ui';

/** `2024-06-01T00:00:00.000Z` (or a Date) → `2024-06-01`, for `<input type=date>`. */
const dateValue = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : '');

const ATTENDEE_TYPES = [
  { value: 'STUDENT', label: 'นักศึกษา' },
  { value: 'PROFESSOR', label: 'อาจารย์' },
  { value: 'EXECUTIVE', label: 'ผู้บริหาร' },
  { value: 'EXPERT', label: 'วิทยากร / ผู้ทรงคุณวุฒิ' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

/**
 * The child lists, and how each maps between the wire and this form.
 *
 * `fromRow` exists because a read answers in the database's column names and a
 * write takes the API's field names. Keeping the translation in one table means
 * a new column is one line here rather than a hunt through JSX.
 */
const SECTIONS = [
  {
    name: 'rationales', title: 'หลักการและเหตุผล',
    columns: [{ key: 'content', label: 'หลักการและเหตุผล', type: 'textarea' }],
    fromRow: (row) => ({ content: row.content || '' }),
  },
  {
    name: 'objectives', title: 'วัตถุประสงค์',
    columns: [{ key: 'content', label: 'วัตถุประสงค์', type: 'textarea' }],
    fromRow: (row) => ({ content: row.content || '' }),
  },
  {
    name: 'types', title: 'ลักษณะโครงการ',
    columns: [{ key: 'content', label: 'ลักษณะโครงการ' }],
    fromRow: (row) => ({ content: row.content || '' }),
  },
  {
    name: 'locations', title: 'สถานที่จัดกิจกรรม',
    columns: [{ key: 'content', label: 'สถานที่' }],
    fromRow: (row) => ({ content: row.content || '' }),
  },
  {
    name: 'activities', title: 'ขั้นตอนการดำเนินงาน',
    hint: 'ช่วงเวลาของแต่ละขั้นตอนคือสิ่งที่แผนภูมิแกนต์บนแบบ กนศ.04 ใช้วาด',
    columns: [
      { key: 'topic', label: 'ขั้นตอน', width: '2fr' },
      { key: 'startOn', label: 'เริ่ม', type: 'date', width: '150px' },
      { key: 'endOn', label: 'สิ้นสุด', type: 'date', width: '150px' },
      { key: 'responsible', label: 'ผู้รับผิดชอบ', width: '1fr' },
    ],
    fromRow: (row) => ({
      topic: row.topic || '',
      startOn: dateValue(row.start_on),
      endOn: dateValue(row.end_on),
      responsible: row.responsible || '',
    }),
  },
  {
    name: 'indicators', title: 'ตัวชี้วัดความสำเร็จ',
    hint: 'แบบฟอร์มพิมพ์เป้าหมายเชิงปริมาณได้เพียงรายการแรก และไม่พิมพ์เป้าหมายเชิงคุณภาพเลย — ข้อมูลถูกเก็บครบ',
    columns: [
      { key: 'expectedResult', label: 'ผลที่คาดว่าจะได้รับ', width: '2fr' },
      { key: 'volumeTarget', label: 'เชิงปริมาณ' },
      { key: 'qualityTarget', label: 'เชิงคุณภาพ' },
      { key: 'etcFollow', label: 'วิธีติดตามอื่น ๆ' },
    ],
    fromRow: (row) => ({
      expectedResult: row.expected_result || '',
      volumeTarget: row.volume_target || '',
      qualityTarget: row.quality_target || '',
      etcFollow: row.etc_follow || '',
    }),
  },
  {
    name: 'problems', title: 'ปัญหาและแนวทางแก้ไข',
    columns: [
      { key: 'problem', label: 'ปัญหา' },
      { key: 'resolution', label: 'แนวทางแก้ไข' },
    ],
    fromRow: (row) => ({ problem: row.problem || '', resolution: row.resolution || '' }),
  },
];

const ATTENDANCE_COLUMNS = [
  { key: 'attendeeType', label: 'ประเภท', type: 'select', options: ATTENDEE_TYPES, width: '200px' },
  { key: 'label', label: 'รายละเอียด', width: '2fr' },
  { key: 'headcount', label: 'จำนวน (คน)', type: 'number', width: '130px' },
];

export default function ProjectFormPage() {
  const { id } = useParams();
  const history = useHistory();
  const { session } = useAuth();
  const isNew = !id;

  const [core, setCore] = useState({
    name: '', academicTerm: '', advisorPersonId: '',
    isNewProject: true, isContinueProject: false,
    prepareStartOn: '', prepareEndOn: '', eventStartOn: '', eventEndOn: '', reportDueOn: '',
    contact1Name: '', contact1Phone: '', contact2Name: '', contact2Phone: '',
    contact3Name: '', contact3Phone: '',
  });
  /**
   * A new project opens with one empty row in each list rather than none.
   *
   * Eight cards each saying "ยังไม่มีรายการ" above an add button is eight clicks
   * before any typing, and it reads as if the form were broken. An untouched
   * row costs nothing: blank rows are dropped on save.
   */
  const [lists, setLists] = useState(() => Object.fromEntries([
    ...SECTIONS.map((s) => [
      s.name,
      isNew ? [Object.fromEntries(s.columns.map((c) => [c.key, '']))] : [],
    ]),
    ['attendance', isNew ? [{ variant: 'PLANNED', attendeeType: 'STUDENT', label: '', headcount: '' }] : []],
  ]));
  const [tagIds, setTagIds] = useState([]);
  const [reference, setReference] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.tags(), api.advisors(), api.limits()])
      .then(([t, a, l]) => setReference({ tagSets: t.tagSets, advisors: a.advisors, limits: l.sections }))
      .catch((err) => setError(messageOf(err)));
  }, []);

  const load = useCallback(() => {
    if (isNew) return;
    setLoading(true);
    api.getProject(id)
      .then((project) => {
        setCore({
          name: project.name || '',
          academicTerm: project.academicTerm || '',
          advisorPersonId: project.advisor ? String(project.advisor.id) : '',
          isNewProject: Boolean(project.isNewProject),
          isContinueProject: Boolean(project.isContinueProject),
          prepareStartOn: dateValue(project.prepareStartOn),
          prepareEndOn: dateValue(project.prepareEndOn),
          eventStartOn: dateValue(project.eventStartOn),
          eventEndOn: dateValue(project.eventEndOn),
          reportDueOn: dateValue(project.reportDueOn),
          contact1Name: (project.contacts[0] && project.contacts[0].name) || '',
          contact1Phone: (project.contacts[0] && project.contacts[0].phone) || '',
          contact2Name: (project.contacts[1] && project.contacts[1].name) || '',
          contact2Phone: (project.contacts[1] && project.contacts[1].phone) || '',
          contact3Name: (project.contacts[2] && project.contacts[2].name) || '',
          contact3Phone: (project.contacts[2] && project.contacts[2].phone) || '',
        });
        setLists({
          ...Object.fromEntries(SECTIONS.map((s) => [
            s.name, (project.sections[s.name] || []).map(s.fromRow),
          ])),
          attendance: (project.sections.attendance || []).map((row) => ({
            variant: row.variant,
            attendeeType: row.attendee_type,
            label: row.label || '',
            headcount: row.headcount === null || row.headcount === undefined ? '' : String(row.headcount),
          })),
        });
        setTagIds(project.sections.tags.map((t) => t.id));
      })
      .catch((err) => setError(messageOf(err)))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  useEffect(load, [load]);

  const field = (key) => ({
    value: core[key],
    onChange: (e) => setCore({ ...core, [key]: e.target.value }),
  });

  /** Rows the user left entirely blank are dropped rather than sent as errors. */
  const meaningful = (rows, columns) =>
    rows.filter((row) => columns.some((c) => String(row[c.key] ?? '').trim() !== ''));

  const save = async () => {
    if (!core.name.trim()) {
      await Swal.fire({ icon: 'warning', title: 'ยังไม่ได้ตั้งชื่อโครงการ' });
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...core,
        advisorPersonId: core.advisorPersonId === '' ? null : Number(core.advisorPersonId),
        academicTerm: core.academicTerm || null,
      };

      // The core row first: the child lists need an id to hang from, and on a
      // new project there is not one until this returns.
      const projectId = isNew
        ? (await api.createProject(body)).id
        : (await api.updateProject(id, body), id);

      // Each list is an independent replace. They are saved in order and the
      // first failure stops the rest, so the message names the list that
      // refused rather than a generic failure after several silent successes.
      for (const section of SECTIONS) {
        await api.saveSection(projectId, section.name, meaningful(lists[section.name], section.columns));
      }
      await api.saveSection(projectId, 'attendance',
        lists.attendance
          .filter((row) => row.attendeeType && String(row.headcount).trim() !== '')
          .map((row) => ({ ...row, headcount: Number(row.headcount) })));
      await api.saveTags(projectId, tagIds);

      await Swal.fire({
        icon: 'success',
        title: isNew ? 'สร้างโครงการแล้ว' : 'บันทึกการแก้ไขแล้ว',
        timer: 1400,
        showConfirmButton: false,
      });
      history.push(`/projects/${projectId}`);
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  };

  const attendanceOf = (variant) => lists.attendance
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.variant === variant);

  const setAttendance = (variant, rows) => {
    const others = lists.attendance.filter((row) => row.variant !== variant);
    setLists({ ...lists, attendance: [...others, ...rows.map((row) => ({ ...row, variant }))] });
  };

  if (error && !reference) return <Alert color="danger">{error}</Alert>;
  if (loading || !reference) return <div className="card-x card-x__body"><Skeleton rows={8} /></div>;

  const limit = (name) => (reference.limits[name] ? reference.limits[name].capacity : undefined);

  return (
    <>
      <Link to={isNew ? '/projects' : `/projects/${id}`} className="u-small u-muted">
        ← {isNew ? 'รายการโครงการ' : 'กลับไปหน้าโครงการ'}
      </Link>

      <div className="page-head mt-2">
        <div>
          <h1>{isNew ? 'สร้างโครงการใหม่' : 'แก้ไขโครงการ'}</h1>
          <div className="u-small u-dim">
            {session.membership && session.membership.club_name}
            {' · ปีการศึกษา '}{session.academicYear}
          </div>
        </div>
        <div className="u-spacer u-row">
          <Button outline color="secondary" onClick={() => history.goBack()} disabled={saving}>ยกเลิก</Button>
          <Button color="primary" onClick={save} disabled={saving}>
            {saving ? 'กำลังบันทึก…' : (isNew ? 'สร้างโครงการ' : 'บันทึกการแก้ไข')}
          </Button>
        </div>
      </div>

      {error && <Alert color="danger">{error}</Alert>}

      <div className="u-stack">
        <Card title="ข้อมูลโครงการ">
          <div className="form-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <Label className="u-small u-muted" for="p-name">ชื่อโครงการ</Label>
              <Input id="p-name" {...field('name')} placeholder="ชื่อโครงการ" />
            </div>

            <div>
              <Label className="u-small u-muted" for="p-term">ภาคการศึกษา</Label>
              <Input id="p-term" {...field('academicTerm')} placeholder="เช่น 1/2567" />
            </div>

            <div>
              <Label className="u-small u-muted" for="p-advisor">อาจารย์ที่ปรึกษา</Label>
              {/* A picker, not a free-text box: the server only accepts an AD of
                  this club in this year, and the old free-text field is how 12
                  of 30 projects came to name a person who did not exist. */}
              <Input id="p-advisor" type="select" {...field('advisorPersonId')}>
                <option value="">— ยังไม่ระบุ —</option>
                {reference.advisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.prefix || ''}{a.fullNameTh}{a.agency ? ` · ${a.agency}` : ''}
                  </option>
                ))}
              </Input>
              {reference.advisors.length === 0 && (
                <div className="u-small u-dim mt-1">ยังไม่มีอาจารย์ที่ปรึกษาในชมรมนี้สำหรับปีการศึกษานี้</div>
              )}
            </div>

            <div style={{ gridColumn: '1 / -1' }} className="u-row">
              <label className="u-small" style={{ display: 'flex', gap: 'var(--s-2)', margin: 0 }}>
                <input type="checkbox" checked={core.isNewProject}
                  onChange={(e) => setCore({ ...core, isNewProject: e.target.checked })} />
                โครงการใหม่
              </label>
              <label className="u-small" style={{ display: 'flex', gap: 'var(--s-2)', margin: 0 }}>
                <input type="checkbox" checked={core.isContinueProject}
                  onChange={(e) => setCore({ ...core, isContinueProject: e.target.checked })} />
                โครงการต่อเนื่อง
              </label>
            </div>

            <div>
              <Label className="u-small u-muted" for="p-ps">เตรียมงาน — เริ่ม</Label>
              <Input id="p-ps" type="date" {...field('prepareStartOn')} />
            </div>
            <div>
              <Label className="u-small u-muted" for="p-pe">เตรียมงาน — สิ้นสุด</Label>
              <Input id="p-pe" type="date" {...field('prepareEndOn')} />
            </div>
            <div>
              <Label className="u-small u-muted" for="p-es">จัดกิจกรรม — เริ่ม</Label>
              <Input id="p-es" type="date" {...field('eventStartOn')} />
            </div>
            <div>
              <Label className="u-small u-muted" for="p-ee">จัดกิจกรรม — สิ้นสุด</Label>
              <Input id="p-ee" type="date" {...field('eventEndOn')} />
            </div>
            <div>
              <Label className="u-small u-muted" for="p-rd">กำหนดส่งสรุปผล</Label>
              <Input id="p-rd" type="date" {...field('reportDueOn')} />
            </div>
          </div>
        </Card>

        <Card title="ผู้ประสานงาน" aside="แบบฟอร์มพิมพ์คนที่ 1–2">
          <p className="u-small u-muted mb-3">
            คนที่สามถูกเก็บไว้ในระบบแต่ไม่ปรากฏบนแบบฟอร์ม — แบบฟอร์มมีช่องเพียงสองคน
          </p>
          {/* One grid item per person, not one per field. Six loose fields on
              the shared three-column grid wrapped so that a coordinator's name
              ended one row and their phone number began the next, directly
              under someone else's name. */}
          <div className="form-grid form-grid--pairs">
            {[1, 2, 3].map((n) => (
              <div className="field-pair" key={n}>
                <div>
                  <Label className="u-small u-muted" for={`p-c${n}n`}>ผู้ประสานงานคนที่ {n}</Label>
                  <Input id={`p-c${n}n`} {...field(`contact${n}Name`)} placeholder="ชื่อ-นามสกุล" />
                </div>
                <div>
                  <Label className="u-small u-muted" for={`p-c${n}p`}>โทรศัพท์</Label>
                  <Input id={`p-c${n}p`} {...field(`contact${n}Phone`)} placeholder="08xxxxxxxx" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {SECTIONS.map((section) => (
          <ListEditor
            key={section.name}
            title={section.title}
            hint={section.hint}
            columns={section.columns}
            rows={lists[section.name]}
            max={limit(section.name)}
            onChange={(rows) => setLists({ ...lists, [section.name]: rows })}
          />
        ))}

        {[
          { variant: 'PLANNED', title: 'ผู้เข้าร่วม — ตามแผน', hint: 'ตัวเลขที่พิมพ์บนแบบ กนศ.04' },
          { variant: 'ACTUAL', title: 'ผู้เข้าร่วม — ที่เข้าร่วมจริง', hint: 'ตัวเลขที่พิมพ์บนแบบ กนศ.06 เทียบกับตามแผน' },
        ].map(({ variant, title, hint }) => (
          <ListEditor
            key={variant}
            title={title}
            hint={hint}
            columns={ATTENDANCE_COLUMNS}
            rows={attendanceOf(variant).map((entry) => entry.row)}
            onChange={(rows) => setAttendance(variant, rows)}
            addLabel="+ เพิ่มกลุ่มผู้เข้าร่วม"
            empty="ยังไม่มีกลุ่มผู้เข้าร่วม"
          />
        ))}

        <TagPicker tagSets={reference.tagSets} selected={tagIds} onChange={setTagIds} />

        <div className="u-row" style={{ justifyContent: 'flex-end', paddingBottom: 'var(--s-6)' }}>
          <Button outline color="secondary" onClick={() => history.goBack()} disabled={saving}>ยกเลิก</Button>
          <Button color="primary" onClick={save} disabled={saving}>
            {saving ? 'กำลังบันทึก…' : (isNew ? 'สร้างโครงการ' : 'บันทึกการแก้ไข')}
          </Button>
        </div>
      </div>
    </>
  );
}
