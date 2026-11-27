import React, { useState } from 'react';
import { Store, Lock, Mail, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const IS_DEV = import.meta.env.DEV;

export const LoginPage: React.FC = () => {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState(IS_DEV ? 'promotor@merchandising.com' : '');
  const [password, setPassword] = useState(IS_DEV ? '123456' : '');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Erro ao autenticar');
    }
  };

  const quickFill = (roleEmail: string) => {
    if (!IS_DEV) return;
    setEmail(roleEmail);
    setPassword('123456');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
            <Store className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">MERCHANDISING PRO</h1>
          <p className="text-sm text-slate-500">Sistema Inteligente de Gestão e Execução no PDV</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="email"
                required
                autoComplete="username"
                placeholder="seu.email@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            <span>{loading ? 'Entrando...' : 'Acessar Plataforma'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {IS_DEV && (
          <div className="pt-4 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2 text-center">
              Perfis de Acesso Rápido (Somente DEV)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => quickFill('promotor@merchandising.com')}
                className="px-2 py-2 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-700 text-xs font-semibold transition"
              >
                Promotor
              </button>
              <button
                type="button"
                onClick={() => quickFill('supervisor@merchandising.com')}
                className="px-2 py-2 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-700 text-xs font-semibold transition"
              >
                Supervisor
              </button>
              <button
                type="button"
                onClick={() => quickFill('admin@merchandising.com')}
                className="px-2 py-2 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-700 text-xs font-semibold transition"
              >
                Admin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
