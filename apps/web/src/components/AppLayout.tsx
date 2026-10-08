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
import {
  Activity,
  Archive,
  ArrowRightLeft,
  Barcode,
  BarChart3,
  Bike,
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
  inventaire: '/inventaire',
  rapports: '/rapports',
  audit: '/audit',
  recherche: '/recherche',
  'admin-utilisateurs': '/admin/utilisateurs',
  'admin-expediteurs': '/admin/expediteurs',
  'admin-livreurs': '/admin/livreurs',
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
  const { user, logout } = useAuth();
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
      label: 'Transferts inter-dépôts',
      icon: <ArrowRightLeft className="w-4 h-4" />,
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
      onLogout={() => void logout()}
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
    >
      {children}
    </AppShell>
  );
}

/**
 * Garde de rendu côté client : redirige vers /connexion tant qu'aucune session
 * n'est établie, et affiche un écran d'attente pendant la vérification.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!isLoading && !user) router.replace('/connexion');
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

  if (!user) {
    // Le rendu est neutralisé tant que la redirection n'a pas eu lieu.
    return null;
  }

  void pathname;
  return <>{children}</>;
}

/** Icône de déconnexion réutilisée par l'en-tête (gardée pour cohérence). */
export const LogoutIcon = LogOut;
