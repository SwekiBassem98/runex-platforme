'use client';

/**
 * Coquille applicative : barre latérale, navigation supérieure et zone de
 * contenu. Le composant AppShell du design system est piloté ici par la route
 * Next.js active plutôt que par un état local, afin que chaque écran soit
 * adressable par son URL.
 */

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useNotifications, PREVIEW_SIZE } from '@/lib/notification-provider';
import { SoundSettingsButton } from '@/components/SoundSettingsButton';
import { useDeconnexionConfirmee } from '@/components/useDeconnexionConfirmee';
import { PasswordSettingsButton } from './PasswordSettingsButton';
import {
  Activity,
  Archive,
  ArrowRightLeft,
  Barcode,
  BarChart3,
  Bike,
  MapPinned,
  Building2,
  Calendar,
  CreditCard,
  LogOut,
  Package,
  Palette,
  ScrollText,
  Search,
  ShieldCheck,
  Truck,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import { AppShell, type NavItem } from '@logixpress/ui';
import { RoleType, PermissionCode } from '@logixpress/types';
import { useAuth } from '@/lib/auth';

/**
 * Table de correspondance identifiant de navigation ↔ route.
 * L'identifiant reste celui utilisé par l'application Vite d'origine.
 *
 * Le portail expéditeur n'y figure pas, et ce n'est pas un oubli : il
 * n'appartient pas à l'exploitation. Un expéditeur s'authentifie sur
 * `/expediteur/login` et n'entre jamais par cette navigation — un raccourci
 * dans la barre interne donnerait à un expéditeur connecté un raccourci vers
 * un espace qu'il est le seul à ne pas partager.
 */
const NAV_ROUTES: Record<string, string> = {
  dashboard: '/dashboard',
  colis: '/colis',
  magasin: '/magasin',
  runsheets: '/runsheets',
  ramassages: '/ramassages',
  paiements: '/paiements',
  finance: '/finance',
  'inter-depots': '/inter-depots',
  'inter-depots-retours': '/inter-depots/retours',
  inventaire: '/inventaire',
  rapports: '/rapports',
  audit: '/audit',
  recherche: '/recherche',
  'admin-utilisateurs': '/admin/utilisateurs',
  'admin-expediteurs': '/admin/expediteurs',
  'admin-livreurs': '/admin/livreurs',
  'admin-zones': '/admin/zones',
  'design-system': '/design-system',
};

/**
 * Retrouve l'identifiant de navigation depuis le chemin courant.
 *
 * Le tri par route la plus longue d'abord permet à `/paiements/[id]` et
 * `/paiements/expediteurs` de rester sur l'entrée « Caisse » : sans ça, la
 * navigation afficherait le poste de commande comme actif dès qu'on ouvre un
 * encaissement.
 */
function navIdForPath(pathname: string): string {
  const entry = Object.entries(NAV_ROUTES)
    .filter(([, route]) => pathname === route || pathname.startsWith(`${route}/`))
    .sort((a, b) => b[1].length - a[1].length)[0];
  return entry ? entry[0] : 'dashboard';
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { demanderDeconnexion, dialogueDeconnexion } = useDeconnexionConfirmee();
  const { items, unread, isConnected, markRead, markAllRead } = useNotifications();

  // La barre supérieure ne montre qu'un aperçu : charger tout l'historique
  // dans la barre coûterait un aller-retour pour un gain nul.
  const preview = React.useMemo(() => items.slice(0, PREVIEW_SIZE), [items]);

  const isShipper = user?.role === RoleType.EXPEDITEUR;
  const isDriver = user?.role === RoleType.LIVREUR;
  // La caisse COD n'a de sens que pour ceux qui comptent l'argent. Un
  // expéditeur n'a pas à voir les encaissements des autres, et un livreur
  // n'a pas à valider les siens.
  const seesCash = !isDriver && !isShipper;

  // Une entrée de menu qui mène à un 403 est un mensonge de l'interface. La
  // navigation suit donc les permissions réellement détenues, comme les portes
  // de l'API — et non le rôle brut, qui ne dit pas tout.
  const peutRechercher = user?.permissions?.includes(PermissionCode.SEARCH_GLOBAL) ?? false;
  const peutInventorier = user?.permissions?.includes(PermissionCode.INVENTORY_READ) ?? false;
  // Le journal d'audit est un relevé d'exploitation, pas un écran de travail :
  // il croise tous les dossiers, tous les auteurs et tous les montants.
  const peutConsulterAudit = user?.permissions?.includes(PermissionCode.AUDIT_READ) ?? false;
  const peutConsulterRapports = user?.permissions?.includes(PermissionCode.REPORT_READ) ?? false;
  // L'administration des comptes, des expéditeurs et des livreurs est une porte
  // à part : elle touche aux accès des personnes. Elle suit `USER_READ`, la même
  // permission que celle que l'API exige — l'API restant seule décisive.
  const peutAdministrer = user?.permissions?.includes(PermissionCode.USER_READ) ?? false;

  const navItems: NavItem[] = [
    ...(isDriver
      ? []
      : [
          {
            id: 'dashboard',
            label: 'Poste de Commandement',
            icon: <Activity className="w-4 h-4" />,
          },
        ]),
    {
      id: 'colis',
      label: 'Gestion des Colis',
      icon: <Package className="w-4 h-4" />,
    },
    {
      id: 'magasin',
      label: 'Acceptation Magasin',
      icon: <Barcode className="w-4 h-4" />,
    },
    {
      id: 'runsheets',
      label: 'Runsheets Livreurs',
      icon: <Truck className="w-4 h-4" />,
    },
    {
      id: 'ramassages',
      label: 'RDV Ramassages',
      icon: <Calendar className="w-4 h-4" />,
    },
    ...(seesCash
      ? [
          {
            id: 'paiements',
            label: 'Caisse — Encaissements COD',
            icon: <CreditCard className="w-4 h-4" />,
          },
          {
            id: 'finance',
            label: 'Finance',
            icon: <Wallet className="w-4 h-4" />,
          },
        ]
      : []),
    {
      id: 'inter-depots',
      label: 'Inter dépôt livraison',
      icon: <ArrowRightLeft className="w-4 h-4" />,
    },
    {
      id: 'inter-depots-retours',
      label: 'Inter dépôt retours et échanges',
      icon: <Undo2 className="w-4 h-4" />,
    },
    ...(peutConsulterRapports
      ? [
          {
            id: 'rapports',
            label: "Rapports d'exploitation",
            icon: <BarChart3 className="w-4 h-4" />,
          },
        ]
      : []),
    ...(peutConsulterAudit
      ? [
          {
            id: 'audit',
            label: "Journal d'audit",
            icon: <ScrollText className="w-4 h-4" />,
          },
        ]
      : []),
    // Administration des accès. Trois entrées distinctes : un compte n'est ni
    // un dossier d'expéditeur ni une fiche chauffeur, et les écrans ne font pas
    // la même chose. `EXPEDITEUR_ADMIN` et `EXPEDITEUR_USER` restent séparés à
    // l'intérieur de l'écran des comptes — ce sont deux niveaux de droit réels.
    ...(peutAdministrer
      ? [
          {
            id: 'admin-utilisateurs',
            label: 'Comptes utilisateurs',
            icon: <Users className="w-4 h-4" />,
          },
          {
            id: 'admin-expediteurs',
            label: 'Expéditeurs',
            icon: <Building2 className="w-4 h-4" />,
          },
          {
            id: 'admin-livreurs',
            label: 'Livreurs',
            icon: <Bike className="w-4 h-4" />,
          },
          {
            id: 'admin-zones',
            label: 'Zones de livraison',
            icon: <MapPinned className="w-4 h-4" />,
          },
        ]
      : []),
    // Inventaire et recherche se placent en fin de liste : ce sont des écrans de
    // repli, utilisés quand on cherche précisément quelque chose, pas des postes
    // de travail quotidiens. Leur route existait déjà, mais aucune entrée de
    // menu n'y menait : les deux écrans étaient inatteignables à la souris.
    ...(peutInventorier
      ? [
          {
            id: 'inventaire',
            label: 'Inventaire',
            icon: <Archive className="w-4 h-4" />,
          },
        ]
      : []),
    ...(peutRechercher
      ? [
          {
            id: 'recherche',
            label: 'Recherche globale',
            icon: <Search className="w-4 h-4" />,
          },
        ]
      : []),
    {
      id: 'design-system',
      label: 'Design System',
      icon: <Palette className="w-4 h-4 text-red-500" />,
    },
  ];

  return (
    <AppShell
      navItems={navItems}
      activeNavId={navIdForPath(pathname)}
      onSelectNav={(id) => {
        const route = NAV_ROUTES[id];
        if (route && route !== pathname) router.push(route);
      }}
      activeDepositName="Hub Central — Ben Arous"
      userName={user?.fullName}
      userRole={user?.role}
      onLogout={demanderDeconnexion}
      onSearchClick={() => router.push('/colis')}
      onGlobalSearch={(term) => router.push(`/recherche?q=${encodeURIComponent(term)}`)}
      notifications={preview}
      unreadNotificationsCount={unread}
      isRealtimeConnected={isConnected}
      onOpenNotification={(notification) => {
        // Cliquer une notification la relit, puis amène à l'objet concerné.
        // Dans cet ordre : arrive sur le colis sans que le clic soit compté
        // comme une non-lue dans l'historique de l'objet.
        void markRead(notification.id);
        if (notification.href) router.push(notification.href);
      }}
      onOpenNotificationCenter={() => router.push('/notifications')}
      onMarkAllRead={() => void markAllRead()}
      actionsSupplementaires={
        <>
          <PasswordSettingsButton />
          <SoundSettingsButton />
        </>
      }
    >
      {children}
      {dialogueDeconnexion}
    </AppShell>
  );
}

/**
 * Garde de rendu côté client : redirige vers /connexion tant qu'aucune session
 * n'est établie, et affiche un écran d'attente pendant la vérification.
 */
/**
 * Accès requis par écran de l'espace d'exploitation.
 *
 * L'API reste seule décisive : cette table évite seulement d'afficher un écran
 * dont toutes les requêtes seraient refusées (et d'exposer sa structure).
 */
const ACCES_ECRANS: { prefix: string; roles?: RoleType[]; permission?: PermissionCode }[] = [
  { prefix: '/dashboard', roles: [RoleType.ADMIN, RoleType.GESTIONNAIRE, RoleType.FINANCE, RoleType.AGENT_DEPOT] },
  { prefix: '/colis', permission: PermissionCode.COLIS_READ },
  { prefix: '/magasin', permission: PermissionCode.DEPOT_SCAN },
  { prefix: '/runsheets', permission: PermissionCode.RUNSHEET_READ },
  { prefix: '/ramassages', permission: PermissionCode.RAMASSAGE_READ },
  { prefix: '/inter-depots', permission: PermissionCode.INTERDEPOT_READ },
  { prefix: '/inventaire', permission: PermissionCode.INVENTORY_READ },
  { prefix: '/paiements/bordereaux', permission: PermissionCode.PAYMENT_READ },
  { prefix: '/paiements', permission: PermissionCode.PAYMENT_CASH_READ },
  { prefix: '/finance', permission: PermissionCode.PAYMENT_CASH_READ },
  { prefix: '/rapports', permission: PermissionCode.REPORT_READ },
  { prefix: '/recherche', permission: PermissionCode.SEARCH_GLOBAL },
  { prefix: '/audit', permission: PermissionCode.AUDIT_READ },
  { prefix: '/admin/utilisateurs', permission: PermissionCode.USER_READ },
  { prefix: '/admin/expediteurs', permission: PermissionCode.EXPEDITEUR_READ },
  { prefix: '/admin/livreurs', permission: PermissionCode.LIVREUR_READ },
  { prefix: '/admin/zones', permission: PermissionCode.LIVREUR_READ },
  { prefix: '/design-system', roles: [RoleType.ADMIN] },
];

function ecranAutorise(
  pathname: string,
  user: { role: RoleType; permissions?: PermissionCode[] }
): boolean {
  const regle = ACCES_ECRANS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!regle) return true; // notifications, etc. : tout profil d'exploitation
  if (regle.roles && !regle.roles.includes(user.role)) return false;
  if (regle.permission && user.role !== RoleType.ADMIN && !(user.permissions ?? []).includes(regle.permission)) {
    return false;
  }
  return true;
}

/**
 * Garde de rendu côté client de l'espace d'exploitation.
 *
 *  - sans session : redirection vers /connexion ;
 *  - expéditeur : redirection vers son portail (l'espace interne ne lui est pas ouvert) ;
 *  - livreur : écran d'information (il travaille depuis l'application mobile) ;
 *  - écran non autorisé pour le profil : écran « accès refusé ».
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const { demanderDeconnexion, dialogueDeconnexion } = useDeconnexionConfirmee();
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  React.useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/connexion');
    else if (user.role === RoleType.EXPEDITEUR) router.replace('/expediteur');
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <ShieldCheck className="w-8 h-8 text-red-600 animate-pulse" />
          <p className="text-sm font-medium">Vérification de la session…</p>
        </div>
      </div>
    );
  }

  // Le rendu est neutralisé tant que la redirection n'a pas eu lieu.
  if (!user || user.role === RoleType.EXPEDITEUR) return null;

  if (user.role === RoleType.LIVREUR) {
    return (
      <AccesRefuse
        titre="Accès refusé — espace livreur sur mobile"
        message="Les livreurs utilisent l'application mobile RUNEX. L'espace web d'exploitation ne leur est pas ouvert."
        action="Se déconnecter"
        onAction={demanderDeconnexion}
      >
        {dialogueDeconnexion}
      </AccesRefuse>
    );
  }

  if (!ecranAutorise(pathname, user)) {
    return (
      <AccesRefuse
        titre="Accès refusé"
        message="Votre profil ne permet pas d'ouvrir cet écran."
        action="Retour au tableau de bord"
        onAction={() => router.replace(user.role === RoleType.ADMIN || user.role === RoleType.GESTIONNAIRE || user.role === RoleType.FINANCE || user.role === RoleType.AGENT_DEPOT ? '/dashboard' : '/connexion')}
      />
    );
  }

  return <>{children}</>;
}

function AccesRefuse(props: {
  titre: string;
  message: string;
  action: string;
  onAction: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4">
        <div className="flex justify-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-amber-50 border border-amber-200">
            <ShieldCheck className="w-5 h-5 text-amber-700" aria-hidden="true" />
          </span>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold text-slate-900">{props.titre}</h1>
          <p className="text-sm text-slate-600 leading-relaxed">{props.message}</p>
        </div>
        <button
          type="button"
          onClick={props.onAction}
          className="inline-block w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs transition"
        >
          {props.action}
        </button>
      </div>
      {props.children}
    </div>
  );
}

/** Icône de déconnexion réutilisée par l'en-tête (gardée pour cohérence). */
export const LogoutIcon = LogOut;
