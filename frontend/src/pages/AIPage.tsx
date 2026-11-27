import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, XCircle, Edit3, Sparkles } from 'lucide-react';
import { apiFetch } from '../services/api';
import { PhotoInput } from '../components/PhotoInput';
import { useToast } from '../context/ToastContext';

export const AIPage: React.FC = () => {
  const { toast } = useToast();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [storeId, setStoreId] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [adjustNotes, setAdjustNotes] = useState('');

  const load = async () => {
    try {
      const [a, s] = await Promise.all([apiFetch('/ai/analyses'), apiFetch('/stores')]);
      setAnalyses(Array.isArray(a) ? a : []);
      setStores(Array.isArray(s) ? s : []);
      if (Array.isArray(s) && s.length && !storeId) setStoreId(String(s[0].id));
    } catch (err: any) {
      toast('err', err.message || 'Erro ao carregar histórico de análises.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append('store_id', storeId);
      fd.append('notes', notes);
      if (photo) fd.append('photo', photo);
      const res = await apiFetch<any>('/ai/analyze-shelf', { method: 'POST', body: fd });
      setPhoto(null);
      setNotes('');
      if (res?.offlineQueued) {
        toast('info', 'Foto salva na fila offline e será analisada automaticamente ao reconectar.');
      } else {
        toast(
          'ok',
          res?.analysis_mode === 'groq_vision'
            ? 'Análise concluída com Groq Vision (IA Real)!'
            : res?.analysis_mode === 'gemini_vision'
            ? 'Análise concluída com Gemini Vision (IA Real)!'
            : 'Análise gerada em Modo Heurístico (configure GROQ_API_KEY ou GEMINI_API_KEY para visão real).'
        );
        await load();
      }
    } catch (err: any) {
      toast('err', err.message || 'Falha ao executar análise de gôndola.');
    } finally {
      setAnalyzing(false);
    }
  };

  const validate = async (id: number, decision: 'Confirmado' | 'Ajustado' | 'Rejeitado', human_notes = '') => {
    try {
      await apiFetch(`/ai/analyses/${id}/validate`, {
        method: 'PATCH',
        body: JSON.stringify({ human_validation: decision, human_notes }),
      });
      setAdjustingId(null);
      setAdjustNotes('');
      toast('ok', `Validação atualizada para "${decision}".`);
      await load();
    } catch (err: any) {
      toast('err', err.message || 'Erro ao salvar validação.');
    }
  };

  const renderModeBadge = (mode?: string, model?: string) => {
    if (mode === 'groq_vision') {
      return (
        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold" title={model}>
          Groq Vision (IA Real)
        </span>
      );
    }
    if (mode === 'gemini_vision') {
      return (
        <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-extrabold" title={model}>
          Gemini Vision (IA Real)
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-extrabold">
        Modo Heurístico (Histórico)
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <Bot className="w-6 h-6 text-indigo-600" /> Inteligência Artificial para Gôndolas
        </h1>
        <p className="text-sm text-slate-500">
          Análise visual de fotografias (Groq Vision / Gemini Vision), detecção de rupturas, conferência de planograma e validação humana
        </p>
      </div>

      <form onSubmit={handleAnalyze} className="bg-white p-5 rounded-2xl border border-indigo-200 shadow-xs space-y-4">
        <div className="font-bold text-sm text-indigo-900 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600" /> Nova Análise Inteligente de Gôndola
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="px-3 py-2 border rounded-xl text-sm">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="Contexto adicional (opcional, ex: corredor de salgadinhos)" value={notes} onChange={(e) => setNotes(e.target.value)} className="px-3 py-2 border rounded-xl text-sm" />
        </div>
        <PhotoInput label="Fotografar ou Enviar Foto da Gôndola" file={photo} onFileSelect={setPhoto} />
        <button
          type="submit"
          disabled={analyzing}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow disabled:opacity-60"
        >
          {analyzing ? 'Analisando imagem...' : 'Executar Análise com IA'}
        </button>
      </form>

      <div className="space-y-4">
        {analyses.map((a) => {
          const safeParse = (raw: string) => {
            try {
              return JSON.parse(raw || '[]');
            } catch {
              return [];
            }
          };
          const ruptures: string[] = safeParse(a.detected_ruptures_json);
          const brands: any[] = safeParse(a.detected_brands_json);
          const issues: string[] = safeParse(a.exposure_issues_json);
          const suggestions: string[] = safeParse(a.suggestions_json);
          const extraPoints: string[] = safeParse(a.extra_point_opportunities_json);
          const annotations: Array<{ label: string; category: string; box_2d: number[] }> = safeParse(a.annotations_json);

          return (
            <div key={a.id} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div>
                  <div className="font-bold text-slate-900">{a.store_name || 'PDV'} — Análise #{a.id}</div>
                  <div className="text-xs text-slate-500">{a.created_at} • Planograma: <b>{a.planogram_score}%</b></div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {renderModeBadge(a.analysis_mode, a.model_used)}
                  {Number(a.confidence) > 0 && (
                    <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-extrabold">
                      Confiança: {a.confidence}%
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    a.human_validation === 'Confirmado' ? 'bg-emerald-100 text-emerald-700' :
                    a.human_validation === 'Rejeitado' ? 'bg-red-100 text-red-700' :
                    a.human_validation === 'Ajustado' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                  }`}>
                    Validação: {a.human_validation}
                  </span>
                </div>
              </div>

              {(a.image_url || a.annotated_image_url) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {a.image_url && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                        <span>Foto Original (HD)</span>
                        <a href={a.image_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          Abrir original
                        </a>
                      </div>
                      <img src={a.image_url} alt="Gôndola original" className="w-full max-h-72 rounded-xl border object-contain bg-slate-950/5" />
                    </div>
                  )}
                  {a.annotated_image_url && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-indigo-700">
                        <span>Foto Demarcada pela IA ({annotations.length} área(s))</span>
                        <a href={a.annotated_image_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                          Abrir demarcada (HD)
                        </a>
                      </div>
                      <img src={a.annotated_image_url} alt="Gôndola demarcada pela IA" className="w-full max-h-72 rounded-xl border border-indigo-200 object-contain bg-slate-950/5" />
                    </div>
                  )}
                </div>
              )}

              {annotations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {annotations.map((ann, idx) => (
                    <span
                      key={idx}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        ann.category === 'rupture'
                          ? 'bg-red-100 text-red-700'
                          : ann.category === 'brand'
                          ? 'bg-blue-100 text-blue-700'
                          : ann.category === 'opportunity'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      #{idx + 1} {ann.label}
                    </span>
                  ))}
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-50 text-xs text-slate-700">
                <b>Relatório Automático:</b> {a.auto_report}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <div className="font-bold text-red-700">Possíveis Rupturas Identificadas</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                    {ruptures.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
                <div className="space-y-1">
                  <div className="font-bold text-blue-700">Marcas & Frentes Reconhecidas</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                    {brands.map((b, i) => (
                      <li key={i}>{b.brand}: {b.facings > 0 ? `~${b.facings} frentes` : 'conferir na gôndola'}</li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-1">
                  <div className="font-bold text-amber-700">Problemas de Exposição & Sugestões</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                    {issues.map((is, i) => <li key={i}>{is}</li>)}
                    {suggestions.map((sg, i) => <li key={`s${i}`} className="text-emerald-700">{sg}</li>)}
                  </ul>
                </div>
                <div className="space-y-1">
                  <div className="font-bold text-purple-700">Oportunidades de Pontos Extras</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                    {extraPoints.map((ep, i) => <li key={i}>{ep}</li>)}
                  </ul>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <button type="button" onClick={() => validate(a.id, 'Confirmado')} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar Análise
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdjustingId(adjustingId === a.id ? null : a.id);
                    setAdjustNotes(a.human_notes || '');
                  }}
                  className="px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-xl flex items-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Ajustar
                </button>
                <button type="button" onClick={() => validate(a.id, 'Rejeitado')} className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-xl flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Rejeitar
                </button>
                {a.human_notes && <span className="text-xs text-slate-500 self-center ml-2">Nota humana: {a.human_notes}</span>}
              </div>

              {adjustingId === a.id && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <input
                    type="text"
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                    placeholder="Descreva o ajuste humano realizado..."
                    className="flex-1 min-w-[220px] px-3 py-1.5 border rounded-xl text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => validate(a.id, 'Ajustado', adjustNotes)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-xl"
                  >
                    Salvar Ajuste
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
