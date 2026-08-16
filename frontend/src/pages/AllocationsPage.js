/**
 * Yearly allocations, one academic year at a time.
 *
 * The ceiling is per `(club, academic year)` and is set fresh each year, but
 * until now the only way to reach it was the dashboard card, which asked for
 * every year at once and rendered the club name alone. With one year seeded
 * that looked right; with two it would have shown each club twice with no way
 * to tell the rows apart. So the year is chosen here, explicitly, and it is the
 * year the edit writes to — not the ambient `session.academicYear`.
 *
 * Writing to a year that is not the current one is allowed on purpose: an
 * officer setting up next year before June, or correcting last year's figure,
 * is ordinary work. It is not silent, though, and the two directions are not
 * the same thing. Next year is *planning*; a past year is *rewriting a figure
 * projects were already approved against*, so it warns in its own right and
 * asks again at the moment of the edit. That is the Q33 bargain applied to the
 * year rather than the amount: allowed, never quiet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useHistory } from 'react-router-dom';
import { Alert, Button, Input } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { Card, Empty, Skeleton, money } from '../components/ui';

/** Admin and STUACT enter allocations; adviser and student read them (Q30). */
const MAY_ALLOCATE = ['ADMIN', 'STUACT'];

export default function AllocationsPage() {
  const { session } = useAuth();
  const location = useLocation();
  const history = useHistory();

  // Seeded from the URL so a particular year can be bookmarked or sent to
  // someone — the same bargain the project list makes with its phase filter.
  const [year, setYear] = useState(() => {
    const asked = Number(new URLSearchParams(location.search).get('year'));
    return Number.isInteger(asked) && asked > 2400 && asked < 2700 ? asked : session.academicYear;
  });
  const [data, setData] = useState(null);
  const [clubs, setClubs] = useState([]);
  const [error, setError] = useState(null);

  const mayAllocate = MAY_ALLOCATE.includes(session.role);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api.allocations({ year }),
      mayAllocate ? api.clubs() : Promise.resolve({ clubs: [] }),
    ])
      .then(([a, c]) => {
        setData(a);
        setClubs(c.clubs);
      })
      .catch((err) => setError(messageOf(err)));
  }, [year, mayAllocate]);

  useEffect(load, [load]);

  const chooseYear = (next) => {
    setYear(next);
    setData(null);
    history.replace(next === session.academicYear ? '/allocations' : `/allocations?year=${next}`);
  };

  const editAllocation = async (clubId, clubName, current) => {
    // A past year's ceiling is the one this year's approvals were already
    // judged against, so the edit asks once more before opening the amount.
    // The page banner alone is not enough: by the time someone has scrolled to
    // a club and clicked, the banner is off screen and out of mind.
    if (year < session.academicYear) {
      // Two different acts, and the warning has to say which one it is. A club
      // that already has a ceiling for that year had its approvals judged
      // against it; a club that has none never did, and telling that officer
      // about a "วงเงินเดิม" that does not exist is simply wrong.
      const hasExisting = current !== null && current !== undefined;
      const confirmed = await Swal.fire({
        icon: 'warning',
        title: hasExisting ? `แก้ไขวงเงินของปี ${year}` : `กำหนดวงเงินย้อนหลังให้ปี ${year}`,
        html:
          `ปี ${year} ผ่านไปแล้ว (ปีปัจจุบันคือ ${session.academicYear})<br>` +
          (hasExisting
            ? 'โครงการของปีนั้นถูกอนุมัติเงินไปแล้วโดยเทียบกับวงเงินเดิม ' +
              'การแก้ตัวเลขย้อนหลังจะทำให้ยอดคงเหลือของปีนั้นเปลี่ยนไปด้วย'
            : 'ชมรมนี้ยังไม่เคยมีวงเงินของปีนั้น การกำหนดตอนนี้เป็นการบันทึกย้อนหลัง'),
        showCancelButton: true,
        confirmButtonText: hasExisting ? `แก้ไขปี ${year} ต่อ` : `กำหนดปี ${year} ต่อ`,
        cancelButtonText: 'ยกเลิก',
        reverseButtons: true,
      });
      if (!confirmed.isConfirmed) return;
    }

    const asked = await Swal.fire({
      title: `วงเงินจัดสรร — ${clubName}`,
      input: 'text',
      inputValue: current === null || current === undefined ? '' : String(Number(current)),
      // The year is in the label because it is the thing that changes on this
      // screen. A dialog that only says "บาท" would write to whichever year the
      // page happened to be showing without ever naming it.
      inputLabel: `ปีการศึกษา ${year} (บาท)`,
      showCancelButton: true,
      confirmButtonText: 'บันทึก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
    });
    if (!asked.isConfirmed) return;

    try {
      const result = await api.setAllocation({ clubId, academicYear: year, amount: asked.value });
      // Q33: lowering a ceiling below what is already approved succeeds, and
      // says so. This is the loud half.
      if (result.warnings.length) {
        await Swal.fire({
          icon: 'warning',
          title: 'บันทึกแล้ว แต่โปรดทราบ',
          text: result.warnings[0].message,
        });
      }
      load();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: messageOf(err) });
    }
  };

  // The picker offers every year the server can see plus the current one, and
  // the year being viewed even when it is neither — otherwise following a
  // bookmark to an empty year would silently snap the selector to a different
  // year than the table below it.
  const offered = data ? data.years : [session.academicYear];
  const years = [...new Set([...offered, year, session.academicYear])].sort((a, b) => b - a);

  const funded = new Set(data ? data.items.map((a) => a.club.id) : []);
  const unfunded = clubs.filter((club) => !funded.has(club.id));
  const isPastYear = year < session.academicYear;
  const isFutureYear = year > session.academicYear;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>วงเงินจัดสรร</h1>
          <div className="u-small u-dim">
            {mayAllocate
              ? 'วงเงินกำหนดใหม่ทุกปีการศึกษา และผูกกับปีที่เลือกด้านขวา'
              : 'อ่านอย่างเดียว — เจ้าหน้าที่กิจการนักศึกษาเป็นผู้กำหนด'}
          </div>
        </div>

        <div className="u-spacer u-row">
          <Link className="u-small u-muted" to="/history">สรุปรายปี →</Link>
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

      {/* Two different situations, not one. Planning next year is routine and
          says so plainly; reaching back into a closed year is the one that
          earns a warning colour. */}
      {isFutureYear && (
        <div className="notice mb-4">
          <span className="notice__mark" aria-hidden="true">i</span>
          <span>
            กำลังตั้งวงเงินล่วงหน้าสำหรับปีการศึกษา <strong>{year}</strong>{' '}
            (ปีปัจจุบันคือ {session.academicYear})
            {mayAllocate && ` — การแก้ไขจะบันทึกลงปี ${year}`}
          </span>
        </div>
      )}

      {isPastYear && (
        <div className="notice notice--warn mb-4">
          <span className="notice__mark" aria-hidden="true">!</span>
          <span>
            กำลังดูปีการศึกษา <strong>{year}</strong> ซึ่งผ่านไปแล้ว
            (ปีปัจจุบันคือ {session.academicYear})
            {/* Deliberately general: this year may hold clubs that were funded
                and clubs that never were, and the banner covers both. The
                consequence specific to a club is stated at the edit itself. */}
            {mayAllocate && ` — แก้ไขได้ แต่เป็นการบันทึกย้อนหลัง`}
          </span>
        </div>
      )}

      {!data && !error && <div className="card-x card-x__body"><Skeleton rows={8} /></div>}

      {data && data.overCommitted.length > 0 && (
        <div className="notice notice--danger mb-4">
          <span className="notice__mark" aria-hidden="true">!</span>
          <span>
            <strong>{data.overCommitted.length} ชมรม</strong> มียอดอนุมัติเกินวงเงินจัดสรรของปี {year} —{' '}
            {data.overCommitted.map((a) => a.club.nameTh).join(', ')}
          </span>
        </div>
      )}

      {data && (
        <Card
          title={`ปีการศึกษา ${year}`}
          aside={mayAllocate ? 'แก้ไขได้' : 'อ่านอย่างเดียว'}
        >
          {data.items.length === 0 && unfunded.length === 0 ? (
            <Empty
              mark="฿"
              title={`ยังไม่มีวงเงินจัดสรรของปี ${year} ในขอบเขตของบัญชีนี้`}
              hint={mayAllocate ? 'เลือกปีอื่นเพื่อดูปีที่กำหนดไว้แล้ว' : undefined}
            />
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
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="table-x__title">{a.club.nameTh}</div>
                        <div className="u-small u-dim u-mono">{a.club.code} · {a.campus.nameTh}</div>
                      </td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>{money(a.amount)}</td>
                      <td className="u-mono" style={{ textAlign: 'right' }}>{money(a.committed)}</td>
                      <td
                        className="u-mono"
                        style={{
                          textAlign: 'right',
                          color: a.overCommitted ? 'var(--c-danger)' : undefined,
                          fontWeight: 600,
                        }}
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

                  {/* Said once, above the block, rather than on every row.
                      There are 69 clubs and in a year nobody has prepared, 68
                      of them are unfunded — the same sentence repeated down a
                      whole page stops being read after the second time, and it
                      buries the club names, which are what the reader is
                      actually scanning for. */}
                  {unfunded.length > 0 && (
                    <tr>
                      <td colSpan={mayAllocate ? 5 : 4} className="u-small u-muted"
                          style={{ paddingTop: 'var(--s-4)' }}>
                        อีก {unfunded.length} ชมรมยังไม่ได้กำหนดวงเงินของปี {year} —
                        อนุมัติเงินโครงการของชมรมเหล่านี้ไม่ได้จนกว่าจะกำหนด
                      </td>
                    </tr>
                  )}

                  {unfunded.map((club) => (
                    <tr key={`u${club.id}`}>
                      <td>
                        <div className="table-x__title">{club.nameTh}</div>
                        <div className="u-small u-dim u-mono">{club.code} · {club.campusName}</div>
                      </td>
                      <td colSpan={3} className="u-dim" style={{ textAlign: 'right' }}>—</td>
                      {mayAllocate && (
                        <td>
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
      )}
    </>
  );
}
