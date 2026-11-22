import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Store,
  MapPin,
  Camera,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  PackagePlus,
  Layers,
  CalendarClock,
  Tag,
  Bell,
  Clock,
  Lock,
  ArrowRight,
  RotateCcw,
  History,
  Play,
  Square,
  ShieldAlert,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PhotoInput } from '../components/PhotoInput';
import { ProductSelectorWithSi5 } from '../components/ProductSelectorWithSi5';
import {
  loadProductsWithDeviceCache,
  syncFullCatalogFromSi5,
  type CachedProduct,
} from '../services/productCatalogCache';

interface StoreOperationalPageProps {
  storeId: number;
  onBack: () => void;
}

const STAGES = [
  { key: 'IDENTIFICACAO', label: '1. Identificação' },
  { key: 'FOTO_INICIAL', label: '2. Foto Inicial' },
  { key: 'DIAGNOSTICO', label: '3. Diagnóstico' },
  { key: 'EXECUCAO', label: '4. Execução' },
  { key: 'FOTO_FINAL', label: '5. Foto Final' },
  { key: 'CHECKOUT', label: '6. Check-out' },
] as const;

const AREAS = [
  'Gôndola Principal',
  'Ponto Extra',
  'Display',
  'Ponta de Gôndola',
  'Ilha Promocional',
  'Estoque/Retaguarda',
  'Checkout',
];

function stageIndex(stage?: string): number {
  if (!stage) return 0;
  if (stage === 'CONCLUIDA') return 6;
  const idx = STAGES.findIndex((s) => s.key === stage);
  return idx >= 0 ? idx : 0;
}

export const StoreOperationalPage: React.FC<StoreOperationalPageProps> = ({ storeId, onBack }) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'operacao' | 'historico'>('operacao');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const [storeData, setStoreData] = useState<any>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [syncingSi5, setSyncingSi5] = useState(false);

  // Step 2: Selfie + Initial & Complementary Photo states
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [initialArea, setInitialArea] = useState('Gôndola Principal');
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [compArea, setCompArea] = useState('Ponto Extra');
  const [compFile, setCompFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Step 3: Diagnostic 11 questions
  const [diag, setDiag] = useState({
    exposicao: 'Boa',
    organizacao_gondola: 'Boa',
    abastecimento: 'Completo',
    tem_rupturas: false,
    detalhes_rupturas: '',
    tem_vencidos: false,
    detalhes_vencidos: '',
    tem_proximo_vencimento: false,
    detalhes_proximo_vencimento: '',
    tem_sem_preco: false,
    detalhes_sem_preco: '',
    tem_divergencia_preco: false,
    detalhes_divergencia_preco: '',
    espacos_disponiveis: false,
    detalhes_espacos: '',
    pontos_extras_ativos: true,
    detalhes_pontos_extras: '',
    tem_concorrencia_espaco: false,
    detalhes_concorrencia: '',
    obs_exposicao: '',
    obs_gondola: '',
    obs_abastecimento: '',
  });
  const [complementaryItems, setComplementaryItems] = useState<Array<{ type: string; product_id: string; description: string; priority: string }>>([]);

  // Step 4: Execution sub-tabs
  const [execTab, setExecTab] = useState<'checklist' | 'abastecimento' | 'exposicao' | 'validade' | 'preco' | 'ocorrencia'>('abastecimento');
  const [newCheckItem, setNewCheckItem] = useState('');

  const [repForm, setRepForm] = useState({
    product_id: '',
    quantity_replenished: '10',
    gondola_stock: '15',
    backroom_stock: '20',
    status: 'Abastecido',
    increase_exposure_opportunity: false,
    notes: '',
  });
  const [expForm, setExpForm] = useState({
    exposure_type: 'Gôndola',
    category: 'Snacks de milho',
    brand_id: '',
    facings_actual: '6',
    facings_expected: '6',
    planogram_compliant: true,
    notes: '',
  });
  const [valForm, setValForm] = useState({
    product_id: '',
    batch_code: '',
    expiry_date: new Date().toISOString().slice(0, 10),
    quantity: '1',
    condition: 'Normal',
    fifo_fefo_applied: true,
    removal_requested: false,
    notes: '',
  });
  const [priceForm, setPriceForm] = useState({
    product_id: '',
    gondola_price: '',
    promo_price: '',
    has_price_tag: true,
    competitor_name: '',
    competitor_price: '',
    notes: '',
  });
  const [occForm, setOccForm] = useState({
    type: 'Ruptura',
    priority: 'Alta',
    product_id: '',
    description: '',
  });
  const [occPhoto, setOccPhoto] = useState<File | null>(null);

  // Step 5: Final Photo
  const [finalArea, setFinalArea] = useState('Gôndola Principal');
  const [finalFile, setFinalFile] = useState<File | null>(null);

  // Step 6: Checkout
  const [checkoutForm, setCheckoutForm] = useState({
    notes: '',
    problems_found: '',
    opportunities_found: '',
  });

  // UI view override to navigate back to earlier unlocked steps
  const [viewStage, setViewStage] = useState<string | null>(null);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [abandonReason, setAbandonReason] = useState('Loja Fechada');
  const [abandonNotes, setAbandonNotes] = useState('');

  const notify = (type: 'ok' | 'err', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 5000);
  };

  const loadOperational = useCallback(async () => {
    setLoading(true);
    try {
      const [op, prods, brs] = await Promise.all([
        apiFetch(`/stores/${storeId}/operational`),
        loadProductsWithDeviceCache(false),
        apiFetch('/brands'),
      ]);
      setStoreData(op);
      setProducts(prods);
      setBrands(brs);

      if (prods.length > 0) {
        setRepForm((f) => ({ ...f, product_id: f.product_id || String(prods[0].id) }));
        setValForm((f) => ({ ...f, product_id: f.product_id || String(prods[0].id) }));
        setPriceForm((f) => ({ ...f, product_id: f.product_id || String(prods[0].id) }));
      }
      if (brs.length > 0) {
        setExpForm((f) => ({ ...f, brand_id: f.brand_id || String(brs[0].id) }));
      }

      if (op.active_visit) {
        const wf = await apiFetch(`/visits/${op.active_visit.id}/workflow-state`);
        setWorkflow(wf);
        setViewStage(null);
      } else {
        setWorkflow(null);
      }
    } catch (err: any) {
      notify('err', err.message || 'Erro ao carregar dados da loja.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    loadOperational();
  }, [loadOperational]);

  const refreshWorkflow = async (visitId: number) => {
    const [wf, op] = await Promise.all([
      apiFetch(`/visits/${visitId}/workflow-state`),
      apiFetch(`/stores/${storeId}/operational`),
    ]);
    setWorkflow(wf);
    setStoreData(op);
  };

  // Etapa 1: Iniciar Check-in na Loja
  const handleStartCheckin = async () => {
    try {
      let coords: { lat?: number; lng?: number } = {};
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              resolve();
            },
            () => resolve(),
            { timeout: 2500 }
          );
        });
      }
      const res = await apiFetch('/visits/start-for-store', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, ...coords }),
      });
      await refreshWorkflow(res.visit.id);
      notify('ok', 'Check-in registrado! Agora capture a Fotografia Inicial obrigatória.');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Etapa 2 / 5: Upload de Evidência
  const handleUploadEvidence = async (stage: 'SELFIE_ENTRADA' | 'INICIAL' | 'COMPLEMENTAR' | 'FINAL', file: File | null, area: string) => {
    if (!file || !workflow?.visit) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('stage', stage);
      fd.append('area', area);
      fd.append('caption', stage === 'SELFIE_ENTRADA' ? 'Selfie em frente ao estabelecimento' : `Evidência ${stage} - ${area}`);
      await apiFetch(`/visits/${workflow.visit.id}/evidences`, { method: 'POST', body: fd });
      if (stage === 'SELFIE_ENTRADA') setSelfieFile(null);
      if (stage === 'INICIAL') setInitialFile(null);
      if (stage === 'COMPLEMENTAR') setCompFile(null);
      if (stage === 'FINAL') setFinalFile(null);
      await refreshWorkflow(workflow.visit.id);
      notify('ok', stage === 'SELFIE_ENTRADA' ? 'Selfie na entrada do estabelecimento registrada!' : `Fotografia ${stage.toLowerCase()} registrada com data/hora e vinculada à loja!`);
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRetakeEvidence = async (evId: number) => {
    if (!workflow?.visit) return;
    try {
      await apiFetch(`/visits/${workflow.visit.id}/evidences/${evId}`, { method: 'DELETE' });
      await refreshWorkflow(workflow.visit.id);
      notify('ok', 'Foto removida para refazer.');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleConfirmInitialPhoto = async () => {
    if (!workflow?.visit) return;
    try {
      await apiFetch(`/visits/${workflow.visit.id}/confirm-initial-photo`, { method: 'POST' });
      await refreshWorkflow(workflow.visit.id);
      setViewStage('DIAGNOSTICO');
      notify('ok', 'Fotografia inicial confirmada! Diagnóstico liberado.');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Etapa 3: Salvar Diagnóstico
  const handleSaveDiagnostic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      const res = await apiFetch(`/visits/${workflow.visit.id}/diagnostic`, {
        method: 'POST',
        body: JSON.stringify({ answers: diag, complementary_items: complementaryItems }),
      });
      await refreshWorkflow(workflow.visit.id);
      setViewStage('EXECUCAO');
      notify('ok', `Diagnóstico salvo! ${res.generated_occurrences} pendência(s) gerada(s). Execução liberada.`);
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Etapa 4: Sincronizar Catálogo Completo da SI5 para o Dispositivo
  const handleSyncSi5ToDevice = async () => {
    setSyncingSi5(true);
    try {
      const res = await syncFullCatalogFromSi5('');
      setProducts(res.products);
      if (res.products.length > 0) {
        setRepForm((f) => ({ ...f, product_id: f.product_id || String(res.products[0].id) }));
        setValForm((f) => ({ ...f, product_id: f.product_id || String(res.products[0].id) }));
        setPriceForm((f) => ({ ...f, product_id: f.product_id || String(res.products[0].id) }));
      }
      notify('ok', `Catálogo completo SI5 salvo no dispositivo (${res.products.length} produtos; ${res.inserted} novos, ${res.updated} atualizados).`);
    } catch (err: any) {
      notify('err', err.message || 'Erro ao sincronizar catálogo da SI5.');
    } finally {
      setSyncingSi5(false);
    }
  };

  const handleToggleChecklist = async (item: any) => {
    if (!workflow?.visit) return;
    await apiFetch(`/visits/${workflow.visit.id}/checklist/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: !item.completed }),
    });
    await refreshWorkflow(workflow.visit.id);
  };

  const handleAddChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit || !newCheckItem.trim()) return;
    await apiFetch(`/visits/${workflow.visit.id}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ label: newCheckItem }),
    });
    setNewCheckItem('');
    await refreshWorkflow(workflow.visit.id);
  };

  const handleSaveReplenishment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      await apiFetch('/replenishments', {
        method: 'POST',
        body: JSON.stringify({
          visit_id: workflow.visit.id,
          store_id: storeId,
          product_id: Number(repForm.product_id),
          quantity_replenished: Number(repForm.quantity_replenished),
          gondola_stock: Number(repForm.gondola_stock),
          backroom_stock: Number(repForm.backroom_stock),
          status: repForm.status,
          increase_exposure_opportunity: repForm.increase_exposure_opportunity,
          notes: repForm.notes,
        }),
      });
      setRepForm((f) => ({ ...f, notes: '' }));
      await refreshWorkflow(workflow.visit.id);
      notify('ok', 'Abastecimento/conferência registrado na visita e no estoque da loja!');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleSaveExposure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      const fd = new FormData();
      fd.append('visit_id', String(workflow.visit.id));
      fd.append('store_id', String(storeId));
      fd.append('exposure_type', expForm.exposure_type);
      fd.append('category', expForm.category);
      if (expForm.brand_id) fd.append('brand_id', expForm.brand_id);
      fd.append('facings_actual', expForm.facings_actual);
      fd.append('facings_expected', expForm.facings_expected);
      fd.append('planogram_compliant', String(expForm.planogram_compliant));
      fd.append('notes', expForm.notes);
      await apiFetch('/displays', { method: 'POST', body: fd });
      setExpForm((f) => ({ ...f, notes: '' }));
      await refreshWorkflow(workflow.visit.id);
      notify('ok', 'Organização de gôndola / ponto extra registrada!');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleSaveExpiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      await apiFetch('/expiries', {
        method: 'POST',
        body: JSON.stringify({
          visit_id: workflow.visit.id,
          store_id: storeId,
          product_id: Number(valForm.product_id),
          batch_code: valForm.batch_code,
          expiry_date: valForm.expiry_date,
          quantity: Number(valForm.quantity),
          condition: valForm.condition,
          fifo_fefo_applied: valForm.fifo_fefo_applied,
          removal_requested: valForm.removal_requested,
          notes: valForm.notes,
        }),
      });
      setValForm((f) => ({ ...f, batch_code: '', notes: '' }));
      await refreshWorkflow(workflow.visit.id);
      notify('ok', 'Controle de validade e PVPS registrado!');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      const fd = new FormData();
      fd.append('visit_id', String(workflow.visit.id));
      fd.append('store_id', String(storeId));
      fd.append('product_id', priceForm.product_id);
      fd.append('gondola_price', priceForm.gondola_price);
      if (priceForm.promo_price) fd.append('promo_price', priceForm.promo_price);
      fd.append('has_price_tag', String(priceForm.has_price_tag));
      if (priceForm.competitor_name) fd.append('competitor_name', priceForm.competitor_name);
      if (priceForm.competitor_price) fd.append('competitor_price', priceForm.competitor_price);
      fd.append('notes', priceForm.notes);
      await apiFetch('/prices', { method: 'POST', body: fd });
      setPriceForm((f) => ({ ...f, gondola_price: '', promo_price: '', notes: '' }));
      await refreshWorkflow(workflow.visit.id);
      notify('ok', 'Precificação registrada!');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleSaveOccurrence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      const fd = new FormData();
      fd.append('visit_id', String(workflow.visit.id));
      fd.append('store_id', String(storeId));
      if (occForm.product_id) fd.append('product_id', occForm.product_id);
      fd.append('type', occForm.type);
      fd.append('priority', occForm.priority);
      fd.append('description', occForm.description);
      if (occPhoto) fd.append('photo', occPhoto);
      await apiFetch('/occurrences', { method: 'POST', body: fd });
      setOccForm((f) => ({ ...f, description: '' }));
      setOccPhoto(null);
      await refreshWorkflow(workflow.visit.id);
      notify('ok', 'Ocorrência registrada e vinculada à loja!');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleGoToFinalPhoto = async () => {
    if (!workflow?.visit) return;
    try {
      await apiFetch(`/visits/${workflow.visit.id}/ready-for-final-photo`, { method: 'POST' });
      await refreshWorkflow(workflow.visit.id);
      setViewStage('FOTO_FINAL');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Etapa 6: Check-out Final
  const handleCheckout = async () => {
    if (!workflow?.visit) return;
    try {
      await apiFetch(`/visits/${workflow.visit.id}/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          ...checkoutForm,
          operational_summary: {
            total_replenished_qty: workflow.summary.total_replenished_qty,
            removed_products_qty: workflow.summary.removed_products_qty,
            ruptures_count: workflow.summary.ruptures_count,
            occurrences_count: workflow.summary.occurrences_count,
            unresolved_pendencies_count: workflow.summary.unresolved_pendencies_count,
            checklist_done: workflow.summary.checklist_done,
            checklist_total: workflow.summary.checklist_total,
          },
        }),
      });
      notify('ok', 'Visita finalizada com sucesso! Relatório salvo no histórico da loja.');
      setViewStage(null);
      await loadOperational();
      setTab('historico');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleAbandonVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow?.visit) return;
    try {
      const reasonText = abandonNotes.trim() ? `${abandonReason} — ${abandonNotes.trim()}` : abandonReason;
      await apiFetch(`/visits/${workflow.visit.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reasonText }),
      });
      setShowAbandonModal(false);
      setAbandonNotes('');
      notify('ok', 'Justificativa de não atendimento registrada.');
      await loadOperational();
    } catch (err: any) {
      notify('err', err.message || 'Erro ao registrar justificativa.');
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Carregando operação da loja...</div>;
  if (!storeData) return null;

  const store = storeData.store;
  const activeVisit = workflow?.visit || null;
  const currentBackendStage = activeVisit
    ? activeVisit.status === 'Pendente'
      ? 'IDENTIFICACAO'
      : activeVisit.workflow_stage || 'FOTO_INICIAL'
    : 'IDENTIFICACAO';
  const activeStage = viewStage || currentBackendStage;
  const maxUnlockedIdx = activeVisit && activeVisit.status === 'Em Andamento' ? stageIndex(currentBackendStage) : 0;

  const selfiePhotos = workflow?.summary?.evidences?.selfie_entrada || [];
  const initialPhotos = workflow?.summary?.evidences?.initial || [];
  const complementaryPhotos = workflow?.summary?.evidences?.complementary || [];
  const finalPhotos = workflow?.summary?.evidences?.final || [];
  const hasSelfieEntrada = selfiePhotos.length > 0;
  const hasInitialPhoto = initialPhotos.length > 0;
  const canProceedToDiagnostic = hasSelfieEntrada && hasInitialPhoto;
  const hasFinalPhoto = finalPhotos.length > 0;
  const hasDiagnostic = Boolean(workflow?.summary?.diagnostic);

  return (
    <div className="space-y-5">
      {/* Cabeçalho Fixo de Identificação da Loja */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              onClick={onBack}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 shrink-0"
              title="Voltar para Lojas"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-extrabold uppercase">
                  Loja Selecionada
                </span>
                <span className="text-xs font-semibold text-slate-500">{store.type} • {store.banner || store.network}</span>
              </div>
              <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 mt-1 flex items-center gap-2">
                <Store className="w-5 h-5 text-blue-600 shrink-0" />
                {store.name}
              </h1>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                {store.address} {store.city ? `— ${store.city}` : ''} • Rota: {store.route_name}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {activeVisit?.status === 'Em Andamento' && (
              <button
                onClick={() => setShowAbandonModal(true)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
              >
                Justificar Não Atendimento
              </button>
            )}
            <button
              onClick={() => setTab('operacao')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                tab === 'operacao' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Play className="w-3.5 h-3.5" /> Operação Atual
            </button>
            <button
              onClick={() => setTab('historico')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                tab === 'historico' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" /> Histórico ({storeData.timeline.length})
            </button>
          </div>
        </div>

        {/* Barra de Progresso das 6 Etapas */}
        {tab === 'operacao' && (
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2 border-t border-slate-100">
            {STAGES.map((st, idx) => {
              const unlocked = activeVisit?.status === 'Em Andamento' && idx <= Math.max(maxUnlockedIdx, 1);
              const isCurrent = activeStage === st.key;
              const isDone = idx < maxUnlockedIdx;
              return (
                <button
                  key={st.key}
                  type="button"
                  disabled={!unlocked && idx > 0}
                  onClick={() => unlocked && setViewStage(st.key)}
                  className={`px-2.5 py-2 rounded-xl text-xs font-bold text-left flex items-center gap-1.5 border transition ${
                    isCurrent
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : isDone
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      : unlocked
                      ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      : 'bg-slate-50/60 text-slate-400 border-slate-100 cursor-not-allowed'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : !unlocked && idx > 0 ? <Lock className="w-3 h-3 shrink-0" /> : null}
                  <span className="truncate">{st.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast Flutuante de Feedback (sempre visível no mobile/desktop) */}
      {feedback && (
        <div
          className={`fixed bottom-20 inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-50 max-w-md p-3.5 rounded-2xl text-sm font-semibold flex items-center gap-2 border shadow-xl ${
            feedback.type === 'ok'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : 'bg-red-600 text-white border-red-700'
          }`}
        >
          {feedback.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{feedback.msg}</span>
        </div>
      )}

      {tab === 'operacao' ? (
        <div className="space-y-5">
          {/* ETAPA 1 — IDENTIFICAÇÃO */}
          {(!activeVisit || activeVisit.status === 'Pendente' || activeStage === 'IDENTIFICACAO') && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="text-base font-extrabold text-slate-900">Etapa 1 — Identificação e Check-in na Loja</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-500">Loja Selecionada</div>
                  <div className="font-bold text-slate-900">{store.name}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-500">Promotor Responsável</div>
                  <div className="font-bold text-slate-900">{user?.name}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-500">Data e Hora Automáticas</div>
                  <div className="font-bold text-slate-900">{new Date().toLocaleString('pt-BR')}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-500">Status da Visita</div>
                  <div className="font-bold text-blue-700">
                    {activeVisit ? `Visita #${activeVisit.id} (${activeVisit.status})` : 'Nova Visita (Aguardando Check-in)'}
                  </div>
                </div>
              </div>

              {storeData.open_occurrences.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Esta loja possui {storeData.open_occurrences.length} pendência(s) aberta(s) de visitas anteriores!
                  </div>
                  <p>Verifique no histórico ou durante a execução após o check-in.</p>
                </div>
              )}

              {activeVisit?.status === 'Em Andamento' ? (
                <button
                  onClick={() => setViewStage('FOTO_INICIAL')}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-base"
                >
                  Ir para Etapa 2 — Fotografia Inicial <ArrowRight className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={handleStartCheckin}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-2xl flex items-center justify-center gap-2 text-base shadow-md"
                >
                  <Play className="w-5 h-5" /> Confirmar Identificação e Iniciar Check-in (GPS)
                </button>
              )}
            </div>
          )}

          {/* ETAPA 2 — FOTOGRAFIA INICIAL OBRIGATÓRIA */}
          {activeVisit?.status === 'Em Andamento' && activeStage === 'FOTO_INICIAL' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-extrabold uppercase">
                    Etapa Obrigatória
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900 mt-1">
                    Etapa 2 — Selfie na Entrada & Fotografia Inicial (Antes da Intervenção)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Registre sua selfie em frente ao estabelecimento e fotografe a gôndola/área exatamente como encontrou antes de abastecer ou organizar.
                  </p>
                </div>
              </div>

              {/* 2.1 Selfie em frente ao estabelecimento (Obrigatória) */}
              <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-indigo-900 uppercase">
                      1. Selfie em frente ao estabelecimento (Obrigatória)
                    </div>
                    <p className="text-[11px] text-indigo-700">
                      Comprove sua presença na fachada/entrada da loja {store.name}.
                    </p>
                  </div>
                  {hasSelfieEntrada && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                      Registrada
                    </span>
                  )}
                </div>

                <PhotoInput
                  label="Tirar Selfie em frente ao estabelecimento"
                  file={selfieFile}
                  onFileSelect={setSelfieFile}
                  facingMode="user"
                  cameraOnly
                  large
                />

                {selfieFile && (
                  <button
                    disabled={uploadingPhoto}
                    onClick={() => handleUploadEvidence('SELFIE_ENTRADA', selfieFile, 'Fachada / Entrada do Estabelecimento')}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm"
                  >
                    <Camera className="w-4 h-4" />
                    {uploadingPhoto ? 'Salvando selfie...' : 'Salvar Selfie na Entrada'}
                  </button>
                )}

                {selfiePhotos.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {selfiePhotos.map((ev: any) => (
                      <div key={ev.id} className="p-3 rounded-xl border border-emerald-200 bg-white flex gap-3 items-center">
                        <img src={ev.photo_url} alt="Selfie na entrada" className="w-20 h-20 object-cover rounded-lg border" />
                        <div className="flex-1 min-w-0 text-xs">
                          <div className="font-bold text-slate-900">Selfie na Entrada</div>
                          <div className="text-slate-500">{ev.captured_at}</div>
                          <button
                            type="button"
                            onClick={() => handleRetakeEvidence(ev.id)}
                            className="mt-1.5 inline-flex items-center gap-1 text-amber-700 font-bold hover:underline"
                          >
                            <RotateCcw className="w-3 h-3" /> Refazer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="text-xs font-extrabold text-slate-800 uppercase">
                  2. Fotografia Inicial da Gôndola / Área (Obrigatória)
                </div>
                <label className="block text-xs font-bold text-slate-700">Área Fotografada</label>
                <select
                  value={initialArea}
                  onChange={(e) => setInitialArea(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white font-medium"
                >
                  {AREAS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>

                <PhotoInput
                  label="Capturar Fotografia Inicial com a Câmera"
                  file={initialFile}
                  onFileSelect={setInitialFile}
                  cameraOnly
                  large
                />

                {initialFile && (
                  <button
                    disabled={uploadingPhoto}
                    onClick={() => handleUploadEvidence('INICIAL', initialFile, initialArea)}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm"
                  >
                    <Camera className="w-4 h-4" />
                    {uploadingPhoto ? 'Salvando evidência...' : 'Salvar Fotografia Inicial'}
                  </button>
                )}
              </div>

              {/* Fotos Iniciais Registradas */}
              {initialPhotos.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-slate-700 uppercase">Fotos Iniciais Registradas ({initialPhotos.length})</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {initialPhotos.map((ev: any) => (
                      <div key={ev.id} className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 flex gap-3 items-center">
                        <img src={ev.photo_url} alt={ev.area} className="w-20 h-20 object-cover rounded-lg border" />
                        <div className="flex-1 min-w-0 text-xs">
                          <div className="font-bold text-slate-900">{ev.area}</div>
                          <div className="text-slate-500">{ev.captured_at}</div>
                          <button
                            type="button"
                            onClick={() => handleRetakeEvidence(ev.id)}
                            className="mt-1.5 inline-flex items-center gap-1 text-amber-700 font-bold hover:underline"
                          >
                            <RotateCcw className="w-3 h-3" /> Refazer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fotos Complementares de Diferentes Áreas */}
              <div className="p-4 rounded-2xl border border-dashed border-slate-300 space-y-3">
                <div className="text-xs font-bold text-slate-700">Fotografias Complementares (Opcional — Outras áreas da loja)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={compArea}
                    onChange={(e) => setCompArea(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
                  >
                    {AREAS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                  <PhotoInput
                    label="Adicionar Foto Complementar"
                    file={compFile}
                    onFileSelect={setCompFile}
                    cameraOnly
                  />
                </div>
                {compFile && (
                  <button
                    disabled={uploadingPhoto}
                    onClick={() => handleUploadEvidence('COMPLEMENTAR', compFile, compArea)}
                    className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl"
                  >
                    Salvar Foto Complementar
                  </button>
                )}
                {complementaryPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {complementaryPhotos.map((c: any) => (
                      <span key={c.id} className="px-2.5 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-700">
                        {c.area} ({c.captured_at})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {!canProceedToDiagnostic && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    Bloqueio ativo: O sistema não libera o Diagnóstico enquanto {!hasSelfieEntrada && !hasInitialPhoto
                      ? 'a selfie em frente ao estabelecimento e a fotografia inicial da gôndola'
                      : !hasSelfieEntrada
                      ? 'a selfie em frente ao estabelecimento'
                      : 'a fotografia inicial da gôndola'} não estiver registrada.
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={!canProceedToDiagnostic}
                onClick={handleConfirmInitialPhoto}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-extrabold rounded-2xl flex items-center justify-center gap-2 text-base"
              >
                Confirmar Selfie + Foto Inicial e Liberar Diagnóstico <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ETAPA 3 — DIAGNÓSTICO INICIAL */}
          {activeVisit?.status === 'Em Andamento' && activeStage === 'DIAGNOSTICO' && (
            <form onSubmit={handleSaveDiagnostic} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Etapa 3 — Diagnóstico Inicial do PDV</h2>
                <p className="text-xs text-slate-500">
                  Responda ao questionário abaixo. Problemas apontados gerarão pendências automaticamente na loja.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border space-y-1.5">
                  <label className="text-xs font-bold text-slate-800">1. Como está a exposição?</label>
                  <select
                    value={diag.exposicao}
                    onChange={(e) => setDiag({ ...diag, exposicao: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm bg-white"
                  >
                    {['Ótima', 'Boa', 'Regular', 'Ruim'].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border space-y-1.5">
                  <label className="text-xs font-bold text-slate-800">2. Organização da gôndola?</label>
                  <select
                    value={diag.organizacao_gondola}
                    onChange={(e) => setDiag({ ...diag, organizacao_gondola: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm bg-white"
                  >
                    {['Ótima', 'Boa', 'Regular', 'Ruim'].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border space-y-1.5">
                  <label className="text-xs font-bold text-slate-800">3. Como está o abastecimento?</label>
                  <select
                    value={diag.abastecimento}
                    onChange={(e) => setDiag({ ...diag, abastecimento: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm bg-white"
                  >
                    {['Completo', 'Parcial', 'Ruim', 'Crítico'].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: 'tem_rupturas', detailKey: 'detalhes_rupturas', label: '4. Existem rupturas?' },
                  { key: 'tem_vencidos', detailKey: 'detalhes_vencidos', label: '5. Existem produtos vencidos?' },
                  { key: 'tem_proximo_vencimento', detailKey: 'detalhes_proximo_vencimento', label: '6. Produtos próximos do vencimento?' },
                  { key: 'tem_sem_preco', detailKey: 'detalhes_sem_preco', label: '7. Existem produtos sem preço?' },
                  { key: 'tem_divergencia_preco', detailKey: 'detalhes_divergencia_preco', label: '8. Existem divergências de preço?' },
                  { key: 'espacos_disponiveis', detailKey: 'detalhes_espacos', label: '9. Existem espaços disponíveis?' },
                  { key: 'pontos_extras_ativos', detailKey: 'detalhes_pontos_extras', label: '10. Existem pontos extras?' },
                  { key: 'tem_concorrencia_espaco', detailKey: 'detalhes_concorrencia', label: '11. Concorrência ocupando espaço?' },
                ].map((q) => {
                  const val = Boolean((diag as any)[q.key]);
                  return (
                    <div key={q.key} className="p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">{q.label}</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDiag({ ...diag, [q.key]: true })}
                            className={`px-3 py-1 rounded-lg text-xs font-bold ${val ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                          >
                            Sim
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiag({ ...diag, [q.key]: false })}
                            className={`px-3 py-1 rounded-lg text-xs font-bold ${!val ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
                          >
                            Não
                          </button>
                        </div>
                      </div>
                      {val && (
                        <input
                          placeholder="Descreva os produtos/detalhes identificados..."
                          value={(diag as any)[q.detailKey] || ''}
                          onChange={(e) => setDiag({ ...diag, [q.detailKey]: e.target.value })}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Formulário Complementar de Produtos com Problema */}
              {(diag.tem_rupturas || diag.tem_vencidos || diag.tem_proximo_vencimento || diag.tem_sem_preco || diag.tem_divergencia_preco) && (
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-extrabold text-amber-900">
                      Identificação Complementar de Produtos com Problema
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setComplementaryItems([
                          ...complementaryItems,
                          { type: 'Ruptura', product_id: products[0]?.id ? String(products[0].id) : '', description: '', priority: 'Alta' },
                        ])
                      }
                      className="px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-bold"
                    >
                      + Adicionar Produto
                    </button>
                  </div>
                  {complementaryItems.map((item, idx) => (
                    <div key={idx} className="space-y-2 bg-white p-3 rounded-xl border">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select
                          value={item.type}
                          onChange={(e) => {
                            const copy = [...complementaryItems];
                            copy[idx].type = e.target.value;
                            setComplementaryItems(copy);
                          }}
                          className="px-2.5 py-2 border rounded-xl text-xs"
                        >
                          {['Ruptura', 'Produto Vencido', 'Próximo do Vencimento', 'Falta de Preço', 'Divergência de Preço'].map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                        <input
                          placeholder="Detalhes do problema..."
                          value={item.description}
                          onChange={(e) => {
                            const copy = [...complementaryItems];
                            copy[idx].description = e.target.value;
                            setComplementaryItems(copy);
                          }}
                          className="px-2.5 py-2 border rounded-xl text-xs"
                        />
                      </div>
                      <ProductSelectorWithSi5
                        products={products}
                        value={item.product_id}
                        onChange={(pid) => {
                          const copy = [...complementaryItems];
                          copy[idx].product_id = pid;
                          setComplementaryItems(copy);
                        }}
                        onCatalogUpdated={setProducts}
                        onNotify={notify}
                      />
                    </div>
                  ))}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-2xl flex items-center justify-center gap-2 text-base"
              >
                Salvar Diagnóstico e Liberar Execução <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          )}

          {/* ETAPA 4 — EXECUÇÃO DE MERCHANDISING */}
          {activeVisit?.status === 'Em Andamento' && activeStage === 'EXECUCAO' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">Etapa 4 — Execução de Merchandising na Loja</h2>
                  <p className="text-xs text-slate-500">
                    Todas as atividades abaixo estão vinculadas automaticamente à loja <b>{store.name}</b> e visita <b>#{activeVisit.id}</b>.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={syncingSi5}
                    onClick={handleSyncSi5ToDevice}
                    className="px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                    title="Carrega todos os produtos completos da SI5 e salva neste dispositivo"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingSi5 ? 'animate-spin' : ''}`} />
                    {syncingSi5 ? 'Sincronizando SI5...' : `Catálogo no Dispositivo (${products.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={handleGoToFinalPhoto}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-xl flex items-center gap-1.5"
                  >
                    Ir para Fotografia Final <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {!hasDiagnostic && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
                  Diagnóstico ainda não concluído. Conclua a Etapa 3 antes de registrar atividades.
                </div>
              )}

              {/* Sub-navegação da Execução */}
              <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
                {[
                  { id: 'abastecimento', label: 'Abastecimento & EAN', icon: PackagePlus },
                  { id: 'exposicao', label: 'Gôndola & Pontos Extras', icon: Layers },
                  { id: 'validade', label: 'Validade & PVPS', icon: CalendarClock },
                  { id: 'preco', label: 'Precificação', icon: Tag },
                  { id: 'ocorrencia', label: 'Ocorrências / Rupturas', icon: Bell },
                  { id: 'checklist', label: `Checklist (${workflow?.summary?.checklist_done || 0}/${workflow?.summary?.checklist_total || 0})`, icon: ClipboardCheck },
                ].map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setExecTab(t.id as any)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                        execTab === t.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </div>

              {execTab === 'abastecimento' && (
                <form onSubmit={handleSaveReplenishment} className="space-y-3">
                  <ProductSelectorWithSi5
                    products={products}
                    value={repForm.product_id}
                    onChange={(pid) => setRepForm({ ...repForm, product_id: pid })}
                    onCatalogUpdated={setProducts}
                    onNotify={notify}
                  />

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600">Qtd Abastecida</label>
                      <input
                        type="number"
                        value={repForm.quantity_replenished}
                        onChange={(e) => setRepForm({ ...repForm, quantity_replenished: e.target.value })}
                        className="w-full px-3 py-2 border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600">Estoque Gôndola</label>
                      <input
                        type="number"
                        value={repForm.gondola_stock}
                        onChange={(e) => setRepForm({ ...repForm, gondola_stock: e.target.value })}
                        className="w-full px-3 py-2 border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600">Estoque Retaguarda</label>
                      <input
                        type="number"
                        value={repForm.backroom_stock}
                        onChange={(e) => setRepForm({ ...repForm, backroom_stock: e.target.value })}
                        className="w-full px-3 py-2 border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600">Status</label>
                      <select
                        value={repForm.status}
                        onChange={(e) => setRepForm({ ...repForm, status: e.target.value })}
                        className="w-full px-3 py-2 border rounded-xl text-sm"
                      >
                        {['Abastecido', 'Parcial', 'Ruptura'].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <input
                    placeholder="Observações do abastecimento..."
                    value={repForm.notes}
                    onChange={(e) => setRepForm({ ...repForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm"
                  />
                  <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">
                    Registrar Abastecimento & Estoque
                  </button>
                </form>
              )}

              {execTab === 'exposicao' && (
                <form onSubmit={handleSaveExposure} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select
                      value={expForm.exposure_type}
                      onChange={(e) => setExpForm({ ...expForm, exposure_type: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    >
                      {['Gôndola', 'Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola', 'Checkout'].map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <select
                      value={expForm.brand_id}
                      onChange={(e) => setExpForm({ ...expForm, brand_id: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    >
                      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <input
                      placeholder="Categoria"
                      value={expForm.category}
                      onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-center">
                    <input
                      type="number"
                      placeholder="Frentes Reais"
                      value={expForm.facings_actual}
                      onChange={(e) => setExpForm({ ...expForm, facings_actual: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Frentes Esperadas"
                      value={expForm.facings_expected}
                      onChange={(e) => setExpForm({ ...expForm, facings_expected: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <label className="flex items-center gap-2 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={expForm.planogram_compliant}
                        onChange={(e) => setExpForm({ ...expForm, planogram_compliant: e.target.checked })}
                        className="accent-blue-600"
                      />
                      Planograma Cumprido
                    </label>
                  </div>
                  <input
                    placeholder="Observações da organização..."
                    value={expForm.notes}
                    onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm"
                  />
                  <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">
                    Registrar Organização / Ponto Extra
                  </button>
                </form>
              )}

              {execTab === 'validade' && (
                <form onSubmit={handleSaveExpiry} className="space-y-3">
                  <ProductSelectorWithSi5
                    products={products}
                    value={valForm.product_id}
                    onChange={(pid) => setValForm({ ...valForm, product_id: pid })}
                    onCatalogUpdated={setProducts}
                    onNotify={notify}
                  />
                  <input
                    placeholder="Lote"
                    value={valForm.batch_code}
                    onChange={(e) => setValForm({ ...valForm, batch_code: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
                    <input
                      type="date"
                      value={valForm.expiry_date}
                      onChange={(e) => setValForm({ ...valForm, expiry_date: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Qtd"
                      value={valForm.quantity}
                      onChange={(e) => setValForm({ ...valForm, quantity: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <select
                      value={valForm.condition}
                      onChange={(e) => setValForm({ ...valForm, condition: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    >
                      {['Normal', 'Próximo Vencimento', 'Vencido'].map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={valForm.fifo_fefo_applied}
                        onChange={(e) => setValForm({ ...valForm, fifo_fefo_applied: e.target.checked })}
                        className="accent-blue-600"
                      />
                      PVPS Aplicado
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-red-700">
                    <input
                      type="checkbox"
                      checked={valForm.removal_requested}
                      onChange={(e) => setValForm({ ...valForm, removal_requested: e.target.checked })}
                      className="accent-red-600"
                    />
                    Produto retirado da área de vendas (vencido/avariado)
                  </label>
                  <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">
                    Registrar Validade & PVPS
                  </button>
                </form>
              )}

              {execTab === 'preco' && (
                <form onSubmit={handleSavePrice} className="space-y-3">
                  <ProductSelectorWithSi5
                    products={products}
                    value={priceForm.product_id}
                    onChange={(pid) => setPriceForm({ ...priceForm, product_id: pid })}
                    onCatalogUpdated={setProducts}
                    onNotify={notify}
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Preço Gôndola (R$)"
                      value={priceForm.gondola_price}
                      onChange={(e) => setPriceForm({ ...priceForm, gondola_price: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Preço Promo (R$)"
                      value={priceForm.promo_price}
                      onChange={(e) => setPriceForm({ ...priceForm, promo_price: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <input
                      placeholder="Concorrente"
                      value={priceForm.competitor_name}
                      onChange={(e) => setPriceForm({ ...priceForm, competitor_name: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={priceForm.has_price_tag}
                        onChange={(e) => setPriceForm({ ...priceForm, has_price_tag: e.target.checked })}
                        className="accent-blue-600"
                      />
                      Com Etiqueta
                    </label>
                  </div>
                  <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">
                    Registrar Precificação
                  </button>
                </form>
              )}

              {execTab === 'ocorrencia' && (
                <form onSubmit={handleSaveOccurrence} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={occForm.type}
                      onChange={(e) => setOccForm({ ...occForm, type: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    >
                      {['Ruptura', 'Baixo Estoque', 'Sem Exposição', 'Espaço Vazio', 'Mal Posicionado', 'Falta Material', 'Concorrente Espaço Estratégico', 'Falta de Preço', 'Baixa Visibilidade', 'Produto Vencido'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    <select
                      value={occForm.priority}
                      onChange={(e) => setOccForm({ ...occForm, priority: e.target.value })}
                      className="px-3 py-2 border rounded-xl text-sm"
                    >
                      {['Alta', 'Média', 'Baixa'].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <ProductSelectorWithSi5
                    products={products}
                    value={occForm.product_id}
                    onChange={(pid) => setOccForm({ ...occForm, product_id: pid })}
                    onCatalogUpdated={setProducts}
                    onNotify={notify}
                    allowEmpty
                    emptyLabel="Produto (Opcional)"
                  />
                  <textarea
                    required
                    rows={2}
                    placeholder="Descreva a ocorrência..."
                    value={occForm.description}
                    onChange={(e) => setOccForm({ ...occForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl text-sm"
                  />
                  <PhotoInput label="Foto da Ocorrência (Opcional)" file={occPhoto} onFileSelect={setOccPhoto} />
                  <button type="submit" className="w-full py-3 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">
                    Registrar Ocorrência
                  </button>
                </form>
              )}

              {execTab === 'checklist' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(workflow?.checklist || []).map((item: any) => (
                      <label key={item.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={Boolean(item.completed)}
                          onChange={() => handleToggleChecklist(item)}
                          className="mt-0.5 w-4 h-4 accent-blue-600"
                        />
                        <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-800 font-semibold'}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <form onSubmit={handleAddChecklist} className="flex gap-2">
                    <input
                      value={newCheckItem}
                      onChange={(e) => setNewCheckItem(e.target.value)}
                      placeholder="Adicionar atividade extra..."
                      className="flex-1 px-3 py-2 border rounded-xl text-xs"
                    />
                    <button type="submit" className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">
                      + Adicionar
                    </button>
                  </form>
                </div>
              )}

              {/* Resumo Rápido do que já foi registrado nesta visita */}
              {((workflow?.summary?.replenishments?.length || 0) > 0 ||
                (workflow?.summary?.expiries?.length || 0) > 0 ||
                (workflow?.summary?.unresolved_pendencies?.length || 0) > 0) && (
                <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                  <div className="font-bold text-slate-700">Já registrado nesta visita:</div>
                  <div className="flex flex-wrap gap-2">
                    {(workflow?.summary?.replenishments || []).map((r: any) => (
                      <span key={`rep-${r.id}`} className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 font-medium">
                        Abast.: {r.product_name} ({r.quantity_replenished} un)
                      </span>
                    ))}
                    {(workflow?.summary?.expiries || []).map((e: any) => (
                      <span key={`exp-${e.id}`} className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 font-medium">
                        Validade: {e.product_name} ({e.condition})
                      </span>
                    ))}
                    {(workflow?.summary?.unresolved_pendencies || []).map((o: any) => (
                      <span key={`occ-${o.id}`} className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 font-medium">
                        {o.type}: {o.description}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ETAPA 5 — FOTOGRAFIA FINAL & COMPARAÇÃO VISUAL */}
          {activeVisit?.status === 'Em Andamento' && activeStage === 'FOTO_FINAL' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-extrabold uppercase">
                  Etapa Obrigatória
                </span>
                <h2 className="text-base font-extrabold text-slate-900 mt-1">
                  Etapa 5 — Fotografia Final e Comparação Visual (Antes × Depois)
                </h2>
                <p className="text-xs text-slate-500">
                  Fotografe a gôndola após intervenção, pontos extras trabalhados, displays e áreas organizadas.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <label className="block text-xs font-bold text-slate-700">Área Final Fotografada</label>
                <select
                  value={finalArea}
                  onChange={(e) => setFinalArea(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white font-medium"
                >
                  {AREAS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <PhotoInput
                  label="Capturar Fotografia Final com a Câmera"
                  file={finalFile}
                  onFileSelect={setFinalFile}
                  cameraOnly
                  large
                />
                {finalFile && (
                  <button
                    disabled={uploadingPhoto}
                    onClick={() => handleUploadEvidence('FINAL', finalFile, finalArea)}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm"
                  >
                    <Camera className="w-4 h-4" />
                    {uploadingPhoto ? 'Salvando foto final...' : 'Salvar Fotografia Final'}
                  </button>
                )}
              </div>

              {/* Comparação Lado a Lado */}
              <div className="space-y-3">
                <h3 className="text-xs font-extrabold text-slate-800 uppercase">
                  Comparação Visual — {store.name} (Visita #{activeVisit.id})
                </h3>
                {(workflow?.summary?.visual_comparison || []).map((pair: any) => (
                  <div key={pair.area} className="p-4 rounded-2xl border border-slate-200 space-y-2">
                    <div className="text-xs font-extrabold text-blue-700">Área: {pair.area}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-slate-500 uppercase">Antes (Foto Inicial)</div>
                        {pair.before.length > 0 ? (
                          pair.before.map((p: any) => (
                            <div key={p.id} className="space-y-1">
                              <img src={p.photo_url} alt="Antes" className="w-full h-44 object-cover rounded-xl border" />
                              <div className="text-[11px] text-slate-500">{p.captured_at}</div>
                            </div>
                          ))
                        ) : (
                          <div className="h-44 rounded-xl bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                            Sem foto inicial nesta área
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-emerald-700 uppercase">Depois (Foto Final)</div>
                        {pair.after.length > 0 ? (
                          pair.after.map((p: any) => (
                            <div key={p.id} className="space-y-1">
                              <img src={p.photo_url} alt="Depois" className="w-full h-44 object-cover rounded-xl border border-emerald-300" />
                              <div className="text-[11px] text-slate-500 flex justify-between">
                                <span>{p.captured_at}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRetakeEvidence(p.id)}
                                  className="text-amber-700 font-bold hover:underline"
                                >
                                  Refazer
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="h-44 rounded-xl bg-amber-50 border border-dashed border-amber-300 flex items-center justify-center text-xs text-amber-700">
                            Capture a foto final desta área
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!hasFinalPhoto && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  Check-out bloqueado até o registro de pelo menos uma Fotografia Final.
                </div>
              )}

              <button
                type="button"
                disabled={!hasFinalPhoto}
                onClick={() => setViewStage('CHECKOUT')}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-extrabold rounded-2xl flex items-center justify-center gap-2 text-base"
              >
                Avançar para Check-out e Resumo Final <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ETAPA 6 — CHECK-OUT E RESUMO OPERACIONAL */}
          {activeVisit?.status === 'Em Andamento' && activeStage === 'CHECKOUT' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Etapa 6 — Resumo Operacional e Check-out</h2>
                <p className="text-xs text-slate-500">Confira os dados consolidados da visita antes de encerrar.</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Produtos Abastecidos', val: `${workflow?.summary?.replenished_items_count || 0} itens` },
                  { label: 'Qtd Total Abastecida', val: `${workflow?.summary?.total_replenished_qty || 0} un` },
                  { label: 'Retirados / Vencidos', val: `${workflow?.summary?.removed_products_qty || 0} un` },
                  { label: 'Validades Conferidas', val: workflow?.summary?.expiries_count || 0 },
                  { label: 'Rupturas', val: workflow?.summary?.ruptures_count || 0 },
                  { label: 'Ocorrências', val: workflow?.summary?.occurrences_count || 0 },
                  { label: 'Checklist Concluído', val: `${workflow?.summary?.checklist_done || 0}/${workflow?.summary?.checklist_total || 0}` },
                  { label: 'Pendências Abertas', val: workflow?.summary?.unresolved_pendencies_count || 0 },
                ].map((k) => (
                  <div key={k.label} className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[11px] text-slate-500">{k.label}</div>
                    <div className="text-lg font-extrabold text-slate-900">{k.val}</div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex flex-wrap gap-4">
                <span><Clock className="w-3.5 h-3.5 inline mr-1" /> Check-in: <b>{activeVisit.checkin_at}</b></span>
                <span>Saída prevista: <b>{new Date().toLocaleString('pt-BR')}</b></span>
                <span>Fotos Iniciais: <b>{initialPhotos.length}</b> • Fotos Finais: <b>{finalPhotos.length}</b></span>
              </div>

              <div className="space-y-3">
                <textarea
                  rows={2}
                  placeholder="Problemas encontrados ou pendências não resolvidas..."
                  value={checkoutForm.problems_found}
                  onChange={(e) => setCheckoutForm({ ...checkoutForm, problems_found: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl text-sm"
                />
                <textarea
                  rows={2}
                  placeholder="Oportunidades identificadas (espaços, pontos extras)..."
                  value={checkoutForm.opportunities_found}
                  onChange={(e) => setCheckoutForm({ ...checkoutForm, opportunities_found: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl text-sm"
                />
                <textarea
                  rows={2}
                  placeholder="Observações finais do relatório da visita..."
                  value={checkoutForm.notes}
                  onChange={(e) => setCheckoutForm({ ...checkoutForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl text-sm"
                />
              </div>

              <button
                type="button"
                disabled={!hasFinalPhoto}
                onClick={handleCheckout}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-extrabold rounded-2xl flex items-center justify-center gap-2 text-base shadow-md"
              >
                <Square className="w-5 h-5" /> Finalizar Visita (Check-out) e Salvar no Histórico
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ABA HISTÓRICO EVOLUTIVO POR LOJA */
        <div className="space-y-5">
          {storeData.recurring_issues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
              <div className="font-extrabold text-sm text-red-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Problemas Recorrentes Identificados nesta Loja
              </div>
              <div className="flex flex-wrap gap-2">
                {storeData.recurring_issues.map((ri: any) => (
                  <span key={ri.type} className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-xs font-bold">
                    {ri.type}: {ri.count} ocorrências
                  </span>
                ))}
              </div>
            </div>
          )}

          {storeData.timeline.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
              Nenhuma visita registrada nesta loja ainda. Inicie o primeiro check-in na aba Operação Atual.
            </div>
          ) : (
            <div className="space-y-4">
              {storeData.timeline.map((v: any) => (
                <div key={v.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="font-extrabold text-slate-900">
                        Visita #{v.id} — {v.scheduled_date}
                      </div>
                      <div className="text-xs text-slate-500">
                        Promotor: <b>{v.promoter_name}</b> • Check-in: {v.checkin_at || '-'} • Check-out: {v.checkout_at || '-'} ({v.duration_minutes || 0} min)
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        v.status === 'Concluída'
                          ? 'bg-emerald-100 text-emerald-700'
                          : v.status === 'Em Andamento'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {v.status}
                    </span>
                  </div>

                  {/* Métricas rápidas da visita */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-50">Abastecidos: <b>{v.total_replenished_qty} un</b></div>
                    <div className="p-2.5 rounded-xl bg-slate-50">Validades: <b>{v.expiries.length}</b></div>
                    <div className="p-2.5 rounded-xl bg-slate-50">Preços: <b>{v.price_checks.length}</b></div>
                    <div className="p-2.5 rounded-xl bg-slate-50">Exposições: <b>{v.displays.length}</b></div>
                    <div className="p-2.5 rounded-xl bg-slate-50">Ocorrências: <b>{v.occurrences.length}</b></div>
                  </div>

                  {/* Selfie na Entrada + Fotos Iniciais x Finais */}
                  {((v.evidences.selfie_entrada?.length || 0) > 0 || v.evidences.initial.length > 0 || v.evidences.final.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {(v.evidences.selfie_entrada?.length || 0) > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-indigo-700 uppercase mb-1">Selfie na Entrada</div>
                          <div className="flex flex-wrap gap-2">
                            {v.evidences.selfie_entrada.map((p: any) => (
                              <div key={p.id} className="w-28">
                                <img src={p.photo_url} alt="Selfie" className="w-28 h-20 object-cover rounded-lg border border-indigo-200" />
                                <div className="text-[10px] text-slate-500 truncate">{p.captured_at}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">Fotos Iniciais</div>
                        <div className="flex flex-wrap gap-2">
                          {v.evidences.initial.map((p: any) => (
                            <div key={p.id} className="w-28">
                              <img src={p.photo_url} alt={p.area} className="w-28 h-20 object-cover rounded-lg border" />
                              <div className="text-[10px] text-slate-500 truncate">{p.area}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-emerald-700 uppercase mb-1">Fotos Finais</div>
                        <div className="flex flex-wrap gap-2">
                          {v.evidences.final.map((p: any) => (
                            <div key={p.id} className="w-28">
                              <img src={p.photo_url} alt={p.area} className="w-28 h-20 object-cover rounded-lg border border-emerald-300" />
                              <div className="text-[10px] text-slate-500 truncate">{p.area}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {v.diagnostic && (
                    <div className="p-3 rounded-xl bg-blue-50/60 text-xs text-slate-700">
                      <b>Diagnóstico Inicial:</b> Exposição {v.diagnostic.answers?.exposicao} • Gôndola {v.diagnostic.answers?.organizacao_gondola} • Abastecimento {v.diagnostic.answers?.abastecimento}
                    </div>
                  )}

                  {v.occurrences.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-700">Ocorrências & Pendências:</div>
                      {v.occurrences.map((o: any) => (
                        <div key={o.id} className="text-xs p-2 rounded-lg bg-red-50/70 flex justify-between">
                          <span><b>{o.type}</b> ({o.priority}): {o.description}</span>
                          <span className="font-bold">{o.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAbandonModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form onSubmit={handleAbandonVisit} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <h3 className="font-extrabold text-base text-slate-900">Justificativa de Não Atendimento</h3>
            <p className="text-xs text-slate-500">Informe o motivo pelo qual não foi possível concluir a visita na loja {store.name}.</p>
            <select
              value={abandonReason}
              onChange={(e) => setAbandonReason(e.target.value)}
              className="w-full px-3 py-2.5 border rounded-xl text-sm"
            >
              {['Loja Fechada', 'Gerente Ausente / Sem Autorização', 'Reforma / Sem Acesso', 'Falta de Energia / Sistema', 'Outro'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <textarea
              rows={2}
              placeholder="Detalhes adicionais (opcional)..."
              value={abandonNotes}
              onChange={(e) => setAbandonNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAbandonModal(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">
                Voltar
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold">
                Confirmar Justificativa
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
