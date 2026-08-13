/**
 * The project list — the old `AllProject` screen, minimally.
 *
 * There is no club selector: the list is whatever the caller's membership can
 * see, decided by the server. The old screen took the club out of the URL
 * (`stuactRoutes.js:7`), which is the leak deviation 1 closes.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Table, Input, Alert, Spinner, Badge } from 'reactstrap';

import { api, messageOf } from '../api';
import { useAuth } from '../AuthContext';

export default function ProjectsPage() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('');
  const [phases, setPhases] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.phases().then((r) => setPhases(r.phases)).catch(() => setPhases([]));
  }, []);

  useEffect(() => {
    setError(null);
    api.listProjects(phase ? { phase } : {})
      .then(setData)
      .catch((err) => setError(messageOf(err)));
  }, [phase]);

  if (error) return <Alert color="danger">{error}</Alert>;
  if (!data) return <div className="text-center p-5"><Spinner /></div>;

  return (
    <>
      <div className="d-flex align-items-center mb-3">
        <h5 className="mb-0">โครงการ</h5>
        <span className="dms-muted ml-3">{data.total} รายการ · ปีการศึกษา {session.academicYear}</span>
        <Input
          type="select"
          className="ml-auto"
          style={{ width: 'auto' }}
          value={phase}
          onChange={(e) => setPhase(e.target.value)}
        >
          <option value="">ทุกสถานะ</option>
          {phases.map((p) => <option key={p.code} value={p.code}>{p.ordinal}. {p.name_th}</option>)}
        </Input>
      </div>

      {data.items.length === 0 ? (
        <div className="dms-card p-4 text-center dms-muted">ไม่มีโครงการในขอบเขตของบัญชีนี้</div>
      ) : (
        <Table className="dms-card" hover responsive>
          <thead>
            <tr>
              <th style={{ width: '9rem' }}>เลขที่โครงการ</th>
              <th>ชื่อโครงการ</th>
              <th>ชมรม</th>
              <th style={{ width: '12rem' }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td className="dms-muted">{p.projectNumber || `ร่างที่ ${p.draftSequence}`}</td>
                <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                <td className="dms-muted">{p.club.nameTh}</td>
                <td><Badge color="light">{p.phase.ordinal}. {p.phase.nameTh}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
