/**
 * The project list — the old `AllProject` screen, minimally.
 *
 * There is no club selector: the list is whatever the caller's membership can
 * see, decided by the server. The old screen took the club out of the URL
 * (`stuactRoutes.js:7`), which is the leak deviation 1 closes.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input, Alert } from 'reactstrap';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';
import { PhasePill, Empty, Skeleton } from '../components/ui';

export default function ProjectsPage() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('');
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
    if (q.trim()) params.q = q.trim();

    // Debounced so typing does not fire a request per keystroke.
    const timer = setTimeout(() => {
      api.listProjects(params).then(setData).catch((err) => setError(messageOf(err)));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [phase, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>โครงการ</h1>
          <div className="u-small u-dim">
            {data ? `${data.total} รายการในขอบเขตของคุณ` : 'กำลังโหลด…'}
            {session.membership && session.membership.club_name && ` · ${session.membership.club_name}`}
          </div>
        </div>

        <div className="u-spacer u-row">
          <Input
            style={{ width: 220 }}
            placeholder="ค้นหาชื่อ หรือเลขที่โครงการ"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Input type="select" style={{ width: 'auto' }} value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            {phases.map((p) => (
              <option key={p.code} value={p.code}>{p.ordinal}. {p.name_th}</option>
            ))}
          </Input>
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
            title={q || phase ? 'ไม่พบโครงการตามเงื่อนไขที่ค้นหา' : 'ยังไม่มีโครงการในขอบเขตของบัญชีนี้'}
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
