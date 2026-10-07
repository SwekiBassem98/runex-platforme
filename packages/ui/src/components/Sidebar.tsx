'use client';

/**
 * Barre de navigation latérale.
 *
 * Sur un écran large, elle est fixe et se replie. Sous 1024 px, elle devient un
 * calque : c'est la seule disposition qui tienne. À 768 px, une barre de 256 px
 * prend un tiers de la largeur — et sur un écran de 768 px en portrait, où l'on
 * travaille en tablette au dépôt, il ne reste plus que la moitié de la largeur
 * pour une table de neuf colonnes.
 *
 * Le repli est conservé parce qu'il sert encore : entre 1024 et 1280 px, un
 * portable 13 pouces en gagne 192 px pour les tableaux, qui en ont besoin.
 *
 * ## Fermeture au clavier
 *
 * Un calque ouvert au clavier doit se fermer au clavier. Sans touche Échap, un
 * utilisateur qui ouvre le menu au clavier se retrouve piégé dedans — il peut
 * encore cliquer dans la page, mais la tabulation reste dans le menu, et rien ne
 * lui dit qu'il y a une sortie.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, LogOut, Building2, X } from 'lucide-react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  badgeVariant?: 'default' | 'danger' | 'warning';
  disabled?: boolean;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  navItems: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * Bandeau de contexte : de quel espace il s'agit.
   *
   * L'exploitation affiche l'agence active ; un expéditeur affiche son
   * entreprise. Le libellé et la pastille viennent de l'appelant plutôt que du
   * composant, pour qu'aucun écran n'hérite du vocabulaire d'un autre.
   */
  contexte?: { libelle: string; valeur: string; badge?: string };
  userName?: string;
  userRole?: string;
  onLogout?: () => void;
  /** Sur les écrans étroits, le menu est un calque : il faut pouvoir le fermer. */
  estCalque?: boolean;
  /** Ferme le calque. Sur grand écran, inopérant. */
  onFermer?: () => void;
  idNavigation?: string;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  navItems,
  activeId,
  onSelect,
  contexte = { libelle: 'Agence Active', valeur: 'Hub Ben Arous', badge: 'Central' },
  userName,
  userRole,
  onLogout,
  estCalque = false,
  onFermer,
  idNavigation,
}: SidebarProps) {
  const { libelles } = useLibellesUI();

  // Au clavier, le calque doit se fermer ; à la souris, non — un clic dans la
  // page qui ferme le menu au milieu d'un scroll est agaçant, et la même action
  // au clavier doit avoir un résultat différent pour être prévisible.
  React.useEffect(() => {
    if (!estCalque) return;
    const surTouche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFermer?.();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [estCalque, onFermer]);

  const contenu = (
    <>
      {/*
        Marque et bouton de repli.

        Le logo officiel RUNEX est montré tel quel : le fichier a un fond noir,
        identique au fond de la barre, et ses proportions (3:2) sont respectées
        par une largeur et une hauteur fixées ensemble. Un recadrage pour remplir
        une tuile carrée déformerait le logo ou en amputerait le nom.

        Deux formats donc, sans jamais retoucher l'image : le logo complet quand
        la barre est ouverte, la variante carrée quand elle est repliée — là où
        le logo entier serait illisible dans un rail de 80 px. Le rail replié
        mesure 80 px et non 64 : à 64 px, la marque et le bouton de repli
        n'entrent plus côte à côte et l'image se fait écraser sur quelques
        pixels de largeur.
      */}
      <div
        className={`border-b border-slate-800/80 flex items-center justify-between shrink-0 ${
          isCollapsed ? 'px-2 py-3' : 'p-3 sm:p-4'
        }`}
      >
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0 shrink-0">
          {isCollapsed ? (
            <img
              src="/brand/runex-mark.png"
              alt="RUNEX"
              width={28}
              height={28}
              className="w-7 h-7 rounded-md shrink-0"
            />
          ) : (
            <img
              src="/brand/runex-logo.jpeg"
              alt="RUNEX"
              width={84}
              height={56}
              className="h-14 w-auto shrink-0"
            />
          )}
        </div>

        {estCalque ? (
          <button
            type="button"
            onClick={onFermer}
            className="p-1.5 -mr-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            aria-label={libelles['menu.fermer']}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer ${
              isCollapsed ? 'p-1' : 'p-1.5'
            }`}
            aria-label={isCollapsed ? libelles['menu.deplier'] : libelles['menu.replier']}
            aria-expanded={!isCollapsed}
            aria-controls={idNavigation}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* Contexte de l'espace de travail */}
      {/*
        * Le bandeau affichait « Agence Active — Central » en dur. C'est exact
        * pour l'exploitation, et faux partout ailleurs : un expéditeur n'a pas
        * d'agence, il a une entreprise. Le libellé et la pastille sont donc
        * fournis par l'appelant, qui reste maître du vocabulaire de son espace.
        */}
      <div
        className={`py-2.5 border-b border-slate-800/60 bg-[#161B22] shrink-0 ${
          isCollapsed ? 'px-3 text-center' : 'px-4'
        }`}
      >
        {isCollapsed ? (
          <div className="flex justify-center" title={`${contexte.libelle} : ${contexte.valeur}`}>
            <Building2 className="w-4 h-4 text-red-400" aria-hidden="true" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate min-w-0">
              <Building2 className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
              <div className="truncate">
                <span className="text-[10px] text-slate-400 block uppercase font-medium">
                  {contexte.libelle}
                </span>
                <span className="font-semibold text-white truncate block">{contexte.valeur}</span>
              </div>
            </div>
            {contexte.badge && (
              <span className="px-1.5 py-0.2 rounded text-[9px] bg-red-950 text-red-400 border border-red-800 font-mono shrink-0">
                {contexte.badge}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Entrées */}
      <nav id={idNavigation} aria-label={libelles['menu.navigation']} className="p-2 space-y-1 flex-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.disabled) return;
                onSelect(item.id);
                if (estCalque) onFermer?.();
              }}
              disabled={item.disabled}
              aria-current={isActive ? 'page' : undefined}
              /* Repliée, la barre ne montre plus qu'un glyphe : sans nom accessible
                 ni `title`, le bouton n'a plus de nom du tout. */
              aria-label={isCollapsed ? item.label : undefined}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition cursor-pointer ${
                isActive
                  ? 'bg-red-600 text-white font-semibold shadow-xs'
                  : item.disabled
                    ? 'opacity-40 cursor-not-allowed text-slate-500'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              } ${isCollapsed ? 'justify-center px-2 relative' : ''}`}
            >
              <span className="shrink-0" aria-hidden="true">
                {item.icon}
              </span>
              {!isCollapsed && (
                <div className="flex-1 flex items-center justify-between text-left truncate min-w-0">
                  <span className="truncate">{item.label}</span>
                  {item.count !== undefined && (
                    <span
                      className={`ml-2 px-1.5 py-0.2 rounded text-[10px] font-mono shrink-0 ${
                        isActive
                          ? 'bg-red-800 text-white'
                          : item.badgeVariant === 'danger'
                            ? 'bg-red-950 text-red-400 border border-red-800'
                            : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </div>
              )}
              {/* Repliée, le compteur devient une pastille sur l'icône. L'alerte d'un dépôt
                  qui réclame de l'attention ne peut pas disparaître parce que la
                  barre est étroite : c'est justement à cette largeur que
                  l'opérateur l'a repliée. */}
              {isCollapsed && item.count !== undefined && (
                <span
                  className={`absolute top-1 right-1 min-w-4 px-1 rounded text-[9px] font-mono text-center leading-4 ${
                    isActive
                      ? 'bg-white text-red-700'
                      : item.badgeVariant === 'danger'
                        ? 'bg-red-950 text-red-400 border border-red-800'
                        : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Profil */}
      {userName && (
        <div
          className={`p-3 border-t border-slate-800/80 bg-[#161B22] shrink-0 ${
            isCollapsed ? 'flex justify-center' : ''
          }`}
        >
          {isCollapsed ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label={libelles['menu.deconnecter']}
              className="p-2 rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-800 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="truncate min-w-0">
                <span className="font-semibold text-white block truncate">{userName}</span>
                <span className="text-[10px] text-red-400 font-mono uppercase block">
                  {userRole}
                </span>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  aria-label={libelles['menu.deconnecter']}
                  className="p-1.5 text-slate-400 hover:text-red-400 transition cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  // Calque : le menu recouvre la page et se referme d'un clic sur le fond.
  if (estCalque) {
    return (
      <>
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 animate-overlay-in lg:hidden"
          onClick={onFermer}
          aria-hidden="true"
        />
        <aside
          id={idNavigation}
          data-menu-mobile=""
          className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#121417] text-slate-300 flex flex-col z-50 animate-panel-in lg:hidden"
          aria-label={libelles['menu.navigation']}
        >
          {contenu}
        </aside>
      </>
    );
  }

  return (
    <aside
      className={`bg-[#121417] text-slate-300 flex-col border-r border-slate-800 shrink-0 transition-all duration-300 select-none z-30 hidden lg:flex ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {contenu}
    </aside>
  );
}