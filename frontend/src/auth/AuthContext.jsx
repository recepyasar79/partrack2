import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { TOKEN_KEY, USER_KEY } from '../utils/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (kullanici_adi, sifre) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { kullanici_adi, sifre });
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.kullanici));
      setUser(data.kullanici);
      return data.kullanici;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      localStorage.setItem(USER_KEY, JSON.stringify(data.kullanici));
      setUser(data.kullanici);
    } catch {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    if (user && localStorage.getItem(TOKEN_KEY)) {
      refresh();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde olmalı');
  return ctx;
}
