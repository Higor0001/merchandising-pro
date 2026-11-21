import React, { useEffect, useState } from 'react';
import { CalendarClock, Boxes } from 'lucide-react';
import { apiFetch } from '../services/api';

export const ExpiryAndInventoryPage: React.FC<{ mode: 'validades' | 'estoque' }> = ({ mode }) => {
  const [expiries, setExpiries] = useState<any[]>([]);
  const [inventory, setInventory] = useState<{ stock: any[]; movements: any[] }>({ stock: [], movements: [] });
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [expForm, setExpForm] = useState({
    store_id: '',
    product_id: '',
    batch_code: '',
    expiry_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    quantity: '10',
    fifo_fefo_applied: true,
    condition: 'Normal',
    removal_requested: false,
    estimated_loss: '0',
    notes: '',
  });

  const [movForm, setMovForm] = useState({
    store_id: '',
    product_id: '',
    movement_type: 'Separação Merchandising',
    quantity: '10',
    notes: '',
  });

  const load = async () => {
    const [ex, inv, s, p] = await Promise.all([
      apiFetch('/expiries'),
      apiFetch('/inventory'),
      apiFetch('/stores'),
      apiFetch('/products'),
    ]);
    setExpiries(ex);
    setInventory(inv);
    setStores(s);
    setProducts(p);
    if (s.length) {
      setExpForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
      setMovForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
    }
    if (p.length) {
      setExpForm((f) => ({ ...f, product_id: f.product_id || String(p[0].id) }));
      setMovForm((f) => ({ ...f, product_id: f.product_id || String(p[0].id) }));
    }
  };

  useEffect(() => { load(); }, []);

  const submitExpiry = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/expiries', {
      method: 'POST',
      body: JSON.stringify({
        ...expForm,
        store_id: Number(expForm.store_id),
        product_id: Number(expForm.product_id),
        quantity: Number(expForm.quantity),
        estimated_loss: Number(expForm.estimated_loss),
      }),
    });
    setExpForm((f) => ({ ...f, batch_code: '', notes: '' }));
    load();
  };

  const submitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/inventory/movement', {
      method: 'POST',
      body: JSON.stringify({
        ...movForm,
        store_id: Number(movForm.store_id),
        product_id: Number(movForm.product_id),
        quantity: Number(movForm.quantity),
      }),
    });
    setMovForm((f) => ({ ...f, notes: '' }));
    load();
  };

  if (mode === 'validades') {
    const totalLoss = expiries.reduce((acc, r) => acc + Number(r.estimated_loss || 0), 0);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Controle de Validade e Qualidade (FIFO / FEFO)</h1>
            <p className="text-sm text-slate-500">Vencimentos próximos, avarias, retirada de impróprios e perdas</p>
          </div>
          <div className="px-4 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700">
            Perdas Estimadas Registradas: R$ {totalLoss.toFixed(2)}
          </div>
        </div>

        <form onSubmit={submitExpiry} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-rose-600" /> Conferir Validade / Avaria
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <select value={expForm.store_id} onChange={(e) => setExpForm({ ...expForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={expForm.product_id} onChange={(e) => setExpForm({ ...expForm, product_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input placeholder="Lote" value={expForm.batch_code} onChange={(e) => setExpForm({ ...expForm, batch_code: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <input type="date" required value={expForm.expiry_date} onChange={(e) => setExpForm({ ...expForm, expiry_date: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input type="number" placeholder="Quantidade" value={expForm.quantity} onChange={(e) => setExpForm({ ...expForm, quantity: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <select value={expForm.condition} onChange={(e) => setExpForm({ ...expForm, condition: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {['Normal', 'Próximo Vencimento', 'Vencido', 'Embalagem Danificada', 'Avaria'].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input type="number" step="0.01" placeholder="Perda Estimada (R$)" value={expForm.estimated_loss} onChange={(e) => setExpForm({ ...expForm, estimated_loss: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <label className="flex items-center gap-2 text-xs font-medium px-2">
              <input type="checkbox" checked={expForm.fifo_fefo_applied} onChange={(e) => setExpForm({ ...expForm, fifo_fefo_applied: e.target.checked })} className="accent-blue-600" />
              FIFO / FEFO aplicado
            </label>
          </div>
          <div className="flex flex-wrap justify-between items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-red-700">
              <input type="checkbox" checked={expForm.removal_requested} onChange={(e) => setExpForm({ ...expForm, removal_requested: e.target.checked })} className="accent-red-600" />
              Solicitar retirada de produto impróprio
            </label>
            <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">Salvar Conferência</button>
          </div>
        </form>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
              <tr>
                <th className="px-4 py-3">Validade</th>
                <th className="px-4 py-3">Loja</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Qtd / Lote</th>
                <th className="px-4 py-3">Condição</th>
                <th className="px-4 py-3">FIFO/FEFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expiries.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 font-bold">{e.expiry_date}</td>
                  <td className="px-4 py-3">{e.store_name}</td>
                  <td className="px-4 py-3">{e.product_name}</td>
                  <td className="px-4 py-3">{e.quantity} un ({e.batch_code || '-'})</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      e.condition === 'Normal' ? 'bg-emerald-100 text-emerald-700' :
                      e.condition === 'Próximo Vencimento' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                    }`}>{e.condition}</span>
                  </td>
                  <td className="px-4 py-3">{e.fifo_fefo_applied ? 'Sim' : 'Não'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Estoque de Apoio ao Merchandising</h1>
        <p className="text-sm text-slate-500">Disponibilidade na loja/retaguarda, separação para abastecimento e histórico de movimentações</p>
      </div>

      <form onSubmit={submitMovement} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          <Boxes className="w-4 h-4 text-blue-600" /> Movimentação / Separação para Merchandising
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select value={movForm.store_id} onChange={(e) => setMovForm({ ...movForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={movForm.product_id} onChange={(e) => setMovForm({ ...movForm, product_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={movForm.movement_type} onChange={(e) => setMovForm({ ...movForm, movement_type: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {['Separação Merchandising', 'Entrada', 'Saída', 'Ajuste Inventário'].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input type="number" min="1" value={movForm.quantity} onChange={(e) => setMovForm({ ...movForm, quantity: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" placeholder="Quantidade" />
        </div>
        <div className="flex gap-2">
          <input placeholder="Observação (ex: Separação para ilha promocional)" value={movForm.notes} onChange={(e) => setMovForm({ ...movForm, notes: e.target.value })} className="flex-1 px-3 py-2 border rounded-xl text-sm" />
          <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">Registrar</button>
        </div>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
            <tr>
              <th className="px-4 py-3">Loja</th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Gôndola</th>
              <th className="px-4 py-3">Retaguarda</th>
              <th className="px-4 py-3">Separado Merch.</th>
              <th className="px-4 py-3">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.stock.map((s) => {
              const total = s.gondola_qty + s.backroom_qty;
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.store_name}</td>
                  <td className="px-4 py-3">{s.product_name}</td>
                  <td className="px-4 py-3">{s.gondola_qty}</td>
                  <td className="px-4 py-3">{s.backroom_qty}</td>
                  <td className="px-4 py-3 font-bold text-indigo-600">{s.separated_for_merchandising}</td>
                  <td className="px-4 py-3">
                    {total === 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Em Falta</span>
                    ) : total < s.min_stock ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Baixo Estoque</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Adequado</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
