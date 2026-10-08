'use client';

import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
}

export function Card({ children, className = '', title, subtitle, action, footer }: CardProps) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            {typeof title === 'string' ? (
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
            ) : (
              title
            )}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">{footer}</div>}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  description?: string;
  icon?: React.ReactNode;
  badge?: string;
}

export function MetricCard({
  title,
  value,
  change,
  trend = 'neutral',
  description,
  icon,
  badge,
}: MetricCardProps) {
  return (
    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
        {icon && <div className="text-slate-400">{icon}</div>}
        {badge && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-700">
            {badge}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900 tracking-tight">{value}</span>
        {change && (
          <span
            className={`inline-flex items-center text-xs font-medium ${
              trend === 'up'
                ? 'text-emerald-600'
                : trend === 'down'
                ? 'text-red-600'
                : 'text-slate-500'
            }`}
          >
            {trend === 'up' && <ArrowUpRight className="w-3.5 h-3.5 me-0.5" />}
            {trend === 'down' && <ArrowDownRight className="w-3.5 h-3.5 me-0.5" />}
            {trend === 'neutral' && <Minus className="w-3 h-3 me-0.5" />}
            {change}
          </span>
        )}
      </div>

      {description && <p className="text-xs text-slate-500 mt-1 truncate">{description}</p>}
    </div>
  );
}
