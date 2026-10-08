'use client';

/**
 * Centre de notifications du portail expéditeur.
 *
 * Les notifications sont déjà cloisonnées par utilisateur : `GET /notifications`
 * ne renvoie que celles de la session ouverte, et c'est aussi vrai du compteur.
 * L'écran n'a donc aucun filtre de périmètre à appliquer — il n'y en a pas à
 * écrire, et surtout pas à laisser deviner au client.
 *
 * Une seule adaptation au portail : `NotificationDto.href` pointe vers les écrans
 * de l'exploitation (`/colis/…`, `/paiements/…`). Une notification qui emmène
 * un expéditeur hors de son espace le ramène devant un écran interdit, ou devant
 * celui d'un autre compte. Les routes sont donc retraduites ici, et uniquement
 * pour les entités que l'API connaît.
 *
 * ## Langue
 *
 * Les filtres, les boutons et les états vides sont lus dans le dictionnaire ;
 * les catégories de notification passent par `traduireValeur`, qui retrouve le
 * mot dans la langue courante à partir de l'identifiant que l'API renvoie. Ni le
 * titre ni le contenu d'une notification ne sont traduits ici : ce sont des
 * textes produits par l'API, déjà rédigés par le serveur.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, Check, RefreshCw } from 'lucide-react';
import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationDto,
} from '@logixpress/types';
import { useNotifications } from '@/lib/notification-provider';
import { useI18n } from '@/i18n';
import { useVocabulaire } from '@/features/expediteur/lib/libelles';

type Filtre = 'toutes' | 'non-lues' | NotificationCategory;

/**
 * Filtres de la barre, dans l'ordre d'affichage.
 *
 * Ce sont des identifiants, pas des mots : les deux premiers se lisent dans le
 * dictionnaire, les suivants sont les catégories que l'API connaît. Un libellé
 * figé ici resterait français après un changement de langue.
 */
const FILTRES: Filtre[] = [
  'toutes',
  'non-lues',
  ...(Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]),
];

const CATEGORY_STYLE: Record<NotificationCategory, string> = {
  colis: 'bg-blue-50 text-blue-700 border-blue-200',
  livraison: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  finance: 'bg-red-50 text-red-700 border-red-200',
  tournee: 'bg-amber-50 text-amber-700 border-amber-200',
  transfert: 'bg-purple-50 text-purple-700 border-purple-200',
};

/** Route du portail correspondant à l'entité liée, jamais celle de l'exploitation. */
function routePortail(notification: NotificationDto): string | null {
  switch (notification.relatedEntity) {
    case 'PACKAGE':
      return notification.relatedEntityId
        ? `/expediteur/colis/${notification.relatedEntityId}`
        : '/expediteur/colis';
    case 'RAMASSAGE':
      return '/expediteur/ramassages';
    case 'PAYMENT':
      return '/expediteur/bordereaux';
    default:
      // Une entité d'exploitation — tournée, dépôt, inter-dépôt — n'a pas
      // d'équivalent dans le portail : le lien est retiré plutôt que trompeur.
      return null;
  }
}

export function VueNotifications() {
  const router = useRouter();
  const { t, traduireValeur, formatDelai, formatDateTime } = useI18n();
  // L'intitulé vient du serveur, écrit en français dans `Notification.title` :
  // le vocabulaire le rend dans la langue courante quand il le reconnaît.
  const voc = useVocabulaire();
  const { items, unread, isLoading, isConnected, error, markRead, markAllRead, refresh } =
    useNotifications();
  const [filtre, setFiltre] = React.useState<Filtre>('toutes');

  const visibles = React.useMemo(() => {
    if (filtre === 'toutes') return items;
    if (filtre === 'non-lues') return items.filter((n) => !n.isRead);
    return items.filter((n) => n.category === filtre);
  }, [items, filtre]);

  /** Mot affiché sur un filtre : les deux états du sélecteur, ou une catégorie. */
  const libelleFiltre = (id: Filtre) =>
    id === 'toutes'
      ? t('notifications.filtre.toutes')
      : id === 'non-lues'
        ? t('notifications.filtre.non-lues')
        : traduireValeur('notif.categorie', id);

  const ouvrir = (notification: NotificationDto) => {
    const destination = routePortail(notification);
    if (!notification.isRead) void markRead(notification.id);
    if (destination) router.push(destination);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            {t('notifications.titre')}
            {unread > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-bold">
                {unread}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isConnected
              ? t('notifications.sous-titre.tempsReel')
              : t('notifications.sous-titre.pertes')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {t('notifications.actualiser')}
          </button>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unread === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-md text-xs font-semibold transition cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            {t('notifications.toutLu')}
          </button>
        </div>
      </div>

      <nav aria-label={t('notifications.filtres')} className="flex gap-2 overflow-x-auto pb-1">
        {FILTRES.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltre(f)}
            aria-current={filtre === f ? 'page' : undefined}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              filtre === f
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {libelleFiltre(f)}
          </button>
        ))}
      </nav>

      {error && (
        <p className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </p>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Bell className="w-6 h-6 animate-pulse" aria-hidden="true" />
        </div>
      )}

      {!isLoading && visibles.length === 0 && (
        <div className="text-center py-10 text-slate-400">
          <BellOff className="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-600">
            {filtre === 'non-lues'
              ? t('notifications.aucuneNonLue')
              : t('notifications.aucuneFiltre')}
          </p>
          <p className="text-xs mt-1">{t('notifications.aucuneAide')}</p>
        </div>
      )}

      <ul className="space-y-2">
        {visibles.map((notification) => {
          const destination = routePortail(notification);
          const contenu = (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <p
                  className={`text-sm font-semibold ${
                    notification.isRead ? 'text-slate-600' : 'text-slate-900'
                  }`}
                >
                  {voc.titreNotification(notification.title)}
                </p>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                    CATEGORY_STYLE[notification.category] ??
                    'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {traduireValeur('notif.categorie', notification.category)}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{notification.content}</p>
              <div className="flex items-center gap-3 mt-1.5">
                {/*
                  L'ancienneté et la date exacte disent deux choses différentes :
                  `formatDelai` et `formatDateTime` viennent du contexte de langue,
                  donc les deux suivent l'arabe comme le français.
                */}
                <time className="text-[11px] text-slate-400 font-mono" dateTime={notification.createdAt}>
                  {formatDelai(notification.createdAt)} · {formatDateTime(notification.createdAt)}
                </time>
                {!notification.isRead && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-red-600"
                    aria-label={t('notifications.nonLue')}
                  />
                )}
                {!destination && (
                  <span className="text-[10px] text-slate-400">{t('notifications.interne')}</span>
                )}
              </div>
            </>
          );

          return (
            <li key={notification.id}>
              {destination ? (
                <button
                  type="button"
                  onClick={() => ouvrir(notification)}
                  className={`w-full text-start bg-white border rounded-md p-3.5 transition cursor-pointer hover:border-slate-300 ${
                    notification.isRead ? 'border-slate-200' : 'border-red-200'
                  }`}
                >
                  {contenu}
                </button>
              ) : (
                <div
                  className={`bg-white border rounded-md p-3.5 ${
                    notification.isRead ? 'border-slate-200' : 'border-red-200'
                  }`}
                >
                  {contenu}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}