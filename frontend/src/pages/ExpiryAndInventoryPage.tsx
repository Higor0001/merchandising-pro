import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Boxes, FileDown, FileSpreadsheet, AlertTriangle, PackageX, Store, Filter } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useToast } from '../context/ToastContext';
import { ProductSelectorWithSi5 } from '../components/ProductSelectorWithSi5';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';

const CONDITIONS = ['Normal', 'Próximo Vencimento', 'Vencido', 'Embalagem Danificada', 'Avaria'] as const;

function isItemRemoved(e: any): boolean {
  return Boolean(e?.is_removed || e?.removal_requested === 1 || e?.removal_requested === true || e?.condition === 'Vencido');
}

function formatDateBr(dateStr?: string): string {
  const s = String(dateStr || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || '-';
}

export const ExpiryAndInventoryPage: React.FC<{ mode: 'validades' | 'estoque' }> = ({ mode }) => {
  const { toast } = useToast();
  const [expiries, setExpiries] = useState<any[]>([]);
  const [inventory, setInventory] = useState<{ stock: any[]; movements: any[] }>({ stock: [], movements: [] });
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [filterStoreId, setFilterStoreId] = useState<string>('ALL');
  const [filterCondition, setFilterCondition] = useState<string>('ALL');
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

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
      apiFetch<any[]>('/expiries'),
      apiFetch<{ stock: any[]; movements: any[] }>('/inventory'),
      apiFetch<any[]>('/stores'),
      loadProductsWithDeviceCache(false),
    ]);
    setExpiries(Array.isArray(ex) ? ex : []);
    setInventory(inv || { stock: [], movements: [] });
    setStores(Array.isArray(s) ? s : []);
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

  useEffect(() => {
    void load();
  }, []);

  const filteredExpiries = useMemo(() => {
    return expiries.filter((e) => {
      if (filterStoreId !== 'ALL' && String(e.store_id) !== filterStoreId) return false;
      if (filterCondition === 'REMOVED') return isItemRemoved(e);
      if (filterCondition !== 'ALL' && e.condition !== filterCondition) return false;
      return true;
    });
  }, [expiries, filterStoreId, filterCondition]);

  const removedExpiries = useMemo(() => filteredExpiries.filter(isItemRemoved), [filteredExpiries]);

  const selectedStoreName = useMemo(() => {
    if (filterStoreId === 'ALL') return 'Todas as Lojas';
    return stores.find((s) => String(s.id) === filterStoreId)?.name || 'Loja Selecionada';
  }, [filterStoreId, stores]);

  const selectedFilterLabel = useMemo(() => {
    if (filterCondition === 'ALL') return 'Todas as Condições';
    if (filterCondition === 'REMOVED') return 'Somente Produtos Retirados';
    return filterCondition;
  }, [filterCondition]);

  const handleExportPdf = async () => {
    if (filteredExpiries.length === 0) {
      toast('err', 'Não há registros de validade para exportar neste filtro.');
      return;
    }
    setExporting('pdf');
    try {
      const { exportExpiriesPDF } = await import('../services/exportUtils');
      const ok = exportExpiriesPDF({
        rows: filteredExpiries,
        storeLabel: selectedStoreName,
        filterLabel: selectedFilterLabel,
      });
      if (ok) toast('ok', `PDF de validades e retirados gerado (${selectedStoreName})!`);
    } catch (err: any) {
      toast('err', err?.message || 'Erro ao gerar PDF de validades.');
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async () => {
    if (filteredExpiries.length === 0) {
      toast('err', 'Não há registros de validade para exportar neste filtro.');
      return;
    }
    setExporting('xlsx');
    try {
      const { exportExpiriesExcel } = await import('../services/exportUtils');
      const ok = exportExpiriesExcel({
        rows: filteredExpiries,
        storeLabel: selectedStoreName,
      });
      if (ok) toast('ok', `Tabela Excel de validades e retirados gerada (${selectedStoreName})!`);
    } catch (err: any) {
      toast('err', err?.message || 'Erro ao gerar tabela Excel de validades.');
    } finally {
      setExporting(null);
    }
  };

  const submitExpiry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<any>('/expiries', {
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
      toast('ok', res?.offlineQueued ? 'Conferência salva na fila offline!' : 'Conferência de validade registrada!');
      if (!res?.offlineQueued) void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar conferência de validade.');
    }
  };

  const submitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<any>('/inventory/movement', {
        method: 'POST',
        body: JSON.stringify({
          ...movForm,
          store_id: Number(movForm.store_id),
          product_id: Number(movForm.product_id),
          quantity: Number(movForm.quantity),
        }),
      });
      setMovForm((f) => ({ ...f, notes: '' }));
      toast('ok', res?.offlineQueued ? 'Movimentação salva na fila offline!' : 'Movimentação de estoque registrada!');
      if (!res?.offlineQueued) void load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao registrar movimentação.');
    }
  };

  if (mode === 'validades') {
    const totalLoss = filteredExpiries.reduce((acc, r) => acc + Number(r.estimated_loss || 0), 0);
    const totalCheckedQty = filteredExpiries.reduce((acc, r) => acc + Number(r.quantity || 0), 0);
    const totalRemovedQty = removedExpiries.reduce((acc, r) => acc + Number(r.quantity || 0), 0);
    const nearExpiryCount = filteredExpiries.filter((r) => r.condition === 'Próximo Vencimento').length;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Controle de Validade e Qualidade (FIFO / FEFO)</h1>
            <p className="text-sm text-slate-500">Vencimentos próximos, avarias, produtos retirados por loja e exportação em PDF/Tabela</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exporting !== null || filteredExpiries.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              {exporting === 'pdf' ? 'Gerando PDF...' : 'Baixar PDF (Validades + Retirados)'}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting !== null || filteredExpiries.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {exporting === 'xlsx' ? 'Gerando Tabela...' : 'Baixar Tabela (Excel)'}
            </button>
          </div>
        </div>

        {/* KPIs do Filtro Atual */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Conferidos</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">{filteredExpiries.length}</div>
            <div className="text-xs text-slate-500">{totalCheckedQty} unidades no total</div>
          </div>
          <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
              <PackageX className="w-3.5 h-3.5" /> Produtos Retirados
            </div>
            <div className="mt-1 text-2xl font-extrabold text-rose-700">{totalRemovedQty} un</div>
            <div className="text-xs text-rose-600">{removedExpiries.length} item(ns) retirado(s)</div>
          </div>
          <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Próx. Vencimento
            </div>
            <div className="mt-1 text-2xl font-extrabold text-amber-700">{nearExpiryCount}</div>
            <div className="text-xs text-amber-600">Atenção PVPS / Giro</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Perdas Estimadas</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">R$ {totalLoss.toFixed(2)}</div>
            <div className="text-xs text-slate-500 truncate">{selectedStoreName}</div>
          </div>
        </div>

        {/* Formulário de Conferência */}
        <form onSubmit={submitExpiry} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-rose-600" /> Conferir Validade / Retirada / Avaria
          </div>
          <ProductSelectorWithSi5
            products={products}
            value={expForm.product_id}
            onChange={(pid) => setExpForm({ ...expForm, product_id: pid })}
            onCatalogUpdated={setProducts}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={expForm.store_id} onChange={(e) => setExpForm({ ...expForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input placeholder="Lote" value={expForm.batch_code} onChange={(e) => setExpForm({ ...expForm, batch_code: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <input type="date" required value={expForm.expiry_date} onChange={(e) => setExpForm({ ...expForm, expiry_date: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input type="number" min="1" placeholder="Quantidade" value={expForm.quantity} onChange={(e) => setExpForm({ ...expForm, quantity: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <select
              value={expForm.condition}
              onChange={(e) => {
                const nextCond = e.target.value;
                setExpForm((f) => ({
                  ...f,
                  condition: nextCond,
                  removal_requested: nextCond === 'Vencido' ? true : f.removal_requested,
                }));
              }}
              className="px-3 py-2 border rounded-xl text-sm"
            >
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" step="0.01" min="0" placeholder="Perda Estimada (R$)" value={expForm.estimated_loss} onChange={(e) => setExpForm({ ...expForm, estimated_loss: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            <label className="flex items-center gap-2 text-xs font-medium px-2">
              <input type="checkbox" checked={expForm.fifo_fefo_applied} onChange={(e) => setExpForm({ ...expForm, fifo_fefo_applied: e.target.checked })} className="accent-blue-600" />
              FIFO / FEFO aplicado
            </label>
          </div>
          <input
            placeholder="Observações (ex: Retirado da área de vendas e entregue ao encarregado)"
            value={expForm.notes}
            onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })}
            className="w-full px-3 py-2 border rounded-xl text-sm"
          />
          <div className="flex flex-wrap justify-between items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-red-700">
              <input type="checkbox" checked={expForm.removal_requested} onChange={(e) => setExpForm({ ...expForm, removal_requested: e.target.checked })} className="accent-red-600" />
              Produto retirado / solicitar retirada da área de vendas
            </label>
            <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition cursor-pointer">
              Salvar Conferência
            </button>
          </div>
        </form>

        {/* Barra de Filtros por Loja e Condição */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-blue-600" /> Filtrar Relatório e Tabela:
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <Store className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={filterStoreId}
              onChange={(e) => setFilterStoreId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 font-medium"
            >
              <option value="ALL">Todas as Lojas ({stores.length})</option>
              {stores.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 font-medium min-w-[190px]"
          >
            <option value="ALL">Todas as Condições</option>
            <option value="REMOVED">Somente Produtos Retirados</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Destaque de Produtos Retirados */}
        {removedExpiries.length > 0 && (
          <div className="bg-rose-50/60 rounded-2xl border border-rose-200 overflow-hidden">
            <div className="px-4 py-3 bg-rose-600 text-white flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm flex items-center gap-2">
                <PackageX className="w-4 h-4" />
                Produtos Retirados da Área de Vendas ({removedExpiries.length} registro(s) • {totalRemovedQty} un)
              </div>
              <span className="text-xs font-semibold bg-white/15 px-2.5 py-1 rounded-full">
                {selectedStoreName}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-rose-100/70 text-[11px] uppercase text-rose-800 border-b border-rose-200">
                  <tr>
                    <th className="px-4 py-2.5">Loja</th>
                    <th className="px-4 py-2.5">Produto</th>
                    <th className="px-4 py-2.5">Validade</th>
                    <th className="px-4 py-2.5">Lote</th>
                    <th className="px-4 py-2.5 text-right">Qtd Retirada</th>
                    <th className="px-4 py-2.5">Motivo / Condição</th>
                    <th className="px-4 py-2.5 text-right">Perda Est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-100 bg-white">
                  {removedExpiries.map((e) => (
                    <tr key={`rem-${e.id}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{e.store_name}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{e.product_name}</div>
                        {e.product_weight && <div className="text-[11px] text-slate-500">{e.product_weight}</div>}
                      </td>
                      <td className="px-4 py-2.5 font-bold text-rose-700">{formatDateBr(e.expiry_date)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{e.batch_code || '-'}</td>
                      <td className="px-4 py-2.5 text-right font-extrabold text-rose-700">{e.quantity} un</td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                          {e.condition}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700">R$ {Number(e.estimated_loss || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tabela Completa de Validades */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-sm text-slate-800">
              Tabela de Validades — {selectedStoreName} ({filteredExpiries.length})
            </div>
            <span className="text-xs text-slate-500">Ordenado por data de validade mais próxima</span>
          </div>
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b">
              <tr>
                <th className="px-4 py-3">Validade</th>
                <th className="px-4 py-3">Loja</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Qtd / Lote</th>
                <th className="px-4 py-3">Condição</th>
                <th className="px-4 py-3">Retirado</th>
                <th className="px-4 py-3">Perda (R$)</th>
                <th className="px-4 py-3">FIFO/FEFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpiries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                    Nenhum registro de validade encontrado para o filtro selecionado.
                  </td>
                </tr>
              ) : (
                filteredExpiries.map((e) => {
                  const removed = isItemRemoved(e);
                  return (
                    <tr key={e.id} className={removed ? 'bg-rose-50/30' : ''}>
                      <td className="px-4 py-3 font-bold whitespace-nowrap">{formatDateBr(e.expiry_date)}</td>
                      <td className="px-4 py-3 font-medium">{e.store_name}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{e.product_name}</div>
                        {e.product_weight && <div className="text-[11px] text-slate-500">{e.product_weight}</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{e.quantity} un ({e.batch_code || '-'})</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            e.condition === 'Normal'
                              ? 'bg-emerald-100 text-emerald-700'
                              : e.condition === 'Próximo Vencimento'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {e.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {removed ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                            Sim ({e.quantity} un)
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Não</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">R$ {Number(e.estimated_loss || 0).toFixed(2)}</td>
                      <td className="px-4 py-3">{e.fifo_fefo_applied ? 'Sim' : 'Não'}</td>
                    </tr>
                  );
                })
              )}
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
        <ProductSelectorWithSi5
          products={products}
          value={movForm.product_id}
          onChange={(pid) => setMovForm({ ...movForm, product_id: pid })}
          onCatalogUpdated={setProducts}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={movForm.store_id} onChange={(e) => setMovForm({ ...movForm, store_id: e.target.value })} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
