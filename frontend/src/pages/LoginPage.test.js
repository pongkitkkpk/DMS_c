/**
 * The one door with no lock on it before this file existed (see the strategy
 * log, 2026-08-15) — so what it tests is not the form, it's the two guards
 * around it: an already-open session redirects instead of re-asking, and the
 * page it redirects to can never leave this site, however the link was made.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';

import LoginPage from './LoginPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { authMode: jest.fn(), login: jest.fn() },
  messageOf: (error) =>
    (error && error.response && error.response.data && error.response.data.error) || 'error',
}));

let mockAuth = null;
jest.mock('../AuthContext', () => ({ useAuth: () => mockAuth }));

const show = (entry, auth) => {
  mockAuth = { session: null, login: jest.fn(), ended: null, ...auth };
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Route exact path="/login"><LoginPage /></Route>
      <Route exact path="/projects"><div>PROJECTS PAGE</div></Route>
      <Route exact path="/spending"><div>SPENDING PAGE</div></Route>
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  api.authMode.mockResolvedValue({ accounts: [], academicYear: 2567, requiresSharedPassword: false });
});

it('redirects an already-open session to where it was headed', async () => {
  show(
    { pathname: '/login', state: { from: '/spending' } },
    { session: { role: 'SH' } },
  );

  expect(await screen.findByText('SPENDING PAGE')).toBeInTheDocument();
});

it('refuses to redirect off this site, however the link was built', async () => {
  show(
    { pathname: '/login', state: { from: '//evil.example' } },
    { session: { role: 'SH' } },
  );

  // Falls back to the default destination — never a bare `//host` push.
  expect(await screen.findByText('PROJECTS PAGE')).toBeInTheDocument();
});

it('signs in and lands back on the page that sent it here', async () => {
  const login = jest.fn().mockResolvedValue({ role: 'SH' });
  show({ pathname: '/login', state: { from: '/spending' } }, { login });

  await userEvent.type(screen.getByLabelText('ชื่อผู้ใช้'), 'fixture.student');
  await userEvent.type(screen.getByLabelText('รหัสผ่าน'), 'anything');
  await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

  await waitFor(() => expect(login).toHaveBeenCalledWith('fixture.student', 'anything'));
  expect(await screen.findByText('SPENDING PAGE')).toBeInTheDocument();
});

it('shows the server\'s refusal rather than a generic failure', async () => {
  const login = jest.fn().mockRejectedValue({
    response: { data: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } },
  });
  show('/login', { login });

  await userEvent.type(screen.getByLabelText('ชื่อผู้ใช้'), 'fixture.student');
  await userEvent.type(screen.getByLabelText('รหัสผ่าน'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

  expect(await screen.findByText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')).toBeInTheDocument();
});

it('explains an expiry differently from an ordinary visit, and says the page is kept', async () => {
  show({ pathname: '/login', state: { from: '/spending' } }, { ended: 'expired' });

  expect(await screen.findByText(/เซสชันหมดอายุแล้ว/)).toBeInTheDocument();
  expect(screen.getByText(/ระบบจะพากลับไปหน้าที่ค้างไว้/)).toBeInTheDocument();
});

it('fills only the username for a shared-password deployment, leaving the password to the person', async () => {
  api.authMode.mockResolvedValue({
    accounts: [{ idStudent: 'fixture.admin', fullNameTh: 'ผู้ดูแล ระบบ', role: 'ADMIN', scope: null }],
    academicYear: 2567,
    requiresSharedPassword: true,
  });
  show('/login', {});

  const account = await screen.findByRole('button', { name: /ผู้ดูแล ระบบ.*ผู้ดูแลระบบ/ });
  await userEvent.click(account);

  expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveValue('fixture.admin');
  expect(screen.getByLabelText('รหัสผ่าน')).toHaveValue('');
});

it('fills both fields for a mock deployment with no shared password', async () => {
  api.authMode.mockResolvedValue({
    accounts: [{ idStudent: 'fixture.student', fullNameTh: 'สมชาย นักศึกษา', role: null, scope: null }],
    academicYear: 2567,
    requiresSharedPassword: false,
  });
  show('/login', {});

  // No role yet is a real, sayable state — not a blank pill.
  const account = await screen.findByRole('button', { name: /สมชาย นักศึกษา.*ยังไม่มีสิทธิ์/ });
  await userEvent.click(account);

  expect(screen.getByLabelText('ชื่อผู้ใช้')).toHaveValue('fixture.student');
  expect(screen.getByLabelText('รหัสผ่าน')).toHaveValue('dev');
});

it('shows no demonstration card at all against a real identity provider', async () => {
  api.authMode.mockResolvedValue({ accounts: [], academicYear: 2567, requiresSharedPassword: false });
  show('/login', {});

  await screen.findByLabelText('ชื่อผู้ใช้');
  expect(screen.queryByText(/บัญชีสาธิต/)).not.toBeInTheDocument();
});
