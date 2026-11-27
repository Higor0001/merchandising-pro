import React, { useEffect, useState } from 'react';
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
  Search,
  PackageSearch,
  ShieldCheck,
  Download,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { GlobalSearchModal } from './GlobalSearchModal';

export const MENU_GROUPS = [
  {
    title: 'Operação em Campo',
    items: [
      { id: 'dashboard', label: 'Central do Dia', icon: LayoutDashboard, managerOnly: false },
      { id: 'lojas', label: 'Lojas & PDV', icon: Store, managerOnly: false },
      { id: 'visitas', label: 'Minhas Visitas', icon: ClipboardCheck, managerOnly: false },
      { id: 'roteiros', label: 'Roteiros', icon: MapPin, managerOnly: false },
      { id: 'ia', label: 'Auditoria IA (100%)', icon: Bot, managerOnly: false },
    ],
  },
  {
    title: 'Execução & Portfólio',
    items: [
      { id: 'catalogo', label: 'Catálogo PepsiCo', icon: PackageSearch, managerOnly: false },
      { id: 'abastecimento', label: 'Abastecimento', icon: PackagePlus, managerOnly: false },
      { id: 'exposicao', label: 'Exposição & Gôndolas', icon: Layers, managerOnly: false },
      { id: 'planogramas', label: 'Planogramas', icon: Grid3X3, managerOnly: false },
      { id: 'precificacao', label: 'Precificação', icon: Tag, managerOnly: false },
      { id: 'validades', label: 'Validades & PVPS', icon: CalendarClock, managerOnly: false },
      { id: 'estoque', label: 'Estoque em Loja', icon: Boxes, managerOnly: false },
    ],
  },
  {
    title: 'Alertas & Comercial',
    items: [
      { id: 'rupturas', label: 'Rupturas', icon: AlertTriangle, managerOnly: false },
      { id: 'ocorrencias', label: 'Ocorrências', icon: Bell, managerOnly: false },
      { id: 'pontos-extras', label: 'Pontos Extras', icon: Sparkles, managerOnly: false },
      { id: 'campanhas', label: 'Campanhas', icon: Megaphone, managerOnly: false },
      { id: 'concorrencia', label: 'Concorrência', icon: TrendingUp, managerOnly: false },
    ],
  },
  {
    title: 'Gestão & Administração',
    items: [
      { id: 'relatorios', label: 'Relatórios', icon: FileBarChart, managerOnly: true },
      { id: 'configuracoes', label: 'Configurações', icon: Settings, managerOnly: true },
    ],
  },
] as const;

export type MenuId = (typeof MENU_GROUPS)[number]['items'][number]['id'];

export const MENU_ITEMS: ReadonlyArray<{
  id: MenuId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  managerOnly: boolean;
}> = MENU_GROUPS.flatMap((g) => [...g.items]);

const PAGE_TITLES: Record<MenuId, string> = {
  dashboard: 'Central do Dia',
  lojas: 'Lojas & Pontos de Venda',
  visitas: 'Minhas Visitas',
  roteiros: 'Roteiros Semanais',
  ia: 'Auditoria IA de Gôndolas',
  catalogo: 'Catálogo PepsiCo & Gramaturas',
  abastecimento: 'Abastecimento & Reposição',
  exposicao: 'Exposição & Gôndolas',
  planogramas: 'Planogramas & Share of Shelf',
  precificacao: 'Precificação & Etiquetas',
  validades: 'Validades & PVPS',
  estoque: 'Estoque em Loja',
  rupturas: 'Gestão de Rupturas',
  ocorrencias: 'Ocorrências no PDV',
  'pontos-extras': 'Pontos Extras & Displays',
  campanhas: 'Campanhas Promocionais',
  concorrencia: 'Pesquisa de Concorrência',
  relatorios: 'Relatórios Gerenciais',
  configuracoes: 'Configurações & Equipe',
};

interface LayoutProps {
  activePage: MenuId;
  activeStoreContext?: boolean;
  onNavigate: (page: MenuId) => void;
  onOpenStore: (storeId: number) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  activePage,
  activeStoreContext = false,
  onNavigate,
  onOpenStore,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [certStatusMsg, setCertStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { user, certificate, logout, loginDisabled, downloadCertificate, importCertificateFile } = useAuth();
  const { isOnline, pendingCount, failedCount, syncNow, retryFailed, clearFailed, syncing } = useOffline();

  const isManager = user?.role === 'admin' || user?.role === 'supervisor';

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const roleLabels: Record<string, string> = {
    promotor: 'Promotor',
    supervisor: 'Supervisor',
    admin: 'Administrador',
  };

  const initials = String(user?.name || 'MP')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

  const handleSelect = (id: MenuId) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f4f7fb]">
      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-slate-950/95 backdrop-blur-md text-white px-3.5 py-2.5 flex items-center justify-between border-b border-slate-800/80 shadow-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-100"
            aria-label="Abrir menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="font-display font-extrabold text-sm tracking-tight text-white truncate">
              {activeStoreContext ? 'Operação na Loja' : PAGE_TITLES[activePage]}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {user?.title ? `${user.title}: ${user.name}` : user?.name} • {user?.city || roleLabels[user?.role || 'promotor']}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200"
            title="Busca rápida"
          >
            <Search className="w-4 h-4" />
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={syncNow}
              className="px-2 py-1.5 rounded-xl bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {pendingCount}
            </button>
          )}
          <span
            className={`p-2 rounded-xl ${
              isOnline ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/20 text-red-300'
            }`}
            title={isOnline ? 'Online' : 'Offline'}
          >
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          </span>
        </div>
      </header>

      {/* Sidebar (Desktop & Mobile Drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-slate-950 text-slate-100 flex flex-col border-r border-slate-800/80 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="px-4 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <button
            type="button"
            onClick={() => handleSelect('dashboard')}
            className="flex items-center gap-2.5 text-left"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/25 shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display font-extrabold text-sm tracking-tight text-white leading-tight">
                MERCHANDISING PRO
              </div>
              <div className="text-[11px] text-blue-400 font-semibold">Trade & Visão IA 2.0</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Profile Pill */}
        <div className="mx-3 mt-3 p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800/90 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-blue-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
              {initials || 'MP'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate">
                {user?.title ? `${user.title}: ${user.name}` : user?.name}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {user?.city || user?.region || roleLabels[user?.role || 'promotor']}
              </div>
            </div>
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isOnline ? 'bg-emerald-400 shadow-xs shadow-emerald-400/70' : 'bg-red-400'
              }`}
              title={isOnline ? 'Conectado' : 'Offline'}
            />
          </div>
          {loginDisabled && (
            <button
              type="button"
              onClick={() => setCertModalOpen(true)}
              className="w-full px-2 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[10px] font-bold text-emerald-300 flex items-center gap-1.5 transition text-left"
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Certificado Digital Ativo • Ver</span>
            </button>
          )}
        </div>

        {/* Grouped Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {MENU_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) => !item.managerOnly || isManager);
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.title} className="space-y-1">
                <div className="px-2.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  {group.title}
                </div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = !activeStoreContext && activePage === item.id;
                  const isAi = item.id === 'ia';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelect(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition ${
                        active
                          ? isAi
                            ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold shadow-md shadow-indigo-600/20'
                            : 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/20'
                          : isAi
                          ? 'text-indigo-200 hover:bg-indigo-950/70 hover:text-white'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white font-medium'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : isAi ? 'text-indigo-400' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-800/80 space-y-2">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={syncNow}
              className="w-full py-2 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sincronizar ({pendingCount} pendente{pendingCount > 1 ? 's' : ''})
            </button>
          )}
          {loginDisabled ? (
            <button
              type="button"
              onClick={() => setCertModalOpen(true)}
              className="w-full py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 hover:text-white text-xs font-bold flex items-center justify-center gap-2 transition border border-emerald-500/30"
            >
              <ShieldCheck className="w-4 h-4" />
              Certificado Digital (Higor)
            </button>
          ) : (
            <button
              type="button"
              onClick={logout}
              className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-red-600/90 text-slate-300 hover:text-white text-xs font-bold flex items-center justify-center gap-2 transition border border-slate-800"
            >
              <LogOut className="w-4 h-4" />
              Sair da Conta
            </button>
          )}
        </div>
      </aside>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Desktop Top Utility Bar */}
        <header className="hidden lg:flex sticky top-0 z-20 h-16 bg-white/85 backdrop-blur-md border-b border-slate-200/80 px-6 items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display font-extrabold text-base text-slate-900 truncate">
              {activeStoreContext ? 'Operação na Loja (Fluxo Guiado)' : PAGE_TITLES[activePage]}
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="w-72 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 text-slate-500 text-xs flex items-center justify-between gap-2 transition"
            >
              <span className="flex items-center gap-2 truncate">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">Buscar loja, produto, gramatura, EAN...</span>
              </span>
              <kbd className="px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-500 shrink-0">
                Ctrl K
              </kbd>
            </button>

            {loginDisabled && (
              <button
                type="button"
                onClick={() => setCertModalOpen(true)}
                className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold inline-flex items-center gap-1.5 transition"
                title="Visualizar Certificado Digital Provisório inserido no site"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Promotor: {certificate?.promotor || 'Higor'} • {certificate?.cidade || 'Cachoeiro de Itapemirim'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSelect('ia')}
              className="px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <Bot className="w-4 h-4" /> Auditoria IA
            </button>

            <div
              className={`px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? 'Online' : 'Offline'}
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 pb-24 lg:pb-10">
          {!isOnline && (
            <div className="bg-amber-400 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              Modo Offline ativo — Suas ações e fotos são salvas no dispositivo (IndexedDB) e sincronizadas ao reconectar.
            </div>
          )}
          {failedCount > 0 && (
            <div className="bg-red-600 text-white px-4 py-2 text-xs font-semibold flex flex-wrap items-center justify-center gap-3">
              <span>{failedCount} registro(s) offline falharam na sincronização por regra de validação.</span>
              <button onClick={retryFailed} className="px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-bold">
                Tentar novamente
              </button>
              <button onClick={clearFailed} className="px-2.5 py-1 rounded-lg bg-slate-900/40 hover:bg-slate-900/60 font-bold">
                Descartar
              </button>
            </div>
          )}
          <div className="max-w-7xl mx-auto p-3.5 sm:p-5 lg:p-6 animate-fade-in-up">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur-md border-t border-slate-200/90 grid grid-cols-5 py-1.5 px-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-[10px] font-semibold text-slate-500 shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
        {[
          { id: 'dashboard' as MenuId, label: 'Início', icon: LayoutDashboard },
          { id: 'lojas' as MenuId, label: 'Lojas', icon: Store },
          { id: 'catalogo' as MenuId, label: 'Catálogo', icon: PackageSearch },
          { id: 'ia' as MenuId, label: 'IA 100%', icon: Bot },
        ].map((b) => {
          const Icon = b.icon;
          const active = !activeStoreContext && activePage === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => handleSelect(b.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition ${
                active ? 'text-blue-600 font-extrabold bg-blue-50/80' : 'hover:text-slate-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{b.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl hover:text-slate-800"
        >
          <Menu className="w-5 h-5" />
          <span>Menu</span>
        </button>
      </nav>

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSelect}
        onOpenStore={(sid) => {
          onOpenStore(sid);
          setMobileOpen(false);
        }}
        isManager={isManager}
      />

      {/* Modal do Certificado Digital Provisório inserido no site */}
      {certModalOpen && certificate && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setCertModalOpen(false)}
        >
          <div
            className="max-w-lg w-full bg-white rounded-3xl overflow-hidden shadow-2xl border-2 border-blue-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-slate-950 to-blue-700 text-white p-5 flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[10px] font-extrabold uppercase tracking-wider mb-2">
                  <ShieldCheck className="w-3.5 h-3.5" /> Certificado Digital Ativo no Site
                </div>
                <h3 className="font-display text-lg font-extrabold">CERTIFICADO DIGITAL PROVISÓRIO</h3>
                <p className="text-xs text-slate-300">Acesso direto liberado • Tela de login desativada</p>
              </div>
              <button
                type="button"
                onClick={() => setCertModalOpen(false)}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 border-l-4 border-l-blue-600">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Promotor</div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">{certificate.promotor}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 border-l-4 border-l-emerald-600">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Cidade</div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">{certificate.cidade}</div>
                </div>
              </div>

              <div className="text-xs space-y-1.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Número de Série:</span>
                  <span className="font-bold text-slate-900">{certificate.serial}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Estado:</span>
                  <span className="font-bold text-slate-900">Espírito Santo ({certificate.uf})</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Status:</span>
                  <span className="font-bold text-emerald-700">{certificate.status}</span>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">
                  Assinatura Digital ({certificate.algoritmo})
                </div>
                <div className="p-3 rounded-xl bg-slate-950 text-sky-400 font-mono text-[11px] break-all">
                  {certificate.assinatura_digital}
                </div>
              </div>

              {certStatusMsg && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-semibold ${
                    certStatusMsg.ok
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {certStatusMsg.text}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={downloadCertificate}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Baixar Certificado (.crt)
                </button>
                <label className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> Verificar arquivo (.crt)
                  <input
                    type="file"
                    accept=".crt,.pem,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const res = await importCertificateFile(f);
                      setCertStatusMsg({ ok: res.valid, text: res.message });
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
