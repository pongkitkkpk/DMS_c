/**
 * The recovery path for a session that expires mid-write. Pins the three
 * things the feature exists for: the dialog names the *current* person and
 * locks who may sign back in to them, a wrong password stays on the dialog
 * rather than losing it, and a correct one updates the session without
 * touching anything else on the page.
 *
 * Fake timers throughout: `ReauthDialog` deliberately waits before opening,
 * and then polls, so the failing request's own page — which shows its own
 * "บันทึกไม่สำเร็จ" dialog in the same tick — always gets to open first. See
 * the component's `openPrompt` for why a race would otherwise drop one of the
 * two dialogs.
 */
import React from 'react';
import { render, act } from '@testing-library/react';

import ReauthDialog from './ReauthDialog';
import { REAUTH_NEEDED_EVENT } from '../api';

jest.mock('../api', () => ({
  REAUTH_NEEDED_EVENT: 'dms:reauth-needed',
  // Mirrors the real messageOf's three branches, including the fall-through to
  // `error.message` — the defensive same-person check below throws a plain
  // `Error`, which only that branch reaches.
  messageOf: (error) =>
    (error && error.response && error.response.data && error.response.data.error) ||
    (error && error.request && 'server unreachable') ||
    (error && error.message) ||
    'error',
}));

const mockSwalFire = jest.fn();
const mockIsVisible = jest.fn(() => false);
const mockShowValidationMessage = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: {
    fire: (...args) => mockSwalFire(...args),
    isVisible: () => mockIsVisible(),
    isLoading: () => false,
    showValidationMessage: (...args) => mockShowValidationMessage(...args),
  },
}));

let mockAuth;
jest.mock('../AuthContext', () => ({ useAuth: () => mockAuth }));

const session = { person: { idStudent: 'fixture.student', fullNameTh: 'สมชาย นักศึกษา' } };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSwalFire.mockResolvedValue({ isConfirmed: false });
});

afterEach(() => {
  jest.useRealTimers();
});

const fireExpiry = () => act(() => { window.dispatchEvent(new Event(REAUTH_NEEDED_EVENT)); });
const settle = () => act(() => { jest.advanceTimersByTime(500); });

it('does nothing without a session to recover into', () => {
  mockAuth = { session: null, login: jest.fn() };
  render(<ReauthDialog />);

  fireExpiry();
  settle();

  expect(mockSwalFire).not.toHaveBeenCalled();
});

it('opens with the current person named and locked, not a blank form', () => {
  mockAuth = { session, login: jest.fn() };
  render(<ReauthDialog />);

  fireExpiry();
  settle();

  expect(mockSwalFire).toHaveBeenCalledWith(expect.objectContaining({
    input: 'password',
    html: expect.stringContaining('สมชาย นักศึกษา'),
  }));
  expect(mockSwalFire.mock.calls[0][0].html).toContain('fixture.student');
});

it('waits for the page\'s own failure dialog to close before opening, rather than replacing it', () => {
  mockAuth = { session, login: jest.fn() };
  mockIsVisible.mockReturnValue(true); // the page's own "บันทึกไม่สำเร็จ" dialog
  render(<ReauthDialog />);

  fireExpiry();
  settle();
  expect(mockSwalFire).not.toHaveBeenCalled();

  mockIsVisible.mockReturnValue(false); // the user dismissed it
  settle();
  expect(mockSwalFire).toHaveBeenCalledTimes(1);
});

it('signs back in as the locked username on a correct password', async () => {
  const login = jest.fn().mockResolvedValue({ person: { idStudent: 'fixture.student' } });
  mockAuth = { session, login };
  render(<ReauthDialog />);
  fireExpiry();
  settle();

  const { preConfirm } = mockSwalFire.mock.calls[0][0];
  await act(async () => { await preConfirm('the-real-password'); });

  expect(login).toHaveBeenCalledWith('fixture.student', 'the-real-password');
  expect(mockShowValidationMessage).not.toHaveBeenCalled();
});

it('keeps the dialog open and shows the server refusal on a wrong password', async () => {
  const login = jest.fn().mockRejectedValue({
    response: { data: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } },
  });
  mockAuth = { session, login };
  render(<ReauthDialog />);
  fireExpiry();
  settle();

  const { preConfirm } = mockSwalFire.mock.calls[0][0];
  await act(async () => { await preConfirm('wrong'); });

  expect(mockShowValidationMessage).toHaveBeenCalledWith('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
});

it('refuses a login that answers as a different person, even though the field cannot be edited to ask for one', async () => {
  // Guards a promise the UI already keeps by locking the field — kept as the
  // one place that promise is actually checked rather than assumed, in case a
  // future change makes the field editable.
  const login = jest.fn().mockResolvedValue({ person: { idStudent: 'someone.else' } });
  mockAuth = { session, login };
  render(<ReauthDialog />);
  fireExpiry();
  settle();

  const { preConfirm } = mockSwalFire.mock.calls[0][0];
  await act(async () => { await preConfirm('anything'); });

  expect(mockShowValidationMessage).toHaveBeenCalledWith(expect.stringContaining('ไม่ใช่บัญชีเดิม'));
});
