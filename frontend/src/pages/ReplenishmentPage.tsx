import React, { useEffect, useMemo, useState } from 'react';
import { Barcode, PackagePlus, Sparkles, Send, FileText, Copy, CheckSquare, Search } from 'lucide-react';
import { apiFetch } from '../services/api';
import { exportToPDF } from '../services/exportUtils';
import { useAuth } from '../context/AuthContext';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

export const ReplenishmentPage: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Quick multi-select checklist for Telegram text / PDF
  const [quickStoreId, setQuickStoreId] = useState('');
  const [quickStatus, setQuickStatus] = useState('Produtos Presentes na Gôndola');
  const [quickSearch, setQuickSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [quickNotes, setQuickNotes] = useState('');
  const [sendingTelegram, setSendingTelegram] = useState(false);

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
    if (s.length) {
      setForm((f) => ({ ...f, store_id: f.store_id || String(s[0].id) }));
      setQuickStoreId((prev) => prev || String(s[0].id));
    }
    if (p.length && !form.product_id) setForm((f) => ({ ...f, product_id: String(p[0].id) }));
  };

  useEffect(() => { load(); }, []);

  const filteredProducts = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand_name || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [products, quickSearch]);

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.includes(p.id)),
    [products, selectedIds]
  );

  const selectedStoreName = useMemo(
    () => stores.find((s) => String(s.id) === quickStoreId)?.name || 'Loja não selecionada',
    [stores, quickStoreId]
  );

  const simpleTextReport = useMemo(() => {
    const lines = [
      'MERCHANDISING PRO — Conferência de Produtos',
      `Loja: ${selectedStoreName}`,
      `Situação: ${quickStatus}`,
      `Promotor: ${user?.name || 'Promotor'}`,
      `Data/Hora: ${new Date().toLocaleString('pt-BR')}`,
      '',
      `Produtos selecionados (${selectedProducts.length}):`,
      ...selectedProducts.map((p, i) => `${i + 1}. ${p.name}${p.brand_name ? ` (${p.brand_name})` : ''}`),
    ];
    if (quickNotes.trim()) {
      lines.push('', `Observações: ${quickNotes.trim()}`);
    }
    return lines.join('\n');
  }, [selectedStoreName, quickStatus, user?.name, selectedProducts, quickNotes]);

  const toggleProduct = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSendTelegramText = async () => {
    if (selectedProducts.length === 0) {
      alert('Selecione pelo menos um produto da lista.');
      return;
    }
    setSendingTelegram(true);
    try {
      await apiFetch('/telegram/send-message', {
        method: 'POST',
        body: JSON.stringify({ text: simpleTextReport }),
      });
      alert('Lista de produtos enviada para o Telegram!');
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar para o Telegram.');
    } finally {
      setSendingTelegram(false);
    }
  };

  const handleExportSelectedPDF = () => {
    if (selectedProducts.length === 0) {
      alert('Selecione pelo menos um produto para gerar o PDF.');
      return;
    }
    const pdfRows = selectedProducts.map((p, idx) => ({
      '#': idx + 1,
      SKU: p.sku,
      Marca: p.brand_name || '-',
      Produto: p.name,
      Categoria: p.category,
      Situação: quickStatus,
      Loja: selectedStoreName,
    }));
    exportToPDF(pdfRows, `${quickStatus} — ${selectedStoreName}`, 'conferencia_produtos');
  };

  const handleCopyText = async () => {
    await navigator.clipboard.writeText(simpleTextReport);
    alert('Texto copiado para a área de transferência!');
  };

  const handleBarcode = (ean: string) => {
    const found = products.find((p) => p.ean === ean);
    if (found) {
      setForm((f) => ({ ...f, product_id: String(found.id) }));
      if (!selectedIds.includes(found.id)) setSelectedIds((prev) => [...prev, found.id]);
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
          <h1 className="text-xl font-extrabold text-slate-900">Abastecimento e Conferência de Produtos</h1>
          <p className="text-sm text-slate-500">Selecione os produtos presentes/em falta para enviar ao Telegram ou gerar PDF, e registre o abastecimento</p>
        </div>
        <button onClick={() => setScannerOpen(true)} className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-xl flex items-center gap-2">
          <Barcode className="w-4 h-4" /> Ler Código de Barras
        </button>
      </div>

      {/* Quick Product Selection -> Telegram Text or PDF */}
      <div className="bg-white p-5 rounded-2xl border border-blue-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-blue-600" /> Seleção Rápida de Produtos (Telegram / PDF)
          </div>
          <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">
            {selectedIds.length} selecionado(s)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={quickStoreId} onChange={(e) => setQuickStoreId(e.target.value)} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={quickStatus} onChange={(e) => setQuickStatus(e.target.value)} className="px-3 py-2 border rounded-xl text-sm">
            {[
              'Produtos Presentes na Gôndola',
              'Produtos Abastecidos',
              'Produtos em Ruptura (Falta)',
              'Produtos com Baixo Estoque',
              'Produtos Sem Preço',
            ].map((st) => <option key={st}>{st}</option>)}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              placeholder="Filtrar produto ou marca..."
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm"
            />
          </div>
        </div>

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSelectedIds(filteredProducts.map((p) => p.id))}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700"
          >
            Selecionar Filtrados ({filteredProducts.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700"
          >
            Limpar Seleção
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1">
          {filteredProducts.map((p) => {
            const checked = selectedIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer text-xs transition ${
                  checked ? 'bg-blue-50 border-blue-400 text-blue-950 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleProduct(p.id)}
                  className="w-4 h-4 accent-blue-600 rounded shrink-0"
                />
                <div className="min-w-0">
                  <div className="truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.brand_name} • {p.category}</div>
                </div>
              </label>
            );
          })}
        </div>

        <input
          placeholder="Observações extras para o relatório (opcional)..."
          value={quickNotes}
          onChange={(e) => setQuickNotes(e.target.value)}
          className="w-full px-3 py-2 border rounded-xl text-sm"
        />

        {selectedProducts.length > 0 && (
          <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 text-xs whitespace-pre-wrap font-mono max-h-44 overflow-y-auto">
            {simpleTextReport}
          </pre>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={sendingTelegram}
            onClick={handleSendTelegramText}
            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl flex items-center gap-2 disabled:opacity-60"
          >
            <Send className="w-4 h-4" /> {sendingTelegram ? 'Enviando...' : 'Enviar Texto para o Telegram'}
          </button>
          <button
            type="button"
            onClick={handleExportSelectedPDF}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl flex items-center gap-2"
          >
            <FileText className="w-4 h-4" /> Gerar PDF
          </button>
          <button
            type="button"
            onClick={handleCopyText}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-xl flex items-center gap-2"
          >
            <Copy className="w-4 h-4" /> Copiar Texto
          </button>
        </div>
      </div>

      {/* Detailed Replenishment Form */}
      <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
          <PackagePlus className="w-4 h-4 text-blue-600" /> Registrar Abastecimento Individual no PDV
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
