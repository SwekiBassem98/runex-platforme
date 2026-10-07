/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Package,
  Truck,
  Layers,
  Calendar,
  CreditCard,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Search,
  Building2,
  FileText,
  Activity,
  Lock,
  UserCheck,
  LogOut,
  KeyRound,
  Eye,
  EyeOff,
  User,
  ShieldAlert,
  ArrowRightLeft,
  Check,
  RotateCcw,
  Palette,
  Sliders,
  ChevronRight,
  TrendingUp,
  MapPin,
  Phone,
  FileSpreadsheet,
  AlertCircle,
  Users,
  Warehouse,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
  Share2,
  Repeat,
  XCircle,
} from 'lucide-react';

import {
  AppShell,
  PageHeader,
  Card,
  MetricCard,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Pagination,
  SearchInput,
  FilterBar,
  FilterSelect,
  Tabs,
  Modal,
  Drawer,
  ConfirmDialog,
  FormField,
  Input,
  Select,
  Checkbox,
  Switch,
  Badge,
  StatusIndicator,
  ToastProvider,
  useToast,
  EmptyState,
  Spinner,
  SkeletonCard,
  SkeletonTable,
  ErrorBanner,
  VolumeLineChart,
  StatusDonutChart,
  CodBarChart,
  DriverActivityChart,
  SupplierActivityChart,
  StatBarChart,
  formatTND,
  PACKAGE_STATUS_MAP,
} from '../../packages/ui/src/index';

import { RoleType, PermissionCode } from '../../packages/types/src/index';
import type { AuthUser } from '../../packages/types/src/index';
import { ExpediteurPortal } from './components/ExpediteurPortal';
import { ColisManagementModule } from './components/ColisManagementModule';
import { RunsheetManagementModule } from './components/RunsheetManagementModule';

interface DemoAccount {
  email: string;
  role: RoleType;
  name: string;
  passwordHint: string;
}

export default function RootApp() {
  return (
    <ToastProvider>
      <MainApplication />
    </ToastProvider>
  );
}

function MainApplication() {
  const { addToast } = useToast();

  // Authentification
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Formulaire de connexion
  const [emailInput, setEmailInput] = useState('admin@logixpress.tn');
  const [passwordInput, setPasswordInput] = useState('Admin123!');
  const [showPassword, setShowPassword] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  // Navigation
  const [activeNav, setActiveNav] = useState('dashboard');
  const [activeDeposit, setActiveDeposit] = useState('Hub Central Ben Arous');

  // Données dynamiques issues de l'API
  const [dashboardData, setDashboardData] = useState<any | null>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [runsheets, setRunsheets] = useState<any[]>([]);
  const [pickups, setPickups] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Filtres et Recherche Colis
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('ALL');
  const [selectedGovFilter, setSelectedGovFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Tiroir Détails Colis (Drawer)
  const [selectedColis, setSelectedColis] = useState<any | null>(null);

  // Modales
  const [showNewColisModal, setShowNewColisModal] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [colisToCancel, setColisToCancel] = useState<string | null>(null);
  const [barcodeScanInput, setBarcodeScanInput] = useState('26092802505813');
  const [isScanning, setIsScanning] = useState(false);

  // Permissions helper
  const can = (permission: PermissionCode): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === RoleType.ADMIN) return true;
    return currentUser.permissions.includes(permission);
  };

  // Chargement des comptes démo
  useEffect(() => {
    fetch('/api/v1/auth/demo-users')
      .then((r) => r.json())
      .then((res) => {
        if (res.data) setDemoAccounts(res.data);
      })
      .catch(() => {});

    const savedToken = localStorage.getItem('logixpress_access_token');
    const savedRefresh = localStorage.getItem('logixpress_refresh_token');
    if (savedToken) {
      setToken(savedToken);
      setRefreshToken(savedRefresh);
      fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.success && res.data) {
            setCurrentUser(res.data);
            if (res.data.role === RoleType.EXPEDITEUR) {
              setActiveNav('expediteur-portal');
            }
          } else {
            localStorage.removeItem('logixpress_access_token');
            setToken(null);
          }
        })
        .catch(() => {
          localStorage.removeItem('logixpress_access_token');
          setToken(null);
        });
    }
  }, []);

  const handleLogin = async (e?: React.FormEvent, directEmail?: string, directPassword?: string) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    const email = directEmail || emailInput;
    const password = directPassword || passwordInput;

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!data.success) {
        setAuthError(data.message || 'Identifiants invalides');
        return;
      }

      setToken(data.data.accessToken);
      setRefreshToken(data.data.refreshToken);
      setCurrentUser(data.data.user);
      localStorage.setItem('logixpress_access_token', data.data.accessToken);
      localStorage.setItem('logixpress_refresh_token', data.data.refreshToken);

      if (data.data.user.role === RoleType.EXPEDITEUR) {
        setActiveNav('expediteur-portal');
      } else {
        setActiveNav('dashboard');
      }

      addToast({
        type: 'success',
        title: 'Authentification réussie',
        message: `Bienvenue, ${data.data.user.fullName} (${data.data.user.role})`,
      });
    } catch {
      setAuthError('Erreur de connexion au serveur.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('logixpress_access_token');
    localStorage.removeItem('logixpress_refresh_token');
    setToken(null);
    setCurrentUser(null);
    addToast({
      type: 'info',
      title: 'Session terminée',
      message: 'Vous êtes maintenant déconnecté.',
    });
  };

  // Chargement des données réelles depuis le backend
  const loadData = async () => {
    if (!token) return;
    setIsLoadingData(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [resDash, resPkg, resRun, resPick, resPay] = await Promise.all([
        fetch('/api/v1/dashboard', { headers }).then((r) => r.json()),
        fetch('/api/v1/packages', { headers }).then((r) => r.json()),
        fetch('/api/v1/runsheets', { headers }).then((r) => r.json()),
        fetch('/api/v1/pickups', { headers }).then((r) => r.json()),
        fetch('/api/v1/payments/vouchers', { headers }).then((r) => r.json()),
      ]);

      if (resDash?.data) setDashboardData(resDash.data);
      if (resPkg?.data) setPackages(resPkg.data);
      if (resRun?.data) setRunsheets(resRun.data);
      if (resPick?.data) setPickups(resPick.data);
      if (resPay?.data) setPayments(resPay.data);
    } catch {
      addToast({
        type: 'error',
        title: 'Erreur réseau',
        message: 'Impossible de synchroniser les métriques opérationnelles.',
      });
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (token) loadData();
  }, [token, currentUser]);

  const handleScanAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeScanInput.trim() || !token) return;
    setIsScanning(true);
    try {
      const res = await fetch('/api/v1/warehouse/scan-accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ barcode: barcodeScanInput.trim(), depositId: 'dep-benarous-01' }),
      });
      const data = await res.json();
      if (data.success) {
        addToast({
          type: 'success',
          title: 'Colis accepté en dépôt',
          message: `N° ${data.data.trackingNumber} pointé au Hub Ben Arous.`,
        });
        loadData();
      } else {
        addToast({
          type: 'error',
          title: 'Erreur scan',
          message: data.message,
        });
      }
    } finally {
      setIsScanning(false);
    }
  };

  // Liste des items de navigation
  //
  // Le portail expéditeur n'est plus un item de navigation : c'est un espace
  // d'authentification séparé, atteint via `/expediteur/login`. L'application
  // Vite archivée conservait ce raccourci pour les deux types d'utilisateurs ;
  // il est retiré ici pour qu'il ne subsiste dans aucune configuration.
  const navItems = [
    ...(currentUser?.role === RoleType.EXPEDITEUR
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
      count: packages.length,
      disabled: !can(PermissionCode.COLIS_READ),
    },
    {
      id: 'magasin',
      label: 'Acceptation Magasin',
      icon: <Barcode className="w-4 h-4" />,
      disabled: !can(PermissionCode.DEPOT_SCAN),
    },
    {
      id: 'runsheets',
      label: 'Runsheets Livreurs',
      icon: <Truck className="w-4 h-4" />,
      count: runsheets.length,
      disabled: !can(PermissionCode.RUNSHEET_READ),
    },
    {
      id: 'ramassages',
      label: 'RDV Ramassages',
      icon: <Calendar className="w-4 h-4" />,
      count: pickups.length,
    },
    {
      id: 'paiements',
      label: 'Paiements Expéditeurs',
      icon: <CreditCard className="w-4 h-4" />,
      count: payments.length,
      disabled: !can(PermissionCode.PAYMENT_READ),
    },
    {
      id: 'design-system',
      label: 'Design System Primitives',
      icon: <Palette className="w-4 h-4 text-red-500" />,
    },
  ];

  // Filtrage des colis
  const filteredPackages = packages.filter((pkg) => {
    const matchSearch =
      !searchTerm ||
      pkg.trackingNumber.includes(searchTerm) ||
      pkg.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pkg.customerPhone.includes(searchTerm);
    const matchStatus = selectedStatusFilter === 'ALL' || pkg.status === selectedStatusFilter;
    const matchGov = selectedGovFilter === 'ALL' || pkg.governorate === selectedGovFilter;
    return matchSearch && matchStatus && matchGov;
  });

  const paginatedPackages = filteredPackages.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // -------------------------------------------------------------
  // VUE 1 : FORMULAIRE DE CONNEXION
  // -------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 text-slate-100">
        <div className="w-full max-w-md bg-[#161B22] border border-slate-800 rounded-xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-lg bg-red-600 flex items-center justify-center font-bold text-white text-2xl mx-auto shadow-md">
              LX
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">LogiXpress Tunisie</h1>
            <p className="text-xs text-slate-400">
              Système de gestion logistique & poste de commandement opérationnel
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {authError && <ErrorBanner message={authError} onDismiss={() => setAuthError(null)} />}

            <FormField label="Email Professionnel" required>
              <Input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="nom@logixpress.tn"
              />
            </FormField>

            <FormField label="Mot de Passe" required>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </FormField>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              {authLoading ? <Spinner size="sm" className="text-white" /> : 'Se Connecter'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-800 space-y-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block text-center">
              Comptes Démonstration pour Test de Rôles
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmailInput(acc.email);
                    setPasswordInput(acc.passwordHint);
                    handleLogin(undefined, acc.email, acc.passwordHint);
                  }}
                  className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-red-600/50 rounded-md text-left transition flex flex-col justify-between cursor-pointer"
                >
                  <span className="font-bold text-white truncate block">{acc.name}</span>
                  <span className="text-[10px] text-red-400 font-mono block mt-0.5">{acc.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Raccourcis pour les données réelles du dashboard
  const colisStats = dashboardData?.colis || {
    total: packages.length,
    nouveaux: 0,
    aAffecter: 2,
    affectes: 1,
    enLivraison: 1,
    livres: 24,
    reportes: 3,
    retournes: 1,
    annules: 0,
    echanges: 0,
    tauxReussite: 85.5,
  };

  const livreurStats = dashboardData?.livreurs || {
    actifs: 5,
    disponibles: 2,
    enTournee: 2,
    horsLigne: 1,
    total: 6,
  };

  const ramassageStats = dashboardData?.ramassages || {
    aConfirmer: 2,
    planifies: 1,
    enCours: 1,
    effectues: 10,
    annules: 0,
    total: pickups.length,
  };

  const paiementStats = dashboardData?.paiements || {
    montantAEncaisserTND: 4850.000,
    montantEncaisseTND: 3572.000,
    paiementsEnAttenteTND: 2017.100,
    paiementsValidesTND: 1714.000,
    retoursFinanciersTND: 12.000,
    deficitCaisseTND: 0.000,
  };

  const depotStats = dashboardData?.depots || {
    colisAuDepot: 360,
    colisInTransit: 45,
    interDepotsActifs: 1,
    agencesActives: 4,
  };

  const alerts = dashboardData?.alerts || [];
  const recentActivities = dashboardData?.recentActivity || [];

  return (
    <AppShell
      navItems={navItems}
      activeNavId={activeNav}
      onSelectNav={setActiveNav}
      activeDepositName={activeDeposit}
      userName={currentUser.fullName}
      userRole={currentUser.role}
      onLogout={handleLogout}
      onSearchClick={() => {
        setActiveNav('colis');
        addToast({ type: 'info', title: 'Recherche active', message: 'Tapez un mot-clé dans le champ de recherche.' });
      }}
    >
      {/* ========================================================= */}
      {/* 0. PORTAIL EXPÉDITEUR DÉDIÉ                              */}
      {/* ========================================================= */}
      {activeNav === 'expediteur-portal' && (
        <ExpediteurPortal currentUser={currentUser} token={token!} />
      )}

      {/* ========================================================= */}
      {/* 1. POSTE DE COMMANDEMENT OPÉRATIONNEL (ADMIN DASHBOARD)  */}
      {/* ========================================================= */}
      {activeNav === 'dashboard' && (
        <div className="space-y-6">
          <PageHeader
            title="Poste de Commandement Logistique"
            description="Supervision en temps réel des 5 piliers opérationnels : Colis, Livreurs, Ramassages, Paiements CRBT et Dépôts régionaux."
            breadcrumbs={[{ label: 'Administration' }, { label: 'Poste de Commandement', active: true }]}
            badge={
              <Badge variant="success">
                <StatusIndicator status="online" pulse label="Temps Réel Opérationnel" />
              </Badge>
            }
            actions={
              <button
                onClick={loadData}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition shadow-2xs cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
                <span>Actualiser les flux</span>
              </button>
            }
          />

          <div className="p-6 space-y-6">
            {/* ALERTES OPÉRATIONNELLES PRIORITAIRES */}
            {alerts.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {alerts.map((alert: any) => (
                  <div
                    key={alert.id}
                    className={`p-3.5 rounded-lg border flex flex-col justify-between shadow-2xs transition hover:shadow-xs ${
                      alert.type === 'danger'
                        ? 'bg-red-50/70 border-red-200 text-red-900'
                        : alert.type === 'warning'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                        : 'bg-blue-50/70 border-blue-200 text-blue-900'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80 flex items-center gap-1">
                          {alert.type === 'danger' && <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
                          {alert.type === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                          {alert.title}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[11px] font-mono font-bold bg-white/80 border">
                          {alert.count}
                        </span>
                      </div>
                      <p className="text-xs mt-1.5 leading-snug text-slate-700">{alert.message}</p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/60 flex justify-end">
                      <button
                        onClick={() => {
                          if (alert.category === 'COLIS_NON_AFFECTES') setActiveNav('colis');
                          else if (alert.category === 'RUNSHEETS_A_VALIDER') setActiveNav('runsheets');
                          else if (alert.category === 'PAIEMENTS_EN_ATTENTE') setActiveNav('paiements');
                          else if (alert.category === 'RAMASSAGES_A_CONFIRMER') setActiveNav('ramassages');
                        }}
                        className="text-xs font-bold text-red-700 hover:text-red-800 flex items-center gap-1 cursor-pointer"
                      >
                        <span>{alert.actionLabel}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* SECTION 1 : STATISTIQUES DES COLIS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-red-600" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Flux Colis (Total : {colisStats.total} pris en charge)
                  </h3>
                </div>
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Taux de Réussite : {colisStats.tauxReussite}%
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2.5">
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block truncate">Total</span>
                  <span className="text-lg font-bold text-slate-900 mt-1 block font-mono">{colisStats.total}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-sky-600 block truncate">Nouveaux</span>
                  <span className="text-lg font-bold text-sky-700 mt-1 block font-mono">{colisStats.nouveaux}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-red-200 bg-red-50/20 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-red-600 block truncate">À affecter</span>
                  <span className="text-lg font-bold text-red-700 mt-1 block font-mono">{colisStats.aAffecter}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block truncate">Affectés</span>
                  <span className="text-lg font-bold text-slate-800 mt-1 block font-mono">{colisStats.affectes}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-amber-200 bg-amber-50/20 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-amber-700 block truncate">En livraison</span>
                  <span className="text-lg font-bold text-amber-800 mt-1 block font-mono">{colisStats.enLivraison}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-emerald-200 bg-emerald-50/20 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-emerald-700 block truncate">Livrés</span>
                  <span className="text-lg font-bold text-emerald-800 mt-1 block font-mono">{colisStats.livres}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-amber-600 block truncate">Reportés</span>
                  <span className="text-lg font-bold text-amber-700 mt-1 block font-mono">{colisStats.reportes}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-rose-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-rose-700 block truncate">Retournés</span>
                  <span className="text-lg font-bold text-rose-800 mt-1 block font-mono">{colisStats.retournes}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block truncate">Annulés</span>
                  <span className="text-lg font-bold text-slate-600 mt-1 block font-mono">{colisStats.annules}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-purple-200 shadow-2xs">
                  <span className="text-[10px] uppercase font-semibold text-purple-700 block truncate">Échanges</span>
                  <span className="text-lg font-bold text-purple-800 mt-1 block font-mono">{colisStats.echanges}</span>
                </div>
              </div>
            </div>

            {/* SECTION 2 : 4 GRILLES DE STATUTS MÉTIER (LIVREURS, RAMASSAGES, FINANCES, DÉPÔTS) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* LIVREURS */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Truck className="w-3.5 h-3.5 text-slate-700" />
                    <span>Flotte Livreurs ({livreurStats.total})</span>
                  </div>
                  <Badge variant="secondary">{livreurStats.actifs} Actifs</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-emerald-50/50 rounded border border-emerald-100">
                    <span className="text-slate-500 text-[10px] block">Disponibles</span>
                    <span className="text-base font-bold text-emerald-800 font-mono">{livreurStats.disponibles}</span>
                  </div>
                  <div className="p-2 bg-blue-50/50 rounded border border-blue-100">
                    <span className="text-slate-500 text-[10px] block">En tournée</span>
                    <span className="text-base font-bold text-blue-800 font-mono">{livreurStats.enTournee}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[10px] block">Hors ligne</span>
                    <span className="text-base font-bold text-slate-600 font-mono">{livreurStats.horsLigne}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[10px] block">Taux occupation</span>
                    <span className="text-base font-bold text-slate-900 font-mono">
                      {Math.round((livreurStats.enTournee / livreurStats.actifs) * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* RAMASSAGES */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Calendar className="w-3.5 h-3.5 text-amber-600" />
                    <span>RDV Ramassages ({ramassageStats.total})</span>
                  </div>
                  <Badge variant="warning">{ramassageStats.aConfirmer} à confirmer</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-amber-50/50 rounded border border-amber-100">
                    <span className="text-slate-500 text-[10px] block">À confirmer</span>
                    <span className="text-base font-bold text-amber-800 font-mono">{ramassageStats.aConfirmer}</span>
                  </div>
                  <div className="p-2 bg-sky-50/50 rounded border border-sky-100">
                    <span className="text-slate-500 text-[10px] block">Planifiés</span>
                    <span className="text-base font-bold text-sky-800 font-mono">{ramassageStats.planifies}</span>
                  </div>
                  <div className="p-2 bg-emerald-50/50 rounded border border-emerald-100">
                    <span className="text-slate-500 text-[10px] block">Effectués</span>
                    <span className="text-base font-bold text-emerald-800 font-mono">{ramassageStats.effectues}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[10px] block">Annulés</span>
                    <span className="text-base font-bold text-slate-500 font-mono">{ramassageStats.annules}</span>
                  </div>
                </div>
              </div>

              {/* FINANCES & PAIEMENTS */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Coins className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Caisse & CRBT (TND)</span>
                  </div>
                  <Badge variant="success">0 Déficit</Badge>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">À encaisser :</span>
                    <span className="font-mono font-bold text-slate-900">{formatTND(paiementStats.montantAEncaisserTND)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">Encaissé espèces :</span>
                    <span className="font-mono font-bold text-emerald-700">{formatTND(paiementStats.montantEncaisseTND)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">Bordereaux en attente :</span>
                    <span className="font-mono font-semibold text-amber-700">{formatTND(paiementStats.paiementsEnAttenteTND)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Validés décaissés :</span>
                    <span className="font-mono font-bold text-slate-800">{formatTND(paiementStats.paiementsValidesTND)}</span>
                  </div>
                </div>
              </div>

              {/* DÉPÔTS & LOGISTIQUE */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Warehouse className="w-3.5 h-3.5 text-red-600" />
                    <span>Dépôts & Navettes</span>
                  </div>
                  <Badge variant="outline">4 Agences</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-red-50/40 rounded border border-red-100">
                    <span className="text-slate-500 text-[10px] block">Au Hub Ben Arous</span>
                    <span className="text-base font-bold text-red-700 font-mono">{depotStats.colisAuDepot}</span>
                  </div>
                  <div className="p-2 bg-purple-50/50 rounded border border-purple-100">
                    <span className="text-slate-500 text-[10px] block">En Transit</span>
                    <span className="text-base font-bold text-purple-800 font-mono">{depotStats.colisInTransit}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[10px] block">Navettes actives</span>
                    <span className="text-base font-bold text-slate-800 font-mono">{depotStats.interDepotsActifs}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[10px] block">Taux saturation</span>
                    <span className="text-base font-bold text-slate-900 font-mono">42%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 3 : 5 GRAPHIQUES OPÉRATIONNELS DEMANDÉS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 1. Deliveries Over Time */}
              <Card
                className="lg:col-span-2"
                title="1. Cadence Horaire des Livraisons (Deliveries Over Time)"
                subtitle="Flux cumulé des colis pris en charge vs validés livrés au client final"
              >
                <VolumeLineChart data={dashboardData?.charts?.deliveriesOverTime || []} height={220} />
              </Card>

              {/* 2. Delivered vs Returned */}
              <Card
                title="2. Livrés vs Retours (Conformité)"
                subtitle="Répartition des fins de tournée"
              >
                <StatusDonutChart data={dashboardData?.charts?.deliveredVsReturned || []} height={180} />
                <div className="mt-2 space-y-1 text-xs border-t border-slate-100 pt-2">
                  <div className="flex justify-between">
                    <span className="text-emerald-700 font-medium">Livrés avec succès :</span>
                    <span className="font-bold text-emerald-800 font-mono">
                      {dashboardData?.charts?.deliveredVsReturned?.[0]?.value || 24}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-700 font-medium">Reportés (NPAI/Absent) :</span>
                    <span className="font-bold text-amber-800 font-mono">
                      {dashboardData?.charts?.deliveredVsReturned?.[1]?.value || 3}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-700 font-medium">Retours définitifs :</span>
                    <span className="font-bold text-red-800 font-mono">
                      {dashboardData?.charts?.deliveredVsReturned?.[2]?.value || 1}
                    </span>
                  </div>
                </div>
              </Card>

              {/* 3. COD Amounts */}
              <Card
                title="3. Montants COD Recouvrés (Espèces)"
                subtitle="Montant prévu à l'enlèvement vs encaissé au retour de tournée (TND)"
              >
                <CodBarChart data={dashboardData?.charts?.codAmounts || []} height={210} />
              </Card>

              {/* 4. Driver Activity */}
              <Card
                title="4. Activité par Livreur (Driver Activity)"
                subtitle="Performance individuelle des tournées en cours"
              >
                <DriverActivityChart data={dashboardData?.charts?.driverActivity || []} height={210} />
              </Card>

              {/* 5. Supplier Activity */}
              <Card
                title="5. Activité des Expéditeurs (Top Fournisseurs)"
                subtitle="Volume des colis expédiés par compte e-commerce"
              >
                <SupplierActivityChart data={dashboardData?.charts?.supplierActivity || []} height={210} />
              </Card>
            </div>

            {/* SECTION 4 : FLUX D'ACTIVITÉ RÉCENTE EN DIRECT (RECENT ACTIVITY FEED) */}
            <Card
              title="Journal des Événements Opérationnels Récents (Live Feed)"
              subtitle="Traçabilité continue des scans, livraisons, validations caisse et ramassages"
              action={
                <span className="text-xs text-slate-500 font-mono">Mis à jour en temps réel</span>
              }
            >
              <div className="divide-y divide-slate-100">
                {recentActivities.map((act: any) => (
                  <div key={act.id} className="py-3 flex items-start justify-between gap-4 hover:bg-slate-50/50 transition px-1 rounded">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          act.type === 'DELIVERY'
                            ? 'bg-emerald-100 text-emerald-700'
                            : act.type === 'SCAN'
                            ? 'bg-blue-100 text-blue-700'
                            : act.type === 'RUNSHEET'
                            ? 'bg-purple-100 text-purple-700'
                            : act.type === 'PAYMENT'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {act.type === 'DELIVERY' && <Check className="w-3.5 h-3.5" />}
                        {act.type === 'SCAN' && <Barcode className="w-3.5 h-3.5" />}
                        {act.type === 'RUNSHEET' && <Truck className="w-3.5 h-3.5" />}
                        {act.type === 'PAYMENT' && <Coins className="w-3.5 h-3.5" />}
                        {act.type === 'PICKUP' && <Calendar className="w-3.5 h-3.5" />}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-xs">{act.title}</span>
                          {act.badge && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border">
                              {act.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">{act.description}</p>
                        <span className="text-[11px] text-slate-400 block mt-0.5 font-medium">Par {act.actor}</span>
                      </div>
                    </div>

                    <span className="text-[11px] font-mono text-slate-400 shrink-0">{act.timestamp}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. GESTION INTÉGRALE DES COLIS (MODULE MAÎTRE)           */}
      {/* ========================================================= */}
      {activeNav === 'colis' && (
        <ColisManagementModule currentUser={currentUser} token={token!} />
      )}

      {/* ========================================================= */}
      {/* 3. ACCEPTATION MAGASIN                                    */}
      {/* ========================================================= */}
      {activeNav === 'magasin' && (
        <div className="space-y-6">
          <PageHeader
            title="Acceptation Magasin (Inbound Scan)"
            description="Réception optique haute cadence des colis au Hub Central de Ben Arous."
            breadcrumbs={[{ label: 'Entrepôt' }, { label: 'Acceptation Magasin', active: true }]}
          />

          <div className="p-6 space-y-6">
            <Card title="Lecteur Code-barres (Focus Pistolet)">
              <form onSubmit={handleScanAccept} className="flex gap-3 max-w-xl">
                <div className="flex-1">
                  <Input
                    value={barcodeScanInput}
                    onChange={(e) => setBarcodeScanInput(e.target.value)}
                    placeholder="Scanner ou saisir code-barres..."
                    className="font-mono font-bold text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isScanning}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isScanning ? <Spinner size="sm" className="text-white" /> : <Barcode className="w-4 h-4" />}
                  <span>Ajouter au dépôt</span>
                </button>
              </form>
            </Card>

            <Card title="Colis récemment réceptionnés" subtitle="Pointés au Hub Ben Arous">
              <Table>
                <Thead>
                  <tr>
                    <Th>Colis</Th>
                    <Th>Client</Th>
                    <Th>Expéditeur</Th>
                    <Th align="right">Montant</Th>
                    <Th align="center">État</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {packages.slice(0, 5).map((pkg) => (
                    <Tr key={pkg.id}>
                      <Td className="font-mono font-bold text-red-600">{pkg.trackingNumber}</Td>
                      <Td>{pkg.customerName}</Td>
                      <Td>{pkg.shipperName}</Td>
                      <Td align="right" className="font-mono font-semibold">{formatTND(pkg.totalPrice)}</Td>
                      <Td align="center">
                        <Badge variant="success">Reçu Dépôt</Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 4. RUNSHEETS & TOURNÉES DE DISTRIBUTION                  */}
      {/* ========================================================= */}
      {activeNav === 'runsheets' && (
        <RunsheetManagementModule currentUser={currentUser} token={token!} />
      )}

      {/* ========================================================= */}
      {/* 5. RAMASSAGES                                             */}
      {/* ========================================================= */}
      {activeNav === 'ramassages' && (
        <div className="space-y-6">
          <PageHeader
            title="Rendez-vous de Ramassage"
            description="Collectes programmées auprès des expéditeurs e-commerce."
            breadcrumbs={[{ label: 'Opérations' }, { label: 'Ramassages', active: true }]}
          />

          <div className="p-6 space-y-4">
            <Card className="p-0">
              <Table>
                <Thead>
                  <tr>
                    <Th>Référence</Th>
                    <Th>Livreur Collecteur</Th>
                    <Th>Créneau Horaire</Th>
                    <Th>Adresse</Th>
                    <Th>Expéditeur</Th>
                    <Th align="center">État</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {pickups.map((pick) => (
                    <Tr key={pick.id}>
                      <Td className="font-mono font-bold text-slate-800">{pick.referenceNumber}</Td>
                      <Td>{pick.assignedDriverName}</Td>
                      <Td className="font-mono">{pick.timeSlotStartHour}h - {pick.timeSlotEndHour}h</Td>
                      <Td>{pick.pickupAddress}</Td>
                      <Td className="font-semibold text-slate-900">{pick.shipperName}</Td>
                      <Td align="center">
                        <Badge variant="warning">{pick.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 6. PAIEMENTS                                              */}
      {/* ========================================================= */}
      {activeNav === 'paiements' && (
        <div className="space-y-6">
          <PageHeader
            title="Bordereaux de Paiement Expéditeurs (CRBT)"
            description="Règlement périodique des montants recouvrés avec validation par code secret."
            breadcrumbs={[{ label: 'Finance' }, { label: 'Bordereaux', active: true }]}
          />

          <div className="p-6 space-y-4">
            <Card className="p-0">
              <Table>
                <Thead>
                  <tr>
                    <Th>N° Bordereau</Th>
                    <Th>Expéditeur</Th>
                    <Th align="center">Livrés / Retours</Th>
                    <Th align="right">Brut Encaissé</Th>
                    <Th align="right">Net à Payer (CR)</Th>
                    <Th align="center">État</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {payments.map((v) => (
                    <Tr key={v.id}>
                      <Td className="font-mono font-bold text-amber-700">{v.voucherNumber}</Td>
                      <Td className="font-semibold">{v.shipperName}</Td>
                      <Td align="center">
                        <span className="text-emerald-700 font-bold">{v.deliveredCount} L</span> / <span className="text-red-600 font-bold">{v.returnedCount} R</span>
                      </Td>
                      <Td align="right" className="font-mono">{formatTND(v.grossCashCollected)}</Td>
                      <Td align="right" className="font-mono font-bold text-slate-900">{formatTND(v.netPayable)}</Td>
                      <Td align="center">
                        <Badge variant={v.status === 'PAYE' ? 'success' : 'primary'}>{v.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 7. DESIGN SYSTEM SHOWCASE                                 */}
      {/* ========================================================= */}
      {activeNav === 'design-system' && (
        <div className="space-y-6">
          <PageHeader
            title="Catalogue des Composants du Design System"
            description="Bibliothèque complète des 23 composants réutilisables créés pour la plateforme LogiXpress."
            breadcrumbs={[{ label: 'Design System' }, { label: 'Catalogue', active: true }]}
          />

          <div className="p-6 space-y-6">
            <Card title="1. Badges & Indicateurs d'État" subtitle="Variants et badges avec points pulsants">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="default">Default</Badge>
                  <Badge variant="primary">Primary (Red)</Badge>
                  <Badge variant="secondary">Secondary (Dark)</Badge>
                  <Badge variant="success">Success</Badge>
                  <Badge variant="warning">Warning</Badge>
                  <Badge variant="danger">Danger</Badge>
                  <Badge variant="outline">Outline</Badge>
                </div>

                <div className="flex flex-wrap gap-6 pt-3 border-t border-slate-100 items-center">
                  <StatusIndicator status="online" pulse label="Connecté (Live)" />
                  <StatusIndicator status="transit" pulse label="En Transit Inter-Dépôt" />
                  <StatusIndicator status="busy" label="Occupé en tournée" />
                  <StatusIndicator status="alert" pulse label="Alerte Retard" />
                  <StatusIndicator status="offline" label="Déconnecté" />
                </div>
              </div>
            </Card>

            <Card title="2. Éléments de Formulaire" subtitle="Inputs, Select, Switch et Checkbox alignés sur la charte">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Champ texte standard" helpText="Exemple de texte d'aide">
                  <Input placeholder="Entrez une valeur..." />
                </FormField>

                <FormField label="Champ avec erreur" error="Ce champ est obligatoire">
                  <Input placeholder="Erreur..." error />
                </FormField>

                <FormField label="Liste déroulante">
                  <Select>
                    <option>Option 1 : Ben Arous</option>
                    <option>Option 2 : Sousse</option>
                    <option>Option 3 : Sfax</option>
                  </Select>
                </FormField>
              </div>

              <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-100">
                <Checkbox label="Autorisation d'ouverture colis" checked={true} onChange={() => {}} />
                <Switch label="Mode Haute Cadence (Scan continu)" checked={true} onChange={() => {}} />
              </div>
            </Card>

            <Card title="3. Toasts & Alertes" subtitle="Déclenchement instantané des notifications de feedback">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => addToast({ type: 'success', title: 'Opération réussie', message: 'Le colis a été mis à jour.' })}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  Toast Succès
                </button>
                <button
                  onClick={() => addToast({ type: 'error', title: 'Erreur critique', message: 'Le montant saisi est invalide.' })}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  Toast Erreur
                </button>
                <button
                  onClick={() => addToast({ type: 'warning', title: 'Avertissement', message: 'Plafond caisse livreur dépassé.' })}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  Toast Avertissement
                </button>
                <button
                  onClick={() => addToast({ type: 'info', title: 'Information', message: 'Nouvelle navette Sousse en transit.' })}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  Toast Info
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TIROIR DÉTAILS COLIS (DRAWER) */}
      {selectedColis && (
        <Drawer
          isOpen={Boolean(selectedColis)}
          onClose={() => setSelectedColis(null)}
          title={`Détails du Colis #${selectedColis.trackingNumber}`}
          subtitle={`Créé le ${new Date(selectedColis.createdAt).toLocaleDateString('fr-TN')}`}
          footer={
            <div className="flex justify-between w-full">
              <button
                onClick={() => {
                  setColisToCancel(selectedColis.trackingNumber);
                  setShowConfirmCancel(true);
                }}
                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-xs font-semibold cursor-pointer"
              >
                Annuler Colis
              </button>
              <button
                onClick={() => setSelectedColis(null)}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
              >
                Fermer
              </button>
            </div>
          }
        >
          <div className="space-y-5 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-slate-500 block">État Actuel</span>
                <span className="font-bold text-slate-900 text-sm">{selectedColis.status}</span>
              </div>
              <div className="text-right">
                <span className="text-slate-500 block">Montant CRBT</span>
                <span className="font-mono font-bold text-red-600 text-base">{formatTND(selectedColis.totalPrice)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] block border-b pb-1">
                Destinataire
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-400 block">Nom :</span>
                  <span className="font-semibold text-slate-900">{selectedColis.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Téléphone :</span>
                  <span className="font-mono font-semibold text-slate-900">{selectedColis.customerPhone}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block">Adresse :</span>
                  <span>{selectedColis.address}, {selectedColis.delegation}, {selectedColis.governorate}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] block border-b pb-1">
                Expéditeur & Contenu
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-400 block">Expéditeur :</span>
                  <span className="font-semibold">{selectedColis.shipperName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Livreur :</span>
                  <span>{selectedColis.assignedDriverName || 'Non assigné'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block">Description du contenu :</span>
                  <p className="p-2 bg-slate-50 rounded border border-slate-200 mt-1">{selectedColis.contentSummary}</p>
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      )}

      {/* CONFIRMATION D'ANNULATION */}
      <ConfirmDialog
        isOpen={showConfirmCancel}
        onClose={() => setShowConfirmCancel(false)}
        onConfirm={() => {
          setShowConfirmCancel(false);
          addToast({
            type: 'warning',
            title: 'Colis annulé',
            message: `Le colis #${colisToCancel} a été annulé avec traçabilité dans l'audit log.`,
          });
        }}
        title="Confirmer l'annulation du colis"
        message={`Êtes-vous sûr de vouloir annuler le colis #${colisToCancel} ? Cette action est irréversible et sera enregistrée dans le journal d'audit.`}
        confirmText="Oui, annuler"
        type="danger"
      />
    </AppShell>
  );
}
