import React, { useMemo, useState } from 'react';
import { Barcode, Search, Package, RefreshCw } from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import {
  searchOrResolveSi5WithDeviceCache,
  type CachedProduct,
} from '../services/productCatalogCache';

interface ProductSelectorWithSi5Props {
  products: CachedProduct[];
  value: string;
  onChange: (productId: string) => void;
  onCatalogUpdated: (products: CachedProduct[]) => void;
  onNotify?: (type: 'ok' | 'err', msg: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export const ProductSelectorWithSi5: React.FC<ProductSelectorWithSi5Props> = ({
  products,
  value,
  onChange,
  onCatalogUpdated,
  onNotify,
  allowEmpty = false,
  emptyLabel = 'Selecione um produto (Opcional)',
}) => {
  const [localFilter, setLocalFilter] = useState('');
  const [si5Query, setSi5Query] = useState('');
  const [searching, setSearching] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Pesquisa 100% local nos produtos salvos no banco/dispositivo (0 solicitações à SI5)
  const filteredProducts = useMemo(() => {
    const q = localFilter.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.ean || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.brand_name || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [products, localFilter]);

  const selectedProduct = products.find((p) => String(p.id) === String(value));

  // Só solicita à API SI5 quando o usuário clicar explicitamente em Buscar SI5 ou ler um EAN inexistente localmente
  const runSi5Lookup = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const { matched, allProducts, fromCache } = await searchOrResolveSi5WithDeviceCache(q, products);
      onCatalogUpdated(allProducts);
      if (matched.length > 0) {
        onChange(String(matched[0].id));
        onNotify?.(
          'ok',
          fromCache
            ? `Produto carregado do cache local (0 tokens SI5 gastos): ${matched[0].name}`
            : `${matched.length} produto(s) salvo(s) da SI5 no banco e dispositivo: ${matched[0].name}`
        );
      } else {
        onNotify?.('err', `Nenhum produto encontrado na SI5 para "${q}".`);
      }
    } catch (err: any) {
      onNotify?.('err', err.message || 'Erro ao consultar catálogo SI5.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* 1. Pesquisa Local Instantânea no Catálogo Salvo */}
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={localFilter}
            onChange={(e) => setLocalFilter(e.target.value)}
            placeholder={`Pesquisar entre ${products.length} produtos salvos (nome, EAN, marca)...`}
            className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0"
        >
          <Barcode className="w-4 h-4" /> Ler EAN
        </button>
      </div>

      {/* 2. Seletor dos Produtos Filtrados */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white font-medium"
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {filteredProducts.length === 0 && !allowEmpty && (
          <option value="">
            {products.length === 0
              ? 'Catálogo vazio — faça a puxada completa da SI5'
              : `Nenhum produto local para "${localFilter}"`}
          </option>
        )}
        {filteredProducts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.ean && p.ean !== 'A CONFERIR' ? `• EAN ${p.ean}` : `(${p.sku})`}
          </option>
        ))}
      </select>

      {/* 3. Solicitação Sob Demanda à API SI5 (apenas quando solicitado) */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={si5Query}
          onChange={(e) => setSi5Query(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              runSi5Lookup(si5Query);
            }
          }}
          placeholder="Não encontrou? Consultar na API SI5 por nome ou EAN..."
          className="flex-1 px-3 py-1.5 border border-teal-300 bg-teal-50/40 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          type="button"
          disabled={searching || !si5Query.trim()}
          onClick={() => runSi5Lookup(si5Query)}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1 shrink-0"
        >
          {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Solicitar à SI5
        </button>
      </div>

      {/* 4. Ficha Completa do Produto Selecionado */}
      {selectedProduct && (
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3 text-xs">
          {selectedProduct.image_url ? (
            <img
              src={selectedProduct.image_url}
              alt={selectedProduct.name}
              className="w-12 h-12 object-contain rounded-lg bg-white border p-0.5 shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-200/70 flex items-center justify-center text-slate-500 shrink-0">
              <Package className="w-5 h-5" />
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="font-bold text-slate-900 truncate">{selectedProduct.name}</div>
            <div className="text-slate-600 flex flex-wrap gap-x-3">
              <span>EAN: <b>{selectedProduct.ean}</b></span>
              {selectedProduct.brand_name && <span>Marca: <b>{selectedProduct.brand_name}</b></span>}
              {selectedProduct.category && <span>Cat: {selectedProduct.category}</span>}
              {selectedProduct.unit && <span>Emb: {selectedProduct.unit}</span>}
            </div>
            {(selectedProduct.ncm || selectedProduct.cest_codigo || (selectedProduct.system_price ?? 0) > 0) && (
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                {(selectedProduct.system_price ?? 0) > 0 && (
                  <span>Preço ref.: <b>R$ {Number(selectedProduct.system_price).toFixed(2)}</b></span>
                )}
                {selectedProduct.ncm && <span>NCM: {selectedProduct.ncm}</span>}
                {selectedProduct.cest_codigo && <span>CEST: {selectedProduct.cest_codigo}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(ean) => runSi5Lookup(ean)}
      />
    </div>
  );
};
