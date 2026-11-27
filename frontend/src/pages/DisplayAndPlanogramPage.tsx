import React, { useEffect, useState } from 'react';
import { Layers, Grid3X3, Sparkles } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useToast } from '../context/ToastContext';
import { PhotoInput } from '../components/PhotoInput';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

export const DisplayAndPlanogramPage: React.FC<{ mode: 'exposicao' | 'pontos-extras' | 'planogramas' }> = ({ mode }) => {
  const { toast } = useToast();
  const [displays, setDisplays] = useState<any[]>([]);
  const [planograms, setPlanograms] = useState<{ rows: any[]; indicators: any }>({ rows: [], indicators: { byBrand: [], byCategory: [], byStore: [] } });
  const [stores, setStores] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [products, setProducts] = useState<CachedProduct[]>([]);

  const [photoBefore, setPhotoBefore] = useState<File | null>(null);
  const [photoAfter, setPhotoAfter] = useState<File | null>(null);
  const [displayForm, setDisplayForm] = useState({
    store_id: '',
    category: 'Salgadinhos',
    brand_id: '',
    exposure_type: mode === 'pontos-extras' ? 'Ponto Extra' : 'Gôndola',
    facings_actual: '6',
    facings_expected: '6',
    planogram_compliant: true,
    pos_materials: 'Faixa de gôndola, Stopper',
    notes: '',
  });

  const [planForm, setPlanForm] = useState({
    store_id: '',
    category: 'Salgadinhos',
    brand_id: '',
    product_id: '',
    ideal_facings: '6',
    actual_facings: '5',
    total_category_facings: '20',
    competitor_facings: '12',
    position_level: 'Olhos',
    notes: '',
  });

  const load = async () => {
    const [d, pl, s, b, pr] = await Promise.all([
      apiFetch('/displays'),
      apiFetch('/planograms'),
      apiFetch('/stores'),
      apiFetch('/brands'),
      loadProductsWithDeviceCache(false),
    ]);
    setDisplays(d);
    setPlanograms(pl);
    setStores(s);
    setBrands(b);
    setProducts(pr);
    if (s.length) {
      setDisplayForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
      setPlanForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
    }
    if (b.length) {
      setDisplayForm((f) => ({ ...f, brand_id: f.brand_id || String(b[0].id) }));
      setPlanForm((f) => ({ ...f, brand_id: f.brand_id || String(b[0].id) }));
    }
    if (pr.length) {
      setPlanForm((f) => ({ ...f, product_id: f.product_id || String(pr[0].id) }));
    }
  };

  useEffect(() => {
    setDisplayForm((f) => ({ ...f, exposure_type: mode === 'pontos-extras' ? 'Ponto Extra' : 'Gôndola' }));
    load();
  }, [mode]);

  const submitDisplay = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(displayForm).forEach(([k, v]) => fd.append(k, String(v)));
      if (photoBefore) fd.append('photo_before', photoBefore);
      if (photoAfter) fd.append('photo_after', photoAfter);
      const res = await apiFetch<any>('/displays', { method: 'POST', body: fd });
      setPhotoBefore(null);
      setPhotoAfter(null);
      setDisplayForm((f) => ({ ...f, notes: '' }));
      toast('ok', res?.offlineQueued ? 'Exposição salva na fila offline!' : 'Exposição registrada com sucesso!');
      if (!res?.offlineQueued) void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar exposição.');
    }
  };

  const submitPlanogram = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<any>('/planograms', {
        method: 'POST',
        body: JSON.stringify({
          ...planForm,
          store_id: Number(planForm.store_id),
          brand_id: Number(planForm.brand_id),
          product_id: Number(planForm.product_id),
          ideal_facings: Number(planForm.ideal_facings),
          actual_facings: Number(planForm.actual_facings),
          total_category_facings: Number(planForm.total_category_facings),
          competitor_facings: Number(planForm.competitor_facings),
        }),
      });
      toast('ok', res?.offlineQueued ? 'Auditoria salva na fila offline!' : 'Auditoria de planograma registrada!');
      if (!res?.offlineQueued) void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar planograma.');
    }
  };

  if (mode === 'planogramas') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Planogramas & Share of Shelf</h1>
          <p className="text-sm text-slate-500">Avaliação de frentes, espaços perdidos, comparação com concorrentes e participação na gôndola</p>
        </div>

        {/* Share Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="font-bold text-sm text-slate-800">Share por Marca</div>
            {planograms.indicators.byBrand.map((b: any, i: number) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                <span className="font-medium">{b.brand_name}</span>
                <span className="font-bold text-blue-600">{b.avg_share}% ({b.total_facings} frentes)</span>
              </div>
            ))}
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="font-bold text-sm text-slate-800">Share por Categoria</div>
            {planograms.indicators.byCategory.map((c: any, i: number) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                <span className="font-medium">{c.category}</span>
                <span className="font-bold text-emerald-600">{c.avg_share}%</span>
              </div>
            ))}
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="font-bold text-sm text-slate-800">Share & Aderência por Loja</div>
            {planograms.indicators.byStore.map((s: any, i: number) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                <span className="font-medium truncate">{s.store_name}</span>
                <span className="font-bold text-indigo-600">{s.avg_share}% ({s.compliance_pct}% ok)</span>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submitPlanogram} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-blue-600" /> Auditar Planograma & Share of Shelf
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <select value={planForm.store_id} onChange={(e) => setPlanForm({ ...planForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={planForm.brand_id} onChange={(e) => setPlanForm({ ...planForm, brand_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={planForm.product_id} onChange={(e) => setPlanForm({ ...planForm, product_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input placeholder="Categoria" value={planForm.category} onChange={(e) => setPlanForm({ ...planForm, category: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <select value={planForm.position_level} onChange={(e) => setPlanForm({ ...planForm, position_level: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {['Olhos', 'Mãos', 'Superior', 'Inferior'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className="text-xs text-slate-500">Frentes Ideais</label><input type="number" value={planForm.ideal_facings} onChange={(e) => setPlanForm({ ...planForm, ideal_facings: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
            <div><label className="text-xs text-slate-500">Frentes Reais</label><input type="number" value={planForm.actual_facings} onChange={(e) => setPlanForm({ ...planForm, actual_facings: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
            <div><label className="text-xs text-slate-500">Total Frentes Categ.</label><input type="number" value={planForm.total_category_facings} onChange={(e) => setPlanForm({ ...planForm, total_category_facings: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
            <div><label className="text-xs text-slate-500">Frentes Concorrente</label><input type="number" value={planForm.competitor_facings} onChange={(e) => setPlanForm({ ...planForm, competitor_facings: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
          </div>
          <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">Calcular & Registrar Auditoria</button>
        </form>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
              <tr>
                <th className="px-4 py-3">Loja</th>
                <th className="px-4 py-3">Categoria / Marca</th>
                <th className="px-4 py-3">Posição</th>
                <th className="px-4 py-3">Frentes (Real/Ideal)</th>
                <th className="px-4 py-3">Espaços Perdidos</th>
                <th className="px-4 py-3">Share of Shelf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {planograms.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium">{r.store_name}</td>
                  <td className="px-4 py-3">{r.category} • {r.brand_name}</td>
                  <td className="px-4 py-3">{r.position_level}</td>
                  <td className="px-4 py-3 font-bold">{r.actual_facings} / {r.ideal_facings}</td>
                  <td className="px-4 py-3 text-red-600 font-bold">{r.lost_spaces}</td>
                  <td className="px-4 py-3 font-extrabold text-blue-600">{r.share_of_shelf}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const filteredDisplays = mode === 'pontos-extras'
    ? displays.filter((d) => ['Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola', 'Checkout'].includes(d.exposure_type))
    : displays;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">
          {mode === 'pontos-extras' ? 'Pontos Extras, Ilhas, Displays & Checkouts' : 'Organização e Exposição de Gôndolas'}
        </h1>
        <p className="text-sm text-slate-500">Padronização visual, controle de frentes, materiais de merchandising e fotos antes/depois</p>
      </div>

      <form onSubmit={submitDisplay} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          {mode === 'pontos-extras' ? <Sparkles className="w-4 h-4 text-purple-600" /> : <Layers className="w-4 h-4 text-blue-600" />}
          Registrar Execução Visual (Antes e Depois)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select value={displayForm.store_id} onChange={(e) => setDisplayForm({ ...displayForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={displayForm.exposure_type} onChange={(e) => setDisplayForm({ ...displayForm, exposure_type: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {['Gôndola', 'Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola', 'Checkout'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input placeholder="Categoria" value={displayForm.category} onChange={(e) => setDisplayForm({ ...displayForm, category: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <select value={displayForm.brand_id} onChange={(e) => setDisplayForm({ ...displayForm, brand_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="text-xs text-slate-500">Frentes Reais</label><input type="number" value={displayForm.facings_actual} onChange={(e) => setDisplayForm({ ...displayForm, facings_actual: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
          <div><label className="text-xs text-slate-500">Frentes Esperadas</label><input type="number" value={displayForm.facings_expected} onChange={(e) => setDisplayForm({ ...displayForm, facings_expected: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
          <div><label className="text-xs text-slate-500">Materiais de PDV</label><input value={displayForm.pos_materials} onChange={(e) => setDisplayForm({ ...displayForm, pos_materials: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PhotoInput label="Foto ANTES da execução" file={photoBefore} onFileSelect={setPhotoBefore} />
          <PhotoInput label="Foto DEPOIS da execução" file={photoAfter} onFileSelect={setPhotoAfter} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={displayForm.planogram_compliant} onChange={(e) => setDisplayForm({ ...displayForm, planogram_compliant: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            Execução dentro do padrão esperado
          </label>
          <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">Salvar Exposição</button>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredDisplays.map((d) => (
          <div key={d.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-slate-900">{d.exposure_type} — {d.store_name}</div>
                <div className="text-xs text-slate-500">{d.category} • {d.brand_name} • Materiais: {d.pos_materials || '-'}</div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${d.planogram_compliant ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {d.facings_actual}/{d.facings_expected} frentes
              </span>
            </div>
            {(d.photo_before || d.photo_after) && (
              <div className="flex gap-3 pt-2">
                {d.photo_before && <img src={d.photo_before} alt="Antes" className="h-24 w-32 object-cover rounded-xl border" />}
                {d.photo_after && <img src={d.photo_after} alt="Depois" className="h-24 w-32 object-cover rounded-xl border" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
