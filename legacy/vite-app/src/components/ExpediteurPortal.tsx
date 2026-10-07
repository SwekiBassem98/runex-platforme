import React, { useState, useEffect } from 'react';
import {
  Package,
  Calendar,
  CreditCard,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileText,
  User,
  Plus,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  Edit3,
  XCircle,
  History,
  Phone,
  MapPin,
  Check,
  Send,
  Building,
  RotateCcw,
  Truck,
  DollarSign,
  ChevronRight,
  ChevronLeft,
  Coins,
} from 'lucide-react';

import {
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
  Modal,
  Drawer,
  ConfirmDialog,
  FormField,
  Input,
  Select,
  Textarea,
  Checkbox,
  Switch,
  Badge,
  StatusIndicator,
  useToast,
  EmptyState,
  Spinner,
  SkeletonTable,
  ErrorBanner,
  formatTND,
  PACKAGE_STATUS_MAP,
} from '../../../packages/ui/src/index';

import {
  RoleType,
  PackageStatus,
  PackageType,
  PackageSize,
  type PackageDto,
  type AuthUser,
  type TrackingTimelineEvent,
  type DeliveryAttempt,
  type AuditModificationLog,
} from '../../../packages/types/src/index';

interface ExpediteurPortalProps {
  currentUser: AuthUser;
  token: string;
}

export function ExpediteurPortal({ currentUser, token }: ExpediteurPortalProps) {
  const { addToast } = useToast();

  // Navigation dans le portail expéditeur
  const [activeSubTab, setActiveSubTab] = useState<
    'dashboard' | 'colis' | 'nouveau' | 'detail' | 'ramassages' | 'paiements' | 'historique' | 'profil'
  >('dashboard');

  // Données de colis
  const [packages, setPackages] = useState<PackageDto[]>([]);
  const [totalPackages, setTotalPackages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [detailedPackage, setDetailedPackage] = useState<PackageDto | null>(null);

  // Filtres et pagination serveur
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [cityFilter, setCityFilter] = useState('ALL');
  const [driverFilter, setDriverFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Formulaire Nouveau Colis
  const [newColisForm, setNewColisForm] = useState({
    customerName: '',
    customerPhone: '',
    governorate: 'Zaghouan',
    delegation: 'Ennadhour',
    address: '',
    totalPrice: 65.000,
    collectedAmount: 65.000,
    pieceCount: 1,
    sizeCategory: PackageSize.LEGERE,
    packageType: PackageType.NORMAL,
    contentSummary: '',
    allowOpen: true,
    notes: '',
  });
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  // Édition d'un colis existant
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<PackageDto>>({});
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Annulation colis (Soft cancel)
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  // Demande de ramassage
  const [pickups, setPickups] = useState<any[]>([]);
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pickupForm, setPickupForm] = useState({
    date: new Date().toISOString().split('T')[0],
    slot: '14h - 17h',
    estimatedPackages: 15,
    pickupAddress: 'Entrepôt BLUE STAR, Z.I. Ben Arous',
    contactPhone: '58199108',
    notes: 'Prévoir un grand utilitaire',
  });

  // Bordereaux et paiements
  const [payments, setPayments] = useState<any[]>([]);

  // Chargement des colis avec pagination et filtres serveur
  const loadPackages = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
      });
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (cityFilter !== 'ALL') params.append('city', cityFilter);
      if (driverFilter !== 'ALL') params.append('driver', driverFilter);
      if (typeFilter !== 'ALL') params.append('type', typeFilter);
      if (paymentStatusFilter !== 'ALL') params.append('paymentStatus', paymentStatusFilter);
      if (dateFilter) params.append('date', dateFilter);

      const res = await fetch(`/api/v1/packages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setPackages(data.data);
        setTotalPackages(data.meta?.total || data.data.length);
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Erreur réseau',
        message: 'Impossible de récupérer la liste des colis.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Chargement d'un colis précis
  const loadPackageDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/packages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setDetailedPackage(data.data);
        setEditFormData(data.data);
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Erreur',
        message: 'Impossible de charger la fiche du colis.',
      });
    }
  };

  // Chargement des ramassages et bordereaux
  const loadOtherData = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [resPickups, resPayments] = await Promise.all([
        fetch('/api/v1/pickups', { headers }).then((r) => r.json()),
        fetch('/api/v1/payments/vouchers', { headers }).then((r) => r.json()),
      ]);
      if (resPickups?.data) setPickups(resPickups.data);
      if (resPayments?.data) setPayments(resPayments.data);
    } catch {}
  };

  useEffect(() => {
    loadPackages();
  }, [currentPage, pageSize, statusFilter, cityFilter, driverFilter, typeFilter, paymentStatusFilter, dateFilter]);

  useEffect(() => {
    loadOtherData();
  }, []);

  useEffect(() => {
    if (selectedPackageId) {
      loadPackageDetails(selectedPackageId);
    }
  }, [selectedPackageId]);

  // Création Colis
  const handleCreateColis = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingNew(true);
    try {
      const res = await fetch('/api/v1/packages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newColisForm),
      });
      const data = await res.json();
      if (data.success) {
        addToast({
          type: 'success',
          title: 'Colis créé avec succès',
          message: `N° Suivi : ${data.data.trackingNumber} pour ${data.data.customerName}`,
        });
        loadPackages();
        setSelectedPackageId(data.data.id);
        setActiveSubTab('detail');
        // Reset form
        setNewColisForm({
          customerName: '',
          customerPhone: '',
          governorate: 'Zaghouan',
          delegation: 'Ennadhour',
          address: '',
          totalPrice: 65.000,
          collectedAmount: 65.000,
          pieceCount: 1,
          sizeCategory: PackageSize.LEGERE,
          packageType: PackageType.NORMAL,
          contentSummary: '',
          allowOpen: true,
          notes: '',
        });
      } else {
        addToast({ type: 'error', title: 'Erreur création', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de communication serveur.' });
    } finally {
      setIsSubmittingNew(false);
    }
  };

  // Mise à jour Colis avec règle métier
  const handleUpdateColis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailedPackage) return;
    setIsSubmittingEdit(true);
    try {
      const res = await fetch(`/api/v1/packages/${detailedPackage.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editFormData),
      });
      const data = await res.json();
      if (data.success) {
        setDetailedPackage(data.data);
        setIsEditing(false);
        loadPackages();
        if (data.driverNotified) {
          addToast({
            type: 'warning',
            title: 'Chauffeur alerté en direct',
            message: data.message,
            duration: 6000,
          });
        } else {
          addToast({
            type: 'success',
            title: 'Mise à jour réussie',
            message: 'Informations du colis modifiées.',
          });
        }
      } else {
        addToast({ type: 'error', title: 'Action non autorisée', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Impossible de modifier le colis.' });
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Annulation Colis
  const handleCancelColis = async () => {
    if (!detailedPackage) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/v1/packages/${detailedPackage.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: cancelReason || 'Annulé par l\'expéditeur' }),
      });
      const data = await res.json();
      if (data.success) {
        addToast({
          type: 'warning',
          title: 'Colis Annulé',
          message: `Le colis #${data.data.trackingNumber} a été annulé avec succès.`,
        });
        setDetailedPackage(data.data);
        setShowCancelModal(false);
        setCancelReason('');
        loadPackages();
      } else {
        addToast({ type: 'error', title: 'Erreur annulation', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de l\'annulation.' });
    } finally {
      setIsCancelling(false);
    }
  };

  // Statut d'édition pour le colis en détail
  const getEditStatusInfo = (status: PackageStatus) => {
    const locked = [
      PackageStatus.LIVRE,
      PackageStatus.LIVRAISON_PARTIELLE,
      PackageStatus.RETOURNE_EXPEDITEUR,
      PackageStatus.ANNULE,
    ].includes(status);

    const restricted = [
      PackageStatus.AFFECTE_RUNSHEET,
      PackageStatus.EN_COURS_LIVRAISON,
      PackageStatus.REPORTE,
    ].includes(status);

    if (locked) {
      return {
        level: 'LOCKED',
        badge: 'Édition verrouillée',
        color: 'bg-slate-100 text-slate-700 border-slate-300',
        message:
          'Ce colis a achevé son cycle de livraison ou est annulé. Les modifications sont scellées pour conformité financière et d\'audit.',
      };
    }

    if (restricted) {
      return {
        level: 'RESTRICTED',
        badge: 'Mode restreint (Chauffeur en tournée)',
        color: 'bg-amber-50 text-amber-800 border-amber-300',
        message:
          'Le colis est affecté ou en cours de livraison. Si vous modifiez le montant à encaisser ou le nombre de pièces, le chauffeur sera automatiquement notifié sur son terminal mobile et un journal d\'audit sera créé.',
      };
    }

    return {
      level: 'FREE',
      badge: 'Édition libre autorisée',
      color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      message: 'Le colis est en attente d\'affectation. Vous pouvez modifier librement toutes les coordonnées et informations.',
    };
  };

  // Navigation dans le sous-menu de l'expéditeur
  const subNavItems = [
    { id: 'dashboard', label: 'Tableau de bord', count: undefined },
    { id: 'colis', label: 'Mes Colis', count: totalPackages },
    { id: 'nouveau', label: '+ Nouveau Colis', count: undefined },
    { id: 'ramassages', label: 'Mes Ramassages', count: pickups.length },
    { id: 'paiements', label: 'Paiements & CRBT', count: payments.length },
    { id: 'historique', label: 'Historique & Audit', count: undefined },
    { id: 'profil', label: 'Profil Fournisseur', count: undefined },
  ];

  return (
    <div className="space-y-6">
      {/* Header Portail Expéditeur */}
      <PageHeader
        title={`Portail Fournisseur : ${currentUser.shipperName || 'BLUE STAR'}`}
        description="Gestion complète des expéditions e-commerce, traçabilité des livraisons, suivi des remboursements CRBT et demandes de ramassage."
        breadcrumbs={[{ label: 'Espace Expéditeur' }, { label: activeSubTab.toUpperCase(), active: true }]}
        badge={
          <Badge variant="primary">
            <span className="font-mono">{currentUser.shipperName || 'BLUE STAR'}</span>
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveSubTab('nouveau')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Créer un Colis</span>
            </button>
            <button
              onClick={() => {
                loadPackages();
                loadOtherData();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>
          </div>
        }
      />

      {/* Barre d'onglets du portail */}
      <div className="px-6 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 overflow-x-auto">
          {subNavItems.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveSubTab(tab.id as any);
                  if (tab.id === 'colis') setSelectedPackageId(null);
                }}
                className={`py-3 px-3 text-xs font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                      isActive ? 'bg-red-50 text-red-600 font-bold' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-6 pb-8">
        {/* ======================================================== */}
        {/* PAGE 1 : DASHBOARD EXPEDITEUR                           */}
        {/* ======================================================== */}
        {activeSubTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <MetricCard
                title="Total Expéditions"
                value={totalPackages}
                description="Colis déclarés dans le réseau"
                icon={<Package className="w-5 h-5 text-slate-700" />}
              />
              <MetricCard
                title="En cours de livraison"
                value={packages.filter((p) => p.status === PackageStatus.EN_COURS_LIVRAISON).length}
                description="Dans les camions des livreurs"
                icon={<Truck className="w-5 h-5 text-amber-600" />}
              />
              <MetricCard
                title="Livrés avec succès"
                value={packages.filter((p) => p.status === PackageStatus.LIVRE).length}
                description="Taux conformité : 88%"
                icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              />
              <MetricCard
                title="Total CRBT Encaissé"
                value="2 127.000 DT"
                description="Sur 2 850.000 DT expédiés"
                badge="TND"
                icon={<CreditCard className="w-5 h-5 text-red-600" />}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card
                className="lg:col-span-2"
                title="Derniers Colis Expédiés"
                subtitle="Aperçu rapide des statuts"
                action={
                  <button
                    onClick={() => setActiveSubTab('colis')}
                    className="text-xs text-red-600 font-semibold hover:underline"
                  >
                    Voir tous les colis →
                  </button>
                }
              >
                <Table>
                  <Thead>
                    <tr>
                      <Th>N° Colis</Th>
                      <Th>Destinataire</Th>
                      <Th>Gouvernorat</Th>
                      <Th align="right">Montant</Th>
                      <Th align="center">État</Th>
                      <Th align="right">Action</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {packages.slice(0, 5).map((pkg) => {
                      const badge = PACKAGE_STATUS_MAP[pkg.status] || {
                        label: pkg.status,
                        bg: 'bg-slate-100',
                        text: 'text-slate-700',
                        border: 'border-slate-300',
                      };
                      return (
                        <Tr
                          key={pkg.id}
                          onClick={() => {
                            setSelectedPackageId(pkg.id);
                            setActiveSubTab('detail');
                          }}
                        >
                          <Td className="font-mono font-bold text-red-600">{pkg.trackingNumber}</Td>
                          <Td className="font-semibold">{pkg.customerName}</Td>
                          <Td>{pkg.governorate}</Td>
                          <Td align="right" className="font-mono font-bold">{formatTND(pkg.totalPrice)}</Td>
                          <Td align="center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                              {badge.label}
                            </span>
                          </Td>
                          <Td align="right">
                            <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Card>

              {/* Raccourci Ramassage & Contact Dépôt */}
              <div className="space-y-4">
                <Card title="Demande de Ramassage Rapide" subtitle="Planifier un enlèvement à votre dépôt">
                  <div className="space-y-3 text-xs">
                    <p className="text-slate-600">
                      Nos chauffeurs de collecte sont disponibles tous les jours de 10h à 18h sur Grand Tunis, Nabeul et Sousse.
                    </p>
                    <button
                      onClick={() => setActiveSubTab('ramassages')}
                      className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-xs transition"
                    >
                      Programmer un Ramassage
                    </button>
                  </div>
                </Card>

                <Card title="Agence de Rattachement">
                  <div className="text-xs space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Building className="w-4 h-4 text-red-600" />
                      <span className="font-bold text-slate-900">Hub Central Ben Arous</span>
                    </div>
                    <p className="text-slate-500">Zone Industrielle Ben Arous, 2013 Tunisie</p>
                    <p className="text-slate-500 font-mono">Tél direct agence : +216 71 380 000</p>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 2 : LISTE DES COLIS AVEC FILTRES AVANCÉS           */}
        {/* ======================================================== */}
        {activeSubTab === 'colis' && (
          <div className="space-y-4">
            {/* Barre de filtres serveur */}
            <FilterBar
              hasActiveFilters={Boolean(
                searchTerm ||
                  statusFilter !== 'ALL' ||
                  cityFilter !== 'ALL' ||
                  driverFilter !== 'ALL' ||
                  typeFilter !== 'ALL' ||
                  paymentStatusFilter !== 'ALL' ||
                  dateFilter
              )}
              onReset={() => {
                setSearchTerm('');
                setStatusFilter('ALL');
                setCityFilter('ALL');
                setDriverFilter('ALL');
                setTypeFilter('ALL');
                setPaymentStatusFilter('ALL');
                setDateFilter('');
                setCurrentPage(1);
              }}
            >
              <div className="w-64">
                <SearchInput
                  value={searchTerm}
                  onChange={(val) => {
                    setSearchTerm(val);
                    setCurrentPage(1);
                  }}
                  placeholder="N° colis, nom client, tél..."
                />
              </div>

              <FilterSelect
                label="Statut"
                selectedValue={statusFilter}
                onChange={(val) => {
                  setStatusFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Tous les statuts', value: 'ALL' },
                  { label: 'Créé', value: 'CREE' },
                  { label: 'Reçu Dépôt', value: 'RECU_DEPOT' },
                  { label: 'En cours livraison', value: 'EN_COURS_LIVRAISON' },
                  { label: 'Livré', value: 'LIVRE' },
                  { label: 'Reporté', value: 'REPORTE' },
                  { label: 'Retour Dépôt', value: 'RETOUR_DEPOT' },
                  { label: 'Annulé', value: 'ANNULE' },
                ]}
              />

              <FilterSelect
                label="Gouvernorat"
                selectedValue={cityFilter}
                onChange={(val) => {
                  setCityFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Tous', value: 'ALL' },
                  { label: 'Zaghouan', value: 'Zaghouan' },
                  { label: 'Ben Arous', value: 'Ben Arous' },
                  { label: 'Tunis', value: 'Tunis' },
                  { label: 'Sousse', value: 'Sousse' },
                ]}
              />

              <FilterSelect
                label="Type"
                selectedValue={typeFilter}
                onChange={(val) => {
                  setTypeFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Tous les types', value: 'ALL' },
                  { label: 'Normal', value: 'NORMAL' },
                  { label: 'Échange', value: 'EXCHANGE' },
                  { label: 'Reporté', value: 'REPORTED' },
                  { label: 'Retour', value: 'RETURN' },
                ]}
              />

              <FilterSelect
                label="Règlement CRBT"
                selectedValue={paymentStatusFilter}
                onChange={(val) => {
                  setPaymentStatusFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Tous', value: 'ALL' },
                  { label: 'Non réglé', value: 'NON_REGLE' },
                  { label: 'Inclus en bordereau', value: 'EN_BORDEREAU' },
                  { label: 'Payé décaissé', value: 'PAYE' },
                ]}
              />

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date</label>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden"
                />
              </div>
            </FilterBar>

            {/* Table des résultats */}
            {isLoading ? (
              <SkeletonTable rows={5} cols={7} />
            ) : packages.length === 0 ? (
              <EmptyState
                title="Aucun colis trouvé"
                description="Aucun colis ne correspond à vos filtres actuels ou vous n'avez pas encore créé d'envoi."
                action={
                  <button
                    onClick={() => setActiveSubTab('nouveau')}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >
                    Créer mon premier colis
                  </button>
                }
              />
            ) : (
              <Card className="p-0">
                <Table>
                  <Thead>
                    <tr>
                      <Th>N° Suivi / Code-barres</Th>
                      <Th>Destinataire</Th>
                      <Th>Destination</Th>
                      <Th>Livreur Assigné</Th>
                      <Th>Type</Th>
                      <Th align="right">Montant CRBT</Th>
                      <Th align="center">Règlement</Th>
                      <Th align="center">Statut</Th>
                      <Th align="right">Action</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {packages.map((pkg) => {
                      const badge = PACKAGE_STATUS_MAP[pkg.status] || {
                        label: pkg.status,
                        bg: 'bg-slate-100',
                        text: 'text-slate-800',
                        border: 'border-slate-300',
                      };
                      return (
                        <Tr
                          key={pkg.id}
                          onClick={() => {
                            setSelectedPackageId(pkg.id);
                            setActiveSubTab('detail');
                          }}
                        >
                          <Td>
                            <span className="font-mono font-bold text-red-600 block">{pkg.trackingNumber}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{pkg.barcode}</span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 block">{pkg.customerName}</span>
                            <span className="text-slate-500 font-mono text-[11px] flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-400" />
                              {pkg.customerPhone}
                            </span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-800 block">{pkg.governorate}</span>
                            <span className="text-slate-500 text-[11px] truncate max-w-xs block">{pkg.address}</span>
                          </Td>
                          <Td>
                            <span className="text-slate-700 font-medium">
                              {pkg.assignedDriverName || <span className="text-slate-400 italic">En attente tournée</span>}
                            </span>
                          </Td>
                          <Td>
                            <Badge variant={pkg.packageType === 'EXCHANGE' ? 'warning' : 'default'}>
                              {pkg.packageType}
                            </Badge>
                          </Td>
                          <Td align="right">
                            <span className="font-mono font-bold text-slate-900">{formatTND(pkg.totalPrice)}</span>
                          </Td>
                          <Td align="center">
                            <Badge
                              variant={
                                pkg.paymentStatus === 'PAYE'
                                  ? 'success'
                                  : pkg.paymentStatus === 'EN_BORDEREAU'
                                  ? 'warning'
                                  : 'outline'
                              }
                            >
                              {pkg.paymentStatus || 'NON_REGLE'}
                            </Badge>
                          </Td>
                          <Td align="center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                              {badge.label}
                            </span>
                          </Td>
                          <Td align="right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPackageId(pkg.id);
                                setActiveSubTab('detail');
                              }}
                              className="px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
                            >
                              Détails
                            </button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>

                <Pagination
                  currentPage={currentPage}
                  totalPages={Math.ceil(totalPackages / pageSize)}
                  totalItems={totalPackages}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                />
              </Card>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 3 : CRÉATION D'UN NOUVEAU COLIS (FORMULAIRE COMPLET)*/}
        {/* ======================================================== */}
        {activeSubTab === 'nouveau' && (
          <div className="max-w-4xl mx-auto">
            <Card
              title="Création d'un Nouveau Colis"
              subtitle="Remplissez les informations du destinataire et les paramètres logistiques pour générer l'étiquette code-barres."
            >
              <form onSubmit={handleCreateColis} className="space-y-6 text-xs">
                {/* 1. Coordonnées Client */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b pb-2 mb-3 flex items-center gap-2">
                    <User className="w-4 h-4 text-red-600" />
                    1. Coordonnées du Destinataire
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Nom complet du client" required>
                      <Input
                        required
                        value={newColisForm.customerName}
                        onChange={(e) => setNewColisForm({ ...newColisForm, customerName: e.target.value })}
                        placeholder="Ex: Monia Trabelsi"
                      />
                    </FormField>

                    <FormField label="Téléphone principal" required helpText="Format tunisien (8 chiffres)">
                      <Input
                        required
                        value={newColisForm.customerPhone}
                        onChange={(e) => setNewColisForm({ ...newColisForm, customerPhone: e.target.value })}
                        placeholder="Ex: 27660505 ou 98451230"
                        className="font-mono font-semibold"
                      />
                    </FormField>
                  </div>
                </div>

                {/* 2. Destination */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b pb-2 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-red-600" />
                    2. Destination & Adresse de Livraison
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Gouvernorat (Ville)" required>
                      <Select
                        value={newColisForm.governorate}
                        onChange={(e) => setNewColisForm({ ...newColisForm, governorate: e.target.value })}
                      >
                        <option value="Zaghouan">Zaghouan</option>
                        <option value="Ben Arous">Ben Arous</option>
                        <option value="Tunis">Tunis</option>
                        <option value="Ariana">Ariana</option>
                        <option value="Manouba">Manouba</option>
                        <option value="Nabeul">Nabeul</option>
                        <option value="Sousse">Sousse</option>
                        <option value="Sfax">Sfax</option>
                        <option value="Bizerte">Bizerte</option>
                      </Select>
                    </FormField>

                    <FormField label="Délégation / Localité" required>
                      <Input
                        required
                        value={newColisForm.delegation}
                        onChange={(e) => setNewColisForm({ ...newColisForm, delegation: e.target.value })}
                        placeholder="Ex: Ennadhour, Hammam Lif, Menzah..."
                      />
                    </FormField>

                    <div className="sm:col-span-2">
                      <FormField label="Adresse exacte & Repère" required helpText="N° rue, bâtiment, repère visuel (près de la mosquée, école...)">
                        <Input
                          required
                          value={newColisForm.address}
                          onChange={(e) => setNewColisForm({ ...newColisForm, address: e.target.value })}
                          placeholder="Rue de la liberté, Immeuble B, Appt 4"
                        />
                      </FormField>
                    </div>
                  </div>
                </div>

                {/* 3. Paramètres Colis & Finances */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b pb-2 mb-3 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-red-600" />
                    3. Valeur Marchande & Spécifications du Colis
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <FormField label="Montant à encaisser (TND)" required helpText="Montant contre remboursement">
                      <Input
                        type="number"
                        step="0.001"
                        required
                        value={newColisForm.totalPrice}
                        onChange={(e) =>
                          setNewColisForm({
                            ...newColisForm,
                            totalPrice: parseFloat(e.target.value) || 0,
                            collectedAmount: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="font-mono font-bold text-sm text-red-700"
                      />
                    </FormField>

                    <FormField label="Nombre de pièces" required>
                      <Input
                        type="number"
                        min="1"
                        required
                        value={newColisForm.pieceCount}
                        onChange={(e) => setNewColisForm({ ...newColisForm, pieceCount: parseInt(e.target.value, 10) || 1 })}
                        className="font-mono font-semibold"
                      />
                    </FormField>

                    <FormField label="Taille / Poids estimé" required>
                      <Select
                        value={newColisForm.sizeCategory}
                        onChange={(e) => setNewColisForm({ ...newColisForm, sizeCategory: e.target.value as PackageSize })}
                      >
                        <option value={PackageSize.LEGERE}>Légère (moins de 2 kg)</option>
                        <option value={PackageSize.MOYENNE}>Moyenne (2 à 5 kg)</option>
                        <option value={PackageSize.LOURDE}>Lourde (5 à 15 kg)</option>
                        <option value={PackageSize.VOLUMINEUSE}>Volumineuse (plus de 15 kg)</option>
                      </Select>
                    </FormField>

                    <FormField label="Type de colis" required>
                      <Select
                        value={newColisForm.packageType}
                        onChange={(e) => setNewColisForm({ ...newColisForm, packageType: e.target.value as PackageType })}
                      >
                        <option value={PackageType.NORMAL}>Normal (Livraison standard)</option>
                        <option value={PackageType.EXCHANGE}>Échange (Récupération article)</option>
                        <option value={PackageType.REPORTED}>Reporté (Nouvelle tentative)</option>
                        <option value={PackageType.RETURN}>Retour (Retour direct fournisseur)</option>
                      </Select>
                    </FormField>

                    <div className="sm:col-span-2">
                      <FormField label="Description sommaire du contenu" required>
                        <Input
                          required
                          value={newColisForm.contentSummary}
                          onChange={(e) => setNewColisForm({ ...newColisForm, contentSummary: e.target.value })}
                          placeholder="Ex: 2 Robes taille M, Veste en jean"
                        />
                      </FormField>
                    </div>

                    <div className="sm:col-span-3">
                      <FormField label="Instructions spéciales pour le livreur">
                        <Input
                          value={newColisForm.notes}
                          onChange={(e) => setNewColisForm({ ...newColisForm, notes: e.target.value })}
                          placeholder="Ex: Livrer avant midi, possibilité d'essayer..."
                        />
                      </FormField>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <Checkbox
                      label="Autoriser l'ouverture du colis par le client avant paiement"
                      checked={newColisForm.allowOpen}
                      onChange={(checked) => setNewColisForm({ ...newColisForm, allowOpen: checked })}
                    />
                  </div>
                </div>

                <div className="pt-4 border-t flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('colis')}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-100"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingNew}
                    className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold flex items-center gap-2 shadow-xs cursor-pointer"
                  >
                    {isSubmittingNew ? <Spinner size="sm" className="text-white" /> : <Send className="w-4 h-4" />}
                    <span>Créer et Générer Étiquette</span>
                  </button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 4 : FICHE COLIS DÉTAILLÉE (AVEC RÈGLES D'ÉDITION)   */}
        {/* ======================================================== */}
        {activeSubTab === 'detail' && detailedPackage && (
          <div className="space-y-6 max-w-5xl mx-auto">
            {/* Bannière de règle métier explicite sur l'édition */}
            {(() => {
              const editInfo = getEditStatusInfo(detailedPackage.status);
              return (
                <div className={`p-4 rounded-lg border flex items-start gap-3 ${editInfo.color}`}>
                  {editInfo.level === 'LOCKED' && <ShieldAlert className="w-5 h-5 shrink-0 text-slate-600 mt-0.5" />}
                  {editInfo.level === 'RESTRICTED' && <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />}
                  {editInfo.level === 'FREE' && <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />}

                  <div className="flex-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{editInfo.badge}</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-white/80 border">
                        Statut : {detailedPackage.status}
                      </span>
                    </div>
                    <p className="mt-1 leading-relaxed text-slate-700">{editInfo.message}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {editInfo.level !== 'LOCKED' && !isEditing && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded font-semibold text-xs text-slate-800 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                        <span>Modifier</span>
                      </button>
                    )}

                    {!detailedPackage.isCancelled && detailedPackage.status !== PackageStatus.LIVRE && (
                      <button
                        onClick={() => setShowCancelModal(true)}
                        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 border border-red-300 rounded font-semibold text-xs text-red-800 flex items-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5 text-red-700" />
                        <span>Annuler Colis</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* En-tête Colis */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold font-mono text-red-600">
                    #{detailedPackage.trackingNumber}
                  </span>
                  <Badge variant={detailedPackage.packageType === 'EXCHANGE' ? 'warning' : 'default'}>
                    {detailedPackage.packageType}
                  </Badge>
                  <span className="text-xs text-slate-400 font-mono">Code : {detailedPackage.barcode}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Créé le {new Date(detailedPackage.createdAt).toLocaleString('fr-TN')} • Expéditeur : {detailedPackage.shipperName}
                </p>
              </div>

              <div className="flex items-center gap-4 text-right">
                <div>
                  <span className="text-[11px] text-slate-400 block uppercase">Montant Recouvrement</span>
                  <span className="text-xl font-mono font-bold text-slate-900">{formatTND(detailedPackage.totalPrice)}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block uppercase">Règlement Fournisseur</span>
                  <Badge variant={detailedPackage.paymentStatus === 'PAYE' ? 'success' : 'outline'}>
                    {detailedPackage.paymentStatus || 'NON_REGLE'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Formulaire d'édition si activé */}
            {isEditing && (
              <Card
                title="Modification des Données du Colis"
                subtitle="Respectez les restrictions opérationnelles liées au statut du colis."
              >
                <form onSubmit={handleUpdateColis} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Nom client">
                      <Input
                        value={editFormData.customerName || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, customerName: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Téléphone client">
                      <Input
                        value={editFormData.customerPhone || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, customerPhone: e.target.value })}
                        className="font-mono"
                      />
                    </FormField>
                    <FormField label="Gouvernorat">
                      <Input
                        value={editFormData.governorate || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, governorate: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Délégation">
                      <Input
                        value={editFormData.delegation || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, delegation: e.target.value })}
                      />
                    </FormField>
                    <div className="sm:col-span-2">
                      <FormField label="Adresse">
                        <Input
                          value={editFormData.address || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                        />
                      </FormField>
                    </div>

                    <FormField
                      label="Montant à encaisser (TND) *"
                      helpText="Attention : Alerte immédiatement le chauffeur en tournée si modifié"
                    >
                      <Input
                        type="number"
                        step="0.001"
                        value={editFormData.totalPrice || 0}
                        onChange={(e) => setEditFormData({ ...editFormData, totalPrice: parseFloat(e.target.value) || 0 })}
                        className="font-mono font-bold text-red-700 bg-red-50/20"
                      />
                    </FormField>

                    <FormField
                      label="Nombre de pièces *"
                      helpText="Attention : Alerte immédiatement le chauffeur en tournée si modifié"
                    >
                      <Input
                        type="number"
                        value={editFormData.pieceCount || 1}
                        onChange={(e) => setEditFormData({ ...editFormData, pieceCount: parseInt(e.target.value, 10) || 1 })}
                        className="font-mono font-bold"
                      />
                    </FormField>

                    <div className="sm:col-span-2">
                      <FormField label="Instructions / Notes">
                        <Input
                          value={editFormData.notes || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                        />
                      </FormField>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 border rounded text-slate-700 hover:bg-slate-100"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingEdit}
                      className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold flex items-center gap-1.5"
                    >
                      {isSubmittingEdit ? <Spinner size="sm" className="text-white" /> : <Check className="w-4 h-4" />}
                      <span>Enregistrer & Notifier</span>
                    </button>
                  </div>
                </form>
              </Card>
            )}

            {/* Grille : Détails Destinataire, Livreur, et Spécifications */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Carte Destinataire */}
              <Card title="Destinataire & Adresse">
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Nom :</span>
                    <span className="font-bold text-slate-900 text-sm">{detailedPackage.customerName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Téléphone :</span>
                    <span className="font-mono font-bold text-slate-800 text-xs flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-slate-500" />
                      {detailedPackage.customerPhone}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Localité :</span>
                    <span className="font-semibold text-slate-800">{detailedPackage.governorate}, {detailedPackage.delegation}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Adresse exacte :</span>
                    <p className="p-2 bg-slate-50 rounded border border-slate-200 text-slate-700">
                      {detailedPackage.address}
                    </p>
                  </div>
                  {detailedPackage.notes && (
                    <div>
                      <span className="text-slate-400 block text-[11px]">Notes expéditeur :</span>
                      <p className="p-2 bg-amber-50 rounded border border-amber-200 text-amber-900 font-medium">
                        {detailedPackage.notes}
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Carte Chauffeur & Tournée */}
              <Card title="Chauffeur & Agence">
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Livreur Assigné :</span>
                    <span className="font-bold text-slate-900 text-sm">
                      {detailedPackage.assignedDriverName || <span className="text-slate-400 italic">Non encore affecté</span>}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Agence responsable :</span>
                    <span className="font-semibold text-slate-800">{detailedPackage.currentDepositName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Autorisation ouverture :</span>
                    <Badge variant={detailedPackage.allowOpen ? 'success' : 'default'}>
                      {detailedPackage.allowOpen ? 'Ouverture Autorisée' : 'Interdite'}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Nombre de pièces :</span>
                    <span className="font-mono font-bold text-slate-900">{detailedPackage.pieceCount} pièce(s)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Taille colis :</span>
                    <span className="font-medium text-slate-700">{detailedPackage.sizeCategory}</span>
                  </div>
                </div>
              </Card>

              {/* Carte Historique des Passages (Delivery Attempts) */}
              <Card title="Tentatives de Livraison" subtitle="Passages du chauffeur chez le client">
                {(!detailedPackage.deliveryAttempts || detailedPackage.deliveryAttempts.length === 0) ? (
                  <p className="text-xs text-slate-400 italic">Aucune tentative enregistrée pour l'instant.</p>
                ) : (
                  <div className="space-y-3">
                    {detailedPackage.deliveryAttempts.map((att, idx) => (
                      <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-900">Passage N° {att.attemptNumber}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(att.timestamp).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-600">Par {att.driverName}</p>
                        {att.reason && (
                          <p className="font-semibold text-amber-800 bg-amber-50 p-1 rounded border border-amber-200">
                            Motif : {att.reason}
                          </p>
                        )}
                        {att.notes && <p className="text-slate-500 italic">{att.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* TIMELINE DE SUIVI (TRACKING TIMELINE) */}
            <Card title="Chronologie de Traçabilité du Colis (Tracking Timeline)">
              <div className="relative pl-6 space-y-4 border-l-2 border-slate-200 ml-3">
                {detailedPackage.trackingTimeline?.map((item, idx) => (
                  <div key={idx} className="relative">
                    <span className="absolute -left-[31px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white bg-red-600 shadow-xs" />
                    <div className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{item.label}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(item.timestamp).toLocaleString('fr-TN')}
                        </span>
                      </div>
                      <p className="text-slate-600 mt-0.5">
                        Lieu : <strong className="text-slate-800">{item.location}</strong> {item.actor && `• Par ${item.actor}`}
                      </p>
                      {item.notes && <p className="text-amber-800 italic mt-0.5">{item.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* JOURNAL D'AUDIT DES MODIFICATIONS */}
            {detailedPackage.auditLogs && detailedPackage.auditLogs.length > 0 && (
              <Card title="Journal d'Audit des Modifications (Traçabilité Immédiate)">
                <div className="space-y-3">
                  {detailedPackage.auditLogs.map((log) => (
                    <div key={log.id} className="p-3 bg-amber-50/40 border border-amber-200 rounded text-xs space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <History className="w-3.5 h-3.5 text-amber-700" />
                          Modifié par {log.modifiedBy} ({log.userRole})
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleString('fr-TN')}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {log.changes.map((c, i) => (
                          <div key={i} className="text-slate-700 font-mono text-[11px]">
                            • {c.fieldLabel} : <del className="text-red-600">{String(c.oldValue)}</del> ➔{' '}
                            <strong className="text-emerald-700">{String(c.newValue)}</strong>
                          </div>
                        ))}
                      </div>
                      {log.driverNotified && (
                        <p className="text-emerald-800 font-semibold text-[11px] flex items-center gap-1 mt-1">
                          <Check className="w-3.5 h-3.5" />
                          {log.notificationMessage}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 5 : GESTION DES RAMASSAGES (PICKUPS)                */}
        {/* ======================================================== */}
        {activeSubTab === 'ramassages' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Demandes de Ramassage (Collecte Fournisseur)</h3>
                <p className="text-xs text-slate-500">Planifiez le passage des véhicules de ramassage à votre dépôt.</p>
              </div>
              <button
                onClick={() => setShowPickupModal(true)}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Programmer un Ramassage</span>
              </button>
            </div>

            <Card className="p-0">
              <Table>
                <Thead>
                  <tr>
                    <Th>Référence RDV</Th>
                    <Th>Date & Créneau</Th>
                    <Th>Adresse de collecte</Th>
                    <Th align="center">Colis prévus</Th>
                    <Th>Chauffeur Collecteur</Th>
                    <Th align="center">Statut</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {pickups.map((pick) => (
                    <Tr key={pick.id}>
                      <Td className="font-mono font-bold text-slate-900">{pick.referenceNumber}</Td>
                      <Td className="font-mono font-semibold">{pick.timeSlotStartHour}h - {pick.timeSlotEndHour}h</Td>
                      <Td>{pick.pickupAddress}</Td>
                      <Td align="center" className="font-bold font-mono">15 colis</Td>
                      <Td>{pick.assignedDriverName || 'En cours d\'affectation'}</Td>
                      <Td align="center">
                        <Badge variant="warning">{pick.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 6 : PAIEMENTS & BORDEREAUX CRBT                     */}
        {/* ======================================================== */}
        {activeSubTab === 'paiements' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Règlements & Bordereaux de Paiement (CRBT)</h3>
              <p className="text-xs text-slate-500">Consultez vos bordereaux clôturés, montants recouvrés et codes secrets de retrait.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard
                title="Total Décaissé"
                value="1 714.000 DT"
                description="Réglé en espèces"
                icon={<CreditCard className="w-5 h-5 text-emerald-600" />}
              />
              <MetricCard
                title="En cours de traitement"
                value="2 017.100 DT"
                description="Bordereau #137832"
                icon={<Clock className="w-5 h-5 text-amber-600" />}
              />
              <MetricCard
                title="Frais de transport déduits"
                value="12.000 DT"
                description="Frais de livraison et retours"
                icon={<Coins className="w-5 h-5 text-slate-600" />}
              />
            </div>

            <Card className="p-0">
              <Table>
                <Thead>
                  <tr>
                    <Th>N° Bordereau</Th>
                    <Th>Date</Th>
                    <Th align="center">Colis Livrés / Retours</Th>
                    <Th align="right">Brut Encaissé</Th>
                    <Th align="right">Frais Déduits</Th>
                    <Th align="right">Net à Percevoir</Th>
                    <Th align="center">Code Retrait</Th>
                    <Th align="center">État</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {payments.map((v) => (
                    <Tr key={v.id}>
                      <Td className="font-mono font-bold text-amber-700">{v.voucherNumber}</Td>
                      <Td>{v.issueDate}</Td>
                      <Td align="center">
                        <span className="text-emerald-700 font-bold">{v.deliveredCount} L</span> /{' '}
                        <span className="text-red-600 font-bold">{v.returnedCount} R</span>
                      </Td>
                      <Td align="right" className="font-mono">{formatTND(v.grossCashCollected)}</Td>
                      <Td align="right" className="font-mono text-slate-500">-{formatTND(v.deliveryFeesTotal + v.returnFeesTotal)}</Td>
                      <Td align="right" className="font-mono font-bold text-slate-900">{formatTND(v.netPayable)}</Td>
                      <Td align="center">
                        <span className="px-2 py-0.5 bg-slate-900 text-white rounded font-mono font-bold text-[11px]">
                          {v.status === 'PAYE' ? '*** UTILISÉ ***' : '884920'}
                        </span>
                      </Td>
                      <Td align="center">
                        <Badge variant={v.status === 'PAYE' ? 'success' : 'primary'}>{v.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 7 : HISTORIQUE & AUDIT GLOBAL                       */}
        {/* ======================================================== */}
        {activeSubTab === 'historique' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Journal d'Audit & Historique des Événements</h3>
              <p className="text-xs text-slate-500">Registre immuable de toutes les actions, créations et modifications sur vos colis.</p>
            </div>

            <Card>
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-slate-50 rounded border border-slate-200 flex items-start gap-3">
                  <History className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-900">Modification du prix sur colis #26092402490551</span>
                    <p className="text-slate-600 mt-0.5">Montant passé de 65.000 DT à 58.000 DT par Karim (BLUE STAR). Chauffeur Hamza notifié.</p>
                    <span className="text-[10px] text-slate-400 font-mono mt-1 block">28 Septembre 2026 à 09:12</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded border border-slate-200 flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-900">Paiement Bordereau #137831 décaissé</span>
                    <p className="text-slate-600 mt-0.5">1 714.000 DT versés en espèces au représentant BLUE STAR avec validation par code secret.</p>
                    <span className="text-[10px] text-slate-400 font-mono mt-1 block">28 Septembre 2026 à 15:45</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded border border-slate-200 flex items-start gap-3">
                  <Plus className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-900">Création du colis #26092901004521</span>
                    <p className="text-slate-600 mt-0.5">Destinataire Sami Bouazizi (Hammam Lif) pour 94.000 DT.</p>
                    <span className="text-[10px] text-slate-400 font-mono mt-1 block">29 Septembre 2026 à 08:00</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAGE 8 : PROFIL FOURNISSEUR                             */}
        {/* ======================================================== */}
        {activeSubTab === 'profil' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <Card title="Fiche Fournisseur & Paramètres Contractuels">
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-400 block mb-1">Raison Sociale</label>
                    <span className="font-bold text-slate-900 text-sm block">BLUE STAR TUNISIE</span>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Identifiant Expéditeur</label>
                    <span className="font-mono font-bold text-red-600 block">SHP-001</span>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Matricule Fiscal</label>
                    <span className="font-mono font-semibold text-slate-800 block">1489201/A/M/000</span>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Téléphone de contact</label>
                    <span className="font-mono font-semibold text-slate-800 block">+216 58 199 108</span>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 block mb-1">Adresse de l'entrepôt principal (Ramassage)</label>
                    <span className="font-medium text-slate-800 block">Zone Industrielle Ben Arous, Rue des Entrepreneurs</span>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 block mb-1">Coordonnées Bancaires (Virements CRBT)</label>
                    <span className="font-mono text-xs bg-slate-100 p-2 rounded block">RIB : 08 012 0001234567890 44 (BIAT Agence Ben Arous)</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
                  <span className="font-bold text-slate-900">Tarification Négociée :</span>
                  <p className="text-slate-600">• Frais de livraison Grand Tunis & Régions : <strong>7.000 DT</strong> / colis</p>
                  <p className="text-slate-600">• Retour colis refusé : <strong>2.000 DT</strong></p>
                  <p className="text-slate-600">• Délais de remboursement CRBT : <strong>J+1 après livraison</strong></p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* MODAL : PROGRAMMER UN RAMASSAGE */}
      {showPickupModal && (
        <Modal
          isOpen={showPickupModal}
          onClose={() => setShowPickupModal(false)}
          title="Demande de Ramassage de Colis"
          subtitle="Un véhicule de collecte viendra récupérer vos colis étiquetés."
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowPickupModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs font-medium"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPickupModal(false);
                  addToast({
                    type: 'success',
                    title: 'Demande enregistrée',
                    message: `Ramassage prévu pour le ${pickupForm.date} (${pickupForm.slot}).`,
                  });
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold cursor-pointer"
              >
                Confirmer la demande
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Date de collecte souhaitée" required>
              <Input
                type="date"
                value={pickupForm.date}
                onChange={(e) => setPickupForm({ ...pickupForm, date: e.target.value })}
              />
            </FormField>

            <FormField label="Créneau horaire" required>
              <Select
                value={pickupForm.slot}
                onChange={(e) => setPickupForm({ ...pickupForm, slot: e.target.value })}
              >
                <option value="10h - 13h">Matinée (10h - 13h)</option>
                <option value="14h - 17h">Après-midi (14h - 17h)</option>
                <option value="17h - 19h">Fin de journée (17h - 19h)</option>
              </Select>
            </FormField>

            <FormField label="Estimation du nombre de colis à enlever" required>
              <Input
                type="number"
                min="1"
                value={pickupForm.estimatedPackages}
                onChange={(e) => setPickupForm({ ...pickupForm, estimatedPackages: parseInt(e.target.value, 10) || 1 })}
              />
            </FormField>

            <FormField label="Adresse de collecte">
              <Input
                value={pickupForm.pickupAddress}
                onChange={(e) => setPickupForm({ ...pickupForm, pickupAddress: e.target.value })}
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* MODAL : CONFIRMATION ANNULATION COLIS */}
      {showCancelModal && (
        <Modal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Annuler l'expédition du colis"
          subtitle={`Colis #${detailedPackage?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs font-medium"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={isCancelling}
                onClick={handleCancelColis}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isCancelling && <Spinner size="sm" className="text-white" />}
                <span>Confirmer l'annulation</span>
              </button>
            </>
          }
        >
          <div className="space-y-3 text-xs">
            <p className="text-slate-600">
              L'annulation est irréversible. Le colis passera au statut <strong className="text-red-700 font-mono">ANNULE</strong> et sera retiré des feuilles de tournée de livraison.
            </p>
            <FormField label="Motif de l'annulation *" required>
              <Input
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ex: Client a annulé la commande, Erreur de saisie..."
              />
            </FormField>
          </div>
        </Modal>
      )}
    </div>
  );
}
