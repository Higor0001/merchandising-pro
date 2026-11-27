import React, { useState } from 'react';
import { Store, Lock, Mail, ArrowRight, Sparkles, Camera, WifiOff, PackageSearch } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 lg:p-8 relative overflow-hidden">
      {/* Subtle Ambient Gradients */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />

      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl overflow-hidden shadow-2xl border border-slate-800/80 bg-white">
        {/* Left Brand Showcase (Desktop) */}
        <div className="hidden lg:flex lg:col-span-6 bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white p-9 flex-col justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-600/30">
                <Store className="w-6 h-6" />
              </div>
              <div>
                <div className="font-display font-extrabold text-lg tracking-tight">MERCHANDISING PRO</div>
                <div className="text-xs text-blue-300 font-semibold">Plataforma de Trade Marketing 2.0</div>
              </div>
            </div>

            <div className="pt-4 space-y-2">
              <h2 className="font-display text-2xl font-extrabold leading-tight">
                Execução impecável no PDV, com visão computacional e envio HD instantâneo.
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Audite gôndolas, fotografe áreas em alta definição com marca d&apos;água automática e acompanhe cada loja em tempo real.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-6">
            {[
              { icon: Camera, text: 'Envio instantâneo em HD ao Telegram com marca d’água e panorâmicas' },
              { icon: Sparkles, text: 'Auditoria IA 100% em 2 passos com editor visual interativo' },
              { icon: PackageSearch, text: 'Catálogo PepsiCo atualizado com EANs e gramaturas reais' },
              { icon: WifiOff, text: 'Operação Offline-First com fila segura no dispositivo' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.text} className="flex items-start gap-2.5 text-xs text-slate-200">
                  <div className="p-1.5 rounded-lg bg-white/10 text-blue-300 shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="leading-snug">{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Form Card */}
        <div className="lg:col-span-6 p-6 sm:p-9 flex flex-col justify-center space-y-6 bg-white">
          <div className="space-y-1.5 text-center lg:text-left">
            <div className="lg:hidden inline-flex items-center justify-center w-13 h-13 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 mb-1">
              <Store className="w-6 h-6" />
            </div>
            <h1 className="font-display text-2xl font-extrabold text-slate-900">Bem-vindo de volta</h1>
            <p className="text-sm text-slate-500">Entre com suas credenciais para iniciar sua rota.</p>
          </div>

          {error && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                E-mail corporativo
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="seu.email@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 bg-slate-50/70 focus:bg-white rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 bg-slate-50/70 focus:bg-white rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 transition disabled:opacity-60 text-sm"
            >
              <span>{loading ? 'Autenticando...' : 'Acessar Plataforma'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {IS_DEV && (
            <div className="pt-4 border-t border-slate-100">
              <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-2 text-center">
                Acesso Rápido (Ambiente DEV)
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Promotor', mail: 'promotor@merchandising.com' },
                  { label: 'Supervisor', mail: 'supervisor@merchandising.com' },
                  { label: 'Admin', mail: 'admin@merchandising.com' },
                ].map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => quickFill(r.mail)}
                    className="px-2 py-2 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 text-xs font-bold transition"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
