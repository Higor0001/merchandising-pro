import React, { useEffect, useState } from 'react';
import { Barcode, PackagePlus, Sparkles } from 'lucide-react';
import { apiFetch } from '../services/api';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

export const ReplenishmentPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [form, setForm] = useState({
    store_id: '',
    product_id: '',
    quantity_replenished: '12',
    gondola_stock: '20',
    backroom_stock: '15',
    status: 'Abastecido',
    increase_exposure_opportunity: false,
    notes: '',
  });

  const load = async () => {
    const [r, s, p] = await Promise.all([apiFetch('/replenishments'), apiFetch('/stores'), apiFetch('/products')]);
    setRows(r);
    setStores(s);
    setProducts(p);
    if (s.length && !form.store_id) setForm((f) => ({ ...f, store_id: String(s[0].id) }));
    if (p.length && !form.product_id) setForm((f) => ({ ...f, product_id: String(p[0].id) }));
  };

  useEffect(() => { load(); }, []);

  const handleBarcode = (ean: string) => {
    const found = products.find((p) => p.ean === ean);
    if (found) {
      setForm((f) => ({ ...f, product_id: String(found.id) }));
    } else {
      alert(`Produto com EAN ${ean} não encontrado no catálogo.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/replenishments', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        store_id: Number(form.store_id),
        product_id: Number(form.product_id),
        quantity_replenished: Number(form.quantity_replenished),
        gondola_stock: Number(form.gondola_stock),
        backroom_stock: Number(form.backroom_stock),
      }),
    });
    setForm((f) => ({ ...f, notes: '', increase_exposure_opportunity: false }));
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Abastecimento e Reposição</h1>
          <p className="text-sm text-slate-500">Disponibilidade nas gôndolas, estoque de retaguarda, rupturas e oportunidades</p>
        </div>
        <button onClick={() => setScannerOpen(true)} className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-xl flex items-center gap-2">
          <Barcode className="w-4 h-4" /> Ler Código de Barras
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          <PackagePlus className="w-4 h-4 text-blue-600" /> Registrar Abastecimento no PDV
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.ean})</option>)}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {['Abastecido', 'Ruptura', 'Baixo Estoque', 'Indisponível'].map((st) => <option key={st}>{st}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Qtd Abastecida</label>
            <input type="number" min="0" value={form.quantity_replenished} onChange={(e) => setForm({ ...form, quantity_replenished: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Estoque na Gôndola</label>
            <input type="number" min="0" value={form.gondola_stock} onChange={(e) => setForm({ ...form, gondola_stock: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Estoque Retaguarda</label>
            <input type="number" min="0" value={form.backroom_stock} onChange={(e) => setForm({ ...form, backroom_stock: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={form.increase_exposure_opportunity} onChange={(e) => setForm({ ...form, increase_exposure_opportunity: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            <Sparkles className="w-4 h-4 text-amber-500" /> Oportunidade de aumento de exposição
          </label>
          <input placeholder="Observações..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="flex-1 min-w-[200px] px-3 py-2 border rounded-xl text-sm" />
          <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">Registrar</button>
        </div>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
            <tr>
              <th className="px-4 py-3">Loja</th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Abastecido</th>
              <th className="px-4 py-3">Gôndola</th>
              <th className="px-4 py-3">Retaguarda</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{r.store_name}</td>
                <td className="px-4 py-3">{r.product_name} {r.increase_exposure_opportunity ? <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-bold">+Exposição</span> : null}</td>
                <td className="px-4 py-3 font-bold">{r.quantity_replenished}</td>
                <td className="px-4 py-3">{r.gondola_stock}</td>
                <td className="px-4 py-3">{r.backroom_stock}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    r.status === 'Abastecido' ? 'bg-emerald-100 text-emerald-700' :
                    r.status === 'Ruptura' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BarcodeScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleBarcode} />
    </div>
  );
};
