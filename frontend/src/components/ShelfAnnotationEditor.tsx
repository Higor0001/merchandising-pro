import React, { useRef, useState } from 'react';
import { Trash2, RotateCcw, Send, Save, PlusSquare, CheckCircle2 } from 'lucide-react';

export type AnnotationCategory = 'rupture' | 'brand' | 'exposure' | 'opportunity';

export interface ShelfAnnotation {
  label: string;
  category: AnnotationCategory;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] em 0..1000
}

const CATEGORIES: Array<{ id: AnnotationCategory; label: string; color: string; badge: string; defaultLabel: string }> = [
  { id: 'rupture', label: 'Ruptura', color: '#ef4444', badge: 'bg-red-600 text-white', defaultLabel: 'Ruptura / Espaço vazio' },
  { id: 'brand', label: 'Marca', color: '#2563eb', badge: 'bg-blue-600 text-white', defaultLabel: 'Bloco de marca' },
  { id: 'exposure', label: 'Exposição / Preço', color: '#f59e0b', badge: 'bg-amber-500 text-slate-950', defaultLabel: 'Ajuste de exposição / etiqueta' },
  { id: 'opportunity', label: 'Oportunidade', color: '#9333ea', badge: 'bg-purple-600 text-white', defaultLabel: 'Oportunidade ponto extra' },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<AnnotationCategory, (typeof CATEGORIES)[number]>;

type DragMode =
  | { type: 'draw'; startX: number; startY: number }
  | { type: 'move'; idx: number; startX: number; startY: number; origBox: [number, number, number, number] }
  | { type: 'resize'; idx: number; corner: 'nw' | 'ne' | 'sw' | 'se'; origBox: [number, number, number, number] };

interface ShelfAnnotationEditorProps {
  imageUrl: string;
  initialAnnotations: ShelfAnnotation[];
  initialNotes?: string;
  submitting?: boolean;
  onConfirmAndSend: (annotations: ShelfAnnotation[], notes: string, sendToTelegram: boolean) => Promise<void>;
  onCancel?: () => void;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export const ShelfAnnotationEditor: React.FC<ShelfAnnotationEditorProps> = ({
  imageUrl,
  initialAnnotations,
  initialNotes = '',
  submitting = false,
  onConfirmAndSend,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<ShelfAnnotation[]>(() =>
    initialAnnotations.map((a) => ({ ...a, box_2d: [...a.box_2d] as [number, number, number, number] }))
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialAnnotations.length > 0 ? 0 : null);
  const [activeCategory, setActiveCategory] = useState<AnnotationCategory>('rupture');
  const [notes, setNotes] = useState(initialNotes);
  const [draftBox, setDraftBox] = useState<[number, number, number, number] | null>(null);
  const dragRef = useRef<DragMode | null>(null);

  const getNormPoint = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = clamp(Math.round(((e.clientX - rect.left) / rect.width) * 1000), 0, 1000);
    const y = clamp(Math.round(((e.clientY - rect.top) / rect.height) * 1000), 0, 1000);
    return { x, y };
  };

  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).dataset.role !== 'bg-img') return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = getNormPoint(e);
    dragRef.current = { type: 'draw', startX: x, startY: y };
    setDraftBox([y, x, y, x]);
  };

  const handleBoxPointerDown = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    setSelectedIdx(idx);
    const { x, y } = getNormPoint(e);
    dragRef.current = {
      type: 'move',
      idx,
      startX: x,
      startY: y,
      origBox: [...annotations[idx].box_2d] as [number, number, number, number],
    };
  };

  const handleCornerPointerDown = (e: React.PointerEvent, idx: number, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    setSelectedIdx(idx);
    dragRef.current = {
      type: 'resize',
      idx,
      corner,
      origBox: [...annotations[idx].box_2d] as [number, number, number, number],
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const { x, y } = getNormPoint(e);

    if (drag.type === 'draw') {
      const ymin = Math.min(drag.startY, y);
      const ymax = Math.max(drag.startY, y);
      const xmin = Math.min(drag.startX, x);
      const xmax = Math.max(drag.startX, x);
      setDraftBox([ymin, xmin, ymax, xmax]);
      return;
    }

    if (drag.type === 'move') {
      const [oy1, ox1, oy2, ox2] = drag.origBox;
      const h = oy2 - oy1;
      const w = ox2 - ox1;
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const nx1 = clamp(ox1 + dx, 0, 1000 - w);
      const ny1 = clamp(oy1 + dy, 0, 1000 - h);
      setAnnotations((prev) =>
        prev.map((a, i) => (i === drag.idx ? { ...a, box_2d: [ny1, nx1, ny1 + h, nx1 + w] } : a))
      );
      return;
    }

    if (drag.type === 'resize') {
      let [y1, x1, y2, x2] = drag.origBox;
      if (drag.corner.includes('n')) y1 = clamp(y, 0, y2 - 30);
      if (drag.corner.includes('s')) y2 = clamp(y, y1 + 30, 1000);
      if (drag.corner.includes('w')) x1 = clamp(x, 0, x2 - 30);
      if (drag.corner.includes('e')) x2 = clamp(x, x1 + 30, 1000);
      setAnnotations((prev) =>
        prev.map((a, i) => (i === drag.idx ? { ...a, box_2d: [y1, x1, y2, x2] } : a))
      );
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.type === 'draw' && draftBox) {
      const [y1, x1, y2, x2] = draftBox;
      setDraftBox(null);
      if (y2 - y1 >= 25 && x2 - x1 >= 25) {
        const catInfo = CATEGORY_MAP[activeCategory];
        const nextIdx = annotations.length;
        setAnnotations((prev) => [
          ...prev,
          { label: catInfo.defaultLabel, category: activeCategory, box_2d: [y1, x1, y2, x2] },
        ]);
        setSelectedIdx(nextIdx);
      }
    }
  };

  const selected = selectedIdx !== null ? annotations[selectedIdx] || null : null;

  const updateSelected = (patch: Partial<ShelfAnnotation>) => {
    if (selectedIdx === null) return;
    setAnnotations((prev) => prev.map((a, i) => (i === selectedIdx ? { ...a, ...patch } : a)));
  };

  const deleteSelected = () => {
    if (selectedIdx === null) return;
    setAnnotations((prev) => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  };

  const resetToAI = () => {
    setAnnotations(initialAnnotations.map((a) => ({ ...a, box_2d: [...a.box_2d] as [number, number, number, number] })));
    setSelectedIdx(initialAnnotations.length > 0 ? 0 : null);
  };

  return (
    <div className="p-4 rounded-2xl border-2 border-indigo-300 bg-indigo-50/40 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-extrabold text-indigo-950 flex items-center gap-1.5">
            <PlusSquare className="w-4 h-4 text-indigo-600" />
            Editor Visual de Precisão 100% (Antes de Enviar ao Telegram)
          </div>
          <p className="text-xs text-slate-600">
            Arraste na imagem para criar uma nova área, toque em uma caixa para mover ou puxe os cantos para redimensionar.
          </p>
        </div>
        <button
          type="button"
          onClick={resetToAI}
          className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-700 flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Restaurar IA
        </button>
      </div>

      {/* Seletor de categoria para novas demarcações */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-bold text-slate-600 mr-1">Nova área:</span>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategory(c.id)}
            className={`px-2.5 py-1 rounded-full font-bold border transition ${
              activeCategory === c.id ? `${c.badge} border-transparent shadow-xs` : 'bg-white text-slate-700 border-slate-300'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Área interativa da fotografia */}
      <div className="flex justify-center bg-slate-950 rounded-xl overflow-hidden border border-slate-300">
        <div
          ref={containerRef}
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative inline-block max-w-full touch-none select-none cursor-crosshair"
        >
          <img
            src={imageUrl}
            alt="Revisão visual da gôndola"
            data-role="bg-img"
            draggable={false}
            className="block max-h-[65vh] w-auto max-w-full object-contain pointer-events-auto"
          />

          {annotations.map((ann, idx) => {
            const [y1, x1, y2, x2] = ann.box_2d;
            const cat = CATEGORY_MAP[ann.category] || CATEGORY_MAP.exposure;
            const isSel = selectedIdx === idx;
            return (
              <div
                key={idx}
                onPointerDown={(e) => handleBoxPointerDown(e, idx)}
                style={{
                  top: `${y1 / 10}%`,
                  left: `${x1 / 10}%`,
                  width: `${(x2 - x1) / 10}%`,
                  height: `${(y2 - y1) / 10}%`,
                  borderColor: cat.color,
                  backgroundColor: `${cat.color}${isSel ? '30' : '1f'}`,
                }}
                className={`absolute border-[3px] rounded-md cursor-move ${isSel ? 'ring-2 ring-white shadow-lg z-20' : 'z-10'}`}
              >
                <span
                  style={{ backgroundColor: cat.color }}
                  className="absolute -top-6 left-0 px-1.5 py-0.5 rounded text-[10px] font-extrabold text-white whitespace-nowrap shadow max-w-[200px] truncate"
                >
                  #{idx + 1} {ann.label}
                </span>

                {isSel &&
                  (['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
                    const pos =
                      corner === 'nw'
                        ? '-top-2 -left-2 cursor-nwse-resize'
                        : corner === 'ne'
                        ? '-top-2 -right-2 cursor-nesw-resize'
                        : corner === 'sw'
                        ? '-bottom-2 -left-2 cursor-nesw-resize'
                        : '-bottom-2 -right-2 cursor-nwse-resize';
                    return (
                      <div
                        key={corner}
                        onPointerDown={(e) => handleCornerPointerDown(e, idx, corner)}
                        className={`absolute w-4 h-4 rounded-full bg-white border-2 border-slate-900 shadow ${pos}`}
                      />
                    );
                  })}
              </div>
            );
          })}

          {draftBox && (
            <div
              style={{
                top: `${draftBox[0] / 10}%`,
                left: `${draftBox[1] / 10}%`,
                width: `${(draftBox[3] - draftBox[1]) / 10}%`,
                height: `${(draftBox[2] - draftBox[0]) / 10}%`,
                borderColor: CATEGORY_MAP[activeCategory].color,
              }}
              className="absolute border-2 border-dashed bg-white/15 pointer-events-none z-30"
            />
          )}
        </div>
      </div>

      {/* Edição da caixa selecionada */}
      {selected && selectedIdx !== null && (
        <div className="p-3 bg-white rounded-xl border border-indigo-200 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-extrabold text-indigo-700">Área #{selectedIdx + 1}:</span>
          <input
            type="text"
            value={selected.label}
            onChange={(e) => updateSelected({ label: e.target.value })}
            placeholder="Descrição da demarcação..."
            className="flex-1 min-w-[180px] px-2.5 py-1.5 border rounded-lg text-xs"
          />
          <select
            value={selected.category}
            onChange={(e) => updateSelected({ category: e.target.value as AnnotationCategory })}
            className="px-2.5 py-1.5 border rounded-lg text-xs bg-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={deleteSelected}
            className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remover
          </button>
        </div>
      )}

      {/* Nota opcional e ações finais */}
      <div className="space-y-2.5 pt-1">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observação final da validação humana (opcional)..."
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => onConfirmAndSend(annotations, notes, true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shadow"
          >
            <Send className="w-4 h-4" />
            {submitting ? 'Gerando HD e enviando...' : `Confirmar 100% e Enviar HD ao Telegram (${annotations.length} área(s))`}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onConfirmAndSend(annotations, notes, false)}
            className="px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> Salvar HD (sem Telegram)
          </button>
          {onCancel && (
            <button
              type="button"
              disabled={submitting}
              onClick={onCancel}
              className="px-3 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Fechar Editor
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
