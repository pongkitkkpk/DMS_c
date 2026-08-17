/**
 * Login.
 *
 * The password field is real even though the mock provider usually accepts
 * anything — the seam is meant to be swapped for ICIT SSO without touching this
 * screen.
 *
 * The demonstration directory below is **the server's answer**, not this
 * bundle's guess. It used to be a hardcoded list rendered behind
 * `process.env.NODE_ENV !== 'production'`, which was wrong in both directions:
 * `npm run build` sets that flag unconditionally, so the accounts vanished from
 * the deployed demo — the one place somebody arrives without knowing what to
 * type — while on a laptop the card always read "รหัสผ่านอะไรก็ได้", which stops
 * being true the moment `MOCK_PASSWORD` is set. `GET /api/auth/mode` knows both
 * facts; a build flag on the client cannot know either.
 */
import React, { useEffect, useState } from 'react';
import { Redirect, useHistory } from 'react-router-dom';
import { Form, FormGroup, Label, Input, Button, Alert, Spinner } from 'reactstrap';

import { useAuth } from '../AuthContext';
import { api, messageOf } from '../api';
import { ROLE_LABELS } from '../components/ui';

export default function LoginPage() {
  const { session, login } = useAuth();
  const history = useHistory();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);

  // A failure here is not shown: the directory is a convenience, and an API
  // that cannot answer will say so through the login attempt itself, in a
  // message that names the cause. Two error banners for one outage is worse
  // than one.
  useEffect(() => {
    let live = true;
    api.authMode().then((data) => { if (live) setMode(data); }).catch(() => {});
    return () => { live = false; };
  }, []);

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

      {/* The mock provider's directory, as the server reports it. An ICIT
          deployment sends no accounts and this whole card is absent. */}
      {mode && mode.accounts.length > 0 && (
        <div className="card-x mt-3">
          {/* `card-x__head` is a flex row, so the two lines go inside one child
              rather than becoming two columns that each wrap. */}
          <div className="card-x__head u-small u-dim" style={{ fontWeight: 500 }}>
            <div>
              บัญชีสาธิต · ปีการศึกษา {mode.academicYear}
              {/* What to type, said once and correctly for this deployment. A
                  shared password is not something the screen can supply, so the
                  click fills the username and leaves the password alone. */}
              <div style={{ fontWeight: 400, marginTop: 2 }}>
                {mode.requiresSharedPassword
                  ? 'กดเลือกบัญชี แล้วกรอกรหัสผ่านที่ได้รับมา'
                  : 'กดเลือกบัญชี — รหัสผ่านอะไรก็ได้'}
              </div>
            </div>
          </div>
          <div className="card-x__body" style={{ padding: 'var(--s-3)' }}>
            {mode.accounts.map((account) => {
              const roleLabel = account.role
                ? (ROLE_LABELS[account.role] || account.role)
                : 'ยังไม่มีสิทธิ์';
              return (
              <button
                key={account.idStudent}
                type="button"
                className="btn btn-link btn-block text-left d-flex align-items-center"
                style={{ padding: 'var(--s-2) var(--s-3)', margin: 0 }}
                // Spelled out rather than left to be assembled from the
                // subtree: the visible row is a name, a club under it and a
                // pill off to the right, which a screen reader would run
                // together into one unpunctuated line.
                aria-label={[account.fullNameTh || account.idStudent, roleLabel, account.scope]
                  .filter(Boolean).join(' · ')}
                onClick={() => {
                  setUsername(account.idStudent);
                  if (!mode.requiresSharedPassword) setPassword('dev');
                }}
              >
                {/* Two block spans rather than a div inside a span: the row is
                    a flex child of a `<button>`, and a `<div>` there is invalid
                    nesting that React will render but nothing has to honour. */}
                <span>
                  <span className="d-block">{account.fullNameTh || account.idStudent}</span>
                  {/* Two of the fixtures are both SH, and the second exists to
                      demonstrate that it cannot see the first one's club. The
                      role alone prints the same words twice; the scope is what
                      separates them. */}
                  {account.scope && (
                    <span className="u-small u-dim d-block" style={{ fontWeight: 400 }}>
                      {account.scope}
                    </span>
                  )}
                </span>
                {/* No membership in this year is a real state, not a gap: the
                    account works and is authorized for nothing until somebody
                    grants it a role. Saying so beats an empty space. */}
                <span className={`u-spacer pill pill--neutral${account.role ? '' : ' pill--plain'}`}>
                  {roleLabel}
                </span>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
