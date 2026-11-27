import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || 'Erro inesperado na interface.' };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary capturou erro:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-red-200 shadow-xl max-w-md w-full p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-extrabold text-slate-900">Ops! Algo saiu do esperado</h1>
              <p className="text-xs text-slate-500">
                Seus dados salvos no servidor e na fila offline estão protegidos.
              </p>
              {this.state.errorMessage && (
                <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-600 break-words">
                  {this.state.errorMessage}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-center pt-1">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMessage: '' })}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Home className="w-4 h-4" /> Voltar
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" /> Recarregar App
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
