import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'ok' | 'err' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (type: ToastType, message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextType>({
  toast: () => {},
});

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (type: ToastType, message: string, durationMs = 4500) => {
      const id = nextIdRef.current++;
      setItems((prev) => [...prev.slice(-3), { id, type, message }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, durationMs);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {items.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 right-4 left-4 sm:left-auto sm:w-96 z-50 space-y-2 pointer-events-none"
        >
          {items.map((item) => {
            const style =
              item.type === 'ok'
                ? 'bg-emerald-700 text-white border-emerald-500'
                : item.type === 'err'
                ? 'bg-red-700 text-white border-red-500'
                : 'bg-slate-900 text-white border-slate-700';
            const Icon = item.type === 'ok' ? CheckCircle2 : item.type === 'err' ? AlertTriangle : Info;
            return (
              <div
                key={item.id}
                className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-2xl border shadow-xl text-xs sm:text-sm font-semibold ${style}`}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 leading-snug">{item.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="p-0.5 rounded hover:bg-white/20 shrink-0"
                  aria-label="Fechar aviso"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
