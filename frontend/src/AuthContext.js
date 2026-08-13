/**
 * Session state for the app.
 *
 * The session is whatever `GET /me` says it is. On mount, an existing token is
 * re-verified against the server rather than trusted, so a token for a deleted
 * person — or one whose membership ended with the academic year — lands on the
 * login screen instead of a half-working UI.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.me()
      .then(setSession)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const { token, ...me } = await api.login(username, password);
    setToken(token);
    setSession(me);
    return me;
  };

  const logout = () => {
    clearToken();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
