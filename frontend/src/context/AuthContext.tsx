import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { clearAuthCaches } from '../services/offlineDb';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'promotor' | 'supervisor' | 'admin';
  region: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('merchpro_user');
      const token = localStorage.getItem('merchpro_token');
      return saved && token ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      void clearAuthCaches();
      setUser(null);
    };
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, []);

  // Valida sessão silenciosamente ao iniciar quando estiver online
  useEffect(() => {
    const token = localStorage.getItem('merchpro_token');
    if (!token || !navigator.onLine) return;
    apiFetch<{ user: User }>('/auth/me')
      .then((res) => {
        if (res?.user) {
          localStorage.setItem('merchpro_user', JSON.stringify(res.user));
          setUser(res.user);
        }
      })
      .catch(() => {
        // Se retornar 401, o evento auth-expired já limpa a sessão
      });
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('merchpro_token', res.token);
      localStorage.setItem('merchpro_user', JSON.stringify(res.user));
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('merchpro_token');
    localStorage.removeItem('merchpro_user');
    void clearAuthCaches();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
