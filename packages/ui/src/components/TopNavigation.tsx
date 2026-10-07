'use client';

import React, { useRef, useState } from 'react';
import {
  Search,
  Bell,
  Building2,
  ChevronDown,
  Check,
  Menu,
  X as XIcon,
} from 'lucide-react';
import { useFermetureAuClavier } from '../hooks/useInterface';

export interface TopNavigationNotification {
  id: string;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  href?: string | null;
}

interface TopNavigationProps {
  deposits?: { id: string; name: string; isMain?: boolean }[];
  activeDepositId?: string;
  activeDepositName?: string;
  onSelectDeposit?: (id: string) => void;
  onSearchClick?: () => void;
  /**
   * Recherche transversale lancée depuis la barre supérieure.
   *
   * Elle reçoit le terme saisi. La barre affichait jusque-là « rechercher un
   * colis, destinataire, runsheet » tout en envoyant vers la seule liste des
   * colis : l'appartenance annoncée n'était pas celle offerte.
   */
  onGlobalSearch?: (term: string) => void;
  /**
   * Aperçu des notifications, les plus récentes d'abord.
   *
   * La liste est fournie par l'application, jamais inventée ici : une cloche
   * qui affiche des exemples figés apprend à l'utilisateur à ne plus la croire.
   */
  notifications?: TopNavigationNotification[];
  unreadNotificationsCount?: number;
  /** Connexion temps réel perdue : la cloche n'affichera plus que son état local. */
  isRealtimeConnected?: boolean;
  onOpenNotification?: (notification: TopNavigationNotification) => void;
  onOpenNotificationCenter?: () => void;
  onMarkAllRead?: () => void;
  userName?: string;
  userRole?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Ouvre la navigation en calque sur les écrans étroits. */
  onOpenMenu?: () => void;
  refBoutonMenu?: React.RefObject<HTMLButtonElement | null>;
}

export function TopNavigation({
  deposits = [
    { id: 'dep-benarous-01', name: 'Hub Central Ben Arous', isMain: true },
    { id: 'dep-sousse-02', name: 'Agence Sousse (Sahloul)' },
    { id: 'dep-sfax-03', name: 'Agence Sfax' },
    { id: 'dep-nabeul-04', name: 'Agence Nabeul' },
  ],
  activeDepositId = 'dep-benarous-01',
  onSelectDeposit,
  onSearchClick,
  onGlobalSearch,
  notifications = [],
  unreadNotificationsCount = 0,
  isRealtimeConnected = false,
  onOpenNotification,
  onOpenNotificationCenter,
  onMarkAllRead,
  userName = 'Utilisateur',
  userRole = 'ADMIN',
  onRefresh,
  isRefreshing = false,
  onOpenMenu,
  refBoutonMenu,
}: TopNavigationProps) {
  const [showDepositMenu, setShowDepositMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  const [rechercheOuverte, setRechercheOuverte] = useState(false);

  const refDepot = useRef<HTMLButtonElement>(null);
  const refNotifs = useRef<HTMLButtonElement>(null);
  const refRecherche = useRef<HTMLInputElement>(null);

  // Un menu doit se fermer au clavier comme à la souris, et rendre le focus à
  // son déclencheur — sinon la tabulation repart du haut de la page après
  // chaque ouverture, ce qui est le pire moment pour le découvrir.
  useFermetureAuClavier(showDepositMenu, () => setShowDepositMenu(false), refDepot);
  useFermetureAuClavier(showNotifMenu, () => setShowNotifMenu(false), refNotifs);

  const activeDeposit = deposits.find((d) => d.id === activeDepositId) || deposits[0];

  return (
    <header className="relative h-14 bg-white border-b border-slate-200 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 shrink-0 shadow-xs z-30">
      {/* Déclencheur du menu, sous 1024 px seulement : au-delà, la navigation
          est fixe et ce bouton n'aurait rien à ouvrir. */}
      {onOpenMenu && (
        <button
          ref={refBoutonMenu}
          type="button"
          onClick={onOpenMenu}
          aria-label="Ouvrir le menu"
          className="lg:hidden p-2 -ml-1 rounded-md text-slate-600 hover:bg-slate-100 transition cursor-pointer shrink-0"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

      {/* Sélecteur de Dépôt / Hub */}
      <div className="relative shrink-0 min-w-0">
        <button
          ref={refDepot}
          type="button"
          onClick={() => setShowDepositMenu(!showDepositMenu)}
          aria-expanded={showDepositMenu}
          aria-haspopup="true"
          className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-md hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800 transition cursor-pointer max-w-[45vw] sm:max-w-none"
        >
          <Building2 className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />
          <span className="truncate">{activeDeposit.name}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
        </button>

        {showDepositMenu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowDepositMenu(false)} />
            <div className="absolute left-0 mt-1 w-64 max-w-[85vw] bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-30 text-xs animate-menu-in">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                Changer d'agence / dépôt
              </div>
              {deposits.map((dep) => (
                <button
                  key={dep.id}
                  type="button"
                  onClick={() => {
                    onSelectDeposit?.(dep.id);
                    setShowDepositMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
                >
                  <span className={dep.id === activeDepositId ? 'font-bold text-red-600' : 'text-slate-700'}>
                    {dep.name}
                  </span>
                  {dep.id === activeDepositId && <Check className="w-3.5 h-3.5 text-red-600" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Sous 640 px, la barre tient mal : le nom du dépôt, la cloche et
          l'avatar ne laissent que 150 px, et un champ de recherche dans
          150 px est illisible. Elle est donc remplacée par une icône qui
          l'ouvre — la recherche existe sur un téléphone au lieu d'y
          disparaître. */}
      <button
        type="button"
        onClick={() => setRechercheOuverte(!rechercheOuverte)}
        aria-expanded={rechercheOuverte}
        aria-label={rechercheOuverte ? 'Fermer la recherche' : 'Rechercher'}
        className="sm:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100 transition cursor-pointer shrink-0"
      >
        {rechercheOuverte ? (
          <XIcon className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Search className="w-5 h-5" aria-hidden="true" />
        )}
      </button>

      {rechercheOuverte && (
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const term = globalSearchTerm.trim();
            if (term) onGlobalSearch?.(term);
            else onSearchClick?.();
            setGlobalSearchTerm('');
            setRechercheOuverte(false);
          }}
          className="sm:hidden absolute left-0 right-0 top-14 z-30 bg-white border-b border-slate-200 px-3 py-2 shadow-md flex items-center gap-2 animate-menu-in"
        >
          <label htmlFor="recherche-mobile" className="sr-only">
            Rechercher un colis, un destinataire ou une runsheet
          </label>
          <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            id="recherche-mobile"
            type="search"
            autoFocus
            value={globalSearchTerm}
            onChange={(event) => setGlobalSearchTerm(event.target.value)}
            placeholder="Rechercher un colis, destinataire..."
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400 min-w-0"
          />
        </form>
      )}

      {/* Barre centrale : Recherche globale avec raccourci.
          Elle était masquée sous 768 px sans rien la remplacer : sur une
          tablette en portrait, la recherche transversale n'existait plus du tout.
          Elle se réduit à une icône sous 640 px, et s'ouvre au clic. */}
      <div className="hidden sm:flex items-center flex-1 max-w-md mx-2 lg:mx-6 min-w-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const term = globalSearchTerm.trim();
            // Un terme va à la recherche transversale ; une barre vide retombe
            // sur la liste des colis, comme avant.
            if (term) onGlobalSearch?.(term);
            else onSearchClick?.();
            setGlobalSearchTerm('');
          }}
          role="search"
          className="w-full flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 focus-within:bg-white focus-within:border-red-400 border border-slate-200 rounded-md text-sm text-slate-500 transition-colors"
        >
          <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <label htmlFor="recherche-globale" className="sr-only">
            Rechercher un colis, un destinataire ou une runsheet
          </label>
          <input
            id="recherche-globale"
            ref={refRecherche}
            type="search"
            value={globalSearchTerm}
            onChange={(event) => setGlobalSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setGlobalSearchTerm('');
            }}
            placeholder="Rechercher un colis, destinataire, runsheet..."
            className="flex-1 bg-transparent outline-none text-slate-700 placeholder:text-slate-400 min-w-0"
          />
          <kbd className="hidden md:inline px-1.5 py-0.5 text-[10px] font-mono bg-white border border-slate-200 rounded text-slate-500 shrink-0">
            ⏎
          </kbd>
        </form>
      </div>

      {/* Actions à droite */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <div className="relative">
          <button
            ref={refNotifs}
            type="button"
            onClick={() => setShowNotifMenu(!showNotifMenu)}
            aria-expanded={showNotifMenu}
            aria-haspopup="true"
            aria-label={
              unreadNotificationsCount > 0
                ? `Notifications — ${unreadNotificationsCount} non lues`
                : 'Notifications — aucune non lue'
            }
            className="p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition relative cursor-pointer shrink-0"
          >
            <Bell className="w-4 h-4" aria-hidden="true" />
            {unreadNotificationsCount > 0 && (
              <span
                className="absolute top-1 right-1 min-w-2 h-2 px-0.5 bg-red-600 text-white text-[9px] font-bold rounded-full ring-2 ring-white flex items-center justify-center tabular-nums"
                aria-hidden="true"
              >
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {showNotifMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowNotifMenu(false)} />
              <div className="absolute right-0 mt-1 w-[min(22rem,calc(100vw-1.5rem))] bg-white border border-slate-200 rounded-lg shadow-xl py-2 z-30 text-xs animate-menu-in">
                <div className="px-4 py-2 border-b border-slate-100 font-bold text-slate-900 flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1.5">
                    Notifications
                    {!isRealtimeConnected && (
                      <span
                        className="text-[9px] font-normal text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 uppercase"
                        title="Connexion temps réel interrompue : la liste peut être incomplète"
                      >
                        hors ligne
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono text-red-600 font-semibold shrink-0">
                    {unreadNotificationsCount} non lues
                  </span>
                </div>

                {notifications.length === 0 ? (
                  <p className="p-4 text-center text-slate-400 text-xs">
                    Aucune notification.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => onOpenNotification?.(notification)}
                        className={`w-full text-left p-3 hover:bg-slate-50 transition ${
                          notification.isRead ? '' : 'bg-blue-50/40'
                        }`}
                      >
                        <p className="font-semibold text-slate-900 text-xs flex items-start gap-1.5">
                          {!notification.isRead && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                          )}
                          <span>{notification.title}</span>
                        </p>
                        <p className="text-slate-500 text-[11px] mt-0.5 line-clamp-2">
                          {notification.content}
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    disabled={unreadNotificationsCount === 0}
                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-300 disabled:hover:text-slate-300 transition"
                  >
                    Tout marquer comme lu
                  </button>
                  <button
                    type="button"
                    onClick={onOpenNotificationCenter}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition"
                  >
                    Tout afficher
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Profil / Rôle */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 text-xs">
          <div className="text-right hidden sm:block min-w-0">
            <span className="font-semibold text-slate-900 block leading-tight">{userName}</span>
            <span className="text-[11px] font-mono text-slate-500 uppercase">{userRole}</span>
          </div>
          <div
            className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0"
            aria-hidden="true"
          >
            {userName.charAt(0)}
          </div>
        </div>
      </div>
    </header>
  );
}
