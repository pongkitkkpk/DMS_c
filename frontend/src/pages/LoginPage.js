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
  ['fixture.student', 'นักศึกษา (SH)'],
  ['fixture.advisor', 'อาจารย์ที่ปรึกษา (AD)'],
  ['fixture.stuact', 'เจ้าหน้าที่กิจการนักศึกษา (STUACT)'],
  ['fixture.admin', 'ผู้ดูแลระบบ (ADMIN)'],
  ['fixture.otherstudent', 'นักศึกษาชมรมอื่น (ทดสอบสิทธิ์)'],
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
    <div className="row justify-content-center mt-5">
      <div className="col-md-5">
        <div className="dms-card p-4">
          <h5 className="mb-3">เข้าสู่ระบบ</h5>
          {error && <Alert color="danger">{error}</Alert>}
          <Form onSubmit={submit}>
            <FormGroup>
              <Label for="username">ชื่อผู้ใช้</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </FormGroup>
            <FormGroup>
              <Label for="password">รหัสผ่าน</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormGroup>
            <Button color="primary" block disabled={busy}>
              {busy ? <Spinner size="sm" /> : 'เข้าสู่ระบบ'}
            </Button>
          </Form>
        </div>

        {/* Development only: the mock provider's directory. Swapping
            AUTH_PROVIDER to icit makes this list meaningless, hence the guard. */}
        {process.env.NODE_ENV !== 'production' && (
          <div className="dms-card p-3 mt-3">
            <div className="dms-muted mb-2" style={{ fontSize: '0.85rem' }}>
              บัญชีทดสอบ (โหมด mock — รหัสผ่านอะไรก็ได้)
            </div>
            {FIXTURES.map(([name, label]) => (
              <Button
                key={name}
                size="sm"
                outline
                className="mr-2 mb-2"
                onClick={() => { setUsername(name); setPassword('dev'); }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
