'use client';

import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon = <Inbox className="w-8 h-8 text-slate-400" aria-hidden="true" />,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`p-6 sm:p-8 text-center flex flex-col items-center justify-center bg-white rounded-lg border border-dashed border-slate-300 ${className}`}
    >
      <div className="p-3 bg-slate-50 rounded-full mb-3 border border-slate-100">{icon}</div>
      <h4 className="text-sm font-bold text-slate-900 mb-1">{title}</h4>
      <p className="text-xs text-slate-500 max-w-sm mb-4 leading-relaxed">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
