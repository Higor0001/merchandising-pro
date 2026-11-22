import React, { useState } from 'react';
import {
  LayoutDashboard,
  ClipboardCheck,
  MapPin,
  Store,
  PackagePlus,
  Layers,
  Grid3X3,
  Tag,
  CalendarClock,
  AlertTriangle,
  Sparkles,
  Megaphone,
  TrendingUp,
  Boxes,
  Bell,
  FileBarChart,
  Settings,
  Menu,
  X,
  Wifi,
  WifiOff,
  RefreshCw,
  LogOut,
  Bot,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';

export const MENU_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'visitas', label: 'Minhas visitas', icon: ClipboardCheck },
  { id: 'roteiros', label: 'Roteiros', icon: MapPin },
  { id: 'lojas', label: 'Lojas', icon: Store },
  { id: 'abastecimento', label: 'Abastecimento', icon: PackagePlus },
  { id: 'exposicao', label: 'Exposição e gôndolas', icon: Layers },
  { id: 'planogramas', label: 'Planogramas', icon: Grid3X3 },
  { id: 'precificacao', label: 'Precificação', icon: Tag },
  { id: 'validades', label: 'Validades', icon: CalendarClock },
  { id: 'rupturas', label: 'Rupturas', icon: AlertTriangle },
  { id: 'pontos-extras', label: 'Pontos extras', icon: Sparkles },
  { id: 'campanhas', label: 'Campanhas', icon: Megaphone },
  { id: 'concorrencia', label: 'Concorrência', icon: TrendingUp },
  { id: 'estoque', label: 'Estoque', icon: Boxes },
  { id: 'ocorrencias', label: 'Ocorrências', icon: Bell },
  { id: 'relatorios', label: 'Relatórios', icon: FileBarChart },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
] as const;

export type MenuId = (typeof MENU_ITEMS)[number]['id'] | 'ia';

interface LayoutProps {
  activePage: MenuId;
  onNavigate: (page: MenuId) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ activePage, onNavigate, children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const { isOnline, pendingCount, syncNow, syncing } = useOffline();

  const roleLabels: Record<string, string> = {
    promotor: 'Promotor',
    supervisor: 'Supervisor',
    admin: 'Administrador',
  };

  const handleSelect = (id: MenuId) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50">
      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg hover:bg-blue-600">
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <div className="font-bold text-sm tracking-wide">MERCHANDISING PRO</div>
            <div className="text-[11px] text-blue-100">{user?.name} • {roleLabels[user?.role || 'promotor']}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSelect('ia')}
            className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold flex items-center gap-1"
            title="Assistente IA"
          >
            <Bot className="w-4 h-4" />
          </button>
          {pendingCount > 0 && (
            <button onClick={syncNow} className="px-2 py-1 rounded-full bg-amber-400 text-slate-900 text-xs font-bold flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {pendingCount}
            </button>
          )}
          <span className={`p-1.5 rounded-full ${isOnline ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/30 text-red-200'}`}>
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          </span>
        </div>
      </header>

      {/* Sidebar (Desktop & Mobile Drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-68 bg-slate-900 text-slate-100 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="font-extrabold text-base tracking-wide text-white">MERCHANDISING PRO</div>
            <div className="text-xs text-blue-400 font-medium">Execução Inteligente no PDV</div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Info */}
        <div className="px-4 py-3 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{user?.name}</div>
            <div className="text-xs text-slate-400">{roleLabels[user?.role || 'promotor']} • {user?.region}</div>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isOnline ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

        {/* AI Assistant Quick Button */}
        <div className="px-3 pt-3">
          <button
            onClick={() => handleSelect('ia')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${
              activePage === 'ia'
                ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg'
                : 'bg-indigo-950/60 text-indigo-200 hover:bg-indigo-900/70 border border-indigo-800/50'
            }`}
          >
            <Bot className="w-4 h-4 shrink-0" />
            <span>Inteligência Artificial (IA)</span>
          </button>
        </div>

        {/* 17 Menu Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {MENU_ITEMS.map((item, idx) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition ${
                  active
                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{idx + 1}. {item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-2">
          {pendingCount > 0 && (
            <button
              onClick={syncNow}
              className="w-full py-2 px-3 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sincronizar ({pendingCount} pendentes)
            </button>
          )}
          <button
            onClick={logout}
            className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-red-600/80 text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-4 h-4" />
            Sair do Sistema
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-8">
        {!isOnline && (
          <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4" />
            Modo Offline ativo — Suas ações serão sincronizadas automaticamente ao reconectar.
          </div>
        )}
        <div className="max-w-7xl mx-auto p-4 lg:p-6">{children}</div>
      </main>

      {/* Mobile Bottom Quick Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 grid grid-cols-5 py-1.5 text-[10px] font-medium text-slate-600">
        {[
          { id: 'dashboard' as MenuId, label: 'Início', icon: LayoutDashboard },
          { id: 'lojas' as MenuId, label: 'Lojas', icon: Store },
          { id: 'visitas' as MenuId, label: 'Visitas', icon: ClipboardCheck },
          { id: 'abastecimento' as MenuId, label: 'Abastec.', icon: PackagePlus },
          { id: 'rupturas' as MenuId, label: 'Rupturas', icon: AlertTriangle },
        ].map((b) => {
          const Icon = b.icon;
          const active = activePage === b.id;
          return (
            <button
              key={b.id}
              onClick={() => handleSelect(b.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 ${active ? 'text-blue-600 font-bold' : ''}`}
            >
              <Icon className="w-5 h-5" />
              <span>{b.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
