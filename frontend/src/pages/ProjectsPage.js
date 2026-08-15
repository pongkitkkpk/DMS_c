/**
 * The project list — the old `AllProject` screen, minimally.
 *
 * There is no club selector: the list is whatever the caller's membership can
 * see, decided by the server. The old screen took the club out of the URL
 * (`stuactRoutes.js:7`), which is the leak deviation 1 closes.
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useHistory } from 'react-router-dom';
import { Input, Alert, Button } from 'reactstrap';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { PhasePill, Empty, Skeleton } from '../components/ui';

export default function ProjectsPage() {
  const { session } = useAuth();
  const location = useLocation();
  const history = useHistory();
  const [data, setData] = useState(null);
  // The dashboard links here with a phase already chosen, so the filter is
  // seeded from the URL and written back to it — which also makes a filtered
  // list something you can bookmark or send to someone.
  const [phase, setPhase] = useState(() => new URLSearchParams(location.search).get('phase') || '');
  // The year summary links here for one year. The list has always been able to
  // filter by year — `listProjects` takes it — but nothing ever sent one, so
  // the link would have quietly shown every year instead of the one clicked.
  // There is no control for it: this is a filter you arrive with, and the way
  // out is the "ดูทุกปี" link rather than a selector nobody would otherwise use.
  const year = new URLSearchParams(location.search).get('year') || '';
  const [q, setQ] = useState('');
  const [phases, setPhases] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.phases().then((r) => setPhases(r.phases)).catch(() => setPhases([]));
  }, []);

  useEffect(() => {
    setError(null);
    const params = {};
    if (phase) params.phase = phase;
    if (year) params.year = year;
    if (q.trim()) params.q = q.trim();

    // Debounced so typing does not fire a request per keystroke.
    const timer = setTimeout(() => {
      api.listProjects(params).then(setData).catch((err) => setError(messageOf(err)));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [phase, year, q]);

  /** Both filters live in the URL, so changing one must not drop the other. */
  const urlWith = (next) => {
    const params = new URLSearchParams();
    if (next.year !== undefined ? next.year : year) {
      params.set('year', next.year !== undefined ? next.year : year);
    }
    if (next.phase !== undefined ? next.phase : phase) {
      params.set('phase', next.phase !== undefined ? next.phase : phase);
    }
    const query = params.toString();
    return query ? `/projects?${query}` : '/projects';
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>โครงการ</h1>
          <div className="u-small u-dim">
            {data ? `${data.total} รายการในขอบเขตของคุณ` : 'กำลังโหลด…'}
            {session.membership && session.membership.club_name && ` · ${session.membership.club_name}`}
            {/* Named, and escapable. A filter that came in through the URL is
                invisible otherwise: the count would simply be smaller than
                expected with nothing on screen saying why. */}
            {year && (
              <>
                {' · '}
                <strong>ปีการศึกษา {year}</strong>{' '}
                <Link className="u-muted" to={urlWith({ year: '' })}>ดูทุกปี</Link>
              </>
            )}
          </div>
        </div>

        <div className="u-spacer u-row">
          <Input
            style={{ width: 220 }}
            placeholder="ค้นหาชื่อ หรือเลขที่โครงการ"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Input
            type="select"
            style={{ width: 'auto' }}
            value={phase}
            onChange={(e) => {
              setPhase(e.target.value);
              history.replace(urlWith({ phase: e.target.value }));
            }}
          >
            <option value="">ทุกสถานะ</option>
            {phases.map((p) => (
              <option key={p.code} value={p.code}>{p.ordinal}. {p.name_th}</option>
            ))}
          </Input>

          {/* Only a student head may open a project, and only in their own club
              (`scope.assertCanCreate`). Hiding the button elsewhere is a
              courtesy; the server refuses regardless. */}
          {session.role === 'SH' && (
            <Button color="primary" tag={Link} to="/projects/new">+ สร้างโครงการ</Button>
          )}
        </div>
      </div>

      {error && <Alert color="danger">{error}</Alert>}

      {!data && !error && (
        <div className="card-x card-x__body"><Skeleton rows={6} /></div>
      )}

      {data && data.items.length === 0 && (
        <div className="card-x">
          <Empty
            mark="□"
            title={q || phase || year ? 'ไม่พบโครงการตามเงื่อนไขที่ค้นหา' : 'ยังไม่มีโครงการในขอบเขตของบัญชีนี้'}
            hint={session.role === 'SH' ? 'หัวหน้านักศึกษาสามารถสร้างโครงการใหม่ได้' : undefined}
          />
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="card-x" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table-x">
              <thead>
                <tr>
                  <th style={{ width: '10rem' }}>เลขที่</th>
                  <th>ชื่อโครงการ</th>
                  <th style={{ width: '14rem' }}>ชมรม</th>
                  <th style={{ width: '13rem' }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="u-small u-dim u-mono">
                      {p.projectNumber || `ร่างที่ ${p.draftSequence}`}
                    </td>
                    <td>
                      <Link to={`/projects/${p.id}`} className="table-x__title">{p.name}</Link>
                    </td>
                    <td className="u-small u-muted">{p.club.nameTh}</td>
                    <td>
                      <PhasePill code={p.phase.code}>{p.phase.nameTh}</PhasePill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
