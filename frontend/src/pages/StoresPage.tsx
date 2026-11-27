import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Store, Plus, History, Bot, X, ArrowRight, Search, MapPin, Phone, FileText, FileSpreadsheet } from 'lucide-react';
import { apiFetch, readCachedApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export const StoresPage: React.FC<{ onOpenStore?: (storeId: number) => void }> = ({ onOpenStore }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = user?.role === 'admin' || user?.role === 'supervisor';
  const [stores, setStores] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [freqFilter, setFreqFilter] = useState('Todas');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'Supermercado',
    banner: '',
    network: '',
    address: '',
    city: 'Vitória',
    region: 'Centro',
    route_name: 'Rota Padrão',
    visit_frequency: 'Semanal',
    contact_name: '',
    contact_phone: '',
  });
  const [historyData, setHistoryData] = useState<any>(null);
  const [aiSummary, setAiSummary] = useState<any>(null);
  const [downloadingVisitId, setDownloadingVisitId] = useState<number | null>(null);

  const handleDownloadVisit = async (visitId: number, format: 'pdf' | 'excel') => {
    setDownloadingVisitId(visitId);
    try {
      const [report, exporter] = await Promise.all([
        apiFetch<any>(`/visits/${visitId}/report${format === 'pdf' ? '?include_images=1' : ''}`),
        import('../services/exportUtils'),
      ]);
      if (format === 'pdf') {
        await exporter.exportVisitHistoryPDF(report);
        toast('ok', `Histórico da Visita #${visitId} baixado em PDF!`);
      } else {
        exporter.exportVisitHistoryExcel(report);
        toast('ok', `Histórico da Visita #${visitId} baixado em Excel!`);
      }
    } catch (err: any) {
      toast('err', err.message || 'Erro ao baixar histórico da visita.');
    } finally {
      setDownloadingVisitId(null);
    }
  };

  const load = useCallback(async () => {
    const cached = await readCachedApi<any[]>('/stores');
    if (Array.isArray(cached) && cached.length > 0) {
      setStores(cached);
    }
    try {
      const list = await apiFetch<any[]>('/stores');
      setStores(Array.isArray(list) ? list : []);
    } catch (err: any) {
      if (!cached) toast('err', err.message || 'Erro ao carregar lojas.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredStores = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((s) => {
      if (freqFilter !== 'Todas' && s.visit_frequency !== freqFilter) return false;
      if (!q) return true;
      return (
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.address || '').toLowerCase().includes(q) ||
        String(s.banner || '').toLowerCase().includes(q) ||
        String(s.city || '').toLowerCase().includes(q) ||
        String(s.route_name || '').toLowerCase().includes(q)
      );
    });
  }, [stores, query, freqFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/stores', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false);
      setForm({
        name: '',
        type: 'Supermercado',
        banner: '',
        network: '',
        address: '',
        city: 'Vitória',
        region: 'Centro',
        route_name: 'Rota Padrão',
        visit_frequency: 'Semanal',
        contact_name: '',
        contact_phone: '',
      });
      toast('ok', 'Loja cadastrada com sucesso!');
      load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao cadastrar loja.');
    }
  };

  const openHistory = async (storeId: number) => {
    try {
      const [h, ai] = await Promise.all([
        apiFetch(`/stores/${storeId}/history`),
        apiFetch(`/ai/store-summary/${storeId}`),
      ]);
      setHistoryData(h);
      setAiSummary(ai);
    } catch (err: any) {
      toast('err', err.message || 'Erro ao carregar histórico da loja.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-extrabold text-slate-900">
              Lojas & Pontos de Venda ({stores.length})
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Supermercados, atacarejos, bandeiras, rotas, contatos e histórico evolutivo individual.
            </p>
          </div>
          {isManager && (
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl inline-flex items-center gap-1.5 shadow-sm transition"
            >
              <Plus className="w-4 h-4" /> Cadastrar PDV
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome da loja, cidade, endereço, bandeira ou rota..."
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 focus:bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {['Todas', 'Diária', 'Semanal', 'Quinzenal', 'Mensal'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFreqFilter(f)}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                  freqFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white p-5 rounded-3xl border border-blue-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <input required placeholder="Nome da Loja" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white">
            {['Supermercado', 'Atacarejo', 'Distribuidor', 'Rede Varejista'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input placeholder="Bandeira" value={form.banner} onChange={(e) => setForm({ ...form, banner: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <input placeholder="Rede" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <input required placeholder="Endereço completo" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm sm:col-span-2" />
          <input placeholder="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <input placeholder="Região" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <select value={form.visit_frequency} onChange={(e) => setForm({ ...form, visit_frequency: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white">
            {['Diária', 'Semanal', 'Quinzenal', 'Mensal'].map((f) => <option key={f}>{f}</option>)}
          </select>
          <input placeholder="Contato / Gerente" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <input placeholder="Telefone do Contato" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <div className="flex justify-end items-center gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl">
              Cancelar
            </button>
            <button type="submit" className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-xl">
              Salvar Loja
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStores.map((s) => (
          <div
            key={s.id}
            className="bg-white p-5 rounded-3xl border border-slate-200/80 hover:border-blue-300 hover:shadow-md transition flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="p-2.5 rounded-2xl bg-blue-50 text-blue-600 shrink-0">
                    <Store className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-extrabold text-sm text-slate-900 truncate">{s.name}</div>
                    <div className="text-xs text-slate-500 truncate">{s.type} • {s.banner || s.network || 'Independente'}</div>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-extrabold shrink-0">
                  {s.visit_frequency}
                </span>
              </div>
              <div className="text-xs text-slate-600 space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>{s.address} {s.city ? `— ${s.city}` : ''}</span>
                </div>
                <div className="text-slate-500">
                  <b>Região / Rota:</b> {s.region} • {s.route_name}
                </div>
                {(s.contact_name || s.contact_phone) && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{s.contact_name || '-'} {s.contact_phone ? `(${s.contact_phone})` : ''}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              {onOpenStore && (
                <button
                  type="button"
                  onClick={() => onOpenStore(s.id)}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition"
                >
                  Abrir Operação <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => openHistory(s.id)}
                className="flex-1 py-2.5 bg-slate-50 hover:bg-indigo-50 text-indigo-700 text-xs font-bold rounded-xl border border-slate-200 flex items-center justify-center gap-1.5 transition"
              >
                <History className="w-4 h-4" /> Resumo IA
              </button>
            </div>
          </div>
        ))}
      </div>

      {historyData && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setHistoryData(null)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4 shadow-2xl animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h2 className="font-display font-extrabold text-lg text-slate-900">
                  Histórico — {historyData.store.name}
                </h2>
                <p className="text-xs text-slate-500">{historyData.store.address}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryData(null)}
                className="p-2 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {aiSummary && (
              <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-1.5">
                <div className="flex items-center gap-2 text-indigo-800 font-extrabold text-sm">
                  <Bot className="w-4 h-4" /> Resumo Inteligente da Loja
                </div>
                <p className="text-xs text-indigo-900 leading-relaxed">{aiSummary.summary}</p>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="font-bold text-sm text-slate-800">Últimas Visitas ({historyData.visits.length})</h3>
              {historyData.visits.map((v: any) => (
                <div key={v.id} className="p-3 rounded-xl bg-slate-50 text-xs flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b>#{v.id} • {v.scheduled_date}</b> — {v.promoter_name} ({v.status}) • {v.duration_minutes || 0} min
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={downloadingVisitId === v.id}
                      onClick={() => void handleDownloadVisit(v.id, 'pdf')}
                      className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <FileText className="w-3 h-3" /> {downloadingVisitId === v.id ? '...' : 'PDF'}
                    </button>
                    <button
                      type="button"
                      disabled={downloadingVisitId === v.id}
                      onClick={() => void handleDownloadVisit(v.id, 'excel')}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <FileSpreadsheet className="w-3 h-3" /> Excel
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="font-bold text-sm text-slate-800">Ocorrências ({historyData.occurrences.length})</h3>
              {historyData.occurrences.map((o: any) => (
                <div key={o.id} className="p-3 rounded-xl bg-red-50/60 text-xs flex justify-between">
                  <span><b>{o.type}:</b> {o.description}</span>
                  <span className="font-bold">{o.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
