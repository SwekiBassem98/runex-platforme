'use client';

/**
 * Coquille du portail expéditeur.
 *
 * La navigation remplace la barre de l'exploitation : même composant
 * `Sidebar`, mêmes comportements — repli sur rail étroit, calque sous 1024 px,
 * fermeture au clic sur le fond — mais le vocabulaire du bandeau est celui de
 * l'espace expéditeur, et les entrées sont celles que l'API accorde
 * réellement à ce rôle.
 *
 * Aucune de ces entrées ne mène à une donnée que l'API refuserait : ni audit,
 * ni tournées, ni dépôts, ni caisse. Les sections qui n'ont pas de support
 * backend — réclamations, manifestes — n'ont pas d'entrée, plutôt qu'une entrée
 * qui afficherait un vide ou une promesse non tenue.
 *
 * ## Langue
 *
 * La coquille est le seul endroit où la langue se décide pour tout le portail :
 * les libellés de navigation, le nom de l'entreprise, le pied de page et le sélecteur
 * sont lus ici, une fois. Les écrans reçoivent la langue par `useI18n()` et n'ont
 * rien à savoir de sa persistance.
 */

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  Bell,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Package,
  PackageX,
  PlusCircle,
  Receipt,
  Search,
  Truck,
  User,
} from 'lucide-react';
import { Sidebar, type NavItem } from '@logixpress/ui';
import { NotificationProvider, useNotifications } from '@/lib/notification-provider';
import { useAuth } from '@/lib/auth';
import { SelecteurLangue, useI18n, type Cle } from '@/i18n';

/**
 * Entrées du portail.
 *
 * `correspondances` associe chaque identifiant à son chemin : la navigation
 * reste une donnée, et non une cascade de `if` dans le rendu. Le libellé est une
 * clé et non un mot — la navigation doit suivre le changement de langue sans
 * être reconstruite, et `label` n'existe qu'au moment du rendu.
 */
const ENTREES: Array<{ id: string; href: string; cle: Cle; icon: React.ReactNode }> = [
  {
    id: 'tableau-de-bord',
    cle: 'nav.tableau-de-bord',
    icon: <LayoutDashboard className="w-4 h-4" />,
    href: '/expediteur/tableau-de-bord',
  },
  {
    id: 'colis',
    cle: 'nav.colis',
    icon: <Package className="w-4 h-4" />,
    href: '/expediteur/colis',
  },
  {
    id: 'nouveau-colis',
    cle: 'nav.nouveau-colis',
    icon: <PlusCircle className="w-4 h-4" />,
    href: '/expediteur/colis/nouveau',
  },
  {
    id: 'suivi',
    cle: 'nav.suivi',
    icon: <Search className="w-4 h-4" />,
    href: '/expediteur/suivi',
  },
  {
    id: 'ramassages',
    cle: 'nav.ramassages',
    icon: <Truck className="w-4 h-4" />,
    href: '/expediteur/ramassages',
  },
  {
    id: 'bordereaux',
    cle: 'nav.bordereaux',
    icon: <Receipt className="w-4 h-4" />,
    href: '/expediteur/bordereaux',
  },
  {
    id: 'echanges',
    cle: 'nav.echanges',
    icon: <ArrowRightLeft className="w-4 h-4" />,
    href: '/expediteur/echanges',
  },
  {
    id: 'retours',
    cle: 'nav.retours',
    icon: <PackageX className="w-4 h-4" />,
    href: '/expediteur/retours',
  },
  {
    id: 'activites',
    cle: 'nav.activites',
    icon: <ClipboardList className="w-4 h-4" />,
    href: '/expediteur/activites',
  },
  {
    id: 'notifications',
    cle: 'nav.notifications',
    icon: <Bell className="w-4 h-4" />,
    href: '/expediteur/notifications',
  },
  {
    id: 'profil',
    cle: 'nav.profil',
    icon: <User className="w-4 h-4" />,
    href: '/expediteur/profil',
  },
];

/**
 * Coquille du portail.
 *
 * ## Une seule barre de navigation
 *
 * `Sidebar` porte déjà la bascule grand écran / calque : à 1024 px et au-dessus
 * il rend un `<aside>` en flux (`hidden lg:flex`, 256 ou 80 px), en dessous il
 * rend un calque fixe (`lg:hidden`). Il n'a donc jamais besoin d'être instancié
 * deux fois, et cette coquille ne le fait pas.
 *
 * La disposition est celle de `AppShell`, à l'identique : la racine est un
 * conteneur `flex`, `Sidebar` en est le premier enfant en flux, et la colonne de
 * contenu prend le reste par `flex-1`. Aucune marge gauche n'est ajoutée au
 * contenu : la barre n'est pas en `fixed`, elle occupe sa place dans le flux.
 * Un `lg:pl-64` ici décalerait le contenu d'une seconde largeur de barre, celle
 * d'un composant passé en `fixed` — c'est-à-dire deux fois.
 *
 * Le centre de notifications est monté ici, comme dans l'espace d'exploitation :
 * la pastille de la barre latérale et l'écran du centre doivent lire la même
 * source, sinon un compteur affiché et une liste affichée peuvent dire deux
 * choses différentes. Le fournisseur ouvre aussi la connexion Socket.IO, ce qui
 * donne au portail le temps réel sans code supplémentaire.
 */
export function CoquillePortail({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <CoquilleInterieur>{children}</CoquilleInterieur>
    </NotificationProvider>
  );
}

function CoquilleInterieur({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  const [replie, setReplie] = React.useState(false);
  const [menuOuvert, setMenuOuvert] = React.useState(false);
  const refDeclencheur = React.useRef<HTMLButtonElement>(null);

  /*
   * Entrée active : la plus longue correspondance, pour que
   * `/expediteur/colis/123` garde « Colis » allumé plutôt que « Nouveau colis ».
   */
  const entreeActive = React.useMemo(() => {
    const candidates = ENTREES.filter((e) => pathname === e.href || pathname.startsWith(`${e.href}/`));
    return candidates.sort((a, b) => b.href.length - a.href.length)[0]?.id ?? 'tableau-de-bord';
  }, [pathname]);

  // Le menu se referme dès qu'on change d'écran : le laisser ouvert ferait croire
  // qu'on est encore sur la page précédente.
  React.useEffect(() => {
    setMenuOuvert(false);
  }, [entreeActive]);

  /*
   * Le calque n'a de sens que sous 1024 px.
   *
   * Sans cette remise à zéro, un expéditeur qui ouvre le menu sur une tablette
   * puis branche un écran garde le calque monté : la barre.visible est alors
   * celle du calque — donc celle qui n'a pas de bouton de repli — alors que
   * `replie` décrit toujours la barre du grand écran. Un état, deux dispositions.
   */
  React.useEffect(() => {
    const liste = window.matchMedia('(min-width: 1024px)');
    const remettre = () => {
      if (liste.matches) setMenuOuvert(false);
    };
    liste.addEventListener('change', remettre);
    return () => liste.removeEventListener('change', remettre);
  }, []);

  if (!user) return null;

  const entreprise = user.shipperName ?? user.fullName;
  const items: NavItem[] = ENTREES.map((e) => ({
    id: e.id,
    icon: e.icon,
    label: t(e.cle),
    ...(e.id === 'notifications' && unread > 0 ? { count: unread, badgeVariant: 'danger' as const } : {}),
  }));

  async function seDeconnecter() {
    await logout();
  }

  return (
    <div className="h-dvh bg-slate-100 flex text-slate-900 font-sans antialiased overflow-hidden">
      <a
        href="#contenu-portail"
        className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:bg-slate-900 focus:text-white focus:text-xs focus:font-semibold focus:rounded-md focus:shadow-lg"
      >
        {t('coque.sautContenu')}
      </a>

      {/*
        Instance unique. `replie` et `menuOuvert` ne pilotent pas deux barres :
        ils décrivent les deux dispositions d'une même barre, et le composant
        choisit laquelle rendre.
      */}
      <Sidebar
        isCollapsed={replie}
        onToggleCollapse={() => setReplie((v) => !v)}
        estCalque={menuOuvert}
        onFermer={() => setMenuOuvert(false)}
        navItems={items}
        activeId={entreeActive}
        onSelect={(id) => {
          const entree = ENTREES.find((e) => e.id === id);
          if (entree) router.push(entree.href);
        }}
        contexte={{ libelle: t('coque.entreprise'), valeur: entreprise }}
        userName={user.fullName || user.email}
        userRole={t('coque.roleExpediteur')}
        onLogout={seDeconnecter}
        idNavigation="navigation-portail"
      />

      {/* Colonne de contenu : elle prend le reste, la barre occupe déjà sa place. */}
      <div className="flex-1 flex flex-col min-w-0 h-dvh overflow-hidden">
        {/* En-tête */}
        <header className="shrink-0 z-20 bg-white border-b border-slate-200">
          <div className="h-14 px-3 sm:px-4 lg:px-6 flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              ref={refDeclencheur}
              onClick={() => setMenuOuvert(true)}
              aria-label={t('coque.ouvrirMenu')}
              className="lg:hidden p-2 -ms-1 rounded-md text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>

            <Link
              href="/expediteur/tableau-de-bord"
              className="flex items-center gap-2 lg:hidden min-w-0"
            >
              <img
                src="/brand/runex-logo.jpeg"
                alt="RUNEX"
                width={96}
                height={64}
                className="h-8 w-auto rounded shrink-0"
              />
            </Link>

            <div className="hidden lg:block min-w-0 flex-1">
              <h1 className="text-sm font-bold text-slate-900 truncate leading-tight">
                {t('app.portail')}
              </h1>
              <p className="text-[11px] text-slate-500 truncate">{entreprise}</p>
            </div>

            <div className="lg:hidden flex-1" />

            {/* Sur téléphone, la recherche rapide reste à une portée de pouce */}
            <Link
              href="/expediteur/suivi"
              aria-label={t('coque.rechercherColis')}
              className="lg:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100 transition"
            >
              <Search className="w-5 h-5" aria-hidden="true" />
            </Link>

            <Link
              href="/expediteur/notifications"
              aria-label={
                unread > 0 ? t('coque.notificationsNonLues', { n: unread }) : t('coque.notifications')
              }
              className="relative p-2 rounded-md text-slate-600 hover:bg-slate-100 transition"
            >
              <Bell className="w-5 h-5" aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute top-0.5 end-0.5 min-w-4 px-1 rounded bg-red-600 text-white text-[10px] font-bold text-center leading-4">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            {/*
              La langue se change ici, dans la barre supérieure : c'est le seul
              endroit présent sur tous les écrans, et l'utilisateur n'a pas à
              descendre dans son profil pour changer la façon dont son portail
              s'affiche.
            */}
            <SelecteurLangue compact />

            {/* L'action la plus fréquente reste visible en permanence */}
            <Link
              href="/expediteur/colis/nouveau"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow-xs transition"
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              {t('coque.nouveauColis')}
            </Link>
          </div>
        </header>

        <main
          id="contenu-portail"
          tabIndex={-1}
          /*
           * `overflow-x-hidden` en plus du défilement vertical : en CSS, un axe
           * valant `visible` devient `auto` dès que l'autre ne l'est pas. Un
           * tableau large ne doit donc pas créer une seconde barre de
           * défilement qui fait glisser la page latéralement.
           */
          className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-100 flex flex-col scroll-region focus:outline-none"
        >
          <div className="px-3 sm:px-4 lg:px-6 py-4 sm:py-6 flex-1">{children}</div>

          <footer className="hidden lg:block px-6 py-4 text-[11px] text-slate-400 border-t border-slate-200 shrink-0">
            {t('coque.pied')}
          </footer>
        </main>
      </div>
    </div>
  );
}