import React, { useEffect, useState } from 'react';
import { Tag, TrendingUp } from 'lucide-react';
import { apiFetch } from '../services/api';
import { PhotoInput } from '../components/PhotoInput';
import { ProductSelectorWithSi5 } from '../components/ProductSelectorWithSi5';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

export const PricingAndCompetitorsPage: React.FC<{ mode: 'precificacao' | 'concorrencia' }> = ({ mode }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [form, setForm] = useState({
    store_id: '',
    product_id: '',
    gondola_price: '',
    promo_price: '',
    has_price_tag: true,
    competitor_name: '',
    competitor_price: '',
    notes: '',
  });

  const load = async () => {
    const [r, s, p] = await Promise.all([apiFetch('/prices'), apiFetch('/stores'), loadProductsWithDeviceCache(false)]);
    setRows(r);
    setStores(s);
    setProducts(p);
    if (s.length && !form.store_id) setForm((f) => ({ ...f, store_id: String(s[0].id) }));
    if (p.length && !form.product_id) setForm((f) => ({ ...f, product_id: String(p[0].id), gondola_price: String(p[0].system_price) }));
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
    if (photo) fd.append('photo', photo);
    await apiFetch('/prices', { method: 'POST', body: fd });
    setPhoto(null);
    setForm((f) => ({ ...f, notes: '' }));
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">
          {mode === 'concorrencia' ? 'Monitoramento de Concorrência & Comparativo' : 'Precificação e Pesquisa de Mercado'}
        </h1>
        <p className="text-sm text-slate-500">Conferência de etiquetas, divergências gôndola vs sistema, promoções, concorrentes e evidências</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          {mode === 'concorrencia' ? <TrendingUp className="w-4 h-4 text-amber-600" /> : <Tag className="w-4 h-4 text-blue-600" />}
          Registrar Pesquisa de Preço
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="flex items-center gap-2 px-3 py-2 border rounded-xl text-sm cursor-pointer">
            <input type="checkbox" checked={form.has_price_tag} onChange={(e) => setForm({ ...form, has_price_tag: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            Possui etiqueta na gôndola
          </label>
        </div>
        <ProductSelectorWithSi5
          products={products}
          value={form.product_id}
          onChange={(pid) => setForm({ ...form, product_id: pid })}
          onCatalogUpdated={setProducts}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input type="number" step="0.01" placeholder="Preço Gôndola (R$)" value={form.gondola_price} onChange={(e) => setForm({ ...form, gondola_price: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input type="number" step="0.01" placeholder="Preço Promocional (R$)" value={form.promo_price} onChange={(e) => setForm({ ...form, promo_price: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input placeholder="Nome do Concorrente" value={form.competitor_name} onChange={(e) => setForm({ ...form, competitor_name: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          <input type="number" step="0.01" placeholder="Preço Concorrente (R$)" value={form.competitor_price} onChange={(e) => setForm({ ...form, competitor_price: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <PhotoInput label="Foto da Etiqueta / Gôndola" onFileSelect={setPhoto} />
          <div className="flex gap-2">
            <input placeholder="Observações..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="flex-1 px-3 py-2 border rounded-xl text-sm" />
            <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">Registrar</button>
          </div>
        </div>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
            <tr>
              <th className="px-4 py-3">Loja</th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Gôndola</th>
              <th className="px-4 py-3">Sistema</th>
              <th className="px-4 py-3">Promo</th>
              <th className="px-4 py-3">Concorrente</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium">{r.store_name}</td>
                <td className="px-4 py-3">{r.product_name}</td>
                <td className="px-4 py-3 font-bold">{r.gondola_price ? `R$ ${Number(r.gondola_price).toFixed(2)}` : 'Sem preço'}</td>
                <td className="px-4 py-3">R$ {Number(r.system_price).toFixed(2)}</td>
                <td className="px-4 py-3 text-emerald-700 font-semibold">{r.promo_price ? `R$ ${Number(r.promo_price).toFixed(2)}` : '-'}</td>
                <td className="px-4 py-3">{r.competitor_name} {r.competitor_price ? `(R$ ${Number(r.competitor_price).toFixed(2)})` : ''}</td>
                <td className="px-4 py-3">
                  {!r.has_price_tag ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Sem Etiqueta</span>
                  ) : r.price_divergent ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Divergente</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Conforme</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
