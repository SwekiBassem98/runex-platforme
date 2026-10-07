import React, { useState, useEffect } from 'react';
import {
  Package,
  Search,
  Filter,
  Plus,
  RotateCcw,
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  History,
  Phone,
  MapPin,
  Building,
  User,
  CreditCard,
  Calendar,
  Layers,
  ArrowRight,
  Clock,
  Edit3,
  Repeat,
  Share2,
  FileText,
  Barcode,
  ShieldAlert,
  ChevronRight,
  ChevronLeft,
  Check,
  Send,
  Boxes,
  HelpCircle,
  ArrowLeft,
  DollarSign,
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

interface ColisManagementModuleProps {
  currentUser: AuthUser;
  token: string;
}

export function ColisManagementModule({ currentUser, token }: ColisManagementModuleProps) {
  const { addToast } = useToast();

  // Navigation dans le module Colis
  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'nouveau'>('list');
  const [selectedColisId, setSelectedColisId] = useState<string | null>(null);
  const [colis, setColis] = useState<PackageDto | null>(null);

  // Liste et filtres serveur
  const [packages, setPackages] = useState<PackageDto[]>([]);
  const [totalPackages, setTotalPackages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [cityFilter, setCityFilter] = useState('ALL');
  const [driverFilter, setDriverFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modales d'actions opérationnelles
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showDeliverModal, setShowDeliverModal] = useState(false);
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Formulaire d'action
  const [actionPayload, setActionPayload] = useState<any>({});
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Formulaire Nouveau Colis
  const [newColisForm, setNewColisForm] = useState({
    customerName: '',
    customerPhone: '',
    governorate: 'Ben Arous',
    delegation: 'Ben Arous',
    address: '',
    totalPrice: 65.000,
    pieceCount: 1,
    sizeCategory: PackageSize.LEGERE,
    packageType: PackageType.NORMAL,
    contentSummary: '',
    allowOpen: true,
    notes: '',
  });

  // Liste des livreurs de la flotte
  const availableDrivers = [
    { id: 'drv-001', name: 'Hamza Ben Dhif', phone: '20112233' },
    { id: 'drv-002', name: 'Ghassan Mghirbi', phone: '21334455' },
    { id: 'drv-003', name: 'Mohamed Ali LOUATI', phone: '22556677' },
    { id: 'drv-004', name: 'Ahmed Hamidou', phone: '23778899' },
  ];

  // Chargement des colis
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
        title: 'Erreur',
        message: 'Impossible de synchroniser les colis.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Chargement de la fiche d'un colis précis
  const loadColisDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/packages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setColis(data.data);
        setActionPayload(data.data);
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Erreur',
        message: 'Impossible de charger la fiche du colis.',
      });
    }
  };

  useEffect(() => {
    loadPackages();
  }, [currentPage, pageSize, statusFilter, cityFilter, driverFilter, typeFilter, paymentStatusFilter, dateFilter]);

  useEffect(() => {
    if (selectedColisId) {
      loadColisDetails(selectedColisId);
    }
  }, [selectedColisId]);

  // Action Générique sur le colis
  const executeColisAction = async (endpoint: string, body: any, successMsg: string) => {
    if (!colis) return;
    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/v1/packages/${colis.id}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        addToast({
          type: 'success',
          title: 'Action Opérationnelle Validée',
          message: successMsg,
        });
        setColis(data.data);
        loadPackages();
        // Fermeture des modales
        setShowAssignModal(false);
        setShowDeliverModal(false);
        setShowPartialModal(false);
        setShowExchangeModal(false);
        setShowPostponeModal(false);
        setShowReturnModal(false);
        setShowCancelModal(false);
      } else {
        addToast({ type: 'error', title: 'Erreur Action', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de transmission au serveur.' });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Création d'un colis
  const handleCreateColis = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingAction(true);
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
          message: `N° ${data.data.trackingNumber} prêt pour l'expédition.`,
        });
        loadPackages();
        setSelectedColisId(data.data.id);
        setViewMode('detail');
      } else {
        addToast({ type: 'error', title: 'Erreur', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec création colis.' });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Mise à jour des informations
  const handleUpdateColis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colis) return;
    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/v1/packages/${colis.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(actionPayload),
      });
      const data = await res.json();
      if (data.success) {
        setColis(data.data);
        setShowEditModal(false);
        loadPackages();
        addToast({
          type: data.driverNotified ? 'warning' : 'success',
          title: data.driverNotified ? 'Chauffeur Notifié en Direct' : 'Colis Mis à Jour',
          message: data.message,
          duration: 6000,
        });
      } else {
        addToast({ type: 'error', title: 'Erreur modification', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de mise à jour.' });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ======================================================== */}
      {/* VUE 1 : LISTE DES COLIS (GESTION COMPLÈTE)              */}
      {/* ======================================================== */}
      {viewMode === 'list' && (
        <div className="space-y-6">
          <PageHeader
            title="Gestion Intégrale des Colis"
            description="Recherche haute vitesse, assignation des chauffeurs, gestion des reports, retours et suivi des encaissements."
            breadcrumbs={[{ label: 'Opérations' }, { label: 'Colis', active: true }]}
            badge={
              <Badge variant="secondary">
                <span className="font-mono">{totalPackages} colis</span>
              </Badge>
            }
            actions={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewMode('nouveau')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nouveau Colis</span>
                </button>
                <button
                  onClick={loadPackages}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Actualiser</span>
                </button>
              </div>
            }
          />

          <div className="px-6 space-y-4">
            {/* Barre de Filtres Complète */}
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
                  placeholder="N° colis, destinataire, tél..."
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
                  { label: 'Affecté Runsheet', value: 'AFFECTE_RUNSHEET' },
                  { label: 'En cours livraison', value: 'EN_COURS_LIVRAISON' },
                  { label: 'Livré', value: 'LIVRE' },
                  { label: 'Livraison Partielle', value: 'LIVRAISON_PARTIELLE' },
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
                label="Livreur"
                selectedValue={driverFilter}
                onChange={(val) => {
                  setDriverFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Tous les chauffeurs', value: 'ALL' },
                  { label: 'Hamza Ben Dhif', value: 'Hamza Ben Dhif' },
                  { label: 'Ghassan Mghirbi', value: 'Ghassan Mghirbi' },
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
                  { label: 'Tous', value: 'ALL' },
                  { label: 'Normal', value: 'NORMAL' },
                  { label: 'Échange', value: 'EXCHANGE' },
                  { label: 'Reporté', value: 'REPORTED' },
                  { label: 'Retour', value: 'RETURN' },
                ]}
              />

              <FilterSelect
                label="Paiement"
                selectedValue={paymentStatusFilter}
                onChange={(val) => {
                  setPaymentStatusFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Tous', value: 'ALL' },
                  { label: 'Non réglé', value: 'NON_REGLE' },
                  { label: 'En bordereau', value: 'EN_BORDEREAU' },
                  { label: 'Payé', value: 'PAYE' },
                ]}
              />
            </FilterBar>

            {/* Table des Colis */}
            {isLoading ? (
              <SkeletonTable rows={5} cols={7} />
            ) : packages.length === 0 ? (
              <EmptyState
                title="Aucun colis trouvé"
                description="Aucun colis ne correspond à vos filtres ou au périmètre de recherche."
              />
            ) : (
              <Card className="p-0">
                <Table>
                  <Thead>
                    <tr>
                      <Th>Colis / Code</Th>
                      <Th>Destinataire</Th>
                      <Th>Destination</Th>
                      <Th>Expéditeur</Th>
                      <Th>Livreur Assigné</Th>
                      <Th align="right">Montant (TND)</Th>
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
                            setSelectedColisId(pkg.id);
                            setViewMode('detail');
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
                            <span className="font-medium text-slate-800">{pkg.shipperName}</span>
                          </Td>
                          <Td>
                            <span className="text-slate-700 font-medium">
                              {pkg.assignedDriverName || <span className="text-slate-400 italic">Non assigné</span>}
                            </span>
                          </Td>
                          <Td align="right">
                            <span className="font-mono font-bold text-slate-900">{formatTND(pkg.totalPrice)}</span>
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
                                setSelectedColisId(pkg.id);
                                setViewMode('detail');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 transition cursor-pointer"
                            >
                              Fiche
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
        </div>
      )}

      {/* ======================================================== */}
      {/* VUE 2 : NOUVEAU COLIS                                   */}
      {/* ======================================================== */}
      {viewMode === 'nouveau' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <PageHeader
            title="Créer une Expédition de Colis"
            description="Enregistrement d'un nouvel envoi avec calcul des frais de transport et génération de code-barres."
            breadcrumbs={[
              { label: 'Colis', onClick: () => setViewMode('list') },
              { label: 'Nouveau', active: true },
            ]}
          />

          <div className="px-6">
            <Card>
              <form onSubmit={handleCreateColis} className="space-y-6 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Nom complet du client *" required>
                    <Input
                      required
                      value={newColisForm.customerName}
                      onChange={(e) => setNewColisForm({ ...newColisForm, customerName: e.target.value })}
                      placeholder="Nom et prénom"
                    />
                  </FormField>

                  <FormField label="Téléphone principal *" required>
                    <Input
                      required
                      value={newColisForm.customerPhone}
                      onChange={(e) => setNewColisForm({ ...newColisForm, customerPhone: e.target.value })}
                      placeholder="Ex: 27660505"
                      className="font-mono font-bold"
                    />
                  </FormField>

                  <FormField label="Gouvernorat (Ville) *" required>
                    <Select
                      value={newColisForm.governorate}
                      onChange={(e) => setNewColisForm({ ...newColisForm, governorate: e.target.value })}
                    >
                      <option value="Ben Arous">Ben Arous</option>
                      <option value="Zaghouan">Zaghouan</option>
                      <option value="Tunis">Tunis</option>
                      <option value="Ariana">Ariana</option>
                      <option value="Sousse">Sousse</option>
                      <option value="Sfax">Sfax</option>
                      <option value="Nabeul">Nabeul</option>
                    </Select>
                  </FormField>

                  <FormField label="Délégation / Cité *" required>
                    <Input
                      required
                      value={newColisForm.delegation}
                      onChange={(e) => setNewColisForm({ ...newColisForm, delegation: e.target.value })}
                      placeholder="Ex: Hammam Lif, Ennadhour..."
                    />
                  </FormField>

                  <div className="sm:col-span-2">
                    <FormField label="Adresse détaillée & Repères *" required>
                      <Input
                        required
                        value={newColisForm.address}
                        onChange={(e) => setNewColisForm({ ...newColisForm, address: e.target.value })}
                        placeholder="N° rue, nom bâtiment, repère visuel..."
                      />
                    </FormField>
                  </div>

                  <FormField label="Montant à encaisser (TND) *" required>
                    <Input
                      type="number"
                      step="0.001"
                      required
                      value={newColisForm.totalPrice}
                      onChange={(e) => setNewColisForm({ ...newColisForm, totalPrice: parseFloat(e.target.value) || 0 })}
                      className="font-mono font-bold text-red-600"
                    />
                  </FormField>

                  <FormField label="Nombre de pièces *" required>
                    <Input
                      type="number"
                      min="1"
                      required
                      value={newColisForm.pieceCount}
                      onChange={(e) => setNewColisForm({ ...newColisForm, pieceCount: parseInt(e.target.value, 10) || 1 })}
                      className="font-mono"
                    />
                  </FormField>

                  <FormField label="Type de colis *" required>
                    <Select
                      value={newColisForm.packageType}
                      onChange={(e) => setNewColisForm({ ...newColisForm, packageType: e.target.value as PackageType })}
                    >
                      <option value={PackageType.NORMAL}>Normal (Livraison classique)</option>
                      <option value={PackageType.EXCHANGE}>Échange (Reprise article)</option>
                      <option value={PackageType.REPORTED}>Reporté (Seconde tentative)</option>
                      <option value={PackageType.RETURN}>Retour direct</option>
                    </Select>
                  </FormField>

                  <FormField label="Taille / Poids" required>
                    <Select
                      value={newColisForm.sizeCategory}
                      onChange={(e) => setNewColisForm({ ...newColisForm, sizeCategory: e.target.value as PackageSize })}
                    >
                      <option value={PackageSize.LEGERE}>Légère (&lt; 2 kg)</option>
                      <option value={PackageSize.MOYENNE}>Moyenne (2 à 5 kg)</option>
                      <option value={PackageSize.LOURDE}>Lourde (5 à 15 kg)</option>
                      <option value={PackageSize.VOLUMINEUSE}>Volumineuse (&gt; 15 kg)</option>
                    </Select>
                  </FormField>

                  <div className="sm:col-span-2">
                    <FormField label="Description du contenu *" required>
                      <Input
                        required
                        value={newColisForm.contentSummary}
                        onChange={(e) => setNewColisForm({ ...newColisForm, contentSummary: e.target.value })}
                        placeholder="Ex: 2 Chemises Coton, 1 Paire Chaussures 42..."
                      />
                    </FormField>
                  </div>

                  <div className="sm:col-span-2">
                    <FormField label="Instructions spéciales pour le chauffeur">
                      <Input
                        value={newColisForm.notes}
                        onChange={(e) => setNewColisForm({ ...newColisForm, notes: e.target.value })}
                        placeholder="Ex: Appeler avant 14h, ouverture colis permise..."
                      />
                    </FormField>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className="px-4 py-2 border rounded text-slate-700 hover:bg-slate-100"
                  >
                    Retour à la liste
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingAction}
                    className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold flex items-center gap-2"
                  >
                    {isSubmittingAction ? <Spinner size="sm" className="text-white" /> : <Plus className="w-4 h-4" />}
                    <span>Créer le Colis</span>
                  </button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* VUE 3 : FICHE DÉTAILLÉE COLIS (THE CORE MASTER SCREEN)  */}
      {/* ======================================================== */}
      {viewMode === 'detail' && colis && (
        <div className="space-y-6 max-w-6xl mx-auto px-6 pb-12">
          {/* Bouton Retour */}
          <button
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour à la liste des colis</span>
          </button>

          {/* 1. HEADER DU COLIS AVEC QUICK ACTIONS */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-red-600 flex items-center justify-center font-bold text-white shadow-xs">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-2xl font-bold font-mono text-slate-900 tracking-tight">
                      #{colis.trackingNumber}
                    </h1>
                    <Badge variant={colis.packageType === 'EXCHANGE' ? 'warning' : 'default'}>
                      {colis.packageType}
                    </Badge>
                    <StatusIndicator
                      status={
                        colis.status === PackageStatus.LIVRE
                          ? 'delivered'
                          : colis.status === PackageStatus.EN_COURS_LIVRAISON
                          ? 'transit'
                          : colis.status === PackageStatus.REPORTE
                          ? 'busy'
                          : 'online'
                      }
                      pulse={colis.status === PackageStatus.EN_COURS_LIVRAISON}
                      label={colis.status}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    Code-barres : {colis.barcode} • Créé le {new Date(colis.createdAt).toLocaleString('fr-TN')}
                  </p>
                </div>
              </div>

              {/* Montant CRBT en grand */}
              <div className="text-right">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-semibold">
                  Montant à Recouvrer (CRBT)
                </span>
                <span className="text-2xl font-bold font-mono text-red-600">
                  {formatTND(colis.totalPrice)}
                </span>
              </div>
            </div>

            {/* QUICK ACTIONS BAR OPÉRATIONNELLE */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2">
                Actions Rapides :
              </span>

              {/* 1. Assigner */}
              <button
                onClick={() => {
                  setActionPayload({ driverId: 'drv-001', driverName: 'Hamza Ben Dhif' });
                  setShowAssignModal(true);
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Assigner Livreur</span>
              </button>

              {/* 2. Marquer Livré */}
              {colis.status !== PackageStatus.LIVRE && (
                <button
                  onClick={() => {
                    setActionPayload({ collectedAmount: colis.totalPrice, driverNote: 'Remis en mains propres' });
                    setShowDeliverModal(true);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Livrer (Encaisser)</span>
                </button>
              )}

              {/* 3. Livraison Partielle */}
              {colis.pieceCount > 1 && colis.status !== PackageStatus.LIVRE && (
                <button
                  onClick={() => {
                    setActionPayload({
                      deliveredPieces: 1,
                      collectedAmount: Math.round(colis.totalPrice / colis.pieceCount),
                      reason: 'Client garde 1 pièce sur 2',
                    });
                    setShowPartialModal(true);
                  }}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Boxes className="w-3.5 h-3.5" />
                  <span>Livraison Partielle</span>
                </button>
              )}

              {/* 4. Échange */}
              <button
                onClick={() => {
                  setActionPayload({
                    returnedItemBarcode: `RET-${Date.now().toString().slice(-6)}`,
                    returnedItemDescription: 'Article retourné par le client',
                    collectedAmount: colis.totalPrice,
                  });
                  setShowExchangeModal(true);
                }}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Échange</span>
              </button>

              {/* 5. Reporter */}
              {colis.status !== PackageStatus.LIVRE && (
                <button
                  onClick={() => {
                    setActionPayload({
                      reason: 'Client absent au domicile',
                      rescheduledDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
                    });
                    setShowPostponeModal(true);
                  }}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Reporter</span>
                </button>
              )}

              {/* 6. Retour Dépôt */}
              {colis.status !== PackageStatus.LIVRE && (
                <button
                  onClick={() => {
                    setActionPayload({ reason: 'Refus de commande par le destinataire' });
                    setShowReturnModal(true);
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retour Dépôt</span>
                </button>
              )}

              {/* 7. Modifier */}
              <button
                onClick={() => {
                  setActionPayload(colis);
                  setShowEditModal(true);
                }}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Modifier</span>
              </button>

              {/* 8. Annuler */}
              {!colis.isCancelled && colis.status !== PackageStatus.LIVRE && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Annuler</span>
                </button>
              )}
            </div>
          </div>

          {/* 2. GRILLE D'INFORMATIONS : CUSTOMER, EXPÉDITEUR, DELIVERY, FINANCIAL, CONTENT, NOTES */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* A. CUSTOMER */}
            <Card title="Destinataire (Customer)">
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Nom complet :</span>
                  <span className="font-bold text-slate-900 text-sm">{colis.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Numéro de téléphone :</span>
                  <span className="font-mono font-bold text-slate-800 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-red-600" />
                    {colis.customerPhone}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Gouvernorat & Délégation :</span>
                  <span className="font-semibold text-slate-800">{colis.governorate}, {colis.delegation}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Adresse exacte de livraison :</span>
                  <p className="p-2.5 bg-slate-50 rounded border border-slate-200 text-slate-700 leading-relaxed font-medium">
                    {colis.address}
                  </p>
                </div>
              </div>
            </Card>

            {/* B. EXPÉDITEUR */}
            <Card title="Expéditeur (Supplier)">
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Compte Expéditeur :</span>
                  <span className="font-bold text-slate-900 text-sm">{colis.shipperName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Contact & Téléphone :</span>
                  <span className="font-mono font-semibold text-slate-800 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    +216 58 199 108
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Agence de Dépôt Actuelle :</span>
                  <span className="font-semibold text-slate-800">{colis.currentDepositName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Statut Règlement Facturation :</span>
                  <Badge variant={colis.paymentStatus === 'PAYE' ? 'success' : 'outline'}>
                    {colis.paymentStatus || 'NON_REGLE'}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* C. FINANCIAL */}
            <Card title="Données Financières (Financial)">
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">Montant à Encaisser (CRBT) :</span>
                  <span className="font-mono font-bold text-slate-900 text-sm">{formatTND(colis.totalPrice)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">Montant Encaissé par Livreur :</span>
                  <span className="font-mono font-bold text-emerald-700 text-sm">{formatTND(colis.collectedAmount)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">Frais de Livraison :</span>
                  <span className="font-mono text-slate-700">{formatTND(colis.deliveryFee)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500">Net Fournisseur Prévu :</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatTND(Math.max(0, colis.totalPrice - colis.deliveryFee))}
                  </span>
                </div>
              </div>
            </Card>

            {/* D. DELIVERY & LIVREUR */}
            <Card title="Distribution & Tournée (Delivery)">
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Livreur Assigné :</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {colis.assignedDriverName || <span className="text-slate-400 italic">Non assigné</span>}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Feuille de Tournée (Runsheet) :</span>
                  <span className="font-mono font-bold text-red-600">
                    {colis.runsheetNumber || 'Aucune runsheet'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Date prévue de livraison :</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {colis.expectedDeliveryDate || 'Aujourd\'hui'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Nombre de tentatives :</span>
                  <span className="font-mono font-bold">{colis.deliveryAttempts?.length || 0} passage(s)</span>
                </div>
              </div>
            </Card>

            {/* E. CONTENT */}
            <Card title="Contenu & Colisage (Content)">
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Description du contenu :</span>
                  <p className="p-2 bg-slate-50 rounded border border-slate-200 text-slate-800 font-medium">
                    {colis.contentSummary}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Nombre de pièces :</span>
                    <span className="font-mono font-bold text-slate-900">{colis.pieceCount} pièce(s)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Gabarit :</span>
                    <span className="font-medium text-slate-800">{colis.sizeCategory}</span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Ouverture colis :</span>
                  <Badge variant={colis.allowOpen ? 'success' : 'default'}>
                    {colis.allowOpen ? 'Ouverture Autorisée' : 'Ouverture Interdite'}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* F. NOTES */}
            <Card title="Instructions & Notes de Tournée">
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                    Instructions Expéditeur :
                  </span>
                  <p className="p-2 bg-amber-50/60 border border-amber-200 rounded text-amber-900 mt-1 font-medium">
                    {colis.notes || 'Aucune consigne particulière.'}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                    Note Compte-rendu Livreur :
                  </span>
                  <p className="p-2 bg-slate-50 border border-slate-200 rounded text-slate-700 mt-1 italic">
                    {colis.driverNote || 'Aucune note terrain enregistrée.'}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* 3. TRACKING : TIMELINE VERTICALE DES ÉTAPES OPÉRATIONNELLES */}
          <Card
            title="Chronologie de Traçabilité Opérationnelle (Tracking Timeline)"
            subtitle="Historique infalsifiable de la création à la livraison finale"
          >
            <div className="relative pl-6 space-y-6 border-l-2 border-slate-200 ml-4 py-2">
              {colis.trackingTimeline?.map((item, idx) => {
                const isFinal = idx === 0;
                return (
                  <div key={idx} className="relative">
                    <span
                      className={`absolute -left-[31px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-xs ${
                        isFinal ? 'bg-red-600 ring-2 ring-red-200' : 'bg-slate-400'
                      }`}
                    />
                    <div className="text-xs space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-bold ${isFinal ? 'text-red-600 text-sm' : 'text-slate-900'}`}>
                          {item.label}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {new Date(item.timestamp).toLocaleString('fr-TN')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-600">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <strong>{item.location}</strong>
                        </span>
                        {item.actor && (
                          <span className="flex items-center gap-1 text-slate-500">
                            <User className="w-3 h-3 text-slate-400" />
                            Par {item.actor}
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="text-slate-700 italic bg-slate-50 p-2 rounded border border-slate-200 max-w-xl">
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 4. AUDIT & MODIFICATIONS */}
          {colis.auditLogs && colis.auditLogs.length > 0 && (
            <Card title="Registre d'Audit & Historique des Modifications">
              <div className="space-y-3">
                {colis.auditLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-amber-50/50 border border-amber-200 rounded text-xs space-y-1.5">
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
      {/* MODALES D'ACTIONS OPÉRATIONNELLES                        */}
      {/* ======================================================== */}

      {/* 1. MODAL ASSIGNATION LIVREUR */}
      {showAssignModal && (
        <Modal
          isOpen={showAssignModal}
          onClose={() => setShowAssignModal(false)}
          title="Assigner le Colis à un Livreur"
          subtitle={`Colis #${colis?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'assign',
                    actionPayload,
                    `Colis assigné à ${actionPayload.driverName} avec succès`
                  )
                }
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Confirmer l'assignation</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Choisir le Chauffeur / Livreur" required>
              <Select
                value={actionPayload.driverId}
                onChange={(e) => {
                  const drv = availableDrivers.find((d) => d.id === e.target.value);
                  setActionPayload({
                    ...actionPayload,
                    driverId: e.target.value,
                    driverName: drv?.name || 'Hamza Ben Dhif',
                  });
                }}
              >
                {availableDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.phone})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Numéro de Runsheet">
              <Input
                value={actionPayload.runsheetNumber || `RUN-${Date.now().toString().slice(-8)}`}
                onChange={(e) => setActionPayload({ ...actionPayload, runsheetNumber: e.target.value })}
                className="font-mono font-bold"
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* 2. MODAL LIVRAISON COMPLÈTE */}
      {showDeliverModal && (
        <Modal
          isOpen={showDeliverModal}
          onClose={() => setShowDeliverModal(false)}
          title="Valider la Livraison du Colis"
          subtitle={`Encaissement CRBT pour #${colis?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowDeliverModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'deliver',
                    actionPayload,
                    `Colis #${colis?.trackingNumber} marqué livré et ${actionPayload.collectedAmount} DT encaissés.`
                  )
                }
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Valider Livraison & Encaissement</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Montant Espèces Encaissé (TND) *" required>
              <Input
                type="number"
                step="0.001"
                value={actionPayload.collectedAmount}
                onChange={(e) => setActionPayload({ ...actionPayload, collectedAmount: parseFloat(e.target.value) || 0 })}
                className="font-mono font-bold text-sm text-emerald-700"
              />
            </FormField>

            <FormField label="Note de livraison / Emargement">
              <Input
                value={actionPayload.driverNote || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, driverNote: e.target.value })}
                placeholder="Ex: Remis en mains propres à l'époux..."
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* 3. MODAL LIVRAISON PARTIELLE */}
      {showPartialModal && (
        <Modal
          isOpen={showPartialModal}
          onClose={() => setShowPartialModal(false)}
          title="Livraison Partielle"
          subtitle={`Colis #${colis?.trackingNumber} (${colis?.pieceCount} pièces initiales)`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowPartialModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'partial-delivery',
                    actionPayload,
                    `Livraison partielle validée pour #${colis?.trackingNumber}.`
                  )
                }
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Enregistrer Partielle</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Nombre de pièces acceptées par le client *" required>
              <Input
                type="number"
                min="1"
                max={colis?.pieceCount ? colis.pieceCount - 1 : 1}
                value={actionPayload.deliveredPieces}
                onChange={(e) =>
                  setActionPayload({ ...actionPayload, deliveredPieces: parseInt(e.target.value, 10) || 1 })
                }
                className="font-mono font-bold"
              />
            </FormField>

            <FormField label="Montant recalculé et encaissé (TND) *" required>
              <Input
                type="number"
                step="0.001"
                value={actionPayload.collectedAmount}
                onChange={(e) => setActionPayload({ ...actionPayload, collectedAmount: parseFloat(e.target.value) || 0 })}
                className="font-mono font-bold text-sm text-cyan-800"
              />
            </FormField>

            <FormField label="Motif de refus des autres pièces *" required>
              <Input
                required
                value={actionPayload.reason || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, reason: e.target.value })}
                placeholder="Ex: Taille trop grande pour la seconde robe..."
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* 4. MODAL ÉCHANGE */}
      {showExchangeModal && (
        <Modal
          isOpen={showExchangeModal}
          onClose={() => setShowExchangeModal(false)}
          title="Procédure d'Échange Marchandise"
          subtitle={`Livraison du nouveau colis & Récupération de l'article retour`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowExchangeModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'exchange',
                    actionPayload,
                    `Échange validé avec succès pour #${colis?.trackingNumber}.`
                  )
                }
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Valider l'Échange</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Code-barres de l'article retourné récupéré *" required>
              <Input
                required
                value={actionPayload.returnedItemBarcode}
                onChange={(e) => setActionPayload({ ...actionPayload, returnedItemBarcode: e.target.value })}
                className="font-mono font-bold text-purple-700"
              />
            </FormField>

            <FormField label="Description de l'article retourné *" required>
              <Input
                required
                value={actionPayload.returnedItemDescription}
                onChange={(e) => setActionPayload({ ...actionPayload, returnedItemDescription: e.target.value })}
                placeholder="Ex: Chaussures pointure 42 rouge (boîte d'origine)"
              />
            </FormField>

            <FormField label="Montant additionnel encaissé (le cas échéant)">
              <Input
                type="number"
                step="0.001"
                value={actionPayload.collectedAmount || 0}
                onChange={(e) => setActionPayload({ ...actionPayload, collectedAmount: parseFloat(e.target.value) || 0 })}
                className="font-mono font-bold"
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* 5. MODAL REPORT DE LIVRAISON */}
      {showPostponeModal && (
        <Modal
          isOpen={showPostponeModal}
          onClose={() => setShowPostponeModal(false)}
          title="Reporter la Livraison"
          subtitle={`Reprogrammation pour #${colis?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowPostponeModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'postpone',
                    actionPayload,
                    `Colis reporté au ${actionPayload.rescheduledDate || 'lendemain'}.`
                  )
                }
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Confirmer le Report</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Motif du report *" required>
              <Select
                value={actionPayload.reason}
                onChange={(e) => setActionPayload({ ...actionPayload, reason: e.target.value })}
              >
                <option value="Client absent au domicile">Client absent au domicile</option>
                <option value="Téléphone injoignable ou éteint">Téléphone injoignable ou éteint</option>
                <option value="Demande de report par le client">Demande de report par le client</option>
                <option value="Adresse incomplète ou imprécise">Adresse incomplète ou imprécise</option>
                <option value="Client manque de liquidités">Client manque de liquidités</option>
              </Select>
            </FormField>

            <FormField label="Date reprogrammée souhaitée" required>
              <Input
                type="date"
                value={actionPayload.rescheduledDate}
                onChange={(e) => setActionPayload({ ...actionPayload, rescheduledDate: e.target.value })}
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* 6. MODAL RETOUR DÉPÔT */}
      {showReturnModal && (
        <Modal
          isOpen={showReturnModal}
          onClose={() => setShowReturnModal(false)}
          title="Retourner le Colis au Dépôt"
          subtitle={`Échec de distribution pour #${colis?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowReturnModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'return',
                    actionPayload,
                    `Colis #${colis?.trackingNumber} retourné au dépôt.`
                  )
                }
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Confirmer le Retour</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Motif du retour définitif *" required>
              <Select
                value={actionPayload.reason}
                onChange={(e) => setActionPayload({ ...actionPayload, reason: e.target.value })}
              >
                <option value="Refus de commande par le destinataire">Refus de commande par le destinataire</option>
                <option value="Colis non conforme aux attentes client">Colis non conforme aux attentes client</option>
                <option value="Destinataire introuvable après 3 passages">Destinataire introuvable après 3 passages</option>
                <option value="Annulation par l'expéditeur">Annulation par l'expéditeur</option>
              </Select>
            </FormField>
          </div>
        </Modal>
      )}

      {/* 7. MODAL MODIFICATION DU COLIS */}
      {showEditModal && (
        <Modal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          title="Modifier les Données du Colis"
          subtitle={`Colis #${colis?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={handleUpdateColis}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Enregistrer & Notifier</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Nom client">
                <Input
                  value={actionPayload.customerName || ''}
                  onChange={(e) => setActionPayload({ ...actionPayload, customerName: e.target.value })}
                />
              </FormField>
              <FormField label="Téléphone">
                <Input
                  value={actionPayload.customerPhone || ''}
                  onChange={(e) => setActionPayload({ ...actionPayload, customerPhone: e.target.value })}
                  className="font-mono"
                />
              </FormField>
              <FormField label="Montant à encaisser (TND)">
                <Input
                  type="number"
                  step="0.001"
                  value={actionPayload.totalPrice || 0}
                  onChange={(e) => setActionPayload({ ...actionPayload, totalPrice: parseFloat(e.target.value) || 0 })}
                  className="font-mono font-bold text-red-700"
                />
              </FormField>
              <FormField label="Nombre de pièces">
                <Input
                  type="number"
                  value={actionPayload.pieceCount || 1}
                  onChange={(e) => setActionPayload({ ...actionPayload, pieceCount: parseInt(e.target.value, 10) || 1 })}
                  className="font-mono font-bold"
                />
              </FormField>
              <div className="col-span-2">
                <FormField label="Adresse de livraison">
                  <Input
                    value={actionPayload.address || ''}
                    onChange={(e) => setActionPayload({ ...actionPayload, address: e.target.value })}
                  />
                </FormField>
              </div>
              <div className="col-span-2">
                <FormField label="Instructions / Notes de tournée">
                  <Input
                    value={actionPayload.notes || ''}
                    onChange={(e) => setActionPayload({ ...actionPayload, notes: e.target.value })}
                  />
                </FormField>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 8. MODAL ANNULATION SÉCURISÉE */}
      {showCancelModal && (
        <Modal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Confirmer l'Annulation du Colis"
          subtitle={`Colis #${colis?.trackingNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'cancel',
                    { reason: actionPayload.cancellationReason || 'Annulé par l\'administrateur' },
                    `Colis #${colis?.trackingNumber} annulé.`
                  )
                }
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Confirmer l'Annulation</span>
              </button>
            </>
          }
        >
          <div className="space-y-3 text-xs">
            <p className="text-slate-600">
              L'annulation retire le colis des tournées actives. Il ne pourra plus être livré.
            </p>
            <FormField label="Motif d'annulation *" required>
              <Input
                required
                value={actionPayload.cancellationReason || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, cancellationReason: e.target.value })}
                placeholder="Ex: Commande annulée par l'expéditeur, doublon..."
              />
            </FormField>
          </div>
        </Modal>
      )}
    </div>
  );
}
