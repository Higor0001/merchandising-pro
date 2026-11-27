import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Store,
  CheckCircle2,
  PackagePlus,
  AlertTriangle,
  Tag,
  CalendarClock,
  Sparkles,
  Megaphone,
  PieChart,
  Timer,
  MapPin,
  ArrowRight,
  Play,
  Search,
  Bot,
  PackageSearch,
  Bell,
  FileText,
} from 'lucide-react';
import { apiFetch, readCachedApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { MenuId } from '../components/Layout';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export const DashboardPage: React.FC<{
  onNavigate: (p: MenuId) => void;
  onOpenStore: (storeId: number) => void;
}> = ({ onNavigate, onOpenStore }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [downloadingVisitId, setDownloadingVisitId] = useState<number | null>(null);

  const handleDownloadVisitPdf = async (visitId: number) => {
    setDownloadingVisitId(visitId);
    try {
      const [report, exporter] = await Promise.all([
        apiFetch<any>(`/visits/${visitId}/report?include_images=1`),
        import('../services/exportUtils'),
      ]);
      await exporter.exportVisitHistoryPDF(report);
      toast('ok', `PDF da Visita #${visitId} baixado!`);
    } catch (err: any) {
      toast('err', err.message || 'Erro ao gerar PDF da visita.');
    } finally {
      setDownloadingVisitId(null);
    }
  };
  const [storeOverview, setStoreOverview] = useState<any>(null);
  const [storeFilter, setStoreFilter] = useState<
    'todas' | 'rota' | 'andamento' | 'pendentes' | 'ocorrencias' | 'visitadas'
  >('todas');
  const [storeSearch, setStoreSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    // Stale-While-Revalidate: exibe snapshot em cache instantaneamente (<10ms) enquanto atualiza em segundo plano
    const [cachedDash, cachedOv] = await Promise.all([
      readCachedApi('/dashboard'),
      readCachedApi('/stores/overview'),
    ]);
    if (cachedDash && cachedOv) {
      setData(cachedDash);
      setStoreOverview(cachedOv);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const [dash, ov] = await Promise.all([apiFetch('/dashboard'), apiFetch('/stores/overview')]);
      setData(dash);
      setStoreOverview(ov);
    } catch (err: any) {
      if (!cachedDash) {
        setError(err.message || 'Erro ao carregar indicadores do painel.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const storeList: any[] = useMemo(() => storeOverview?.stores || [], [storeOverview]);

  const activeStoreInProgress = useMemo(
    () => storeList.find((s) => s.operational_status === 'Em Andamento') || null,
    [storeList]
  );

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    return storeList.filter((s) => {
      if (storeFilter === 'rota' && !s.in_daily_route) return false;
      if (storeFilter === 'andamento' && s.operational_status !== 'Em Andamento') return false;
      if (storeFilter === 'pendentes' && s.operational_status !== 'Pendente') return false;
      if (storeFilter === 'ocorrencias' && !(s.open_occurrences_count > 0)) return false;
      if (storeFilter === 'visitadas' && !(s.visited_today || s.operational_status === 'Visitada')) return false;
      if (!q) return true;
      return (
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.address || '').toLowerCase().includes(q) ||
        String(s.banner || '').toLowerCase().includes(q) ||
        String(s.city || '').toLowerCase().includes(q)
      );
    });
  }, [storeList, storeFilter, storeSearch]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-36 rounded-3xl bg-white border border-slate-200/80" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-white border border-slate-200/80" />
          ))}
        </div>
        <div className="h-64 rounded-3xl bg-white border border-slate-200/80" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 bg-white rounded-3xl border border-red-200 text-center space-y-3">
        <div className="text-sm font-bold text-red-700">{error || 'Não foi possível carregar o painel.'}</div>
        <button onClick={load} className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl">
          Tentar novamente
        </button>
      </div>
    );
  }

  const k = data.kpis;
  const visitedTodayCount = storeList.filter((s) => s.visited_today || s.operational_status === 'Visitada').length;
  const routeTotalCount = Math.max(1, storeList.filter((s) => s.in_daily_route).length || storeList.length);
  const progressPct = Math.min(100, Math.round((visitedTodayCount / routeTotalCount) * 100));
  const firstName = String(user?.name || 'Promotor').split(' ')[0];

  return (
    <div className="space-y-5">
      {/* Executive & Field Hero */}
      <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 text-white rounded-3xl p-5 sm:p-6 shadow-lg space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-blue-300">
              <span>{storeOverview?.today_day_name || 'Hoje'}</span>
              <span>•</span>
              <span>{storeOverview?.today || ''}</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
              {getGreeting()}, {firstName}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              {activeStoreInProgress
                ? `Você tem uma visita em andamento em ${activeStoreInProgress.name}.`
                : 'Selecione uma loja abaixo para iniciar o check-in e registrar fotos HD em tempo real.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {activeStoreInProgress && (
              <button
                type="button"
                onClick={() => onOpenStore(activeStoreInProgress.id)}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md transition"
              >
                <Play className="w-4 h-4" /> Retomar {activeStoreInProgress.name}
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('ia')}
              className="px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md transition"
            >
              <Bot className="w-4 h-4" /> Auditoria IA 100%
            </button>
            <button
              type="button"
              onClick={() => onNavigate('catalogo')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <PackageSearch className="w-4 h-4" /> Catálogo PepsiCo
            </button>
          </div>
        </div>

        {/* Daily Progress Bar */}
        <div className="p-3.5 rounded-2xl bg-white/8 border border-white/10 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">Progresso das lojas visitadas</span>
            <span className="font-extrabold text-white tabular-nums">
              {visitedTodayCount} / {routeTotalCount} ({progressPct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* 4 Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'Visitas Concluídas',
            value: k.visitsDone,
            sub: `${k.visitsPending} pendente(s) • ${k.storesVisited} lojas`,
            icon: CheckCircle2,
            accent: 'text-emerald-600 bg-emerald-50',
            nav: 'visitas' as MenuId,
          },
          {
            label: 'Abastecimento Total',
            value: `${k.productsReplenished} un`,
            sub: `Checklist médio: ${k.checklistPct}%`,
            icon: PackagePlus,
            accent: 'text-blue-600 bg-blue-50',
            nav: 'abastecimento' as MenuId,
          },
          {
            label: 'Rupturas & Alertas',
            value: k.openOccurrences,
            sub: `${k.rupturesSolved}/${k.rupturesIdentified} rupturas resolvidas`,
            icon: AlertTriangle,
            accent: k.openOccurrences > 0 ? 'text-red-600 bg-red-50' : 'text-teal-600 bg-teal-50',
            nav: 'rupturas' as MenuId,
          },
          {
            label: 'Share of Shelf Médio',
            value: `${k.shareOfShelf}%`,
            sub: `Tempo médio: ${k.avgVisitMinutes} min/visita`,
            icon: PieChart,
            accent: 'text-indigo-600 bg-indigo-50',
            nav: 'planogramas' as MenuId,
          },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => onNavigate(c.nav)}
              className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md hover:border-blue-300 text-left transition group space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className={`p-2 rounded-xl ${c.accent}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-600 transition" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums group-hover:text-blue-700">
                  {c.value}
                </div>
                <div className="text-xs font-bold text-slate-700">{c.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">{c.sub}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Secondary Operational Pill Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {[
          { label: 'Sem Etiqueta', value: k.productsWithoutPrice, icon: Tag, color: 'text-orange-600', nav: 'precificacao' as MenuId },
          { label: 'Validades Próx.', value: k.nearExpiry, icon: CalendarClock, color: 'text-rose-600', nav: 'validades' as MenuId },
          { label: 'Pontos Extras', value: k.extraPoints, icon: Sparkles, color: 'text-purple-600', nav: 'pontos-extras' as MenuId },
          { label: 'Campanhas', value: k.campaignsExecuted, icon: Megaphone, color: 'text-cyan-600', nav: 'campanhas' as MenuId },
          { label: 'Tempo/Visita', value: `${k.avgVisitMinutes}m`, icon: Timer, color: 'text-slate-600', nav: 'roteiros' as MenuId },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.nav)}
              className="bg-white px-3.5 py-2.5 rounded-2xl border border-slate-200/80 hover:border-blue-300 flex items-center justify-between gap-2 text-left transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${item.color}`} />
                <span className="text-xs font-semibold text-slate-600 truncate">{item.label}</span>
              </div>
              <span className="text-sm font-extrabold text-slate-900 tabular-nums">{item.value}</span>
            </button>
          );
        })}
      </div>

      {/* Store-Centric Command Center */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <Store className="w-5 h-5 text-blue-600" />
              Central de Lojas & PDVs
            </h2>
            <p className="text-xs text-slate-500">
              Toque em qualquer loja para iniciar check-in, fotos automáticas em HD, diagnóstico e check-out.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
                placeholder="Filtrar loja, endereço..."
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={() => onNavigate('lojas')}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shrink-0"
            >
              + Lojas
            </button>
          </div>
        </div>

        {/* Store Filters */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'todas', label: `Todas (${storeList.length})` },
            { id: 'rota', label: `Rota Diária (${storeList.filter((s) => s.in_daily_route).length})` },
            { id: 'andamento', label: `Em Andamento (${storeList.filter((s) => s.operational_status === 'Em Andamento').length})` },
            { id: 'pendentes', label: `Pendentes (${storeList.filter((s) => s.operational_status === 'Pendente').length})` },
            { id: 'ocorrencias', label: `Com Ocorrências (${storeList.filter((s) => s.open_occurrences_count > 0).length})` },
            { id: 'visitadas', label: `Visitadas (${visitedTodayCount})` },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStoreFilter(f.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                storeFilter === f.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Store Cards */}
        {filteredStores.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Nenhuma loja corresponde ao filtro selecionado.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredStores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenStore(s.id)}
                className="text-left p-4 rounded-2xl border border-slate-200/90 hover:border-blue-400 hover:shadow-md bg-slate-50/50 hover:bg-white transition flex flex-col justify-between gap-3 group"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-extrabold text-sm text-slate-900 group-hover:text-blue-700 line-clamp-2">
                      {s.name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                        s.operational_status === 'Em Andamento'
                          ? 'bg-blue-100 text-blue-700'
                          : s.operational_status === 'Com Ocorrências'
                          ? 'bg-red-100 text-red-700'
                          : s.operational_status === 'Pendente'
                          ? 'bg-amber-100 text-amber-800'
                          : s.operational_status === 'Visitada'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {s.operational_status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{s.address}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/70 text-xs">
                  <div className="text-slate-600">
                    {s.open_occurrences_count > 0 ? (
                      <span className="text-red-600 font-bold inline-flex items-center gap-1">
                        <Bell className="w-3.5 h-3.5" /> {s.open_occurrences_count} pendência(s)
                      </span>
                    ) : (
                      <span>
                        Visitas concluídas: <b className="tabular-nums">{s.total_visits_done}</b>
                      </span>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 font-extrabold text-blue-600 group-hover:translate-x-0.5 transition">
                    {s.active_visit ? (
                      <>
                        <Play className="w-3.5 h-3.5" /> Continuar
                      </>
                    ) : (
                      <>
                        Abrir <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-extrabold text-sm text-slate-900">Visitas Recentes & Programadas</h2>
            <button
              type="button"
              onClick={() => onNavigate('visitas')}
              className="text-xs font-bold text-blue-600 hover:underline"
            >
              Ver todas
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.recentVisits.map((v: any) => (
              <div key={v.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="font-bold text-slate-800 truncate">{v.store_name}</div>
                  <div className="text-xs text-slate-500">
                    {v.scheduled_date} {v.scheduled_time} • {v.promoter_name}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={downloadingVisitId === v.id}
                    onClick={() => void handleDownloadVisitPdf(v.id)}
                    title="Baixar histórico desta visita em PDF"
                    className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <FileText className="w-3 h-3" /> {downloadingVisitId === v.id ? '...' : 'PDF'}
                  </button>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      v.status === 'Concluída'
                        ? 'bg-emerald-100 text-emerald-700'
                        : v.status === 'Em Andamento'
                        ? 'bg-blue-100 text-blue-700'
                        : v.status === 'Não Atendida' || v.status === 'Cancelada'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {v.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200/80 p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-extrabold text-sm text-slate-900">Ocorrências & Rupturas Prioritárias</h2>
            <button
              type="button"
              onClick={() => onNavigate('ocorrencias')}
              className="text-xs font-bold text-blue-600 hover:underline"
            >
              Gerenciar
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.criticalOccurrences.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                Nenhuma ocorrência crítica em aberto no momento.
              </div>
            ) : (
              data.criticalOccurrences.map((o: any) => (
                <div key={o.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 truncate">
                      {o.type} — {o.store_name}
                    </div>
                    <div className="text-xs text-slate-500 line-clamp-1">{o.description}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                      o.priority === 'Alta'
                        ? 'bg-red-100 text-red-700'
                        : o.priority === 'Média'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {o.priority}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
