/**
 * The caller's own account — the old `UserProfile`.
 *
 * Read-only, and that is the point rather than a shortcut. Identity comes from
 * ICIT: name, prefix, email and account type are the provider's to state, and a
 * field editable here would be one the next login silently overwrote. The
 * **role** is not editable either, for a different reason — it is resolved from
 * `membership` on every request, so there is nothing on this screen that grants
 * anything (deviation 11: the old token carried a role and nothing checked it).
 */
import React, { useEffect, useState } from 'react';
import { Alert } from 'reactstrap';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { Avatar, Card, Empty, Pill, Skeleton } from '../components/ui';

/** What each role may do, in one sentence, from `services/scope.js`. */
const ROLE_SUMMARY = {
  SH: 'สร้างและแก้ไขโครงการของชมรมตนเองในช่วงร่าง และเสนอขออนุมัติ',
  AD: 'ดูโครงการของชมรมที่เป็นที่ปรึกษา และอนุมัติโครงการ (ดูอย่างเดียว ไม่แก้ไข)',
  STUACT: 'ดูและดำเนินการกับโครงการของกลุ่มชมรมที่รับผิดชอบ อนุมัติวงเงิน และกำหนดวงเงินจัดสรร',
  ADMIN: 'เข้าถึงทุกชมรมทุกโครงการ',
};

const ACCOUNT_TYPES = { students: 'นักศึกษา', personel: 'บุคลากร' };

export default function ProfilePage() {
  const { session } = useAuth();
  const [me, setMe] = useState(session);
  const [error, setError] = useState(null);

  // Re-read rather than trusting the copy held since login: a membership can be
  // changed while a session is open, and the server is the only authority on it.
  useEffect(() => {
    api.me().then(setMe).catch((err) => setError(messageOf(err)));
  }, []);

  if (error) return <Alert color="danger">{error}</Alert>;
  if (!me) return <div className="card-x card-x__body"><Skeleton rows={5} /></div>;

  const field = (label, value) => (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value u-small">{value || '—'}</span>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div className="u-row">
          <Avatar name={me.person.fullNameTh} />
          <div>
            <h1 style={{ fontSize: '1.3rem' }}>
              {me.person.prefix || ''}{me.person.fullNameTh}
            </h1>
            <div className="u-small u-dim u-mono">{me.person.idStudent}</div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-lg-6 mb-4">
          <Card title="ข้อมูลบัญชี" aside="จาก ICIT">
            {field('ชื่อผู้ใช้', me.person.idStudent)}
            {field('ชื่อ-นามสกุล', `${me.person.prefix || ''}${me.person.fullNameTh}`)}
            {field('อีเมล', me.person.email)}
            {field('ประเภทบัญชี', ACCOUNT_TYPES[me.person.accountType] || me.person.accountType)}
            {field('ระดับการศึกษา', me.person.levelDesc)}
            {field('สถานภาพ', me.person.stuStatusDesc)}
            {field('ปีการศึกษาปัจจุบัน', me.academicYear)}
            <p className="u-small u-dim mt-3 mb-0">
              ข้อมูลนี้มาจากระบบบัญชีของมหาวิทยาลัย แก้ไขที่นี่ไม่ได้ —
              การเปลี่ยนแปลงต้องทำที่ต้นทาง
            </p>
          </Card>
        </div>

        <div className="col-lg-6">
          <Card title="สิทธิ์ในปีการศึกษานี้" aside={`${me.memberships.length} รายการ`}>
            {me.memberships.length === 0 ? (
              <Empty
                mark="—"
                title="บัญชีนี้ไม่มีสิทธิ์ในปีการศึกษานี้"
                hint="เข้าสู่ระบบได้ แต่จะยังไม่เห็นโครงการใด ๆ จนกว่าจะได้รับสิทธิ์"
              />
            ) : (
              <div className="u-stack" style={{ gap: 'var(--s-3)' }}>
                {me.memberships.map((m, index) => (
                  <div key={m.id || index} className="kpi">
                    <div className="u-row">
                      <Pill tone="brand" plain>{m.role}</Pill>
                      <span className="u-small u-muted">
                        {m.club_name || m.club_group_name || m.agency_name || '—'}
                      </span>
                      <span className="u-spacer u-small u-dim u-mono">{m.academic_year}</span>
                    </div>
                    <div className="u-small u-dim mt-2">{ROLE_SUMMARY[m.role]}</div>
                    {m.advisor_agency && (
                      <div className="u-small u-dim mt-1">หน่วยงาน: {m.advisor_agency}</div>
                    )}
                  </div>
                ))}
                {me.memberships.length > 1 && (
                  <p className="u-small u-dim mb-0">
                    ระบบใช้สิทธิ์แรกในการตัดสินขอบเขตการเข้าถึง
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
