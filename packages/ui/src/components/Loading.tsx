'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeClasses = {
    sm: 'w-3.5 h-3.5',
    md: 'w-5 h-5',
    lg: 'w-8 h-8',
  }[size];

  return <Loader2 className={`animate-spin text-red-600 ${sizeClasses} ${className}`} aria-hidden="true" />;
}

export function LoadingOverlay({ message = 'Chargement des données...' }: { message?: string }) {
  /*
   * `absolute` : le calque se pose sur le premier ancêtre positionné. Hors d'un
   * conteneur `relative`, c'est souvent la racine — et l'écran se voile
   * entièrement au lieu de montrer que la zone attend.
   */
  return (
    <div
      role="status"
      className="absolute inset-0 bg-white/70 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-20"
    >
      <Spinner size="lg" />
      <span className="mt-3 text-xs font-semibold text-slate-700">{message}</span>
    </div>
  );
}
