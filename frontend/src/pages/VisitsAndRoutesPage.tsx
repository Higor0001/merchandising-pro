import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  MapPin,
  Play,
  Square,
  Plus,
  ListChecks,
  XCircle,
  Trash2,
  FileText,
  FileSpreadsheet,
  Calendar,
  CalendarRange,
  Search,
  Filter,
} from 'lucide-react';
import { apiFetch, readCachedApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PhotoInput } from '../components/PhotoInput';
import { ProductSelectorWithSi5 } from '../components/ProductSelectorWithSi5';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

type DateFilterMode = 'hoje' | 'ontem' | '7dias' | 'mes' | 'data' | 'periodo' | 'todas';

function getBrazilDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatBrDate(isoDay: string): string {
  if (!isoDay || !/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return isoDay;
  const [y, m, d] = isoDay.split('-');
  return `${d}/${m}/${y}`;
}

export const VisitsAndRoutesPage: React.FC<{
  mode: 'visitas' | 'roteiros';
  onOpenStore?: (storeId: number) => void;
}> = ({ mode, onOpenStore }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = user?.role === 'admin' || user?.role === 'supervisor';

  const todayStr = useMemo(() => getBrazilDateStr(0), []);
  const [dateMode, setDateMode] = useState<DateFilterMode>('hoje');
  const [singleDate, setSingleDate] = useState<string>(todayStr);
  const [startDate, setStartDate] = useState<string>(getBrazilDateStr(-7));
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [statusFilter, setStatusFilter] = useState<string>('Todas');
  const [searchStore, setSearchStore] = useState<string>('');

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
  const [visitPhotoArea, setVisitPhotoArea] = useState('Corredor Principal');
  const [uploadingVisitPhotos, setUploadingVisitPhotos] = useState(false);
  const [downloadingVisitId, setDownloadingVisitId] = useState<number | null>(null);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [activeActionTab, setActiveActionTab] = useState<'foto' | 'exposicao' | 'preco' | 'campanha' | 'ocorrencia'>('foto');

  // Quick action states inside selected visit
  const [expBefore, setExpBefore] = useState<File | null>(null);
  const [expAfter, setExpAfter] = useState<File | null>(null);
  const [expForm, setExpForm] = useState({ exposure_type: 'Gôndola', category: 'Todos', brand_id: '', product_id: '', facings_actual: '6', facings_expected: '6', notes: '' });

  const [pricePhoto, setPricePhoto] = useState<File | null>(null);
  const [priceForm, setPriceForm] = useState({ product_id: '', gondola_price: '', has_price_tag: true, notes: '' });

  const [campPhoto, setCampPhoto] = useState<File | null>(null);
  const [campForm, setCampForm] = useState({ campaign_id: '', notes: '' });

  const [occPhoto, setOccPhoto] = useState<File | null>(null);
  const [occForm, setOccForm] = useState({ type: 'Ruptura', priority: 'Alta', description: '' });

  const [checkoutNotes, setCheckoutNotes] = useState({ notes: '', problems_found: '', opportunities_found: '' });

  // New Visit form
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [newVisit, setNewVisit] = useState({ store_id: '', scheduled_date: todayStr, scheduled_time: '08:00', notes: '' });

  // New Route form
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: '', region: 'Centro', day_of_week: 'Segunda-feira', store_ids: [] as number[], notes: '' });

  const buildVisitsEndpoint = useCallback(() => {
    if (mode === 'roteiros') return '/visits';
    const params = new URLSearchParams();
    if (dateMode === 'hoje') {
      params.set('date', getBrazilDateStr(0));
    } else if (dateMode === 'ontem') {
      params.set('date', getBrazilDateStr(-1));
    } else if (dateMode === '7dias') {
      params.set('start_date', getBrazilDateStr(-6));
      params.set('end_date', getBrazilDateStr(0));
    } else if (dateMode === 'mes') {
      const today = getBrazilDateStr(0);
      params.set('start_date', `${today.slice(0, 7)}-01`);
      params.set('end_date', today);
    } else if (dateMode === 'data' && singleDate) {
      params.set('date', singleDate);
    } else if (dateMode === 'periodo') {
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
    }
    const qs = params.toString();
    return qs ? `/visits?${qs}` : '/visits';
  }, [mode, dateMode, singleDate, startDate, endDate]);

  const loadVisitsOnly = useCallback(async () => {
    const endpoint = buildVisitsEndpoint();
    const cached = await readCachedApi<any[]>(endpoint);
    if (Array.isArray(cached)) {
      setVisits(cached);
      setLoadingVisits(false);
    } else {
      setLoadingVisits(true);
    }
    try {
      const v = await apiFetch<any[]>(endpoint);
      setVisits(Array.isArray(v) ? v : []);
    } catch (err: any) {
      if (!cached) toast('err', err.message || 'Erro ao carregar visitas.');
    } finally {
      setLoadingVisits(false);
    }
  }, [buildVisitsEndpoint, toast]);

  const loadStaticData = useCallback(async () => {
    try {
      const [r, s, p, b, c] = await Promise.all([
        apiFetch('/routes'),
        apiFetch('/stores'),
        loadProductsWithDeviceCache(false),
        apiFetch('/brands'),
        apiFetch('/campaigns'),
      ]);
      setRoutes(Array.isArray(r) ? r : []);
      setStores(Array.isArray(s) ? s : []);
      setProducts(Array.isArray(p) ? p : []);
      setBrands(Array.isArray(b) ? b : []);
      setCampaigns(c?.campaigns || []);
      if (Array.isArray(s) && s.length > 0) setNewVisit((prev) => ({ ...prev, store_id: prev.store_id || String(s[0].id) }));
      if (Array.isArray(p) && p.length > 0) setPriceForm((prev) => ({ ...prev, product_id: prev.product_id || String(p[0].id) }));
      if ((c?.campaigns || []).length > 0) {
        setCampForm((prev) => ({ ...prev, campaign_id: prev.campaign_id || String(c.campaigns[0].id) }));
      }
    } catch (err: any) {
      toast('err', err.message || 'Erro ao carregar dados auxiliares.');
    }
  }, [toast]);

  useEffect(() => {
    void loadStaticData();
  }, [loadStaticData]);

  useEffect(() => {
    void loadVisitsOnly();
  }, [loadVisitsOnly]);

  const loadAll = async () => {
    await Promise.all([loadVisitsOnly(), loadStaticData()]);
  };

  const filteredVisits = useMemo(() => {
    const q = searchStore.trim().toLowerCase();
    return visits.filter((v) => {
      if (statusFilter !== 'Todas' && v.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(v.store_name || '').toLowerCase().includes(q) ||
        String(v.store_address || '').toLowerCase().includes(q) ||
        String(v.promoter_name || '').toLowerCase().includes(q)
      );
    });
  }, [visits, statusFilter, searchStore]);

  const periodDescription = useMemo(() => {
    if (dateMode === 'hoje') return `Hoje (${formatBrDate(getBrazilDateStr(0))})`;
    if (dateMode === 'ontem') return `Ontem (${formatBrDate(getBrazilDateStr(-1))})`;
    if (dateMode === '7dias') return `Últimos 7 dias (${formatBrDate(getBrazilDateStr(-6))} a ${formatBrDate(getBrazilDateStr(0))})`;
    if (dateMode === 'mes') return `Este mês (desde 01/${getBrazilDateStr(0).slice(5, 7)}/${getBrazilDateStr(0).slice(0, 4)})`;
    if (dateMode === 'data') return `Data: ${formatBrDate(singleDate)}`;
    if (dateMode === 'periodo') return `Período: ${formatBrDate(startDate)} a ${formatBrDate(endDate)}`;
    return 'Todo o histórico disponível';
  }, [dateMode, singleDate, startDate, endDate]);

  const handleDownloadVisit = async (visitId: number, format: 'pdf' | 'excel') => {
    setDownloadingVisitId(visitId);
    try {
      const [report, exporter] = await Promise.all([
        apiFetch<any>(`/visits/${visitId}/report${format === 'pdf' ? '?include_images=1' : ''}`),
        import('../services/exportUtils'),
      ]);
      if (format === 'pdf') {
        await exporter.exportVisitHistoryPDF(report);
        toast('ok', `Histórico da Visita #${visitId} baixado em PDF com fotos!`);
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

  const openChecklist = async (visit: any) => {
    setSelectedVisit(visit);
    setCheckoutNotes({
      notes: visit.notes || '',
      problems_found: visit.problems_found || '',
      opportunities_found: visit.opportunities_found || '',
    });
    const items = await apiFetch(`/visits/${visit.id}/checklist`);
    setChecklist(Array.isArray(items) ? items : []);
  };

  const toggleCheckItem = async (item: any) => {
    try {
      const updated = await apiFetch<any>(`/visits/${selectedVisit.id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !item.completed }),
      });
      if (Array.isArray(updated)) setChecklist(updated);
      void loadVisitsOnly();
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
      void loadVisitsOnly();
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
            (pos) => {
              coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              resolve();
            },
            () => resolve(),
            { timeout: 2500 }
          );
        });
      }
      await apiFetch(`/visits/${visitId}/checkin`, { method: 'POST', body: JSON.stringify(coords) });
      toast('ok', 'Check-in realizado!');
      await loadVisitsOnly();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao realizar check-in.');
    }
  };

  const handleCheckout = async (visitId: number) => {
    try {
      await apiFetch(`/visits/${visitId}/checkout`, { method: 'POST', body: JSON.stringify(checkoutNotes) });
      setSelectedVisit(null);
      toast('ok', 'Visita finalizada com sucesso!');
      await loadVisitsOnly();
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
      await loadVisitsOnly();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao cancelar visita.');
    }
  };

  const handleAutoUploadVisitPhotos = async (files: File[]) => {
    if (!files.length || !selectedVisit) return;
    setUploadingVisitPhotos(true);
    let okCount = 0;
    let queuedCount = 0;
    let latestPhotos: any[] | null = null;
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('photo', file);
        fd.append('area', visitPhotoArea);
        fd.append('caption', `Registro de visita — ${visitPhotoArea}`);
        const res = await apiFetch<any>(`/visits/${selectedVisit.id}/photos`, { method: 'POST', body: fd });
        if (res?.offlineQueued) queuedCount++;
        else {
          okCount++;
          if (Array.isArray(res?.photos)) latestPhotos = res.photos;
        }
      }
      if (latestPhotos) {
        setSelectedVisit((prev: any) => (prev ? { ...prev, photos_json: JSON.stringify(latestPhotos) } : prev));
      }
      if (queuedCount > 0 && okCount === 0) {
        toast('info', `${queuedCount} foto(s) salva(s) na fila offline!`);
      } else {
        toast('ok', `${okCount} foto(s) de "${visitPhotoArea}" enviada(s) automaticamente em HD ao Telegram!`);
        void loadVisitsOnly();
      }
    } catch (err: any) {
      toast('err', err.message || 'Erro ao enviar foto.');
    } finally {
      setUploadingVisitPhotos(false);
    }
  };

  const handleDeleteVisitPhoto = async (photoId: string) => {
    if (!selectedVisit) return;
    try {
      const res = await apiFetch<any>(`/visits/${selectedVisit.id}/photos/${encodeURIComponent(photoId)}`, {
        method: 'DELETE',
      });
      if (Array.isArray(res?.photos)) {
        setSelectedVisit((prev: any) => (prev ? { ...prev, photos_json: JSON.stringify(res.photos) } : prev));
      }
      toast(
        'ok',
        res?.telegram_deleted
          ? 'Foto removida do site e apagada automaticamente do Telegram!'
          : 'Foto removida da visita.'
      );
      void loadVisitsOnly();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao remover foto.');
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
      if (expForm.product_id) fd.append('product_id', expForm.product_id);
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
      void loadVisitsOnly();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao agendar visita.');
    }
  };

  const createRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/routes', { method: 'POST', body: JSON.stringify(newRoute) });
      setShowNewRoute(false);
      setNewRoute({ name: '', region: 'Centro', day_of_week: 'Segunda-feira', store_ids: [], notes: '' });
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
            <h1 className="font-display text-xl font-extrabold text-slate-900">Roteirização e Produtividade</h1>
            <p className="text-sm text-slate-500">Planejamento semanal, organização por região/proximidade e controle de tempo</p>
          </div>
          {isManager && (
            <button onClick={() => setShowNewRoute(!showNewRoute)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Nova Rota
            </button>
          )}
        </div>

        {showNewRoute && (
          <form onSubmit={createRoute} className="bg-white p-5 rounded-3xl border border-slate-200 space-y-4">
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
                      onClick={() =>
                        setNewRoute({
                          ...newRoute,
                          store_ids: selected ? newRoute.store_ids.filter((id) => id !== s.id) : [...newRoute.store_ids, s.id],
                        })
                      }
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
              <div key={r.id} className="bg-white p-5 rounded-3xl border border-slate-200 space-y-3">
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

        <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-3">
          <h2 className="font-bold text-slate-800">Lojas Pendentes / Não Atendidas</h2>
          <div className="divide-y divide-slate-100">
            {unattended.length === 0 ? (
              <div className="py-4 text-xs text-slate-400 text-center">Nenhuma loja pendente ou não atendida.</div>
            ) : (
              unattended.map((v) => (
                <div key={v.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold">{v.store_name}</span>
                    <span className="text-xs text-slate-500 ml-2">{v.scheduled_date} {v.scheduled_time}</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${v.status === 'Não Atendida' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {v.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Banner Diário */}
      <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 text-white rounded-3xl p-5 sm:p-6 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-[11px] font-bold mb-1">
              <Calendar className="w-3.5 h-3.5" /> {periodDescription}
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight">
              Minhas Visitas & Pesquisas do Dia
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              Por padrão exibe apenas as visitas de hoje. Use o filtro abaixo para consultar outras datas ou períodos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewVisit(!showNewVisit)}
            className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-xs font-extrabold rounded-xl inline-flex items-center gap-1.5 shadow-md transition"
          >
            <Plus className="w-4 h-4" /> Agendar Visita
          </button>
        </div>

        {/* Métricas do período selecionado */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: 'No Filtro', val: filteredVisits.length },
            { label: 'Em Andamento', val: filteredVisits.filter((v) => v.status === 'Em Andamento').length },
            { label: 'Concluídas', val: filteredVisits.filter((v) => v.status === 'Concluída').length },
            { label: 'Pendentes', val: filteredVisits.filter((v) => v.status === 'Pendente').length },
          ].map((m) => (
            <div key={m.label} className="px-3.5 py-2.5 rounded-2xl bg-white/8 border border-white/10">
              <div className="text-lg font-extrabold tabular-nums">{m.val}</div>
              <div className="text-[11px] text-slate-300">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Barra de Filtro de Data / Período */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mr-1 inline-flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Período:
          </span>
          {[
            { id: 'hoje', label: 'Hoje' },
            { id: 'ontem', label: 'Ontem' },
            { id: '7dias', label: 'Últimos 7 dias' },
            { id: 'mes', label: 'Este mês' },
            { id: 'data', label: 'Escolher Data' },
            { id: 'periodo', label: 'Período (De/Até)' },
            { id: 'todas', label: 'Todas' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDateMode(opt.id as DateFilterMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                dateMode === opt.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {(dateMode === 'data' || dateMode === 'periodo') && (
          <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-2xl bg-blue-50/60 border border-blue-200/80 text-xs">
            <CalendarRange className="w-4 h-4 text-blue-600 shrink-0" />
            {dateMode === 'data' ? (
              <label className="flex items-center gap-2 font-bold text-slate-700">
                Data:
                <input
                  type="date"
                  value={singleDate}
                  onChange={(e) => setSingleDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 bg-white rounded-xl text-xs font-semibold"
                />
              </label>
            ) : (
              <>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                  De:
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 bg-white rounded-xl text-xs font-semibold"
                  />
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                  Até:
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 bg-white rounded-xl text-xs font-semibold"
                  />
                </label>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1 border-t border-slate-100">
          <div className="flex-1 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchStore}
              onChange={(e) => setSearchStore(e.target.value)}
              placeholder="Filtrar por loja, endereço ou promotor..."
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {['Todas', 'Em Andamento', 'Pendente', 'Concluída', 'Cancelada'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition ${
                  statusFilter === st ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showNewVisit && (
        <form onSubmit={createVisit} className="bg-white p-5 rounded-3xl border border-blue-200 grid grid-cols-1 sm:grid-cols-4 gap-3 shadow-xs">
          <select required value={newVisit.store_id} onChange={(e) => setNewVisit({ ...newVisit, store_id: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="date" required value={newVisit.scheduled_date} onChange={(e) => setNewVisit({ ...newVisit, scheduled_date: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <input type="time" value={newVisit.scheduled_time} onChange={(e) => setNewVisit({ ...newVisit, scheduled_time: e.target.value })} className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          <button type="submit" className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-xl">Confirmar Visita</button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          {loadingVisits ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-32 rounded-3xl bg-white border border-slate-200" />
              <div className="h-32 rounded-3xl bg-white border border-slate-200" />
            </div>
          ) : filteredVisits.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center space-y-3">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="font-bold text-slate-800 text-sm">
                {dateMode === 'hoje'
                  ? 'Nenhuma visita registrada para hoje ainda'
                  : 'Nenhuma visita encontrada neste filtro'}
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {dateMode === 'hoje'
                  ? 'Inicie uma visita em uma loja ou agende acima. Para ver visitas de dias anteriores, selecione uma data ou período no filtro acima.'
                  : 'Ajuste o período ou os filtros de status para localizar visitas anteriores.'}
              </p>
              {dateMode === 'hoje' && (
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setDateMode('7dias')}
                    className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                  >
                    Ver últimos 7 dias
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateMode('periodo')}
                    className="px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold"
                  >
                    Filtrar por período
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredVisits.map((v) => {
              const pct = v.checklist_total ? Math.round((v.checklist_done / v.checklist_total) * 100) : 0;
              return (
                <div key={v.id} className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-extrabold text-slate-900 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                        <span>{v.store_name}</span>
                        <span className="text-xs font-normal text-slate-500">({v.store_type})</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {v.store_address} • {formatBrDate(v.scheduled_date)} às {v.scheduled_time} • {v.promoter_name}
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
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

                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {v.duration_minutes ? `${v.duration_minutes} min` : 'Aguardando'}
                    </span>
                    <span>
                      Checklist: <b>{v.checklist_done}/{v.checklist_total} ({pct}%)</b>
                    </span>
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
                    <button
                      type="button"
                      disabled={downloadingVisitId === v.id}
                      onClick={() => void handleDownloadVisit(v.id, 'pdf')}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl flex items-center gap-1 disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" /> {downloadingVisitId === v.id ? 'Gerando...' : 'Baixar PDF'}
                    </button>
                    <button
                      type="button"
                      disabled={downloadingVisitId === v.id}
                      onClick={() => void handleDownloadVisit(v.id, 'excel')}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl flex items-center gap-1 disabled:opacity-50"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                    </button>
                    {(v.status === 'Pendente' || v.status === 'Em Andamento') && (
                      <button
                        onClick={() => {
                          setCancelVisitId(v.id);
                          setCancelReason('');
                        }}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Cancelar
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Checklist & Checkout Panel */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 h-fit sticky top-20 space-y-4 shadow-xs">
          {selectedVisit ? (
            <>
              <div className="border-b border-slate-100 pb-3">
                <div className="font-extrabold text-slate-900">{selectedVisit.store_name}</div>
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
                    <select
                      value={visitPhotoArea}
                      onChange={(e) => setVisitPhotoArea(e.target.value)}
                      className="w-full px-2.5 py-1.5 border rounded-xl text-xs bg-white font-semibold"
                    >
                      {['Corredor Principal', 'Gôndola Principal', 'Ponta de Gôndola', 'Ilha Promocional', 'Checkout', 'Ponto Extra', 'Display', 'Estoque/Retaguarda'].map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <PhotoInput
                      label={`Selecionar 1 ou Várias Fotos (${visitPhotoArea})`}
                      onFilesSelect={(files) => void handleAutoUploadVisitPhotos(files)}
                      multiple
                      autoClear
                      busy={uploadingVisitPhotos}
                      busyText="Enviando em HD ao Telegram..."
                    />
                    {(() => {
                      let visitPhotos: any[] = [];
                      try {
                        visitPhotos = JSON.parse(selectedVisit.photos_json || '[]');
                      } catch {
                        visitPhotos = [];
                      }
                      if (!visitPhotos.length) return null;
                      return (
                        <div className="grid grid-cols-2 gap-2 pt-1 max-h-48 overflow-y-auto">
                          {visitPhotos.map((p: any, idx: number) => {
                            const pid = String(p.photo_id ?? idx);
                            return (
                              <div key={pid} className="relative rounded-xl border bg-slate-50 overflow-hidden">
                                <img src={p.url} alt={p.area || 'Foto'} className="w-full h-20 object-cover" />
                                {p.is_panoramic && (
                                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-indigo-600/90 text-white text-[9px] font-bold">
                                    Panorâmica
                                  </span>
                                )}
                                {selectedVisit.status !== 'Concluída' && selectedVisit.status !== 'Cancelada' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteVisitPhoto(pid)}
                                    title="Apagar foto do site e do Telegram"
                                    className="absolute top-1 right-1 p-1 rounded-full bg-red-600/90 text-white hover:bg-red-700"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                                <div className="px-1.5 py-1 text-[10px] font-semibold text-slate-600 truncate">
                                  {p.area || p.caption || 'Foto'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {activeActionTab === 'exposicao' && (() => {
                  const expCategories = ['Todos', ...Array.from(new Set(products.map((p: any) => String(p.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
                  const validBrandIds = expForm.category === 'Todos'
                    ? null
                    : new Set(products.filter((p: any) => (p.category || '') === expForm.category && p.brand_id).map((p: any) => Number(p.brand_id)));
                  const expBrands = validBrandIds ? brands.filter((b: any) => validBrandIds.has(Number(b.id))) : brands;
                  const expProducts = products.filter((p: any) => {
                    if (expForm.category !== 'Todos' && (p.category || '') !== expForm.category) return false;
                    if (expForm.brand_id && Number(p.brand_id) !== Number(expForm.brand_id)) return false;
                    return true;
                  });
                  return (
                  <form onSubmit={handleSubmitDisplay} className="space-y-2">
                    <select value={expForm.exposure_type} onChange={(e) => setExpForm({ ...expForm, exposure_type: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs bg-white">
                      {['Gôndola', 'Corredor Principal', 'Ponta de Gôndola', 'Ilha Promocional', 'Ponto Extra', 'Display', 'Checkout'].map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={expForm.category}
                        onChange={(e) => setExpForm({ ...expForm, category: e.target.value, brand_id: '', product_id: '' })}
                        className="px-2.5 py-1.5 border rounded-xl text-xs bg-white"
                      >
                        {expCategories.map((c) => <option key={c} value={c}>{c === 'Todos' ? 'Todos (Categorias)' : c}</option>)}
                      </select>
                      <select
                        value={expForm.brand_id}
                        onChange={(e) => setExpForm({ ...expForm, brand_id: e.target.value, product_id: '' })}
                        className="px-2.5 py-1.5 border rounded-xl text-xs bg-white"
                      >
                        <option value="">Todos ({expBrands.length} marcas)</option>
                        {expBrands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <select
                      value={expForm.product_id}
                      onChange={(e) => setExpForm({ ...expForm, product_id: e.target.value })}
                      className="w-full px-2.5 py-1.5 border rounded-xl text-xs bg-white"
                    >
                      <option value="">Todos ({expProducts.length} itens)</option>
                      {expProducts.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}{p.weight ? ` (${p.weight})` : ''}</option>
                      ))}
                    </select>
                    <PhotoInput label="Foto ANTES" file={expBefore} onFileSelect={setExpBefore} />
                    <PhotoInput label="Foto DEPOIS" file={expAfter} onFileSelect={setExpAfter} />
                    <input placeholder="Observação..." value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-xl text-xs" />
                    <button type="submit" className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl">Salvar Exposição</button>
                  </form>
                  );
                })()}

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
          <form onSubmit={confirmCancelVisit} className="bg-white rounded-3xl w-full max-w-md p-5 space-y-4 shadow-2xl">
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
