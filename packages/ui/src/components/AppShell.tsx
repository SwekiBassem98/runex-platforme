'use client';

/**
 * Coquille applicative.
 *
 * Elle porte la seule décision qui concerne *toutes* les pages : à partir de
 * quelle largeur la navigation devient un calque.
 *
 * ## Pourquoi 1024 px
 *
 * C'est la largeur en dessous de laquelle les tableaux d'exploitation cessent
 * d'être lisibles : sous 1024 px, un tableau à neuf colonnes passe à six, puis
 * à quatre, et celles qui disparaissent sont précisément celles qui identifient
 * la ligne. Garder 256 px de navigation en plus n'a alors plus de sens.
 *
 * Entre 1024 et 1280 px, la navigation reste fixe et se replie : c'est un
 * portable 13 pouces, où les 192 px gagnés au repli vont réellement aux
 * tableaux.
 *
 * ## Lien d'évitement
 *
 * La navigation compte plus de quinze entrées, sur chaque page, avant même le
 * contenu. Sans lien d'évitement, un utilisateur de clavier doit traverser tout
 * cela à chaque changement d'écran. Le lien est le premier élément focusable et
 * n'apparaît qu'au focus : il ne coûte rien à la souris.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Sidebar, type NavItem } from './Sidebar';
import { TopNavigation, type TopNavigationNotification } from './TopNavigation';

interface AppShellProps {
  navItems: NavItem[];
  activeNavId: string;
  onSelectNav: (id: string) => void;
  activeDepositName?: string;
  userName?: string;
  userRole?: string;
  onLogout?: () => void;
  onSearchClick?: () => void;
  onGlobalSearch?: (term: string) => void;
  notifications?: TopNavigationNotification[];
  unreadNotificationsCount?: number;
  isRealtimeConnected?: boolean;
  onOpenNotification?: (notification: TopNavigationNotification) => void;
  onOpenNotificationCenter?: () => void;
  onMarkAllRead?: () => void;
  children: React.ReactNode;
}

export function AppShell({
  navItems,
  activeNavId,
  onSelectNav,
  activeDepositName,
  userName,
  userRole,
  onLogout,
  onSearchClick,
  onGlobalSearch,
  notifications,
  unreadNotificationsCount,
  isRealtimeConnected,
  onOpenNotification,
  onOpenNotificationCenter,
  onMarkAllRead,
  children,
}: AppShellProps) {
  const [replie, setReplie] = useState(false);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const refDeclencheur = useRef<HTMLButtonElement>(null);

  // Le menu se referme dès qu'on change d'écran : le laisser ouvert ferait
  // croire qu'on est encore sur la page précédente.
  useEffect(() => {
    setMenuOuvert(false);
  }, [activeNavId]);

  // Passé 1024 px, le menu en calque n'a plus lieu d'être. Sans cette remise à
  // zéro, un utilisateur qui ouvre le menu sur une tablette puis branche un
  // écran se retrouve avec un calque fantôme par-dessus la page.
  useEffect(() => {
    const liste = window.matchMedia('(min-width: 1024px)');
    const remettre = () => {
      if (liste.matches) setMenuOuvert(false);
    };
    liste.addEventListener('change', remettre);
    return () => liste.removeEventListener('change', remettre);
  }, []);

  // Échap referme le calque et rend le focus au bouton qui l'a ouvert.
  useEffect(() => {
    if (!menuOuvert) return;

    const surTouche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOuvert(false);
        refDeclencheur.current?.focus();
      }
    };

    document.addEventListener('keydown', surTouche);
    // Le focus entre dans le menu : on vient de l'ouvrir au clavier, et
    // s'attarder sur la page derrière n'a pas de sens. La recherche est bornée
    // au calque lui-même — un sélecteur global prendrait le premier bouton de la
    // page, qui n'appartient pas au menu.
    const calque = document.querySelector<HTMLElement>('[data-menu-mobile]');
    calque?.querySelector<HTMLElement>('button')?.focus();

    return () => document.removeEventListener('keydown', surTouche);
  }, [menuOuvert]);

  return (
    /*
     * `h-dvh` et non `h-screen`.
     *
     * `100vh` est la hauteur du *plus grand* viewport, celle où les barres
     * d'outils du navigateur sont repliées. La racine ne défile pas — c'est
     * `main` qui défile — donc les 60 à 100 px du bas, masqués par la barre
     * d'outils iOS ou la barre d'adresse Android, sont définitivement hors
     * d'atteinte : la dernière ligne d'un tableau n'est jamais vue. `dvh`
     * suit la hauteur réellement visible et se réajuste quand la barre se
     * replie.
     */
    <div className="h-dvh bg-slate-50 flex text-slate-900 font-sans antialiased overflow-hidden">
      <a
        href="#contenu-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:bg-slate-900 focus:text-white focus:text-xs focus:font-semibold focus:rounded-md focus:shadow-lg"
      >
        Aller au contenu principal
      </a>

      <Sidebar
        isCollapsed={replie}
        onToggleCollapse={() => setReplie(!replie)}
        estCalque={menuOuvert}
        onFermer={() => setMenuOuvert(false)}
        navItems={navItems}
        activeId={activeNavId}
        onSelect={onSelectNav}
        contexte={{
          libelle: 'Agence Active',
          valeur: activeDepositName ?? 'Hub Ben Arous',
          badge: 'Central',
        }}
        userName={userName}
        userRole={userRole}
        onLogout={onLogout}
      />

      <div className="flex-1 flex flex-col min-w-0 h-dvh overflow-hidden">
        <TopNavigation
          onOpenMenu={() => setMenuOuvert(true)}
          refBoutonMenu={refDeclencheur}
          userName={userName}
          userRole={userRole}
          activeDepositId="dep-benarous-01"
          activeDepositName={activeDepositName}
          onSearchClick={onSearchClick}
          onGlobalSearch={onGlobalSearch}
          notifications={notifications}
          unreadNotificationsCount={unreadNotificationsCount}
          isRealtimeConnected={isRealtimeConnected}
          onOpenNotification={onOpenNotification}
          onOpenNotificationCenter={onOpenNotificationCenter}
          onMarkAllRead={onMarkAllRead}
        />

        <main
          id="contenu-principal"
          tabIndex={-1}
          /*
           * `overflow-x-hidden` en plus du `overflow-y-auto` : en CSS, un axe
           * valant `visible` devient `auto` dès que l'autre ne l'est pas. Sans
           * cela, le moindre élément plus large que l'écran — un titre, une
           * rangée d'onglets — crée une deuxième barre de défilement, cette
           * fois sur toute la page, et le contenu glisse latéralement au lieu
           * d'être défile dans son conteneur.
           */
          className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-100 flex flex-col scroll-region focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}