/**
 * `RequireAuth` — the route guard every protected page renders through. Its
 * own comment names why the redirect carries the page the user was on: a
 * link like `/spending?year=2566` or `/projects/12` is meant to be *sent* to
 * somebody, and quietly delivering the project list instead looks like a
 * link that worked. And why it does *not* carry that page after a deliberate
 * sign-out: the next person to use this browser did not ask for it.
 *
 * `AppBar` — its nav is filtered by the same two roles the server enforces
 * on `GET /api/spending`, so a screen an officer cannot use never shows up
 * as a link. Neither piece has ever run in a test — nothing in this suite
 * imports `App`.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Switch } from 'react-router-dom';

let mockAuth;
jest.mock('./AuthContext', () => ({ useAuth: () => mockAuth }));

const { RequireAuth, AppBar } = require('./App');

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Switch>
        <Route exact path="/login" render={({ location }) => (
          <div data-testid="login">
            login{location.state && location.state.from ? ` (from: ${location.state.from})` : ''}
          </div>
        )} />
        <Route exact path="/projects/:id" render={() => (
          <RequireAuth><div data-testid="protected">protected content</div></RequireAuth>
        )} />
      </Switch>
    </MemoryRouter>
  );
}

test('renders nothing decisive while the session is still loading — no flash of the login screen', () => {
  mockAuth = { loading: true, session: null, ended: null };
  renderAt('/projects/12');

  expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
});

test('renders the protected content once a session exists', () => {
  mockAuth = { loading: false, session: { person: { idStudent: 'x' } }, ended: null };
  renderAt('/projects/12');

  expect(screen.getByTestId('protected')).toBeInTheDocument();
});

test('with no session, redirects to /login carrying the page the user was on', () => {
  mockAuth = { loading: false, session: null, ended: null };
  renderAt('/projects/12?tab=budget');

  expect(screen.getByTestId('login')).toHaveTextContent('from: /projects/12?tab=budget');
});

test('after a deliberate sign-out, redirects to /login without carrying a page to return to', () => {
  mockAuth = { loading: false, session: null, ended: 'signed-out' };
  renderAt('/projects/12');

  const login = screen.getByTestId('login');
  expect(login).toHaveTextContent('login');
  expect(login).not.toHaveTextContent('from:');
});

test('after an expired session (not a sign-out), the return page is still carried', () => {
  mockAuth = { loading: false, session: null, ended: 'expired' };
  renderAt('/projects/12');

  expect(screen.getByTestId('login')).toHaveTextContent('from: /projects/12');
});

describe('AppBar', () => {
  const session = (overrides = {}) => ({
    person: { fullNameTh: 'สมชาย นักศึกษา' },
    role: null,
    academicYear: 2569,
    membership: null,
    ...overrides,
  });

  function renderBar(auth) {
    mockAuth = auth;
    return render(<MemoryRouter><AppBar /></MemoryRouter>);
  }

  test('renders nothing at all without a session', () => {
    const { container } = renderBar({ session: null, logout: jest.fn() });
    expect(container).toBeEmptyDOMElement();
  });

  test.each(['ADMIN', 'STUACT'])('%s sees every nav entry, including the officer-only ones', (role) => {
    renderBar({ session: session({ role }), logout: jest.fn() });

    for (const label of ['ภาพรวม', 'โครงการ', 'วงเงินจัดสรร', 'สรุปการใช้เงิน', 'สรุปรายปี', 'สิทธิ์']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  test.each(['SH', 'AD', null])('%s does not see the officer-only nav entries', (role) => {
    renderBar({ session: session({ role }), logout: jest.fn() });

    for (const label of ['ภาพรวม', 'โครงการ', 'วงเงินจัดสรร', 'สรุปรายปี']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'สรุปการใช้เงิน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'สิทธิ์' })).not.toBeInTheDocument();
  });

  test('shows the club name as the signed-in scope when there is one', () => {
    renderBar({ session: session({ membership: { club_name: 'ชมรมกีฬา' } }), logout: jest.fn() });
    expect(screen.getByText('ชมรมกีฬา')).toBeInTheDocument();
  });

  test('falls back to the club group, then the agency, when there is no club', () => {
    renderBar({ session: session({ membership: { club_group_name: 'ฝ่ายกีฬา' } }), logout: jest.fn() });
    expect(screen.getByText('ฝ่ายกีฬา')).toBeInTheDocument();
  });

  test('shows "ไม่ได้สังกัดหน่วยงาน" for someone with no membership at all', () => {
    renderBar({ session: session({ membership: null }), logout: jest.fn() });
    expect(screen.getByText('ไม่ได้สังกัดหน่วยงาน')).toBeInTheDocument();
  });

  test('shows "ไม่มีสิทธิ์" rather than a blank pill for a null role', () => {
    renderBar({ session: session({ role: null }), logout: jest.fn() });
    expect(screen.getByText('ไม่มีสิทธิ์')).toBeInTheDocument();
  });

  test('signing out calls logout() and navigates to /login', () => {
    const logout = jest.fn();
    mockAuth = { session: session(), logout };
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppBar />
        <Route exact path="/login" render={() => <div data-testid="landed-on-login" />} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('landed-on-login')).toBeInTheDocument();
  });
});
