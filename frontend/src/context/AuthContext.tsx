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

export const EMBEDDED_CERTIFICATE: ProvisionalCertificate = {
  serial: 'MPRO-CERT-PROV-2026-HIGOR-CI',
  tipo: 'Certificado Digital Provisório',
  sistema: 'MERCHANDISING PRO',
  promotor: 'Higor',
  cidade: 'Cachoeiro de Itapemirim',
  uf: 'ES',
  email: 'higor@merchandising.com',
  emitido_em: '2026-11-27T03:40:00-03:00',
  status: 'ATIVO (Inserido no site — Login desativado provisoriamente)',
  algoritmo: 'SHA-256',
  assinatura_digital: '8EC3C9B7D986FE5EC7404711F5333EA6FA6A776E21D5F0B8498DB051ED505FA8',
};

const EMBEDDED_PROVISIONAL_USER: User = {
  id: 1,
  name: 'Higor',
  email: 'higor@merchandising.com',
  role: 'admin',
  region: 'Cachoeiro de Itapemirim',
  city: 'Cachoeiro de Itapemirim',
  title: 'Promotor',
};

interface AuthContextType {
  user: User | null;
  certificate: ProvisionalCertificate | null;
  loginDisabled: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  importCertificateFile: (file: File) => Promise<{ valid: boolean; message: string }>;
  downloadCertificate: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('merchpro_user');
      const token = localStorage.getItem('merchpro_token');
      if (saved && token) {
        const parsed = JSON.parse(saved);
        if (!PROVISIONAL_LOGIN_DISABLED || parsed?.email === EMBEDDED_PROVISIONAL_USER.email) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    // Entra DIRETO no sistema com o certificado digital inserido (sem passar pela tela de login)
    return PROVISIONAL_LOGIN_DISABLED ? EMBEDDED_PROVISIONAL_USER : null;
  });

  const [certificate, setCertificate] = useState<ProvisionalCertificate | null>(() => {
    try {
      const saved = localStorage.getItem('merchpro_provisional_cert');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return PROVISIONAL_LOGIN_DISABLED ? EMBEDDED_CERTIFICATE : null;
  });

  const [loading, setLoading] = useState(false);

  const syncProvisionalSessionInBackground = useCallback(async () => {
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
    } catch {
      // Mesmo offline ou antes da resposta, o certificado embutido já autentica diretamente
      setUser((prev) => prev || EMBEDDED_PROVISIONAL_USER);
      setCertificate((prev) => prev || EMBEDDED_CERTIFICATE);
    }
  }, []);

  useEffect(() => {
    const onExpired = () => {
      if (PROVISIONAL_LOGIN_DISABLED) {
        void syncProvisionalSessionInBackground();
        return;
      }
      void clearAuthCaches();
      setUser(null);
    };
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, [syncProvisionalSessionInBackground]);

  useEffect(() => {
    if (PROVISIONAL_LOGIN_DISABLED) {
      localStorage.setItem('merchpro_provisional_cert', JSON.stringify(EMBEDDED_CERTIFICATE));
      if (navigator.onLine) {
        void syncProvisionalSessionInBackground();
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
  }, [syncProvisionalSessionInBackground]);

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

  const importCertificateFile = async (file: File): Promise<{ valid: boolean; message: string }> => {
    try {
      const text = await file.text();
      const hasSerial = text.includes(EMBEDDED_CERTIFICATE.serial);
      const hasSig = text.toUpperCase().includes(EMBEDDED_CERTIFICATE.assinatura_digital);
      if (!hasSerial || !hasSig) {
        return {
          valid: false,
          message: 'Arquivo não corresponde ao Certificado Digital Provisório oficial de Higor (Cachoeiro de Itapemirim).',
        };
      }
      localStorage.setItem('merchpro_provisional_cert', JSON.stringify(EMBEDDED_CERTIFICATE));
      setCertificate(EMBEDDED_CERTIFICATE);
      await syncProvisionalSessionInBackground();
      return {
        valid: true,
        message: 'Certificado Digital validado com sucesso! Promotor: Higor • Cachoeiro de Itapemirim.',
      };
    } catch {
      return { valid: false, message: 'Não foi possível ler o arquivo de certificado.' };
    }
  };

  const downloadCertificate = () => {
    const cert = certificate || EMBEDDED_CERTIFICATE;
    const content = [
      '====================================================================',
      '          MERCHANDISING PRO - CERTIFICADO DIGITAL PROVISÓRIO        ',
      '====================================================================',
      `Promotor:           ${cert.promotor}`,
      `Cidade:             ${cert.cidade} - ${cert.uf}`,
      `Sistema:            ${cert.sistema}`,
      `Número de Série:    ${cert.serial}`,
      `Status:             ${cert.status}`,
      `Data de Emissão:    27/11/2026 03:40 (Horário de Brasília)`,
      `Algoritmo:          ${cert.algoritmo}`,
      `Impressão Digital:  ${cert.assinatura_digital}`,
      '====================================================================',
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
    if (PROVISIONAL_LOGIN_DISABLED) return;
    localStorage.removeItem('merchpro_token');
    localStorage.removeItem('merchpro_user');
    clearMemoryApiCache();
    void clearAuthCaches();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        certificate,
        loginDisabled: PROVISIONAL_LOGIN_DISABLED,
        loading,
        login,
        importCertificateFile,
        downloadCertificate,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
