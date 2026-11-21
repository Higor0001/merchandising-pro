import React, { useEffect, useState } from 'react';
import { Store, Plus, History, Bot, X } from 'lucide-react';
import { apiFetch } from '../services/api';

export const StoresPage: React.FC = () => {
  const [stores, setStores] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'Supermercado',
    banner: '',
    network: '',
    address: '',
    city: 'São Paulo',
    region: 'Zona Sul',
    route_name: 'Rota Sul 01',
    visit_frequency: 'Semanal',
    contact_name: '',
    contact_phone: '',
  });
  const [historyData, setHistoryData] = useState<any>(null);
  const [aiSummary, setAiSummary] = useState<any>(null);

  const load = () => apiFetch('/stores').then(setStores);
  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/stores', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false);
    setForm({ name: '', type: 'Supermercado', banner: '', network: '', address: '', city: 'São Paulo', region: 'Zona Sul', route_name: 'Rota Sul 01', visit_frequency: 'Semanal', contact_name: '', contact_phone: '' });
    load();
  };

  const openHistory = async (storeId: number) => {
    const [h, ai] = await Promise.all([
      apiFetch(`/stores/${storeId}/history`),
      apiFetch(`/ai/store-summary/${storeId}`),
    ]);
    setHistoryData(h);
    setAiSummary(ai);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Lojas & Pontos de Venda (PDV)</h1>
          <p className="text-sm text-slate-500">Supermercados, atacarejos, bandeiras, rotas, contatos e histórico individual</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Cadastrar PDV
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input required placeholder="Nome da Loja" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {['Supermercado', 'Atacarejo', 'Distribuidor', 'Rede Varejista'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input placeholder="Bandeira" value={form.banner} onChange={(e) => setForm({ ...form, banner: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input placeholder="Rede" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input required placeholder="Endereço completo" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="px-3 py-2 border rounded-xl text-sm sm:col-span-2" />
          <input placeholder="Região" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <select value={form.visit_frequency} onChange={(e) => setForm({ ...form, visit_frequency: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {['Diária', 'Semanal', 'Quinzenal', 'Mensal'].map((f) => <option key={f}>{f}</option>)}
          </select>
          <input placeholder="Contato / Gerente" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input placeholder="Telefone do Contato" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" className="px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl">Salvar Loja</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.map((s) => (
          <div key={s.id} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="p-2.5 rounded-xl bg-blue-50 text-blue-600"><Store className="w-5 h-5" /></span>
                <div>
                  <div className="font-bold text-slate-900">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.type} • {s.banner || s.network}</div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold">{s.visit_frequency}</span>
            </div>
            <div className="text-xs text-slate-600 space-y-1">
              <div><b>Endereço:</b> {s.address} {s.city ? `- ${s.city}` : ''}</div>
              <div><b>Região / Rota:</b> {s.region} • {s.route_name}</div>
              <div><b>Contato:</b> {s.contact_name || '-'} ({s.contact_phone || '-'})</div>
            </div>
            <button
              onClick={() => openHistory(s.id)}
              className="w-full py-2 bg-slate-50 hover:bg-blue-50 text-blue-700 text-xs font-bold rounded-xl border border-slate-200 flex items-center justify-center gap-1.5"
            >
              <History className="w-4 h-4" /> Ver Histórico & Resumo IA
            </button>
          </div>
        ))}
      </div>

      {historyData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h2 className="font-bold text-lg text-slate-900">Histórico — {historyData.store.name}</h2>
                <p className="text-xs text-slate-500">{historyData.store.address}</p>
              </div>
              <button onClick={() => setHistoryData(null)} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            {aiSummary && (
              <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-1.5">
                <div className="flex items-center gap-2 text-indigo-800 font-bold text-sm">
                  <Bot className="w-4 h-4" /> Resumo Inteligente da Loja
                </div>
                <p className="text-xs text-indigo-900">{aiSummary.summary}</p>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="font-bold text-sm text-slate-800">Últimas Visitas ({historyData.visits.length})</h3>
              {historyData.visits.map((v: any) => (
                <div key={v.id} className="p-3 rounded-xl bg-slate-50 text-xs flex justify-between">
                  <span><b>{v.scheduled_date}</b> — {v.promoter_name} ({v.status})</span>
                  <span className="text-slate-500">{v.duration_minutes || 0} min</span>
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
