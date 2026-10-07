'use client';

import React from 'react';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, badge, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-slate-200 bg-white px-4 sm:px-6 py-4 space-y-2">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="mb-1">
          <Breadcrumbs items={breadcrumbs} />
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* `min-w-0` + `flex-wrap` : un titre d'exploitation long doit passer à la
            ligne et repousser le badge, pas sortir de l'écran ni le chevaucher. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight break-words">{title}</h1>
          {badge}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="text-xs text-slate-500 leading-normal">{description}</p>}
    </div>
  );
}
