'use client';

import React from 'react';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500"
    >
      {/*
        Le premier maillon est l'accueil, et il doit être un lien : un élément
        qui ressemble à un lien et n'en est pas un — pas de clic droit, pas de
        copie, pas d'onglet moyen — apprend à l'utilisateur que le fil est décoratif.
      */}
      <a
        href="/"
        aria-label="Accueil"
        className="flex items-center gap-1 min-w-6 min-h-6 justify-center px-1 -mx-1 rounded hover:text-slate-900 transition"
      >
        <Home className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
      </a>
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          <ChevronRight className="w-3 h-3 text-slate-400" aria-hidden="true" />
          {item.active ? (
            <span className="font-semibold text-slate-900" aria-current="page">
              {item.label}
            </span>
          ) : item.href ? (
            <a
              href={item.href}
              onClick={item.onClick}
              className="inline-flex items-center min-h-6 px-1 -mx-1 rounded hover:text-slate-900 hover:underline transition"
            >
              {item.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={item.onClick}
              className="inline-flex items-center min-h-6 px-1 -mx-1 rounded hover:text-slate-900 hover:underline transition cursor-pointer"
            >
              {item.label}
            </button>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
