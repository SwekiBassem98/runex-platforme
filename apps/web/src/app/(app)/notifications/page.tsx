'use client';

/**
 * Centre de notifications.
 *
 * L'écran n'invente rien : catégories et libellés viennent du catalogue
 * partagé, la liste et le compteur de l'API, et la mise à jour en direct arrive
 * par la socket. Un clic sur une ligne la relit et ouvre l'objet concerné.
 */

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, Check, Filter, RefreshCw } from 'lucide-react';
import {
  NOTIFICATION_EVENT_META,
  NotificationEvent,
  type NotificationCategory,
} from '@logixpress/types';
import { notificationsApi } from '@/lib/notification-api';
import { useNotifications } from '@/lib/notification-provider';

type Filtre = 'toutes' | 'non-lues' | NotificationCategory;

const FILTRES: { id: Filtre; label: string }[] = [
  { id: 'toutes', label: 'Toutes' },
  { id: 'non-lues', label: 'Non lues' },
  { id: 'colis', label: 'Colis' },
  { id: 'livraison', label: 'Livraison' },
  { id: 'finance', label: 'Finance' },
  { id: 'tournee', label: 'Tournée' },
  { id: 'transfert', label: 'Transfert' },
];

/** Pastille de catégorie, alignée sur la charte de la barre supérieure. */
const CATEGORY_STYLE: Record<NotificationCategory, string> = {
  colis: 'bg-blue-50 text-blue-700 border-blue-200',
  livraison: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  finance: 'bg-red-50 text-red-700 border-red-200',
  tournee: 'bg-amber-50 text-amber-700 border-amber-200',
  transfert: 'bg-purple-50 text-purple-700 border-purple-200',
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString('fr-TN');
}

export default function NotificationsPage() {
  const router = useRouter();
  const { items, unread, isLoading, isConnected, error, markRead, markAllRead, refresh } =
    useNotifications();
  const [filtre, setFiltre] = useState<Filtre>('toutes');

  const visible = useMemo(() => {
    if (filtre === 'toutes') return items;
    if (filtre === 'non-lues') return items.filter((n) => !n.isRead);
    return items.filter((n) => n.category === filtre);
  }, [items, filtre]);

  return (
    <div className="flex-1 p-4 lg:p-6 space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            Centre de notifications
            {unread > 0 && (
              <span className="text-[11px] font-mono font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                {unread} non lues
              </span>
            )}
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
            {isConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Mises à jour en direct
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Connexion temps réel interrompue — la liste peut être incomplète
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualiser
          </button>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unread === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:text-slate-300 disabled:bg-slate-50 disabled:border-slate-200 transition"
          >
            <Check className="w-3.5 h-3.5" />
            Tout marquer comme lu
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-slate-500" />
        {FILTRES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltre(f.id)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition ${
              filtre === f.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste */}
      {error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-[11px] text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
        {isLoading && items.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <BellOff className="w-8 h-8 mx-auto mb-2" />
            <p className="text-xs">
              {filtre === 'non-lues'
                ? 'Aucune notification non lue.'
                : 'Aucune notification pour ce filtre.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => {
                    void markRead(notification.id);
                    if (notification.href) router.push(notification.href);
                  }}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition ${
                    notification.isRead ? '' : 'bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {!notification.isRead && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                        )}
                        <p className="text-xs font-bold text-slate-900">{notification.title}</p>
                        <span
                          className={`text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                            CATEGORY_STYLE[notification.category] ?? CATEGORY_STYLE.colis
                          }`}
                        >
                          {NOTIFICATION_EVENT_META[
                            notification.type as NotificationEvent
                          ]?.label ?? notification.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        {notification.content}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 font-mono">
                        {relativeTime(notification.createdAt)}
                        {notification.relatedEntityId && ` · ${notification.relatedEntity}`}
                      </p>
                    </div>

                    <Bell className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 0 && visible.length !== items.length && (
        <p className="text-[11px] text-slate-500 text-center">
          {visible.length} affichée{visible.length > 1 ? 's' : ''} sur {items.length} récentes. Les
          notifications plus anciennes sont conservées en base et Hors de cet écran.
        </p>
      )}
    </div>
  );
}