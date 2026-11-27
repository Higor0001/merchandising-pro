import React, { useEffect, useState } from 'react';
import { Megaphone, AlertTriangle, Plus, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PhotoInput } from '../components/PhotoInput';
import { ProductSelectorWithSi5 } from '../components/ProductSelectorWithSi5';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

const OCCURRENCE_TYPES = [
  'Ruptura',
  'Baixo Estoque',
  'Sem Exposição',
  'Espaço Vazio',
  'Mal Posicionado',
  'Falta Material',
  'Concorrente Espaço Estratégico',
  'Falta de Preço',
  'Baixa Visibilidade',
];

export const CampaignsAndOccurrencesPage: React.FC<{ mode: 'campanhas' | 'rupturas' | 'ocorrencias' }> = ({ mode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = user?.role === 'admin' || user?.role === 'supervisor';
  const [campaigns, setCampaigns] = useState<{ campaigns: any[]; executions: any[] }>({ campaigns: [], executions: [] });
  const [occurrences, setOccurrences] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);

  const [showNewCamp, setShowNewCamp] = useState(false);
  const [campForm, setCampForm] = useState({
    title: '',
    description: '',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    materials_needed: 'Ilha promocional, Cartaz A3',
  });

  const [execForm, setExecForm] = useState({ campaign_id: '', store_id: '', notes: '', compliant: true });

  const [occForm, setOccForm] = useState({
    store_id: '',
    product_id: '',
    type: mode === 'rupturas' ? 'Ruptura' : 'Espaço Vazio',
    priority: 'Alta',
    description: '',
  });

  const load = async () => {
    const [c, o, s, p] = await Promise.all([
      apiFetch('/campaigns'),
      apiFetch(mode === 'rupturas' ? '/occurrences?type=Ruptura' : '/occurrences'),
      apiFetch('/stores'),
      loadProductsWithDeviceCache(false),
    ]);
    setCampaigns(c);
    setOccurrences(o);
    setStores(s);
    setProducts(p);
    if (s.length) {
      setOccForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
      setExecForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
    }
    if (c.campaigns.length) {
      setExecForm((f) => ({ ...f, campaign_id: f.campaign_id || String(c.campaigns[0].id) }));
    }
  };

  useEffect(() => {
    setOccForm((f) => ({ ...f, type: mode === 'rupturas' ? 'Ruptura' : 'Espaço Vazio' }));
    load();
  }, [mode]);

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/campaigns', { method: 'POST', body: JSON.stringify(campForm) });
      setShowNewCamp(false);
      setCampForm({ ...campForm, title: '', description: '' });
      toast('ok', 'Campanha criada com sucesso!');
      void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao criar campanha.');
    }
  };

  const executeCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execForm.campaign_id) return;
    try {
      const fd = new FormData();
      fd.append('store_id', execForm.store_id);
      fd.append('compliant', String(execForm.compliant));
      fd.append('notes', execForm.notes);
      if (photo) fd.append('photo', photo);
      const res = await apiFetch<any>(`/campaigns/${execForm.campaign_id}/execute`, { method: 'POST', body: fd });
      setPhoto(null);
      setExecForm((f) => ({ ...f, notes: '' }));
      toast('ok', res?.offlineQueued ? 'Comprovação salva na fila offline!' : 'Comprovação de campanha registrada!');
      if (!res?.offlineQueued) void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar comprovação.');
    }
  };

  const createOccurrence = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(occForm).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) fd.append(k, String(v));
      });
      if (photo) fd.append('photo', photo);
      const res = await apiFetch<any>('/occurrences', { method: 'POST', body: fd });
      setPhoto(null);
      setOccForm((f) => ({ ...f, product_id: '', description: '' }));
      toast('ok', res?.offlineQueued ? 'Ocorrência salva na fila offline!' : 'Ocorrência registrada com sucesso!');
      if (!res?.offlineQueued) void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar ocorrência.');
    }
  };

  const updateStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/occurrences/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast('ok', `Status atualizado para ${status}.`);
      void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao atualizar status.');
    }
  };

  if (mode === 'campanhas') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Execução de Campanhas e Promoções</h1>
            <p className="text-sm text-slate-500">Campanhas comerciais, materiais, comprovação fotográfica e cumprimento por loja</p>
          </div>
          {isManager && (
            <button onClick={() => setShowNewCamp(!showNewCamp)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Nova Campanha
            </button>
          )}
        </div>

        {showNewCamp && (
          <form onSubmit={createCampaign} className="bg-white p-5 rounded-2xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input required placeholder="Título da Campanha" value={campForm.title} onChange={(e) => setCampForm({ ...campForm, title: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <input placeholder="Materiais necessários" value={campForm.materials_needed} onChange={(e) => setCampForm({ ...campForm, materials_needed: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <input type="date" value={campForm.start_date} onChange={(e) => setCampForm({ ...campForm, start_date: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <input type="date" value={campForm.end_date} onChange={(e) => setCampForm({ ...campForm, end_date: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <textarea placeholder="Descrição..." value={campForm.description} onChange={(e) => setCampForm({ ...campForm, description: e.target.value })} className="sm:col-span-2 px-3 py-2 border rounded-xl text-sm" rows={2} />
            <button type="submit" className="sm:col-span-2 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl">Criar Campanha</button>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.campaigns.map((c) => (
            <div key={c.id} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-2">
              <div className="flex justify-between items-start">
                <div className="font-bold text-slate-900 flex items-center gap-2"><Megaphone className="w-4 h-4 text-blue-600" /> {c.title}</div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">{c.status}</span>
              </div>
              <p className="text-xs text-slate-600">{c.description}</p>
              <div className="text-xs text-slate-500"><b>Período:</b> {c.start_date} até {c.end_date}</div>
              <div className="text-xs text-slate-500"><b>Materiais:</b> {c.materials_needed}</div>
            </div>
          ))}
        </div>

        <form onSubmit={executeCampaign} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800">Registrar Comprovação de Campanha na Loja</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={execForm.campaign_id} onChange={(e) => setExecForm({ ...execForm, campaign_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {campaigns.campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <select value={execForm.store_id} onChange={(e) => setExecForm({ ...execForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input placeholder="Observações de implantação..." value={execForm.notes} onChange={(e) => setExecForm({ ...execForm, notes: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          </div>
          <PhotoInput label="Foto de Comprovação da Campanha" file={photo} onFileSelect={setPhoto} />
          <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">Confirmar Implantação</button>
        </form>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-2">
          <div className="font-bold text-sm text-slate-800">Lojas que Cumpriram a Campanha</div>
          {campaigns.executions.map((ex) => (
            <div key={ex.id} className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs">
              <div><b>{ex.campaign_title}</b> — {ex.store_name} ({ex.promoter_name})</div>
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold">Cumprida</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">
          {mode === 'rupturas' ? 'Gestão de Rupturas' : 'Ocorrências & Oportunidades Comerciais'}
        </h1>
        <p className="text-sm text-slate-500">Registro com prioridade, foto, loja, data e status de resolução</p>
      </div>

      <form onSubmit={createOccurrence} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600" /> Registrar Nova Ocorrência / Oportunidade
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={occForm.store_id} onChange={(e) => setOccForm({ ...occForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={occForm.type} onChange={(e) => setOccForm({ ...occForm, type: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {OCCURRENCE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={occForm.priority} onChange={(e) => setOccForm({ ...occForm, priority: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {['Alta', 'Média', 'Baixa'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <ProductSelectorWithSi5
          products={products}
          value={occForm.product_id}
          onChange={(pid) => setOccForm({ ...occForm, product_id: pid })}
          onCatalogUpdated={setProducts}
          allowEmpty
          emptyLabel={mode === 'rupturas' ? 'Selecione o produto em ruptura (ou pesquise/leia EAN)' : 'Produto relacionado (Opcional)'}
        />
        <textarea required placeholder="Descreva o problema ou oportunidade identificada no PDV..." value={occForm.description} onChange={(e) => setOccForm({ ...occForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" rows={2} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PhotoInput label="Foto da Ocorrência" file={photo} onFileSelect={setPhoto} />
          <button type="submit" className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Registrar Ocorrência</button>
        </div>
      </form>

      <div className="space-y-3">
        {occurrences.map((o) => (
          <div key={o.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  o.priority === 'Alta' ? 'bg-red-100 text-red-700' : o.priority === 'Média' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                }`}>{o.priority}</span>
                <span className="font-bold text-slate-900 text-sm">{o.type} — {o.store_name}</span>
                {o.product_name && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-bold">
                    Item: {o.product_name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">{o.description}</p>
              <div className="text-[11px] text-slate-400">{o.created_at} • Status: <b>{o.status}</b></div>
              {o.photo_url && <img src={o.photo_url} alt="Evidência" className="h-20 w-28 object-cover rounded-lg border mt-1" />}
            </div>
            <div className="flex gap-2 shrink-0">
              {o.status !== 'Resolvida' && (
                <>
                  {o.status === 'Aberta' && (
                    <button onClick={() => updateStatus(o.id, 'Em Andamento')} className="px-3 py-1.5 bg-amber-100 text-amber-800 text-xs font-bold rounded-xl">
                      Em Andamento
                    </button>
                  )}
                  <button onClick={() => updateStatus(o.id, 'Resolvida')} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
