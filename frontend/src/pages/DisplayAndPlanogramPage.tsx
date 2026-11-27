import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Grid3X3, Sparkles } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useToast } from '../context/ToastContext';
import { PhotoInput } from '../components/PhotoInput';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

export const DisplayAndPlanogramPage: React.FC<{ mode: 'exposicao' | 'pontos-extras' | 'planogramas' }> = ({ mode }) => {
  const { toast } = useToast();
  const [displays, setDisplays] = useState<any[]>([]);
  const [planograms, setPlanograms] = useState<{ rows: any[]; indicators: any }>({
    rows: [],
    indicators: { byBrand: [], byCategory: [], byStore: [] },
  });
  const [stores, setStores] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [products, setProducts] = useState<CachedProduct[]>([]);

  const [photoBefore, setPhotoBefore] = useState<File | null>(null);
  const [photoAfter, setPhotoAfter] = useState<File | null>(null);
  const [displayForm, setDisplayForm] = useState({
    store_id: '',
    category: 'Todos',
    brand_id: '',
    product_id: '',
    exposure_type: mode === 'pontos-extras' ? 'Ponto Extra' : 'Gôndola',
    facings_actual: '6',
    facings_expected: '6',
    planogram_compliant: true,
    pos_materials: 'Faixa de gôndola, Stopper',
    notes: '',
  });

  const [planForm, setPlanForm] = useState({
    store_id: '',
    category: 'Todos',
    brand_id: '',
    product_id: '',
    ideal_facings: '6',
    actual_facings: '5',
    total_category_facings: '20',
    competitor_facings: '12',
    position_level: 'Olhos',
    notes: '',
  });

  const load = useCallback(async () => {
    try {
      const [d, pl, s, b, pr] = await Promise.all([
        apiFetch('/displays'),
        apiFetch('/planograms'),
        apiFetch('/stores'),
        apiFetch('/brands'),
        loadProductsWithDeviceCache(false),
      ]);
      setDisplays(Array.isArray(d) ? d : []);
      setPlanograms(pl || { rows: [], indicators: { byBrand: [], byCategory: [], byStore: [] } });
      setStores(Array.isArray(s) ? s : []);
      setBrands(Array.isArray(b) ? b : []);
      setProducts(Array.isArray(pr) ? pr : []);
      if (Array.isArray(s) && s.length) {
        setDisplayForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
        setPlanForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
      }
    } catch (err: any) {
      toast('err', err.message || 'Erro ao carregar exposições e planogramas.');
    }
  }, [toast]);

  useEffect(() => {
    setDisplayForm((f) => ({ ...f, exposure_type: mode === 'pontos-extras' ? 'Ponto Extra' : 'Gôndola' }));
    void load();
  }, [mode, load]);

  // Todas as categorias reais do catálogo (sempre com "Todos" no topo)
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return ['Todos', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  // Filtra marcas pertencentes à categoria escolhida
  const getBrandsForCategory = useCallback(
    (category: string) => {
      if (!category || category === 'Todos') return brands;
      const validBrandIds = new Set(
        products.filter((p) => (p.category || '') === category && p.brand_id).map((p) => Number(p.brand_id))
      );
      return brands.filter((b) => validBrandIds.has(Number(b.id)));
    },
    [brands, products]
  );

  // Filtra produtos pertencentes à categoria + marca escolhidas
  const getProductsForSelection = useCallback(
    (category: string, brandId: string) => {
      return products.filter((p) => {
        if (category && category !== 'Todos' && (p.category || '') !== category) return false;
        if (brandId && Number(p.brand_id) !== Number(brandId)) return false;
        return true;
      });
    },
    [products]
  );

  const displayBrands = useMemo(
    () => getBrandsForCategory(displayForm.category),
    [getBrandsForCategory, displayForm.category]
  );
  const displayProducts = useMemo(
    () => getProductsForSelection(displayForm.category, displayForm.brand_id),
    [getProductsForSelection, displayForm.category, displayForm.brand_id]
  );

  const planBrands = useMemo(
    () => getBrandsForCategory(planForm.category),
    [getBrandsForCategory, planForm.category]
  );
  const planProducts = useMemo(
    () => getProductsForSelection(planForm.category, planForm.brand_id),
    [getProductsForSelection, planForm.category, planForm.brand_id]
  );

  const submitDisplay = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(displayForm).forEach(([k, v]) => {
        if ((k === 'brand_id' || k === 'product_id') && !v) return;
        fd.append(k, String(v));
      });
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
          brand_id: planForm.brand_id ? Number(planForm.brand_id) : null,
          product_id: planForm.product_id ? Number(planForm.product_id) : null,
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
          <h1 className="font-display text-xl font-extrabold text-slate-900">Planogramas & Share of Shelf</h1>
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

        <form onSubmit={submitPlanogram} className="bg-white p-5 rounded-3xl border border-slate-200 space-y-3 shadow-xs">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-blue-600" /> Auditar Planograma & Share of Shelf
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500">Loja</label>
              <select value={planForm.store_id} onChange={(e) => setPlanForm({ ...planForm, store_id: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500">Categoria</label>
              <select
                value={planForm.category}
                onChange={(e) => setPlanForm({ ...planForm, category: e.target.value, brand_id: '', product_id: '' })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c === 'Todos' ? 'Todos (Todas as Categorias)' : c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500">Marca</label>
              <select
                value={planForm.brand_id}
                onChange={(e) => setPlanForm({ ...planForm, brand_id: e.target.value, product_id: '' })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
              >
                <option value="">Todos ({planBrands.length} marca{planBrands.length !== 1 ? 's' : ''})</option>
                {planBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500">Item / Produto</label>
              <select
                value={planForm.product_id}
                onChange={(e) => setPlanForm({ ...planForm, product_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
              >
                <option value="">Todos ({planProducts.length} ite{planProducts.length !== 1 ? 'ns' : 'm'})</option>
                {planProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.weight && !p.name.toLowerCase().includes(p.weight.toLowerCase().replace(/\s+/g, '')) ? ` (${p.weight})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500">Nível</label>
              <select value={planForm.position_level} onChange={(e) => setPlanForm({ ...planForm, position_level: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
                {['Olhos', 'Mãos', 'Superior', 'Inferior'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className="text-xs text-slate-500">Frentes Ideais</label><input type="number" value={planForm.ideal_facings} onChange={(e) => setPlanForm({ ...planForm, ideal_facings: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
            <div><label className="text-xs text-slate-500">Frentes Reais</label><input type="number" value={planForm.actual_facings} onChange={(e) => setPlanForm({ ...planForm, actual_facings: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
            <div><label className="text-xs text-slate-500">Total Frentes Categ.</label><input type="number" value={planForm.total_category_facings} onChange={(e) => setPlanForm({ ...planForm, total_category_facings: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
            <div><label className="text-xs text-slate-500">Frentes Concorrente</label><input type="number" value={planForm.competitor_facings} onChange={(e) => setPlanForm({ ...planForm, competitor_facings: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
          </div>
          <button type="submit" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">Calcular & Registrar Auditoria</button>
        </form>

        <div className="bg-white rounded-3xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
              <tr>
                <th className="px-4 py-3">Loja</th>
                <th className="px-4 py-3">Categoria / Marca / Item</th>
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
                  <td className="px-4 py-3">
                    {r.category} • {r.brand_name !== '-' ? r.brand_name : 'Todas'}
                    {r.product_name && r.product_name !== '-' ? ` • ${r.product_name}` : ''}
                  </td>
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
        <h1 className="font-display text-xl font-extrabold text-slate-900">
          {mode === 'pontos-extras' ? 'Pontos Extras, Ilhas, Displays & Checkouts' : 'Organização e Exposição de Gôndolas'}
        </h1>
        <p className="text-sm text-slate-500">Padronização visual, controle de frentes, materiais de merchandising e fotos antes/depois</p>
      </div>

      <form onSubmit={submitDisplay} className="bg-white p-5 rounded-3xl border border-slate-200 space-y-4 shadow-xs">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          {mode === 'pontos-extras' ? <Sparkles className="w-4 h-4 text-purple-600" /> : <Layers className="w-4 h-4 text-blue-600" />}
          Registrar Execução Visual (Antes e Depois)
        </div>

        {/* Loja + Tipo de Exposição */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-500">Loja / PDV</label>
            <select
              value={displayForm.store_id}
              onChange={(e) => setDisplayForm({ ...displayForm, store_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
            >
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500">Tipo de Exposição</label>
            <select
              value={displayForm.exposure_type}
              onChange={(e) => setDisplayForm({ ...displayForm, exposure_type: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
            >
              {['Gôndola', 'Corredor Principal', 'Ponta de Gôndola', 'Ilha Promocional', 'Ponto Extra', 'Display', 'Checkout'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Seleção em Cascata: Categoria -> Marca (Todos) -> Item/Produto (Todos) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-2xl bg-slate-50/80 border border-slate-200/80">
          <div>
            <label className="text-[11px] font-bold text-slate-600">1. Categoria</label>
            <select
              value={displayForm.category}
              onChange={(e) =>
                setDisplayForm({
                  ...displayForm,
                  category: e.target.value,
                  brand_id: '',
                  product_id: '',
                })
              }
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white font-semibold"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'Todos' ? 'Todos (Todas as Categorias)' : cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600">2. Marca da Categoria</label>
            <select
              value={displayForm.brand_id}
              onChange={(e) =>
                setDisplayForm({
                  ...displayForm,
                  brand_id: e.target.value,
                  product_id: '',
                })
              }
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white font-semibold"
            >
              <option value="">Todos ({displayBrands.length} marca{displayBrands.length !== 1 ? 's' : ''})</option>
              {displayBrands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600">3. Item / Produto</label>
            <select
              value={displayForm.product_id}
              onChange={(e) => setDisplayForm({ ...displayForm, product_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white font-semibold"
            >
              <option value="">Todos ({displayProducts.length} ite{displayProducts.length !== 1 ? 'ns' : 'm'})</option>
              {displayProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.weight && !p.name.toLowerCase().includes(p.weight.toLowerCase().replace(/\s+/g, '')) ? ` (${p.weight})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="text-xs text-slate-500">Frentes Reais</label><input type="number" value={displayForm.facings_actual} onChange={(e) => setDisplayForm({ ...displayForm, facings_actual: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
          <div><label className="text-xs text-slate-500">Frentes Esperadas</label><input type="number" value={displayForm.facings_expected} onChange={(e) => setDisplayForm({ ...displayForm, facings_expected: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
          <div><label className="text-xs text-slate-500">Materiais de PDV</label><input value={displayForm.pos_materials} onChange={(e) => setDisplayForm({ ...displayForm, pos_materials: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
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
          <button type="submit" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">Salvar Exposição</button>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredDisplays.map((d) => (
          <div key={d.id} className="bg-white p-4 rounded-3xl border border-slate-200 space-y-2 shadow-xs">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-bold text-slate-900">{d.exposure_type} — {d.store_name}</div>
                <div className="text-xs text-slate-500">
                  {d.category} › {d.brand_name || 'Todas'}
                  {d.product_name && d.product_name !== 'Todos' ? ` › ${d.product_name}` : ' › Todos'}
                  {d.pos_materials ? ` • Materiais: ${d.pos_materials}` : ''}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${d.planogram_compliant ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
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
