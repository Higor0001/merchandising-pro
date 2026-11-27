import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Store, Package, ArrowRight, X, Copy, Check, Compass } from 'lucide-react';
import { apiFetch } from '../services/api';
import { loadProductsWithDeviceCache, type CachedProduct } from '../services/productCatalogCache';
import type { MenuId } from './Layout';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: MenuId) => void;
  onOpenStore: (storeId: number) => void;
  isManager: boolean;
}

const QUICK_MODULES: Array<{ id: MenuId; label: string; desc: string; managerOnly?: boolean }> = [
  { id: 'dashboard', label: 'Central do Dia', desc: 'Resumo operacional, lojas e indicadores' },
  { id: 'lojas', label: 'Lojas & PDV', desc: 'Lista de mercados, redes e histórico' },
  { id: 'catalogo', label: 'Catálogo PepsiCo & Gramaturas', desc: 'Produtos, EANs, pesos e marcas' },
  { id: 'ia', label: 'Auditoria IA de Gôndola', desc: 'Visão computacional 100% + panorâmicas' },
  { id: 'visitas', label: 'Minhas Visitas', desc: 'Check-in, checklist e fotos' },
  { id: 'roteiros', label: 'Roteiros Semanais', desc: 'Planejamento de rota por região' },
  { id: 'abastecimento', label: 'Abastecimento', desc: 'Reposição de gôndola e retaguarda' },
  { id: 'exposicao', label: 'Exposição & Gôndolas', desc: 'Organização visual antes e depois' },
  { id: 'planogramas', label: 'Planogramas & Share', desc: 'Frentes ideais e participação' },
  { id: 'precificacao', label: 'Precificação', desc: 'Conferência de etiquetas e preços' },
  { id: 'validades', label: 'Validades & PVPS', desc: 'Vencimentos próximos e retiradas' },
  { id: 'estoque', label: 'Estoque em Loja', desc: 'Movimentações e inventário' },
  { id: 'rupturas', label: 'Rupturas', desc: 'Faltas críticas no PDV' },
  { id: 'ocorrencias', label: 'Ocorrências', desc: 'Pendências abertas e resoluções' },
  { id: 'pontos-extras', label: 'Pontos Extras', desc: 'Ilhas, pontas de gôndola e displays' },
  { id: 'campanhas', label: 'Campanhas', desc: 'Execução de ações promocionais' },
  { id: 'concorrencia', label: 'Concorrência', desc: 'Monitoramento de preços concorrentes' },
  { id: 'relatorios', label: 'Relatórios (PDF/Excel)', desc: 'Exportações gerenciais por período', managerOnly: true },
  { id: 'configuracoes', label: 'Configurações & Equipe', desc: 'Usuários, marcas, SI5 e auditoria', managerOnly: true },
];

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  open,
  onClose,
  onNavigate,
  onOpenStore,
  isManager,
}) => {
  const [query, setQuery] = useState('');
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [copiedEan, setCopiedEan] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 40);
    void Promise.all([
      apiFetch<any[]>('/stores').catch(() => []),
      loadProductsWithDeviceCache(false).catch(() => []),
    ]).then(([s, p]) => {
      if (Array.isArray(s)) setStores(s);
      if (Array.isArray(p)) setProducts(p);
    });
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();

  const matchedModules = useMemo(() => {
    const allowed = QUICK_MODULES.filter((m) => !m.managerOnly || isManager);
    if (!q) return allowed.slice(0, 6);
    return allowed.filter(
      (m) => m.label.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [q, isManager]);

  const matchedStores = useMemo(() => {
    if (!q) return stores.slice(0, 4);
    return stores
      .filter(
        (s) =>
          String(s.name || '').toLowerCase().includes(q) ||
          String(s.address || '').toLowerCase().includes(q) ||
          String(s.banner || '').toLowerCase().includes(q) ||
          String(s.city || '').toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [stores, q]);

  const matchedProducts = useMemo(() => {
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.weight || '').toLowerCase().includes(q) ||
          (p.ean || '').includes(q) ||
          (p.brand_name || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [products, q]);

  if (!open) return null;

  const copyEan = (ean: string) => {
    void navigator.clipboard?.writeText(ean);
    setCopiedEan(ean);
    setTimeout(() => setCopiedEan(''), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-20"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search className="w-5 h-5 text-blue-600 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar loja, produto PepsiCo, gramatura (ex: 140g), EAN ou módulo..."
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none bg-transparent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-500 hover:bg-slate-200"
          >
            ESC
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-3 space-y-4">
          {/* Produtos PepsiCo */}
          {matchedProducts.length > 0 && (
            <div className="space-y-1.5">
              <div className="px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Catálogo PepsiCo ({matchedProducts.length})</span>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('catalogo');
                    onClose();
                  }}
                  className="text-blue-600 hover:underline normal-case font-bold"
                >
                  Abrir catálogo completo →
                </button>
              </div>
              {matchedProducts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      className="w-10 h-10 object-contain rounded-xl bg-white border p-0.5 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      {p.brand_name && <span className="font-semibold text-slate-700">{p.brand_name}</span>}
                      {p.weight && (
                        <span className="px-1.5 py-0.2 rounded-md bg-blue-100 text-blue-800 font-extrabold">
                          {p.weight}
                        </span>
                      )}
                      <span className="font-mono">EAN {p.ean}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyEan(p.ean)}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 transition shrink-0"
                  >
                    {copiedEan === p.ean ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedEan === p.ean ? 'Copiado' : 'EAN'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Lojas */}
          {matchedStores.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Lojas & PDVs
              </div>
              {matchedStores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onOpenStore(s.id);
                    onClose();
                  }}
                  className="w-full text-left flex items-center gap-3 p-2.5 rounded-2xl hover:bg-blue-50/70 transition group"
                >
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Store className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-900 group-hover:text-blue-700 truncate">
                      {s.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {s.address} {s.city ? `— ${s.city}` : ''}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-600 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Módulos */}
          {matchedModules.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Navegação Rápida
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {matchedModules.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onNavigate(m.id);
                      onClose();
                    }}
                    className="text-left flex items-center gap-2.5 p-2.5 rounded-2xl hover:bg-slate-100 transition"
                  >
                    <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                      <Compass className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{m.label}</div>
                      <div className="text-[11px] text-slate-500 truncate">{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {q && matchedModules.length === 0 && matchedStores.length === 0 && matchedProducts.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-400">
              Nenhum resultado encontrado para &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
