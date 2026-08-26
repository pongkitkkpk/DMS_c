/**
 * `AuthContext` is the only thing that owns session state, and its own
 * header names the distinction the mount-time verification exists to make:
 * a 401 *from the server* means the token is genuinely bad and should be
 * dropped, but a request that never arrived (the API restarting, flaky wifi)
 * says nothing about the token — clearing it there would sign the user out
 * for somebody else's outage. Every other test in this suite mocks
 * `AuthContext` away, so that distinction has never actually run.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

const mockApi = { me: jest.fn(), login: jest.fn() };
// The token store lives inside the factory (not the outer scope) because
// `jest.mock`'s factory may not reference out-of-scope variables — it is
// read and driven through the exported get/set/clear functions instead.
jest.mock('./api', () => {
  let token = null;
  return {
    api: mockApi,
    getToken: () => token,
    setToken: (t) => { token = t; },
    clearToken: () => { token = null; },
    SESSION_LOST_EVENT: 'dms:session-lost',
  };
});

const { AuthProvider, useAuth } = require('./AuthContext');
const { SESSION_LOST_EVENT, getToken, setToken, clearToken } = require('./api');

/** Exposes the hook's state as text/buttons so tests can read and drive it without reaching into internals. */
function Probe() {
  const { session, loading, ended, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="session">{session ? session.person.idStudent : 'none'}</span>
      <span data-testid="ended">{ended === null ? 'null' : ended}</span>
      <button onClick={() => login('fixture.student', 'pw').catch(() => {})}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

function renderProbe() {
  return render(<AuthProvider><Probe /></AuthProvider>);
}

beforeEach(() => {
  clearToken();
  jest.clearAllMocks();
});

describe('mount', () => {
  test('with no token: resolves loading immediately, never calls api.me()', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(mockApi.me).not.toHaveBeenCalled();
    expect(screen.getByTestId('session')).toHaveTextContent('none');
  });

  test('with a token that still verifies: session is populated', async () => {
    setToken('a-real-token');
    mockApi.me.mockResolvedValue({ person: { idStudent: 'fixture.student' } });

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('fixture.student'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  test('a genuine 401 from the server clears the token', async () => {
    setToken('a-stale-token');
    mockApi.me.mockRejectedValue({ response: { status: 401 } });

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(getToken()).toBeNull();
  });

  test('a network error (no response) leaves the token alone — the outage is not the token’s fault', async () => {
    setToken('a-fine-token');
    mockApi.me.mockRejectedValue({ request: {} }); // no `.response` — the request never came back

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(getToken()).toBe('a-fine-token');
  });
});

describe('SESSION_LOST_EVENT', () => {
  test('clears the session and marks it "expired", for the login screen to explain', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    act(() => { window.dispatchEvent(new Event(SESSION_LOST_EVENT)); });

    expect(screen.getByTestId('session')).toHaveTextContent('none');
    expect(screen.getByTestId('ended')).toHaveTextContent('expired');
  });
});

describe('login / logout', () => {
  test('login stores the token, sets the session, and clears any previous "ended" reason', async () => {
    mockApi.login.mockResolvedValue({ token: 'new-token', person: { idStudent: 'fixture.student' } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    act(() => { window.dispatchEvent(new Event(SESSION_LOST_EVENT)); }); // leave an "expired" reason behind first
    expect(screen.getByTestId('ended')).toHaveTextContent('expired');

    await act(async () => { screen.getByText('login').click(); });

    expect(getToken()).toBe('new-token');
    expect(screen.getByTestId('session')).toHaveTextContent('fixture.student');
    expect(screen.getByTestId('ended')).toHaveTextContent('null');
  });

  test('logout clears the token and session, and marks the reason "signed-out"', async () => {
    setToken('a-real-token');
    mockApi.me.mockResolvedValue({ person: { idStudent: 'fixture.student' } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('fixture.student'));

    act(() => { screen.getByText('logout').click(); });

    expect(getToken()).toBeNull();
    expect(screen.getByTestId('session')).toHaveTextContent('none');
    expect(screen.getByTestId('ended')).toHaveTextContent('signed-out');
  });
});
