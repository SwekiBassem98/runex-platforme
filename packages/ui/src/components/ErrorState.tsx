'use client';

import React from 'react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Une erreur est survenue',
  message = 'Impossible de charger les données opérationnelles. Veuillez vérifier votre connexion ou réessayer.',
  onRetry,
  className = '',
}: ErrorStateProps) {
  const { libelles } = useLibellesUI();
  return (
    <div
      className={`p-6 sm:p-8 text-center flex flex-col items-center justify-center bg-white rounded-lg border border-red-200 bg-red-50/20 ${className}`}
    >
      <div className="p-3 bg-red-100 rounded-full mb-3 text-red-600">
        <AlertCircle className="w-6 h-6" aria-hidden="true" />
      </div>
      <h4 className="text-sm font-bold text-slate-900 mb-1">{title}</h4>
      <p className="text-xs text-slate-600 max-w-sm mb-4 leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{libelles['erreur.reessayer']}</span>
        </button>
      )}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const { libelles } = useLibellesUI();
  return (
    /* `role="alert"` : un bandeau d'erreur qui apparaît après une requête ne se
       devine pas — il faut qu'il soit annoncé, sinon l'échec de chargement n'a
       aucun signe pour qui ne voit pas la couleur. */
    <div
      role="alert"
      className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-3 text-xs text-red-800"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
        <span className="font-medium">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={libelles['erreur.masquer']}
          className="text-red-500 hover:text-red-700 font-bold ms-2 shrink-0 cursor-pointer"
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
