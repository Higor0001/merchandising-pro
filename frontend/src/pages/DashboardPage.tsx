import React, { useEffect, useState } from 'react';
import {
  Store,
  CheckCircle2,
  Clock,
  PackagePlus,
  AlertTriangle,
  ShieldCheck,
  ClipboardList,
  Tag,
  CalendarClock,
  Sparkles,
  Megaphone,
  PieChart,
  Bell,
  Timer,
  MapPin,
  ArrowRight,
  Play,
} from 'lucide-react';
import { apiFetch } from '../services/api';
import type { MenuId } from '../components/Layout';

export const DashboardPage: React.FC<{ onNavigate: (p: MenuId) => void; onOpenStore: (storeId: number) => void }> = ({ onNavigate, onOpenStore }) => {
  const [data, setData] = useState<any>(null);
  const [storeOverview, setStoreOverview] = useState<any>(null);
  const [storeFilter, setStoreFilter] = useState<'todas' | 'rota' | 'andamento' | 'pendentes' | 'ocorrencias' | 'visitadas'>('todas');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiFetch('/dashboard'), apiFetch('/stores/overview')])
      .then(([dash, ov]) => {
        setData(dash);
        setStoreOverview(ov);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-slate-500">Carregando indicadores de execução...</div>;
  if (!data) return null;

  const k = data.kpis;
  const cards = [
    { label: 'Lojas Visitadas', value: k.storesVisited, icon: Store, color: 'text-blue-600 bg-blue-50', nav: 'lojas' as MenuId },
    { label: 'Visitas Realizadas', value: k.visitsDone, icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50', nav: 'visitas' as MenuId },
    { label: 'Visitas Pendentes', value: k.visitsPending, icon: Clock, color: 'text-amber-600 bg-amber-50', nav: 'visitas' as MenuId },
    { label: 'Produtos Abastecidos', value: `${k.productsReplenished} un`, icon: PackagePlus, color: 'text-indigo-600 bg-indigo-50', nav: 'abastecimento' as MenuId },
    { label: 'Rupturas Identificadas', value: k.rupturesIdentified, icon: AlertTriangle, color: 'text-red-600 bg-red-50', nav: 'rupturas' as MenuId },
    { label: 'Rupturas Solucionadas', value: k.rupturesSolved, icon: ShieldCheck, color: 'text-teal-600 bg-teal-50', nav: 'rupturas' as MenuId },
    { label: 'Execução de Checklists', value: `${k.checklistPct}%`, icon: ClipboardList, color: 'text-blue-600 bg-blue-50', nav: 'visitas' as MenuId },
    { label: 'Produtos Sem Preço', value: k.productsWithoutPrice, icon: Tag, color: 'text-orange-600 bg-orange-50', nav: 'precificacao' as MenuId },
    { label: 'Validades Próximas', value: k.nearExpiry, icon: CalendarClock, color: 'text-rose-600 bg-rose-50', nav: 'validades' as MenuId },
    { label: 'Pontos Extras Implantados', value: k.extraPoints, icon: Sparkles, color: 'text-purple-600 bg-purple-50', nav: 'pontos-extras' as MenuId },
    { label: 'Campanhas Executadas', value: k.campaignsExecuted, icon: Megaphone, color: 'text-cyan-600 bg-cyan-50', nav: 'campanhas' as MenuId },
    { label: 'Share of Shelf Médio', value: `${k.shareOfShelf}%`, icon: PieChart, color: 'text-emerald-600 bg-emerald-50', nav: 'planogramas' as MenuId },
    { label: 'Ocorrências Abertas', value: k.openOccurrences, icon: Bell, color: 'text-red-600 bg-red-50', nav: 'ocorrencias' as MenuId },
    { label: 'Tempo Médio / Visita', value: `${k.avgVisitMinutes} min`, icon: Timer, color: 'text-slate-700 bg-slate-100', nav: 'roteiros' as MenuId },
  ];

  const storeList: any[] = storeOverview?.stores || [];
  const filteredStores = storeList.filter((s) => {
    if (storeFilter === 'rota') return s.in_daily_route;
    if (storeFilter === 'andamento') return s.operational_status === 'Em Andamento';
    if (storeFilter === 'pendentes') return s.operational_status === 'Pendente';
    if (storeFilter === 'ocorrencias') return s.open_occurrences_count > 0;
    if (storeFilter === 'visitadas') return s.visited_today || s.operational_status === 'Visitada';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Seção Principal Store-Centric */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">Central de Lojas ({storeOverview?.today_day_name || 'Hoje'})</h1>
            <p className="text-sm text-slate-500">Selecione uma loja para iniciar check-in, diagnóstico, execução e histórico evolutivo</p>
          </div>
          <button
            onClick={() => onNavigate('lojas')}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition self-start sm:self-auto"
          >
            + Gerenciar / Cadastrar Lojas
          </button>
        </div>

        {/* Filtros Store-Centric */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'todas', label: `Todas (${storeList.length})` },
            { id: 'rota', label: `Rota Diária (${storeList.filter((s) => s.in_daily_route).length})` },
            { id: 'andamento', label: `Em Andamento (${storeList.filter((s) => s.operational_status === 'Em Andamento').length})` },
            { id: 'pendentes', label: `Pendentes (${storeList.filter((s) => s.operational_status === 'Pendente').length})` },
            { id: 'ocorrencias', label: `Com Ocorrências (${storeList.filter((s) => s.open_occurrences_count > 0).length})` },
            { id: 'visitadas', label: `Visitadas (${storeList.filter((s) => s.visited_today || s.operational_status === 'Visitada').length})` },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStoreFilter(f.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                storeFilter === f.id ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Cards de Lojas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredStores.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenStore(s.id)}
              className="text-left p-4 rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md bg-slate-50/40 hover:bg-white transition flex flex-col justify-between gap-3 group"
            >
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-extrabold text-sm text-slate-900 group-hover:text-blue-700 line-clamp-2">{s.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                      s.operational_status === 'Em Andamento'
                        ? 'bg-blue-100 text-blue-700'
                        : s.operational_status === 'Com Ocorrências'
                        ? 'bg-red-100 text-red-700'
                        : s.operational_status === 'Pendente'
                        ? 'bg-amber-100 text-amber-700'
                        : s.operational_status === 'Visitada'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {s.operational_status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{s.address}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 text-xs">
                <div className="text-slate-600">
                  {s.open_occurrences_count > 0 ? (
                    <span className="text-red-600 font-bold">{s.open_occurrences_count} ocorrência(s)</span>
                  ) : (
                    <span>Visitas: <b>{s.total_visits_done}</b></span>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 font-bold text-blue-600">
                  {s.active_visit ? <><Play className="w-3.5 h-3.5" /> Continuar Visita</> : <>Abrir Loja <ArrowRight className="w-3.5 h-3.5" /></>}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Indicadores Executivos */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">Indicadores de Merchandising</h2>
          <p className="text-xs text-slate-500">Visão consolidada em tempo real dos pontos de venda</p>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              onClick={() => onNavigate(c.nav)}
              className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md hover:border-blue-300 text-left transition group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`p-2 rounded-xl ${c.color}`}>
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-extrabold text-slate-900 group-hover:text-blue-700">{c.value}</div>
              <div className="text-xs font-medium text-slate-500 mt-0.5">{c.label}</div>
            </button>
          );
        })}
      </div>

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Visitas Recentes & Programadas</h2>
            <button onClick={() => onNavigate('visitas')} className="text-xs font-semibold text-blue-600 hover:underline">
              Ver todas
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.recentVisits.map((v: any) => (
              <div key={v.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-semibold text-slate-800">{v.store_name}</div>
                  <div className="text-xs text-slate-500">{v.scheduled_date} {v.scheduled_time} • {v.promoter_name}</div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    v.status === 'Concluída'
                      ? 'bg-emerald-100 text-emerald-700'
                      : v.status === 'Em Andamento'
                      ? 'bg-blue-100 text-blue-700'
                      : v.status === 'Não Atendida'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Ocorrências & Rupturas Prioritárias</h2>
            <button onClick={() => onNavigate('ocorrencias')} className="text-xs font-semibold text-blue-600 hover:underline">
              Gerenciar
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.criticalOccurrences.map((o: any) => (
              <div key={o.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="font-semibold text-slate-800">{o.type} — {o.store_name}</div>
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
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
