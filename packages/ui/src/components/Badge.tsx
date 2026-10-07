'use client';

import React from 'react';

export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'outline';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'sm', className = '' }: BadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  const variantClasses = {
    default: 'bg-slate-100 text-slate-700 border-slate-200',
    primary: 'bg-red-50 text-red-700 border-red-200',
    secondary: 'bg-slate-900 text-slate-100 border-slate-800',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-100 text-red-800 border-red-300 font-semibold',
    outline: 'bg-transparent text-slate-700 border-slate-300',
  }[variant];

  return (
    <span
      className={`inline-flex items-center font-medium rounded border ${sizeClasses} ${variantClasses} ${className}`}
    >
      {children}
    </span>
  );
}
