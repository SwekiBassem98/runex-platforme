'use client';

import React from 'react';

export type StatusType = 'online' | 'offline' | 'busy' | 'transit' | 'delivered' | 'alert';

interface StatusIndicatorProps {
  status: StatusType;
  label?: string;
  pulse?: boolean;
}

export function StatusIndicator({ status, label, pulse = false }: StatusIndicatorProps) {
  const dotColor = {
    online: 'bg-emerald-500',
    offline: 'bg-slate-400',
    busy: 'bg-amber-500',
    transit: 'bg-blue-500',
    delivered: 'bg-emerald-600',
    alert: 'bg-red-500',
  }[status];

  return (
    <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColor}`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
      </span>
      {label && <span>{label}</span>}
    </div>
  );
}
