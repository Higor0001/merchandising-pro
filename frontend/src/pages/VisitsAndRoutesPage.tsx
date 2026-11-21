import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MapPin, Play, Square, Plus, Camera, ListChecks } from 'lucide-react';
import { apiFetch } from '../services/api';
import { PhotoInput } from '../components/PhotoInput';

export const VisitsAndRoutesPage: React.FC<{ mode: 'visitas' | 'roteiros' }> = ({ mode }) => {
  const [visits, setVisits] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<any>(null);
  const [checklist, setChecklist] = useState<any[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [visitPhoto, setVisitPhoto] = useState<File | null>(null);
  const [checkoutNotes, setCheckoutNotes] = useState({ notes: '', problems_found: '', opportunities_found: '' });

  // New Visit form
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [newVisit, setNewVisit] = useState({ store_id: '', scheduled_date: new Date().toISOString().slice(0, 10), scheduled_time: '08:00', notes: '' });

  // New Route form
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: '', region: 'Zona Sul', day_of_week: 'Segunda-feira', store_ids: [] as number[], notes: '' });

  const loadAll = async () => {
    const [v, r, s] = await Promise.all([apiFetch('/visits'), apiFetch('/routes'), apiFetch('/stores')]);
    setVisits(v);
    setRoutes(r);
    setStores(s);
    if (s.length > 0 && !newVisit.store_id) setNewVisit((p) => ({ ...p, store_id: String(s[0].id) }));
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
    const updated = await apiFetch(`/visits/${selectedVisit.id}/checklist/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: !item.completed }),
    });
    setChecklist(updated);
    loadAll();
  };

  const addCustomCheckItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCheckItem.trim()) return;
    const updated = await apiFetch(`/visits/${selectedVisit.id}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ label: newCheckItem }),
    });
    setChecklist(updated);
    setNewCheckItem('');
    loadAll();
  };

  const handleCheckin = async (visitId: number) => {
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
    await loadAll();
  };

  const handleCheckout = async (visitId: number) => {
    await apiFetch(`/visits/${visitId}/checkout`, { method: 'POST', body: JSON.stringify(checkoutNotes) });
    setSelectedVisit(null);
    await loadAll();
  };

  const handleUploadVisitPhoto = async () => {
    if (!visitPhoto || !selectedVisit) return;
    const fd = new FormData();
    fd.append('photo', visitPhoto);
    fd.append('caption', 'Registro de visita no PDV');
    await apiFetch(`/visits/${selectedVisit.id}/photos`, { method: 'POST', body: fd });
    setVisitPhoto(null);
    alert('Foto anexada à visita!');
    loadAll();
  };

  const createVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/visits', { method: 'POST', body: JSON.stringify({ ...newVisit, store_id: Number(newVisit.store_id) }) });
    setShowNewVisit(false);
    loadAll();
  };

  const createRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/routes', { method: 'POST', body: JSON.stringify(newRoute) });
    setShowNewRoute(false);
    setNewRoute({ name: '', region: 'Zona Sul', day_of_week: 'Segunda-feira', store_ids: [], notes: '' });
    loadAll();
  };

  if (mode === 'roteiros') {
    const unattended = visits.filter((v) => v.status === 'Não Atendida' || v.status === 'Pendente');
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Roteirização e Produtividade</h1>
            <p className="text-sm text-slate-500">Planejamento semanal, organização por região/proximidade e controle de tempo</p>
          </div>
          <button onClick={() => setShowNewRoute(!showNewRoute)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nova Rota
          </button>
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
                    v.status === 'Não Atendida' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
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
                  {v.status === 'Pendente' && (
                    <button onClick={() => handleCheckin(v.id)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1">
                      <Play className="w-3.5 h-3.5" /> Check-in
                    </button>
                  )}
                  <button onClick={() => openChecklist(v)} className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl flex items-center gap-1">
                    <ListChecks className="w-3.5 h-3.5" /> Checklist & Detalhes
                  </button>
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

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <PhotoInput label="Foto da Visita" onFileSelect={setVisitPhoto} />
                {visitPhoto && (
                  <button onClick={handleUploadVisitPhoto} className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> Enviar Foto para Visita
                  </button>
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
    </div>
  );
};
