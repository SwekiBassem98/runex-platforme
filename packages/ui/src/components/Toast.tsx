'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { libelles } = useLibellesUI();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  /** Minuterie de disparition, pour la suspendre au survol et au focus. */
  const minuteries = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(minuteries.current[id]);
    delete minuteries.current[id];
  }, []);

  const addToast = useCallback(
    ({ type, title, message, duration = 4000 }: Omit<ToastItem, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, title, message, duration }]);
      if (duration > 0) {
        minuteries.current[id] = setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast]
  );

  /**
   * Suspende la disparition pendant la lecture.
   *
   * Un message d'erreur qui s'efface au bout de quatre secondes alors qu'on est
   * en train de le lire n'a jamais été lu. On suspend donc au survol comme au
   * focus clavier — la durée reprend au retrait.
   */
  const suspendre = (id: string) => clearTimeout(minuteries.current[id]);
  const reprendre = (toast: ToastItem) => {
    if (!toast.duration || toast.duration <= 0) return;
    clearTimeout(minuteries.current[toast.id]);
    minuteries.current[toast.id] = setTimeout(() => removeToast(toast.id), toast.duration);
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/*
        La pile est ancrée sur les deux bords sous 640 px. Ancrée à droite avec
        une largeur de 100 %, elle débordait de 16 px à gauche : le bord gauche
        de la notification était coupé, et c'est là que commence le titre.
      */}
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-4 bottom-4 sm:start-auto sm:end-4 z-50 flex flex-col gap-2 sm:w-full sm:max-w-sm pointer-events-none"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onMouseEnter={() => suspendre(toast.id)}
            onMouseLeave={() => reprendre(toast)}
            onFocus={() => suspendre(toast.id)}
            onBlur={() => reprendre(toast)}
            className={`pointer-events-auto p-3.5 rounded-lg border shadow-lg flex items-start gap-3 bg-white text-slate-900 transition-all transform animate-in slide-in-from-bottom-2 ${
              toast.type === 'success'
                ? 'border-emerald-200 bg-emerald-50/50'
                : toast.type === 'error'
                ? 'border-red-200 bg-red-50/50'
                : toast.type === 'warning'
                ? 'border-amber-200 bg-amber-50/50'
                : 'border-slate-200'
            }`}
          >
            {toast.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" aria-hidden="true" />
            )}
            {toast.type === 'warning' && (
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            )}
            {toast.type === 'info' && (
              <Info className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" aria-hidden="true" />
            )}

            <div className="flex-1 min-w-0 text-xs">
              <h4 className="font-semibold text-slate-900">{toast.title}</h4>
              {toast.message && <p className="text-slate-600 mt-0.5 leading-relaxed">{toast.message}</p>}
            </div>

            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label={libelles['toast.fermer']}
              className="text-slate-400 hover:text-slate-600 transition p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
