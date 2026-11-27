import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MapPin, Play, Square, Plus, Camera, ListChecks, XCircle } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PhotoInput } from '../components/PhotoInput';
import { ProductSelectorWithSi5 } from '../components/ProductSelectorWithSi5';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

export const VisitsAndRoutesPage: React.FC<{ mode: 'visitas' | 'roteiros'; onOpenStore?: (storeId: number) => void }> = ({ mode, onOpenStore }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = user?.role === 'admin' || user?.role === 'supervisor';
  const [cancelVisitId, setCancelVisitId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [visits, setVisits] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<any>(null);
  const [checklist, setChecklist] = useState<any[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [visitPhoto, setVisitPhoto] = useState<File | null>(null);
  const [activeActionTab, setActiveActionTab] = useState<'foto' | 'exposicao' | 'preco' | 'campanha' | 'ocorrencia'>('foto');

  // Quick action states inside selected visit
  const [expBefore, setExpBefore] = useState<File | null>(null);
  const [expAfter, setExpAfter] = useState<File | null>(null);
  const [expForm, setExpForm] = useState({ exposure_type: 'Gôndola', category: 'Salgadinhos', brand_id: '', facings_actual: '6', facings_expected: '6', notes: '' });

  const [pricePhoto, setPricePhoto] = useState<File | null>(null);
  const [priceForm, setPriceForm] = useState({ product_id: '', gondola_price: '', has_price_tag: true, notes: '' });

  const [campPhoto, setCampPhoto] = useState<File | null>(null);
  const [campForm, setCampForm] = useState({ campaign_id: '', notes: '' });

  const [occPhoto, setOccPhoto] = useState<File | null>(null);
  const [occForm, setOccForm] = useState({ type: 'Ruptura', priority: 'Alta', description: '' });

  const [checkoutNotes, setCheckoutNotes] = useState({ notes: '', problems_found: '', opportunities_found: '' });

  // New Visit form
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [newVisit, setNewVisit] = useState({ store_id: '', scheduled_date: new Date().toISOString().slice(0, 10), scheduled_time: '08:00', notes: '' });

  // New Route form
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: '', region: 'Zona Sul', day_of_week: 'Segunda-feira', store_ids: [] as number[], notes: '' });

  const loadAll = async () => {
    const [v, r, s, p, b, c] = await Promise.all([
      apiFetch('/visits'),
      apiFetch('/routes'),
      apiFetch('/stores'),
      loadProductsWithDeviceCache(false),
      apiFetch('/brands'),
      apiFetch('/campaigns'),
    ]);
    setVisits(v);
    setRoutes(r);
    setStores(s);
    setProducts(p);
    setBrands(b);
    setCampaigns(c.campaigns || []);
    if (s.length > 0 && !newVisit.store_id) setNewVisit((prev) => ({ ...prev, store_id: String(s[0].id) }));
    if (p.length > 0 && !priceForm.product_id) setPriceForm((prev) => ({ ...prev, product_id: String(p[0].id) }));
    if (b.length > 0 && !expForm.brand_id) setExpForm((prev) => ({ ...prev, brand_id: String(b[0].id) }));
    if ((c.campaigns || []).length > 0 && !campForm.campaign_id) {
      setCampForm((prev) => ({ ...prev, campaign_id: String(c.campaigns[0].id) }));
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const openChecklist = async (visit: any) => {
    setSelectedVisit(visit);
    setCheckoutNotes({
      notes: visit.notes || '',
      problems_found: visit.problems_found || '',
      opportunities_found: visit.opportunities_found || '',
    });
    const items = await apiFetch(`/visits/${visit.id}/checklist`);
    setChecklist(items);
  };

  const toggleCheckItem = async (item: any) => {
    try {
      const updated = await apiFetch<any>(`/visits/${selectedVisit.id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !item.completed }),
      });
      if (Array.isArray(updated)) setChecklist(updated);
      void loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao atualizar checklist.');
    }
  };

  const addCustomCheckItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCheckItem.trim()) return;
    try {
      const updated = await apiFetch<any>(`/visits/${selectedVisit.id}/checklist`, {
        method: 'POST',
        body: JSON.stringify({ label: newCheckItem }),
      });
      if (Array.isArray(updated)) setChecklist(updated);
      setNewCheckItem('');
      void loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao adicionar item.');
    }
  };

  const handleCheckin = async (visitId: number) => {
    try {
      let coords: { lat?: number; lng?: number } = {};
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => { coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; resolve(); },
            () => resolve(),
            { timeout: 2500 }
          );
        });
      }
      await apiFetch(`/visits/${visitId}/checkin`, { method: 'POST', body: JSON.stringify(coords) });
      toast('ok', 'Check-in realizado!');
      await loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao realizar check-in.');
    }
  };

  const handleCheckout = async (visitId: number) => {
    try {
      await apiFetch(`/visits/${visitId}/checkout`, { method: 'POST', body: JSON.stringify(checkoutNotes) });
      setSelectedVisit(null);
      toast('ok', 'Visita finalizada com sucesso!');
      await loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Não foi possível finalizar a visita.');
    }
  };

  const confirmCancelVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelVisitId) return;
    try {
      await apiFetch(`/visits/${cancelVisitId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      });
      if (selectedVisit?.id === cancelVisitId) setSelectedVisit(null);
      setCancelVisitId(null);
      setCancelReason('');
      toast('ok', 'Visita cancelada.');
      await loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao cancelar visita.');
    }
  };

  const handleUploadVisitPhoto = async () => {
    if (!visitPhoto || !selectedVisit) return;
    try {
      const fd = new FormData();
      fd.append('photo', visitPhoto);
      fd.append('caption', 'Registro de visita no PDV');
      const res = await apiFetch<any>(`/visits/${selectedVisit.id}/photos`, { method: 'POST', body: fd });
      setVisitPhoto(null);
      toast('ok', res?.offlineQueued ? 'Foto salva na fila offline!' : 'Foto anexada à visita e enviada ao Telegram!');
      if (!res?.offlineQueued) void loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao enviar foto.');
    }
  };

  const handleSubmitDisplay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    try {
      const fd = new FormData();
      fd.append('visit_id', String(selectedVisit.id));
      fd.append('store_id', String(selectedVisit.store_id));
      fd.append('exposure_type', expForm.exposure_type);
      fd.append('category', expForm.category);
      if (expForm.brand_id) fd.append('brand_id', expForm.brand_id);
      fd.append('facings_actual', expForm.facings_actual);
      fd.append('facings_expected', expForm.facings_expected);
      fd.append('notes', expForm.notes);
      if (expBefore) fd.append('photo_before', expBefore);
      if (expAfter) fd.append('photo_after', expAfter);
      const res = await apiFetch<any>('/displays', { method: 'POST', body: fd });
      setExpBefore(null);
      setExpAfter(null);
      setExpForm((f) => ({ ...f, notes: '' }));
      toast('ok', res?.offlineQueued ? 'Exposição salva na fila offline!' : 'Exposição registrada e fotos enviadas!');
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar exposição.');
    }
  };

  const handleSubmitPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    try {
      const fd = new FormData();
      fd.append('visit_id', String(selectedVisit.id));
      fd.append('store_id', String(selectedVisit.store_id));
      fd.append('product_id', priceForm.product_id);
      fd.append('gondola_price', priceForm.gondola_price);
      fd.append('has_price_tag', String(priceForm.has_price_tag));
      fd.append('notes', priceForm.notes);
      if (pricePhoto) fd.append('photo', pricePhoto);
      const res = await apiFetch<any>('/prices', { method: 'POST', body: fd });
      setPricePhoto(null);
      setPriceForm((f) => ({ ...f, gondola_price: '', notes: '' }));
      toast('ok', res?.offlineQueued ? 'Precificação salva na fila offline!' : 'Precificação registrada!');
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar preço.');
    }
  };

  const handleSubmitCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit || !campForm.campaign_id) {
      toast('info', 'Cadastre uma campanha em Campanhas primeiro.');
      return;
    }
    try {
      const fd = new FormData();
      fd.append('visit_id', String(selectedVisit.id));
      fd.append('store_id', String(selectedVisit.store_id));
      fd.append('compliant', 'true');
      fd.append('notes', campForm.notes);
      if (campPhoto) fd.append('photo', campPhoto);
      const res = await apiFetch<any>(`/campaigns/${campForm.campaign_id}/execute`, { method: 'POST', body: fd });
      setCampPhoto(null);
      setCampForm((f) => ({ ...f, notes: '' }));
      toast('ok', res?.offlineQueued ? 'Campanha salva na fila offline!' : 'Comprovação de campanha registrada!');
    } catch (err: any) {
      toast('err', err.message || 'Erro ao comprovar campanha.');
    }
  };

  const handleSubmitOccurrence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    try {
      const fd = new FormData();
      fd.append('visit_id', String(selectedVisit.id));
      fd.append('store_id', String(selectedVisit.store_id));
      fd.append('type', occForm.type);
      fd.append('priority', occForm.priority);
      fd.append('description', occForm.description);
      if (occPhoto) fd.append('photo', occPhoto);
      const res = await apiFetch<any>('/occurrences', { method: 'POST', body: fd });
      setOccPhoto(null);
      setOccForm((f) => ({ ...f, description: '' }));
      toast('ok', res?.offlineQueued ? 'Ocorrência salva na fila offline!' : 'Ocorrência registrada!');
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar ocorrência.');
    }
  };

  const createVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/visits', { method: 'POST', body: JSON.stringify({ ...newVisit, store_id: Number(newVisit.store_id) }) });
      setShowNewVisit(false);
      toast('ok', 'Visita agendada!');
      void loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao agendar visita.');
    }
  };

  const createRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/routes', { method: 'POST', body: JSON.stringify(newRoute) });
      setShowNewRoute(false);
      setNewRoute({ name: '', region: 'Zona Sul', day_of_week: 'Segunda-feira', store_ids: [], notes: '' });
      toast('ok', 'Rota criada com sucesso!');
      void loadAll();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao criar rota.');
    }
  };

  if (mode === 'roteiros') {
    const unattended = visits.filter((v) => v.status === 'Não Atendida' || v.status === 'Pendente' || v.status === 'Cancelada');
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Roteirização e Produtividade</h1>
            <p className="text-sm text-slate-500">Planejamento semanal, organização por região/proximidade e controle de tempo</p>
          </div>
          {isManager && (
            <button onClick={() => setShowNewRoute(!showNewRoute)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Nova Rota
            </button>
          )}
        </div>

        {showNewRoute && (
          <form onSubmit={createRoute} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input required placeholder="Nome da Rota" value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
              <input required placeholder="Região" value={newRoute.region} onChange={(e) => setNewRoute({ ...newRoute, region: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
              <select value={newRoute.day_of_week} onChange={(e) => setNewRoute({ ...newRoute, day_of_week: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
                {['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'].map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1.5">Lojas na Rota (ordem de proximidade):</div>
              <div className="flex flex-wrap gap-2">
                {stores.map((s) => {
                  const selected = newRoute.store_ids.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => setNewRoute({
                        ...newRoute,
                        store_ids: selected ? newRoute.store_ids.filter((id) => id !== s.id) : [...newRoute.store_ids, s.id],
                      })}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}
                    >
                      {s.name} ({s.region})
                    </button>
                  );
                })}
              </div>
            </div>
            <button type="submit" className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl">Salvar Rota</button>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {routes.map((r) => {
            const ids: number[] = JSON.parse(r.store_ids_json || '[]');
            const routeStores = ids.map((id) => stores.find((s) => s.id === id)).filter(Boolean);
            return (
              <div key={r.id} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">{r.day_of_week} • Região: {r.region} • Promotor: {r.promoter_name || 'N/A'}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">{routeStores.length} lojas</span>
                </div>
                <div className="space-y-1.5">
                  {routeStores.map((s: any, i: number) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs text-slate-700 bg-slate-50 px-3 py-2 rounded-xl">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">{i + 1}</span>
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-slate-400">— {s.address}</span>
                    </div>
                  ))}
                </div>
                {r.notes && <div className="text-xs text-slate-500 italic">{r.notes}</div>}
              </div>
            );
          })}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <h2 className="font-bold text-slate-800">Lojas Pendentes / Não Atendidas</h2>
          <div className="divide-y divide-slate-100">
            {unattended.map((v) => (
              <div key={v.id} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-semibold">{v.store_name}</span>
                  <span className="text-xs text-slate-500 ml-2">{v.scheduled_date} {v.scheduled_time}</span>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${v.status === 'Não Atendida' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Minhas Visitas & Checklist Inteligente</h1>
          <p className="text-sm text-slate-500">Check-in/Check-out no PDV, controle de tempo, fotos e checklist personalizável</p>
        </div>
        <button onClick={() => setShowNewVisit(!showNewVisit)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Agendar Visita
        </button>
      </div>

      {showNewVisit && (
        <form onSubmit={createVisit} className="bg-white p-5 rounded-2xl border border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select required value={newVisit.store_id} onChange={(e) => setNewVisit({ ...newVisit, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="date" required value={newVisit.scheduled_date} onChange={(e) => setNewVisit({ ...newVisit, scheduled_date: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input type="time" value={newVisit.scheduled_time} onChange={(e) => setNewVisit({ ...newVisit, scheduled_time: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <button type="submit" className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl">Confirmar Visita</button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          {visits.map((v) => {
            const pct = v.checklist_total ? Math.round((v.checklist_done / v.checklist_total) * 100) : 0;
            return (
              <div key={v.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-blue-600" />
                      {v.store_name}
                      <span className="text-xs font-normal text-slate-500">({v.store_type})</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{v.store_address} • {v.scheduled_date} às {v.scheduled_time}</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    v.status === 'Concluída' ? 'bg-emerald-100 text-emerald-700' :
                    v.status === 'Em Andamento' ? 'bg-blue-100 text-blue-700' :
                    (v.status === 'Não Atendida' || v.status === 'Cancelada') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {v.status}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {v.duration_minutes ? `${v.duration_minutes} min` : 'Aguardando'}</span>
                  <span>Checklist: <b>{v.checklist_done}/{v.checklist_total} ({pct}%)</b></span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {onOpenStore && (
                    <button
                      onClick={() => onOpenStore(v.store_id)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1"
                    >
                      <Play className="w-3.5 h-3.5" /> Abrir Fluxo na Loja
                    </button>
                  )}
                  {v.status === 'Pendente' && (
                    <button onClick={() => handleCheckin(v.id)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1">
                      <Play className="w-3.5 h-3.5" /> Check-in Rápido
                    </button>
                  )}
                  <button onClick={() => openChecklist(v)} className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl flex items-center gap-1">
                    <ListChecks className="w-3.5 h-3.5" /> Checklist & Detalhes
                  </button>
                  {(v.status === 'Pendente' || v.status === 'Em Andamento') && (
                    <button onClick={() => { setCancelVisitId(v.id); setCancelReason(''); }} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> Cancelar Visita
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Checklist & Checkout Drawer/Panel */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 h-fit sticky top-20 space-y-4">
          {selectedVisit ? (
            <>
              <div className="border-b border-slate-100 pb-3">
                <div className="font-bold text-slate-900">{selectedVisit.store_name}</div>
                <div className="text-xs text-slate-500">Checklist Inteligente da Visita #{selectedVisit.id}</div>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {checklist.map((item) => (
                  <label key={item.id} className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(item.completed)}
                      onChange={() => toggleCheckItem(item)}
                      className="mt-0.5 w-4 h-4 accent-blue-600 rounded"
                    />
                    <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-700 font-medium'}>
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>

              <form onSubmit={addCustomCheckItem} className="flex gap-2">
                <input
                  value={newCheckItem}
                  onChange={(e) => setNewCheckItem(e.target.value)}
                  placeholder="Adicionar item personalizado..."
                  className="flex-1 px-3 py-1.5 border rounded-xl text-xs"
                />
                <button type="submit" className="px-3 py-1.5 bg-slate-800 text-white rounded-xl text-xs font-semibold">+</button>
              </form>

              {/* 5 Opções de Registro & Fotos na Visita */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="text-xs font-bold text-slate-700">Registros com Foto nesta Visita</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'foto', label: '1. Visita' },
                    { id: 'exposicao', label: '2. Exposição' },
                    { id: 'preco', label: '3. Preço' },
                    { id: 'campanha', label: '4. Campanha' },
                    { id: 'ocorrencia', label: '5. Ocorrência' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveActionTab(tab.id as any)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                        activeActionTab === tab.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeActionTab === 'foto' && (
                  <div className="space-y-2">
                    <PhotoInput label="Foto da Visita" file={visitPhoto} onFileSelect={setVisitPhoto} />
                    {visitPhoto && (
                      <button onClick={handleUploadVisitPhoto} className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1">
                        <Camera className="w-3.5 h-3.5" /> Enviar Foto da Visita
                      </button>
                    )}
                  </div>
                )}

                {activeActionTab === 'exposicao' && (
                  <form onSubmit={handleSubmitDisplay} className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select value={expForm.exposure_type} onChange={(e) => setExpForm({ ...expForm, exposure_type: e.target.value })} className="px-2.5 py-1.5 border rounded-xl text-xs">
                        {['Gôndola', 'Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola', 'Checkout'].map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <select value={expForm.brand_id} onChange={(e) => setExpForm({ ...expForm, brand_id: e.target.value })} className="px-2.5 py-1.5 border rounded-xl text-xs">
                        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <input placeholder="Categoria (ex: Salgadinhos)" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs" />
                    <PhotoInput label="Foto ANTES" file={expBefore} onFileSelect={setExpBefore} />
                    <PhotoInput label="Foto DEPOIS" file={expAfter} onFileSelect={setExpAfter} />
                    <input placeholder="Observação..." value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs" />
                    <button type="submit" className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl">Salvar Exposição</button>
                  </form>
                )}

                {activeActionTab === 'preco' && (
                  <form onSubmit={handleSubmitPrice} className="space-y-2">
                    <ProductSelectorWithSi5
                      products={products as CachedProduct[]}
                      value={priceForm.product_id}
                      onChange={(pid) => setPriceForm({ ...priceForm, product_id: pid })}
                      onCatalogUpdated={setProducts}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" step="0.01" placeholder="Preço Gôndola (R$)" value={priceForm.gondola_price} onChange={(e) => setPriceForm({ ...priceForm, gondola_price: e.target.value })} className="px-2.5 py-1.5 border rounded-xl text-xs" />
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={priceForm.has_price_tag} onChange={(e) => setPriceForm({ ...priceForm, has_price_tag: e.target.checked })} className="accent-blue-600" />
                        Com etiqueta
                      </label>
                    </div>
                    <PhotoInput label="Foto da Etiqueta / Preço" file={pricePhoto} onFileSelect={setPricePhoto} />
                    <input placeholder="Observação..." value={priceForm.notes} onChange={(e) => setPriceForm({ ...priceForm, notes: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs" />
                    <button type="submit" className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl">Registrar Preço</button>
                  </form>
                )}

                {activeActionTab === 'campanha' && (
                  <form onSubmit={handleSubmitCampaign} className="space-y-2">
                    <select value={campForm.campaign_id} onChange={(e) => setCampForm({ ...campForm, campaign_id: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs">
                      {campaigns.length === 0 ? <option value="">Nenhuma campanha ativa</option> : campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                    <PhotoInput label="Foto de Comprovação da Campanha" file={campPhoto} onFileSelect={setCampPhoto} />
                    <input placeholder="Observações da campanha..." value={campForm.notes} onChange={(e) => setCampForm({ ...campForm, notes: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs" />
                    <button type="submit" className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl">Confirmar Campanha</button>
                  </form>
                )}

                {activeActionTab === 'ocorrencia' && (
                  <form onSubmit={handleSubmitOccurrence} className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select value={occForm.type} onChange={(e) => setOccForm({ ...occForm, type: e.target.value })} className="px-2.5 py-1.5 border rounded-xl text-xs">
                        {['Ruptura', 'Baixo Estoque', 'Sem Exposição', 'Espaço Vazio', 'Mal Posicionado', 'Falta Material', 'Concorrente Espaço Estratégico', 'Falta de Preço', 'Baixa Visibilidade'].map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <select value={occForm.priority} onChange={(e) => setOccForm({ ...occForm, priority: e.target.value })} className="px-2.5 py-1.5 border rounded-xl text-xs">
                        {['Alta', 'Média', 'Baixa'].map((p) => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                    <textarea required placeholder="Descreva a ocorrência ou ruptura..." value={occForm.description} onChange={(e) => setOccForm({ ...occForm, description: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs" rows={2} />
                    <PhotoInput label="Foto da Ocorrência" file={occPhoto} onFileSelect={setOccPhoto} />
                    <button type="submit" className="w-full py-2 bg-red-600 text-white text-xs font-bold rounded-xl">Registrar Ocorrência</button>
                  </form>
                )}
              </div>

              {selectedVisit.status !== 'Concluída' && (
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <textarea
                    placeholder="Problemas encontrados..."
                    value={checkoutNotes.problems_found}
                    onChange={(e) => setCheckoutNotes({ ...checkoutNotes, problems_found: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-xs"
                    rows={2}
                  />
                  <textarea
                    placeholder="Oportunidades identificadas..."
                    value={checkoutNotes.opportunities_found}
                    onChange={(e) => setCheckoutNotes({ ...checkoutNotes, opportunities_found: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-xs"
                    rows={2}
                  />
                  <button
                    onClick={() => handleCheckout(selectedVisit.id)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Square className="w-4 h-4" /> Finalizar Visita (Check-out)
                  </button>
                </div>
              )}
              {selectedVisit.status === 'Concluída' && (
                <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Visita concluída em {selectedVisit.duration_minutes} min.
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-10 text-slate-400 text-sm">
              Selecione uma visita ao lado para preencher o checklist, anexar fotos ou realizar check-out.
            </div>
          )}
        </div>
      </div>

      {cancelVisitId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form onSubmit={confirmCancelVisit} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <h2 className="font-bold text-slate-900">Cancelar Visita #{cancelVisitId}</h2>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Informe o motivo do cancelamento (opcional)..."
              className="w-full px-3 py-2 border rounded-xl text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCancelVisitId(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold">
                Voltar
              </button>
              <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold">
                Confirmar Cancelamento
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
