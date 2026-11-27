import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, clearMemoryApiCache } from '../services/api';
import { clearAuthCaches } from '../services/offlineDb';

export const PROVISIONAL_LOGIN_DISABLED = true;

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'promotor' | 'supervisor' | 'admin';
  region: string;
  city?: string;
  title?: string;
  phone?: string;
}

export interface ProvisionalCertificate {
  serial: string;
  tipo: string;
  sistema: string;
  promotor: string;
  cidade: string;
  uf: string;
  email: string;
  emitido_em: string;
  status: string;
  algoritmo: string;
  assinatura_digital: string;
}

const DEFAULT_CERTIFICATE: ProvisionalCertificate = {
  serial: 'MPRO-CERT-PROV-2026-HIGOR-CI',
  tipo: 'Certificado Digital Provisório',
  sistema: 'MERCHANDISING PRO',
  promotor: 'Higor',
  cidade: 'Cachoeiro de Itapemirim',
  uf: 'ES',
  email: 'higor@merchandising.com',
  emitido_em: '2026-11-27T03:40:00-03:00',
  status: 'ATIVO (Tela de Login Desativada Provisoriamente)',
  algoritmo: 'SHA-256',
  assinatura_digital: '',
};

interface AuthContextType {
  user: User | null;
  certificate: ProvisionalCertificate | null;
  loginDisabled: boolean;
  loading: boolean;
  initializing: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  retryProvisionalAccess: () => Promise<void>;
  downloadCertificate: () => void;
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
  const [certificate, setCertificate] = useState<ProvisionalCertificate | null>(() => {
    try {
      const saved = localStorage.getItem('merchpro_provisional_cert');
      return saved ? JSON.parse(saved) : PROVISIONAL_LOGIN_DISABLED ? DEFAULT_CERTIFICATE : null;
    } catch {
      return PROVISIONAL_LOGIN_DISABLED ? DEFAULT_CERTIFICATE : null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState<boolean>(() => {
    if (!PROVISIONAL_LOGIN_DISABLED) return false;
    return !localStorage.getItem('merchpro_token');
  });
  const [authError, setAuthError] = useState<string | null>(null);

  const activateProvisionalSession = useCallback(async () => {
    setInitializing(true);
    setAuthError(null);
    try {
      const res = await apiFetch<{
        token: string;
        user: User;
        certificate?: ProvisionalCertificate;
      }>('/auth/provisional', { method: 'POST' });

      if (res?.token && res?.user) {
        localStorage.setItem('merchpro_token', res.token);
        localStorage.setItem('merchpro_user', JSON.stringify(res.user));
        setUser(res.user);
        if (res.certificate) {
          localStorage.setItem('merchpro_provisional_cert', JSON.stringify(res.certificate));
          setCertificate(res.certificate);
        }
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Não foi possível validar o certificado digital provisório.');
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    const onExpired = () => {
      void clearAuthCaches();
      setUser(null);
      if (PROVISIONAL_LOGIN_DISABLED) {
        void activateProvisionalSession();
      }
    };
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, [activateProvisionalSession]);

  // Acesso direto com Certificado Digital Provisório (tela de login desativada)
  useEffect(() => {
    if (PROVISIONAL_LOGIN_DISABLED) {
      const token = localStorage.getItem('merchpro_token');
      const savedRaw = localStorage.getItem('merchpro_user');
      let savedUser: User | null = null;
      try {
        savedUser = savedRaw ? JSON.parse(savedRaw) : null;
      } catch {
        savedUser = null;
      }

      if (!token || !savedUser || savedUser.email !== 'higor@merchandising.com') {
        void activateProvisionalSession();
        return;
      }

      if (navigator.onLine) {
        apiFetch<{ user: User }>('/auth/me')
          .then((res) => {
            if (res?.user) {
              const merged = {
                ...res.user,
                city: res.user.city || 'Cachoeiro de Itapemirim',
                title: res.user.title || 'Promotor',
              };
              localStorage.setItem('merchpro_user', JSON.stringify(merged));
              setUser(merged);
            }
          })
          .catch(() => {
            void activateProvisionalSession();
          });
      }
      return;
    }

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
  }, [activateProvisionalSession]);

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

  const downloadCertificate = () => {
    const cert = certificate || DEFAULT_CERTIFICATE;
    const content = [
      '-----BEGIN MERCHANDISING PRO DIGITAL CERTIFICATE-----',
      `Sistema:            ${cert.sistema}`,
      `Tipo:               ${cert.tipo}`,
      `Número de Série:    ${cert.serial}`,
      `Promotor:           ${cert.promotor}`,
      `Cidade:             ${cert.cidade} - ${cert.uf}`,
      `E-mail Vinculado:   ${cert.email}`,
      `Status:             ${cert.status}`,
      `Data de Emissão:    ${cert.emitido_em}`,
      `Algoritmo:          ${cert.algoritmo}`,
      `Assinatura Digital: ${cert.assinatura_digital || 'VALIDADA-EM-SERVIDOR'}`,
      '-----END MERCHANDISING PRO DIGITAL CERTIFICATE-----',
      '',
    ].join('\n');
    const blob = new Blob([content], { type: 'application/x-x509-ca-cert;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Certificado_Digital_Provisorio_Higor.crt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const logout = () => {
    localStorage.removeItem('merchpro_token');
    localStorage.removeItem('merchpro_user');
    clearMemoryApiCache();
    void clearAuthCaches();
    setUser(null);
    if (PROVISIONAL_LOGIN_DISABLED) {
      void activateProvisionalSession();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        certificate,
        loginDisabled: PROVISIONAL_LOGIN_DISABLED,
        loading,
        initializing,
        authError,
        login,
        retryProvisionalAccess: activateProvisionalSession,
        downloadCertificate,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
