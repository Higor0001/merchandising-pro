import React, { useEffect, useMemo, useState } from 'react';
import {
  PackageSearch,
  Search,
  Barcode,
  RefreshCw,
  Copy,
  Check,
  Package,
  Scale,
  Tag,
  Layers,
} from 'lucide-react';
import {
  loadProductsWithDeviceCache,
  type CachedProduct,
} from '../services/productCatalogCache';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { useToast } from '../context/ToastContext';

export const CatalogPage: React.FC = () => {
  const { toast } = useToast();
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [selectedBrand, setSelectedBrand] = useState('Todas');
  const [onlyWithWeight, setOnlyWithWeight] = useState(false);
  const [visibleCount, setVisibleCount] = useState(48);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [copiedEan, setCopiedEan] = useState('');

  const loadCatalog = async (forceServer = false) => {
    if (forceServer) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await loadProductsWithDeviceCache(forceServer);
      setProducts(Array.isArray(list) ? list : []);
      if (forceServer) {
        toast('ok', `Catálogo atualizado do servidor (${list.length} produtos ativos).`);
      }
    } catch (err: any) {
      toast('err', err.message || 'Erro ao carregar catálogo de produtos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadCatalog(false);
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const cat = p.category || 'Outros';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return [
      { name: 'Todas', count: products.length },
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    ];
  }, [products]);

  const brands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (selectedCategory !== 'Todas' && (p.category || 'Outros') !== selectedCategory) continue;
      const b = p.brand_name || 'PepsiCo';
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    return [
      { name: 'Todas', count: Array.from(counts.values()).reduce((a, b) => a + b, 0) },
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    ];
  }, [products, selectedCategory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'Todas' && (p.category || 'Outros') !== selectedCategory) return false;
      if (selectedBrand !== 'Todas' && (p.brand_name || 'PepsiCo') !== selectedBrand) return false;
      if (onlyWithWeight && !(p.weight && p.weight.trim())) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.weight || '').toLowerCase().includes(q) ||
        (p.ean || '').toLowerCase().includes(q) ||
        (p.brand_name || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, selectedCategory, selectedBrand, onlyWithWeight]);

  const withWeightCount = useMemo(
    () => products.filter((p) => Boolean(p.weight && p.weight.trim())).length,
    [products]
  );

  const uniqueBrandsCount = useMemo(
    () => new Set(products.map((p) => p.brand_name).filter(Boolean)).size,
    [products]
  );

  const handleCopyEan = (ean: string) => {
    void navigator.clipboard?.writeText(ean);
    setCopiedEan(ean);
    toast('ok', `EAN ${ean} copiado!`);
    setTimeout(() => setCopiedEan(''), 1600);
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white rounded-3xl p-5 sm:p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-[11px] font-bold">
              <PackageSearch className="w-3.5 h-3.5" /> Portfólio Oficial Atualizado
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              Catálogo PepsiCo & Gramaturas
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              Consulte produtos, códigos EAN, fotos e gramaturas reais mesmo offline no corredor da loja.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md transition"
            >
              <Barcode className="w-4 h-4" /> Ler EAN pela Câmera
            </button>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void loadCatalog(true)}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 text-xs font-bold inline-flex items-center gap-1.5 transition disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Atualizando...' : 'Atualizar Banco'}
            </button>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
          {[
            { label: 'SKUs Ativos', val: products.length, icon: Package },
            { label: 'Com Gramatura', val: withWeightCount, icon: Scale },
            { label: 'Marcas PepsiCo', val: uniqueBrandsCount, icon: Tag },
            { label: 'Categorias', val: Math.max(0, categories.length - 1), icon: Layers },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="p-3 rounded-2xl bg-white/8 border border-white/10 flex items-center gap-3"
              >
                <div className="p-2 rounded-xl bg-blue-500/20 text-blue-200">
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-lg font-extrabold tabular-nums leading-tight">{m.val}</div>
                  <div className="text-[11px] text-slate-300">{m.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Search & Filters Card */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisibleCount(48);
              }}
              placeholder="Pesquisar por produto, marca, gramatura (ex: 140 g, 500 ml, 2 L) ou EAN..."
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={onlyWithWeight}
              onChange={(e) => setOnlyWithWeight(e.target.checked)}
              className="w-4 h-4 accent-blue-600 rounded"
            />
            Apenas com gramatura
          </label>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat.name}
              type="button"
              onClick={() => {
                setSelectedCategory(cat.name);
                setSelectedBrand('Todas');
                setVisibleCount(48);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                selectedCategory === cat.name
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {cat.name} <span className="opacity-70">({cat.count})</span>
            </button>
          ))}
        </div>

        {/* Brand Pills */}
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          {brands.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => {
                setSelectedBrand(b.name);
                setVisibleCount(48);
              }}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition ${
                selectedBrand === b.name
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
              }`}
            >
              {b.name} ({b.count})
            </button>
          ))}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between px-1 text-xs text-slate-500">
        <span>
          Exibindo <b className="text-slate-900">{Math.min(visibleCount, filtered.length)}</b> de{' '}
          <b className="text-slate-900">{filtered.length}</b> produto(s)
        </span>
        {(search || selectedCategory !== 'Todas' || selectedBrand !== 'Todas' || onlyWithWeight) && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSelectedCategory('Todas');
              setSelectedBrand('Todas');
              setOnlyWithWeight(false);
            }}
            className="text-blue-600 font-bold hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-2">
          <Package className="w-10 h-10 text-slate-300 mx-auto" />
          <div className="font-bold text-slate-700">Nenhum produto encontrado</div>
          <p className="text-xs text-slate-500">Tente limpar os filtros ou pesquisar por outro EAN ou gramatura.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filtered.slice(0, visibleCount).map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-slate-200/80 hover:border-blue-300 hover:shadow-md p-3.5 flex gap-3.5 transition"
              >
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    loading="lazy"
                    className="w-16 h-16 object-contain rounded-xl bg-slate-50 border border-slate-100 p-1 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                    <Package className="w-7 h-7" />
                  </div>
                )}

                <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      {p.brand_name && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-extrabold uppercase">
                          {p.brand_name}
                        </span>
                      )}
                      {p.weight ? (
                        <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[11px] font-extrabold inline-flex items-center gap-1">
                          <Scale className="w-3 h-3" /> {p.weight}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-slate-50 text-slate-400 text-[10px] font-semibold">
                          Peso padrão
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug">{p.name}</h3>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                    <div className="text-[11px] font-mono text-slate-500 truncate">{p.ean}</div>
                    <button
                      type="button"
                      onClick={() => handleCopyEan(p.ean)}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 text-[10px] font-bold inline-flex items-center gap-1 transition shrink-0"
                    >
                      {copiedEan === p.ean ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedEan === p.ean ? 'Copiado' : 'EAN'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {visibleCount < filtered.length && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 48)}
                className="px-6 py-2.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-extrabold text-slate-700 shadow-xs transition"
              >
                Carregar mais produtos ({filtered.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </>
      )}

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(ean) => {
          setSearch(ean);
          setSelectedCategory('Todas');
          setSelectedBrand('Todas');
          setScannerOpen(false);
          toast('info', `Filtrando catálogo pelo EAN ${ean}`);
        }}
      />
    </div>
  );
};
