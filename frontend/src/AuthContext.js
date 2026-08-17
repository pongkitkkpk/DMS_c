/**
 * Session state for the app.
 *
 * The session is whatever `GET /me` says it is. On mount, an existing token is
 * re-verified against the server rather than trusted, so a token for a deleted
 * person — or one whose membership ended with the academic year — lands on the
 * login screen instead of a half-working UI.
 *
 * A session can also end *while* the app is open, which is the ordinary case: a
 * tab left overnight outlives `JWT_EXPIRES_IN`. Nothing here can predict when —
 * the expiry is the server's and the token is opaque to this bundle on purpose —
 * so it is learned from the first 401 instead, which `api.js` turns into
 * `SESSION_LOST_EVENT`. This provider is the only thing that owns session state,
 * so it is the only thing that reacts to it.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken, SESSION_LOST_EVENT } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  /**
   * Why there is no session, when the answer is interesting: `'expired'` after a
   * 401, `'signed-out'` after the button. `null` for somebody who simply has not
   * signed in — the login screen has nothing to explain to them.
   *
   * Two screens read it. The login form says which of the two happened, because
   * "you are back at the login page" is not an explanation. And `RequireAuth`
   * decides from it whether to carry the page the user was on: after an expiry
   * they wanted that page and should get it back, after a deliberate sign-out the
   * next person to use this browser did not ask for it.
   */
  const [ended, setEnded] = useState(null);

  // Registered before the verification below can fail, so the event cannot
  // arrive with nothing listening.
  useEffect(() => {
    const onSessionLost = () => {
      setSession(null);
      setEnded('expired');
    };
    window.addEventListener(SESSION_LOST_EVENT, onSessionLost);
    return () => window.removeEventListener(SESSION_LOST_EVENT, onSessionLost);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.me()
      .then(setSession)
      // Only an answer *from the server* says the token is bad, and a 401 has
      // already cleared it in the interceptor. A request that never arrived —
      // the API restarting, the laptop's wifi — says nothing about the token,
      // and discarding it there signs the user out for somebody else's outage.
      // They land on the login screen either way; the difference is whether the
      // token is still there to work on the next reload.
      .catch((err) => { if (err.response) clearToken(); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const { token, ...me } = await api.login(username, password);
    setToken(token);
    setSession(me);
    setEnded(null);
    return me;
  };

  const logout = () => {
    clearToken();
    setSession(null);
    setEnded('signed-out');
  };

  return (
    <AuthContext.Provider value={{ session, loading, ended, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
