/**
 * Granting roles.
 *
 * Every other screen in this system spends authority; this one creates it. A
 * membership row is what `requireAuth` resolves and what every rule in
 * `scope.js` reads, so the form is written to make the shape of what it is
 * about to do impossible to miss — who, what, which club, which year — and to
 * offer only what the server will accept, rather than discovering the refusal
 * afterwards.
 *
 * Three things it deliberately does not do:
 *
 * - **It cannot revoke.** There is no delete endpoint. Taking a role away has
 *   to answer what happens to the projects that person is mid-way through, and
 *   guessing at that here would be worse than the gap.
 * - **It cannot invent a person.** Identity belongs to ICIT: `person` rows are
 *   written on login and nowhere else. So the recipient is searched for, not
 *   typed in. Somebody who has never signed in can always sign in — holding no
 *   membership is a supported state — and then they can be found.
 * - **It does not decide who may grant what.** `grantableRoles` and
 *   `grantableYears` come from the server, so this file cannot drift from the
 *   rule it is drawing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Input } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { Card, Empty, Pill, Skeleton } from '../components/ui';

const MAY_GRANT = ['ADMIN', 'STUACT'];

const ROLE_LABELS = {
  SH: 'หัวหน้านักศึกษา',
  AD: 'อาจารย์ที่ปรึกษา',
  STUACT: 'กองกิจการนักศึกษา',
  ADMIN: 'ผู้ดูแลระบบ',
};

/** SH and AD attach to a club; STUACT to a jurisdiction; ADMIN to neither. */
const scopeKindOf = (role) => {
  if (role === 'SH' || role === 'AD') return 'club';
  if (role === 'STUACT') return 'group';
  return 'none';
};

export default function RolesPage() {
  const { session } = useAuth();
  const mayGrant = MAY_GRANT.includes(session.role);

  const [year, setYear] = useState(session.academicYear);
  const [data, setData] = useState(null);
  const [clubs, setClubs] = useState([]);
  const [clubGroups, setClubGroups] = useState([]);
  const [error, setError] = useState(null);

  // The form.
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState(null);
  const [role, setRole] = useState('');
  const [clubId, setClubId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    // A student reaching this URL gets the refusal below without three requests
    // first. The server refuses them too — this only avoids asking a question
    // whose answer is already known.
    if (!mayGrant) return;
    setError(null);
    Promise.all([api.memberships({ year }), api.clubs(), api.clubGroups()])
      .then(([m, c, g]) => {
        setData(m);
        setClubs(c.clubs);
        setClubGroups(g.clubGroups);
      })
      .catch((err) => setError(messageOf(err)));
  }, [year, mayGrant]);

  useEffect(load, [load]);

  // Debounced, and silent below the server's minimum rather than firing a
  // request that can only come back as a validation error.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 3) {
      setResults(null);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api.people(trimmed)
        .then((r) => setResults(r.people))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  if (!mayGrant) {
    return (
      <Alert color="warning">
        หน้านี้สำหรับผู้ดูแลระบบและกองกิจการนักศึกษาเท่านั้น
      </Alert>
    );
  }
  if (error) return <Alert color="danger">{error}</Alert>;
  if (!data) return <div className="card-x card-x__body"><Skeleton rows={8} /></div>;

  const scopeKind = scopeKindOf(role);
  const ready =
    person &&
    role &&
    (scopeKind === 'club' ? Boolean(clubId) : scopeKind === 'group' ? Boolean(groupId) : true);

  const resetForm = () => {
    setPerson(null);
    setRole('');
    setClubId('');
    setGroupId('');
    setTerm('');
    setResults(null);
  };

  const grant = async () => {
    const club = clubs.find((c) => String(c.id) === String(clubId));
    const group = clubGroups.find((g) => String(g.id) === String(groupId));
    const where =
      scopeKind === 'club' ? club && club.nameTh
      : scopeKind === 'group' ? group && group.nameTh
      : 'ทั้งระบบ';

    // Named in full before it happens. This is the one action on the site that
    // cannot be undone through the site.
    const confirmed = await Swal.fire({
      icon: 'question',
      title: 'ยืนยันการให้สิทธิ์',
      html:
        `<div style="text-align:left">` +
        `<div><strong>${person.fullNameTh}</strong> (${person.idStudent})</div>` +
        `<div>สิทธิ์: <strong>${ROLE_LABELS[role]}</strong></div>` +
        `<div>ขอบเขต: <strong>${where}</strong></div>` +
        `<div>ปีการศึกษา: <strong>${year}</strong></div>` +
        `<div class="mt-2">ระบบนี้ยังไม่มีหน้าถอนสิทธิ์</div>` +
        `</div>`,
      showCancelButton: true,
      confirmButtonText: 'ให้สิทธิ์',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
    });
    if (!confirmed.isConfirmed) return;

    setSaving(true);
    try {
      await api.grantMembership({
        personId: person.id,
        role,
        academicYear: year,
        clubId: scopeKind === 'club' ? Number(clubId) : undefined,
        jurisdictionClubGroupId: scopeKind === 'group' ? Number(groupId) : undefined,
      });
      resetForm();
      load();
      await Swal.fire({ icon: 'success', title: 'ให้สิทธิ์แล้ว', timer: 1400, showConfirmButton: false });
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ให้สิทธิ์ไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สิทธิ์การใช้งาน</h1>
          <div className="u-small u-dim">
            สิทธิ์ผูกกับปีการศึกษา และคนหนึ่งคนถือได้หลายสิทธิ์
          </div>
        </div>

        <div className="u-spacer u-row">
          <Input
            type="select"
            style={{ width: 'auto' }}
            aria-label="ปีการศึกษา"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {data.grantableYears.map((y) => (
              <option key={y} value={y}>
                ปีการศึกษา {y}{y === session.academicYear ? ' (ปีปัจจุบัน)' : ''}
              </option>
            ))}
          </Input>
        </div>
      </div>

      {year !== session.academicYear && (
        <div className="notice mb-4">
          <span className="notice__mark" aria-hidden="true">i</span>
          <span>
            กำลังเตรียมสิทธิ์ของปีการศึกษา <strong>{year}</strong> ล่วงหน้า
            — สิทธิ์จะมีผลเมื่อถึงปีนั้น
          </span>
        </div>
      )}

      <div className="u-stack">
        <Card title="ให้สิทธิ์ใหม่" aside={`ให้ได้: ${data.grantableRoles.map((r) => ROLE_LABELS[r]).join(', ')}`}>
          <div className="u-stack">
            <div>
              <label className="u-small u-dim" htmlFor="person-search">
                ผู้รับสิทธิ์ — ค้นหาจากชื่อหรือรหัสนักศึกษา
              </label>
              {person ? (
                <div className="u-row" style={{ alignItems: 'center', gap: 'var(--s-3)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{person.prefix}{person.fullNameTh}</div>
                    <div className="u-small u-dim u-mono">{person.idStudent}</div>
                  </div>
                  <Button size="sm" outline color="secondary" onClick={() => setPerson(null)}>
                    เปลี่ยน
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="person-search"
                    placeholder="อย่างน้อย 3 ตัวอักษร"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                  />
                  {searching && <div className="u-small u-dim mt-1">กำลังค้นหา…</div>}
                  {results && results.length === 0 && !searching && (
                    // The likeliest reason, said plainly, because it is not
                    // obvious that a role can only be given to someone the
                    // system has already met.
                    <div className="u-small u-muted mt-1">
                      ไม่พบผู้ใช้ — ผู้รับสิทธิ์ต้องเคยเข้าสู่ระบบอย่างน้อยหนึ่งครั้ง
                    </div>
                  )}
                  {results && results.length > 0 && (
                    <div className="u-stack mt-2">
                      {results.map((found) => (
                        <button
                          key={found.id}
                          type="button"
                          className="table-x__title"
                          style={{
                            textAlign: 'left', background: 'none', border: 0, padding: 0,
                            cursor: 'pointer',
                          }}
                          onClick={() => setPerson(found)}
                        >
                          {found.prefix}{found.fullNameTh}
                          <span className="u-small u-dim u-mono">{' · '}{found.idStudent}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="u-row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <div>
                <label className="u-small u-dim" htmlFor="role-select">สิทธิ์</label>
                <Input
                  id="role-select"
                  type="select"
                  style={{ width: 'auto' }}
                  value={role}
                  onChange={(e) => { setRole(e.target.value); setClubId(''); setGroupId(''); }}
                >
                  <option value="">— เลือกสิทธิ์ —</option>
                  {/* Only what this actor may grant. A STUACT never sees ADMIN
                      in the list, and the server refuses it regardless. */}
                  {data.grantableRoles.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </Input>
              </div>

              {scopeKind === 'club' && (
                <div>
                  <label className="u-small u-dim" htmlFor="club-select">ชมรม</label>
                  <Input
                    id="club-select"
                    type="select"
                    style={{ width: 'auto' }}
                    value={clubId}
                    onChange={(e) => setClubId(e.target.value)}
                  >
                    <option value="">— เลือกชมรม —</option>
                    {clubs.map((club) => (
                      <option key={club.id} value={club.id}>
                        {club.code} · {club.nameTh}
                      </option>
                    ))}
                  </Input>
                </div>
              )}

              {scopeKind === 'group' && (
                <div>
                  <label className="u-small u-dim" htmlFor="group-select">กลุ่มชมรมที่รับผิดชอบ</label>
                  <Input
                    id="group-select"
                    type="select"
                    style={{ width: 'auto' }}
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                  >
                    <option value="">— เลือกกลุ่มชมรม —</option>
                    {clubGroups.map((group) => (
                      <option key={group.id} value={group.id}>{group.nameTh}</option>
                    ))}
                  </Input>
                </div>
              )}

              <div className="u-spacer" style={{ alignSelf: 'flex-end' }}>
                <Button color="primary" disabled={!ready || saving} onClick={grant}>
                  {saving ? 'กำลังบันทึก…' : 'ให้สิทธิ์'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card title={`ผู้มีสิทธิ์ ปีการศึกษา ${year}`} aside={`${data.items.length} รายการ`}>
          {data.items.length === 0 ? (
            <Empty
              mark="□"
              title={`ยังไม่มีผู้ได้รับสิทธิ์ในปี ${year}`}
              hint={year !== session.academicYear ? 'สิทธิ์ของปีนี้ยังไม่ได้เตรียมไว้' : undefined}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table-x">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th style={{ width: '13rem' }}>สิทธิ์</th>
                    <th>ขอบเขต</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="table-x__title">{item.person.prefix}{item.person.fullNameTh}</div>
                        <div className="u-small u-dim u-mono">{item.person.idStudent}</div>
                      </td>
                      <td>
                        <Pill tone={item.role === 'ADMIN' || item.role === 'STUACT' ? 'brand' : 'neutral'}>
                          {ROLE_LABELS[item.role] || item.role}
                        </Pill>
                      </td>
                      <td className="u-small">
                        {item.club
                          ? <>{item.club.nameTh}<div className="u-dim u-mono">{item.club.code}</div></>
                          : item.jurisdiction
                            ? item.jurisdiction.nameTh
                            : <span className="u-dim">ทั้งระบบ</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="u-small u-dim mt-3">
        ยังไม่มีหน้าถอนสิทธิ์ — ต้องแก้ที่ฐานข้อมูล ·{' '}
        <Link className="u-muted" to="/history">สรุปรายปี</Link>
      </div>
    </>
  );
}
