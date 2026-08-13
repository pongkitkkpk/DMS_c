/**
 * Login.
 *
 * The password field is real even though the mock provider accepts anything —
 * the seam is meant to be swapped for ICIT SSO without touching this screen.
 */
import React, { useState } from 'react';
import { Redirect, useHistory } from 'react-router-dom';
import { Form, FormGroup, Label, Input, Button, Alert, Spinner } from 'reactstrap';

import { useAuth } from '../AuthContext';
import { messageOf } from '../api';

const FIXTURES = [
  ['fixture.student', 'นักศึกษา', 'SH'],
  ['fixture.advisor', 'อาจารย์ที่ปรึกษา', 'AD'],
  ['fixture.stuact', 'เจ้าหน้าที่กิจการนักศึกษา', 'STUACT'],
  ['fixture.admin', 'ผู้ดูแลระบบ', 'ADMIN'],
  ['fixture.otherstudent', 'นักศึกษาชมรมอื่น', 'SH'],
];

export default function LoginPage() {
  const { session, login } = useAuth();
  const history = useHistory();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Redirect to="/projects" />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      history.push('/projects');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', paddingTop: 'var(--s-6)' }}>
      <div className="text-center mb-4">
        <span className="app-brand__mark d-inline-grid" style={{ width: 44, height: 44, fontSize: '0.95rem' }}>
          มจพ
        </span>
        <h1 style={{ fontSize: '1.35rem', marginTop: 'var(--s-4)', marginBottom: 4 }}>
          ระบบจัดการโครงการกิจกรรมนักศึกษา
        </h1>
        <div className="u-small u-dim">มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ</div>
      </div>

      <div className="card-x card-x__body">
        {error && <Alert color="danger">{error}</Alert>}
        <Form onSubmit={submit}>
          <FormGroup>
            <Label for="username">ชื่อผู้ใช้</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="รหัสนักศึกษา หรือชื่อผู้ใช้ ICIT"
              autoFocus
            />
          </FormGroup>
          <FormGroup>
            <Label for="password">รหัสผ่าน</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </FormGroup>
          <Button color="primary" block disabled={busy}>
            {busy ? <Spinner size="sm" /> : 'เข้าสู่ระบบ'}
          </Button>
        </Form>
      </div>

      {/* Development only: the mock provider's directory. Swapping
          AUTH_PROVIDER to icit makes this list meaningless, hence the guard. */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="card-x mt-3">
          <div className="card-x__head u-small u-dim" style={{ fontWeight: 500 }}>
            บัญชีทดสอบ · โหมด mock (รหัสผ่านอะไรก็ได้)
          </div>
          <div className="card-x__body" style={{ padding: 'var(--s-3)' }}>
            {FIXTURES.map(([name, label, role]) => (
              <button
                key={name}
                type="button"
                className="btn btn-link btn-block text-left d-flex align-items-center"
                style={{ padding: 'var(--s-2) var(--s-3)', margin: 0 }}
                onClick={() => { setUsername(name); setPassword('dev'); }}
              >
                <span>{label}</span>
                <span className="u-spacer pill pill--neutral">{role}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
