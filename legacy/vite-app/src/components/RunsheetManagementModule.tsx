import React, { useState, useEffect } from 'react';
import {
  Truck,
  Plus,
  Search,
  Filter,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Calendar,
  User,
  CreditCard,
  Download,
  Printer,
  ChevronRight,
  ArrowLeft,
  Barcode,
  Package,
  Boxes,
  FileSpreadsheet,
  Check,
  Send,
  Building,
  Phone,
  Coins,
  MapPin,
  Layers,
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
  FormField,
  Input,
  Select,
  Badge,
  StatusIndicator,
  useToast,
  EmptyState,
  Spinner,
  SkeletonTable,
  formatTND,
  PACKAGE_STATUS_MAP,
} from '../../../packages/ui/src/index';

import {
  RoleType,
  RunsheetStatus,
  PackageStatus,
  type RunsheetSummaryDto,
  type PackageDto,
  type AuthUser,
} from '../../../packages/types/src/index';

interface RunsheetManagementModuleProps {
  currentUser: AuthUser;
  token: string;
}

const RUNSHEET_STATUS_BADGES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  BROUILLON: { label: 'Brouillon', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  PREPARE: { label: 'Préparé', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  ASSIGNE: { label: 'Assigné', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  EN_COURS: { label: 'En Tournée', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
  TERMINE: { label: 'Terminé (Retour)', bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-300' },
  VALIDE: { label: 'Validé & Rapproché', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
  ANNULE: { label: 'Annulé', bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-300' },
  // Compatibilité
  EN_ATTENTE: { label: 'En attente', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
  CLOTUREE_CONFORME: { label: 'Clôturé Conforme', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
};

export function RunsheetManagementModule({ currentUser, token }: RunsheetManagementModuleProps) {
  const { addToast } = useToast();

  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedRunsheetId, setSelectedRunsheetId] = useState<string | null>(null);
  const [runsheet, setRunsheet] = useState<RunsheetSummaryDto | null>(null);

  // Liste et filtres
  const [runsheets, setRunsheets] = useState<RunsheetSummaryDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [driverFilter, setDriverFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');

  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddPackageModal, setShowAddPackageModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Formulaire Création
  const [createForm, setCreateForm] = useState({
    driverId: 'drv-001',
    driverName: 'Hamza Ben Dhif',
    tourDate: new Date().toISOString().split('T')[0],
    notes: 'Tournée Ben Arous & Sud',
  });

  // Formulaire Clôture Caisse
  const [closeForm, setCloseForm] = useState({
    collectedCash: 0,
    notes: 'Vérification espèces effectuée',
  });

  // Colis disponibles au dépôt pour ajout
  const [availablePackages, setAvailablePackages] = useState<PackageDto[]>([]);
  const [scanPackageInput, setScanPackageInput] = useState('');

  // Recherche à l'intérieur de la runsheet
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [tableStatusFilter, setTableStatusFilter] = useState('ALL');

  const availableDrivers = [
    { id: 'drv-001', name: 'Hamza Ben Dhif', phone: '20112233' },
    { id: 'drv-002', name: 'Ghassan Mghirbi', phone: '21334455' },
    { id: 'drv-003', name: 'Mohamed Ali LOUATI', phone: '22556677' },
    { id: 'drv-004', name: 'Ahmed Hamidou', phone: '23778899' },
  ];

  // Chargement des runsheets
  const loadRunsheets = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (driverFilter !== 'ALL') params.append('driverId', driverFilter);
      if (dateFilter) params.append('date', dateFilter);

      const res = await fetch(`/api/v1/runsheets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setRunsheets(data.data);
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Impossible de charger les tournées.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Chargement des détails d'une runsheet
  const loadRunsheetDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/runsheets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setRunsheet(data.data);
        setCloseForm({
          collectedCash: data.data.collectedCash || data.data.expectedCash,
          notes: 'Rapprochement de caisse au retour du chauffeur',
        });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Impossible de charger la tournée.' });
    }
  };

  // Chargement des colis disponibles au dépôt
  const loadAvailablePackages = async () => {
    try {
      const res = await fetch('/api/v1/packages?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        // Colis au dépôt sans runsheet ou en statut RECU_DEPOT / RECU_DEPOT_DESTINATION
        const unassigned = data.data.filter(
          (p: PackageDto) =>
            !p.runsheetNumber &&
            (p.status === PackageStatus.RECU_DEPOT ||
              p.status === PackageStatus.RECU_DEPOT_DESTINATION ||
              p.status === PackageStatus.CREE)
        );
        setAvailablePackages(unassigned);
      }
    } catch {}
  };

  useEffect(() => {
    loadRunsheets();
  }, [statusFilter, driverFilter, dateFilter]);

  useEffect(() => {
    if (selectedRunsheetId) {
      loadRunsheetDetails(selectedRunsheetId);
    }
  }, [selectedRunsheetId]);

  // Création d'une nouvelle runsheet
  const handleCreateRunsheet = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/runsheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (data.success) {
        addToast({
          type: 'success',
          title: 'Feuille de Tournée Créée',
          message: `N° ${data.data.runsheetNumber} pour ${data.data.driverName}`,
        });
        setShowCreateModal(false);
        loadRunsheets();
        setSelectedRunsheetId(data.data.runsheetNumber);
        setViewMode('detail');
      } else {
        addToast({ type: 'error', title: 'Erreur', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de création de la tournée.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Changement de statut du workflow
  const handleStatusChange = async (newStatus: RunsheetStatus) => {
    if (!runsheet) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/runsheets/${runsheet.runsheetNumber}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setRunsheet(data.data);
        loadRunsheets();
        addToast({
          type: 'success',
          title: 'Statut Tournée Mis à Jour',
          message: `Passage au statut [${newStatus}].`,
        });
      } else {
        addToast({ type: 'error', title: 'Action Impossible', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de transition de statut.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Ajout d'un colis à la runsheet
  const handleAddPackage = async (packageIdentifier: string) => {
    if (!runsheet || !packageIdentifier.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/runsheets/${runsheet.runsheetNumber}/add-package`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ packageIdentifier }),
      });
      const data = await res.json();
      if (data.success) {
        setRunsheet(data.data);
        setScanPackageInput('');
        loadAvailablePackages();
        loadRunsheets();
        addToast({
          type: 'success',
          title: 'Colis Ajouté',
          message: `Colis #${packageIdentifier} intégré à la tournée.`,
        });
      } else {
        addToast({ type: 'error', title: 'Erreur Ajout', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec d\'ajout du colis.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Retrait d'un colis avant le départ
  const handleRemovePackage = async (packageIdentifier: string) => {
    if (!runsheet) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/runsheets/${runsheet.runsheetNumber}/remove-package`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ packageIdentifier }),
      });
      const data = await res.json();
      if (data.success) {
        setRunsheet(data.data);
        loadAvailablePackages();
        loadRunsheets();
        addToast({
          type: 'warning',
          title: 'Colis Retiré',
          message: `Colis #${packageIdentifier} replacé en stock dépôt.`,
        });
      } else {
        addToast({ type: 'error', title: 'Erreur Retrait', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Impossible de retirer ce colis.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Clôture financière de la runsheet
  const handleCloseRunsheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runsheet) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/runsheets/${runsheet.runsheetNumber}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(closeForm),
      });
      const data = await res.json();
      if (data.success) {
        setRunsheet(data.data);
        setShowCloseModal(false);
        loadRunsheets();
        addToast({
          type: 'success',
          title: 'Caisse Clôturée avec Succès',
          message: `Tournée terminée avec ${closeForm.collectedCash} DT encaissés.`,
        });
      } else {
        addToast({ type: 'error', title: 'Erreur', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de clôture de caisse.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export CSV / Impression
  const handleExportCSV = () => {
    if (!runsheet || !runsheet.packages) return;
    const headers = ['N° Colis', 'Code-barres', 'Destinataire', 'Téléphone', 'Adresse', 'Gouvernorat', 'Montant (TND)', 'Statut'];
    const rows = runsheet.packages.map((p) => [
      p.trackingNumber,
      p.barcode,
      `"${p.customerName}"`,
      p.customerPhone,
      `"${p.address}"`,
      p.governorate,
      p.totalPrice.toFixed(3),
      p.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Runsheet_${runsheet.runsheetNumber}_${runsheet.tourDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addToast({
      type: 'info',
      title: 'Export Réussi',
      message: `Fichier CSV généré pour ${runsheet.runsheetNumber}.`,
    });
  };

  // Filtrage dans la liste des runsheets
  const filteredRunsheets = runsheets.filter((r) => {
    const matchSearch =
      !searchTerm ||
      r.runsheetNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.driverName.toLowerCase().includes(searchTerm.toLowerCase());
    return matchSearch;
  });

  // Filtrage des colis à l'intérieur de la runsheet
  const runsheetPackages = (runsheet?.packages || []).filter((p) => {
    const matchSearch =
      !tableSearchTerm ||
      p.trackingNumber.includes(tableSearchTerm) ||
      p.customerName.toLowerCase().includes(tableSearchTerm.toLowerCase()) ||
      p.customerPhone.includes(tableSearchTerm);
    const matchStatus = tableStatusFilter === 'ALL' || p.status === tableStatusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6">
      {/* ======================================================== */}
      {/* VUE 1 : LISTE DES FEUILLES DE TOURNÉE (RUNSHEETS)        */}
      {/* ======================================================== */}
      {viewMode === 'list' && (
        <div className="space-y-6">
          <PageHeader
            title="Feuilles de Tournée & Runsheets Chauffeurs"
            description="Création de tournées, composition des chargements camions, suivi temps réel et validation caisse."
            breadcrumbs={[{ label: 'Distribution' }, { label: 'Runsheets', active: true }]}
            badge={
              <Badge variant="secondary">
                <span className="font-mono">{runsheets.length} tournées</span>
              </Badge>
            }
            actions={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Créer Runsheet</span>
                </button>
                <button
                  onClick={loadRunsheets}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Actualiser</span>
                </button>
              </div>
            }
          />

          <div className="px-6 space-y-4">
            <FilterBar
              hasActiveFilters={Boolean(searchTerm || statusFilter !== 'ALL' || driverFilter !== 'ALL' || dateFilter)}
              onReset={() => {
                setSearchTerm('');
                setStatusFilter('ALL');
                setDriverFilter('ALL');
                setDateFilter('');
              }}
            >
              <div className="w-64">
                <SearchInput
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="N° Runsheet, nom livreur..."
                />
              </div>

              <FilterSelect
                label="Statut Tournée"
                selectedValue={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { label: 'Tous les statuts', value: 'ALL' },
                  { label: 'Brouillon', value: 'BROUILLON' },
                  { label: 'Préparé', value: 'PREPARE' },
                  { label: 'Assigné', value: 'ASSIGNE' },
                  { label: 'En Tournée', value: 'EN_COURS' },
                  { label: 'Terminé', value: 'TERMINE' },
                  { label: 'Validé', value: 'VALIDE' },
                ]}
              />

              <FilterSelect
                label="Chauffeur"
                selectedValue={driverFilter}
                onChange={setDriverFilter}
                options={[
                  { label: 'Tous les chauffeurs', value: 'ALL' },
                  ...availableDrivers.map((d) => ({ label: d.name, value: d.id })),
                ]}
              />

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date Tournée</label>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden"
                />
              </div>
            </FilterBar>

            {isLoading ? (
              <SkeletonTable rows={4} cols={8} />
            ) : filteredRunsheets.length === 0 ? (
              <EmptyState
                title="Aucune feuille de tournée trouvée"
                description="Aucune runsheet ne correspond aux critères sélectionnés."
                action={
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 bg-red-600 text-white rounded text-xs font-semibold"
                  >
                    Créer une Runsheet
                  </button>
                }
              />
            ) : (
              <Card className="p-0">
                <Table>
                  <Thead>
                    <tr>
                      <Th>N° Runsheet</Th>
                      <Th>Livreur Responsable</Th>
                      <Th>Date Tournée</Th>
                      <Th align="center">Colis Prévus</Th>
                      <Th align="center">Livrés</Th>
                      <Th align="center">Rep / Ret</Th>
                      <Th align="right">À Encaisser</Th>
                      <Th align="right">Encaissé</Th>
                      <Th align="center">Statut</Th>
                      <Th align="right">Action</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {filteredRunsheets.map((r) => {
                      const badge = RUNSHEET_STATUS_BADGES[r.status] || {
                        label: r.status,
                        bg: 'bg-slate-100',
                        text: 'text-slate-800',
                        border: 'border-slate-300',
                      };
                      return (
                        <Tr
                          key={r.id}
                          onClick={() => {
                            setSelectedRunsheetId(r.runsheetNumber);
                            setViewMode('detail');
                          }}
                        >
                          <Td>
                            <span className="font-mono font-bold text-red-600 block">{r.runsheetNumber}</span>
                            <span className="text-[10px] text-slate-400">{r.depositName}</span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 block">{r.driverName}</span>
                          </Td>
                          <Td className="font-mono text-slate-700">{r.tourDate}</Td>
                          <Td align="center">
                            <span className="font-mono font-bold text-slate-900">{r.totalPackages}</span>
                            <span className="text-[10px] text-slate-400 block font-mono">{r.totalPieces} pcs</span>
                          </Td>
                          <Td align="center" className="font-mono font-bold text-emerald-700">
                            {r.deliveredCount}
                          </Td>
                          <Td align="center" className="font-mono font-bold text-amber-700">
                            {r.postponedCount + r.returnedCount}
                          </Td>
                          <Td align="right" className="font-mono font-bold text-slate-900">
                            {formatTND(r.expectedCash)}
                          </Td>
                          <Td align="right" className="font-mono font-bold text-emerald-700">
                            {formatTND(r.collectedCash)}
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
                                setSelectedRunsheetId(r.runsheetNumber);
                                setViewMode('detail');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"
                            >
                              Ouvrir
                            </button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* VUE 2 : FICHE DÉTAILLÉE RUNSHEET (DASHBOARD TOURNÉE)     */}
      {/* ======================================================== */}
      {viewMode === 'detail' && runsheet && (
        <div className="space-y-6 max-w-6xl mx-auto px-6 pb-12">
          {/* Bouton Retour */}
          <button
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour à la liste des tournées</span>
          </button>

          {/* HEADER TOURNÉE AVEC WORKFLOW OPÉRATIONNEL */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-slate-900 flex items-center justify-center font-bold text-white shadow-xs">
                  <Truck className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-2xl font-bold font-mono text-slate-900 tracking-tight">
                      #{runsheet.runsheetNumber}
                    </h1>
                    <span
                      className={`px-2.5 py-0.5 rounded text-xs font-bold border ${
                        RUNSHEET_STATUS_BADGES[runsheet.status]?.bg || 'bg-slate-100'
                      } ${RUNSHEET_STATUS_BADGES[runsheet.status]?.text || 'text-slate-800'}`}
                    >
                      {RUNSHEET_STATUS_BADGES[runsheet.status]?.label || runsheet.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Date de tournée : <strong className="text-slate-800 font-mono">{runsheet.tourDate}</strong> •
                    Chauffeur : <strong className="text-slate-800">{runsheet.driverName}</strong> • Dépôt : {runsheet.depositName}
                  </p>
                </div>
              </div>

              {/* Actions Export & Impression */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Exporter CSV</span>
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500" />
                  <span>Imprimer Bordereau</span>
                </button>
              </div>
            </div>

            {/* WORKFLOW BAR : PROGRESSION DE LA TOURNÉE */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[11px]">Workflow :</span>
                {runsheet.status === RunsheetStatus.BROUILLON && (
                  <button
                    disabled={isSubmitting}
                    onClick={() => handleStatusChange(RunsheetStatus.PREPARE)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    1. Marquer Préparé (Colis vérifiés)
                  </button>
                )}
                {runsheet.status === RunsheetStatus.PREPARE && (
                  <button
                    disabled={isSubmitting}
                    onClick={() => handleStatusChange(RunsheetStatus.ASSIGNE)}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    2. Assigner & Transmettre au Livreur
                  </button>
                )}
                {runsheet.status === RunsheetStatus.ASSIGNE && (
                  <button
                    disabled={isSubmitting}
                    onClick={() => handleStatusChange(RunsheetStatus.EN_COURS)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    3. Valider Départ Tournée (En Cours)
                  </button>
                )}
                {runsheet.status === RunsheetStatus.EN_COURS && (
                  <button
                    disabled={isSubmitting}
                    onClick={() => handleStatusChange(RunsheetStatus.TERMINE)}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    4. Enregistrer Retour Chauffeur au Dépôt
                  </button>
                )}
                {runsheet.status === RunsheetStatus.TERMINE && (
                  <button
                    disabled={isSubmitting}
                    onClick={() => setShowCloseModal(true)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    5. Clôturer & Rapprocher la Caisse
                  </button>
                )}
                {runsheet.status === RunsheetStatus.VALIDE && (
                  <Badge variant="success">
                    <Check className="w-3.5 h-3.5" />
                    <span>Tournée Clôturée et Caisse Validée</span>
                  </Badge>
                )}
              </div>

              {/* Bouton Ajouter Colis si avant départ */}
              {[RunsheetStatus.BROUILLON, RunsheetStatus.PREPARE, RunsheetStatus.ASSIGNE].includes(runsheet.status) && (
                <button
                  onClick={() => {
                    loadAvailablePackages();
                    setShowAddPackageModal(true);
                  }}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ajouter Colis au Chargement</span>
                </button>
              )}
            </div>
          </div>

          {/* SUMMARY CARDS REQUISES */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-slate-400 block truncate">Total Colis</span>
              <span className="text-xl font-bold text-slate-900 mt-1 block font-mono">{runsheet.totalPackages}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-slate-400 block truncate">Pièces</span>
              <span className="text-xl font-bold text-slate-800 mt-1 block font-mono">{runsheet.totalPieces}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-emerald-200 bg-emerald-50/20 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-emerald-700 block truncate">Livrés</span>
              <span className="text-xl font-bold text-emerald-800 mt-1 block font-mono">{runsheet.deliveredCount}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-rose-200 bg-rose-50/20 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-rose-700 block truncate">Retours</span>
              <span className="text-xl font-bold text-rose-800 mt-1 block font-mono">{runsheet.returnedCount}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-amber-200 bg-amber-50/20 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-amber-700 block truncate">Reportés</span>
              <span className="text-xl font-bold text-amber-800 mt-1 block font-mono">{runsheet.postponedCount}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-slate-500 block truncate">À encaisser</span>
              <span className="text-base font-bold text-slate-900 mt-1 block font-mono">{formatTND(runsheet.expectedCash)}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-emerald-200 bg-emerald-50/30 shadow-2xs">
              <span className="text-[10px] uppercase font-semibold text-emerald-700 block truncate">Encaissé</span>
              <span className="text-base font-bold text-emerald-800 mt-1 block font-mono">{formatTND(runsheet.collectedCash)}</span>
            </div>
          </div>

          {/* TABLEAU DES COLIS DE LA RUNSHEET */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Colis Embarqués dans la Tournée ({runsheetPackages.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Ordre de livraison et suivi des remises contre remboursement.
                </p>
              </div>

              {/* Filtre interne à la runsheet */}
              <div className="flex items-center gap-2">
                <div className="w-56">
                  <SearchInput
                    value={tableSearchTerm}
                    onChange={setTableSearchTerm}
                    placeholder="Chercher colis, client..."
                  />
                </div>
                <Select
                  value={tableStatusFilter}
                  onChange={(e) => setTableStatusFilter(e.target.value)}
                  className="text-xs py-1.5 w-44"
                >
                  <option value="ALL">Tous les statuts</option>
                  <option value="AFFECTE_RUNSHEET">Affecté Runsheet</option>
                  <option value="EN_COURS_LIVRAISON">En cours de livraison</option>
                  <option value="LIVRE">Livré</option>
                  <option value="REPORTE">Reporté</option>
                  <option value="RETOUR_DEPOT">Retour Dépôt</option>
                </Select>
              </div>
            </div>

            {runsheetPackages.length === 0 ? (
              <EmptyState
                title="Aucun colis dans cette tournée"
                description="Cette feuille de tournée ne contient aucun colis pour le moment."
                action={
                  [RunsheetStatus.BROUILLON, RunsheetStatus.PREPARE, RunsheetStatus.ASSIGNE].includes(runsheet.status) ? (
                    <button
                      onClick={() => {
                        loadAvailablePackages();
                        setShowAddPackageModal(true);
                      }}
                      className="px-4 py-2 bg-red-600 text-white rounded text-xs font-semibold"
                    >
                      Ajouter des colis maintenant
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <Card className="p-0">
                <Table>
                  <Thead>
                    <tr>
                      <Th>N° Colis / Code</Th>
                      <Th>Destinataire</Th>
                      <Th>Adresse / Localité</Th>
                      <Th>Expéditeur</Th>
                      <Th align="center">Pièces</Th>
                      <Th align="right">Montant CRBT</Th>
                      <Th align="center">État Livraison</Th>
                      <Th align="right">Action</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {runsheetPackages.map((pkg) => {
                      const badge = PACKAGE_STATUS_MAP[pkg.status] || {
                        label: pkg.status,
                        bg: 'bg-slate-100',
                        text: 'text-slate-800',
                        border: 'border-slate-300',
                      };
                      const canRemove = [RunsheetStatus.BROUILLON, RunsheetStatus.PREPARE, RunsheetStatus.ASSIGNE].includes(
                        runsheet.status
                      );

                      return (
                        <Tr key={pkg.id}>
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
                          <Td align="center">
                            <span className="font-mono font-bold text-slate-900">{pkg.pieceCount}</span>
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
                            {canRemove && (
                              <button
                                onClick={() => handleRemovePackage(pkg.trackingNumber)}
                                title="Retirer ce colis avant le départ de tournée"
                                className="px-2 py-1 text-xs text-red-700 bg-red-50 hover:bg-red-100 rounded border border-red-200 transition cursor-pointer"
                              >
                                Retirer
                              </button>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1 : CRÉATION RUNSHEET                              */}
      {/* ======================================================== */}
      {showCreateModal && (
        <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Créer une Feuille de Tournée (Runsheet)"
          subtitle="Assignation chauffeur et définition de la date d'expédition"
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCreateRunsheet}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isSubmitting && <Spinner size="sm" className="text-white" />}
                <span>Créer la Tournée</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <FormField label="Chauffeur / Livreur Titulaire *" required>
              <Select
                value={createForm.driverId}
                onChange={(e) => {
                  const drv = availableDrivers.find((d) => d.id === e.target.value);
                  setCreateForm({
                    ...createForm,
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

            <FormField label="Date de la tournée *" required>
              <Input
                type="date"
                required
                value={createForm.tourDate}
                onChange={(e) => setCreateForm({ ...createForm, tourDate: e.target.value })}
              />
            </FormField>

            <FormField label="Zone / Secteur géographique">
              <Input
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                placeholder="Ex: Tunis Ouest, Bardo, Menzah..."
              />
            </FormField>
          </div>
        </Modal>
      )}

      {/* ======================================================== */}
      {/* MODAL 2 : AJOUTER COLIS À LA RUNSHEET                   */}
      {/* ======================================================== */}
      {showAddPackageModal && (
        <Modal
          isOpen={showAddPackageModal}
          onClose={() => setShowAddPackageModal(false)}
          title="Ajouter un Colis à la Tournée"
          subtitle={`Runsheet #${runsheet?.runsheetNumber}`}
          footer={
            <button
              type="button"
              onClick={() => setShowAddPackageModal(false)}
              className="px-4 py-2 bg-slate-900 text-white rounded text-xs font-semibold"
            >
              Fermer
            </button>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Saisie ou scan optique */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddPackage(scanPackageInput);
              }}
              className="flex gap-2"
            >
              <div className="flex-1">
                <Input
                  value={scanPackageInput}
                  onChange={(e) => setScanPackageInput(e.target.value)}
                  placeholder="Scanner ou saisir le code-barres..."
                  className="font-mono font-bold"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Barcode className="w-4 h-4" />
                <span>Ajouter</span>
              </button>
            </form>

            <div className="pt-2">
              <span className="font-bold text-slate-800 text-[11px] block uppercase mb-2">
                Colis disponibles au dépôt Hub Ben Arous ({availablePackages.length}) :
              </span>

              {availablePackages.length === 0 ? (
                <p className="text-slate-400 italic">Aucun colis en attente au dépôt.</p>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y border rounded">
                  {availablePackages.map((pkg) => (
                    <div key={pkg.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <span className="font-mono font-bold text-red-600 block">{pkg.trackingNumber}</span>
                        <span className="text-slate-700 font-medium">
                          {pkg.customerName} • {pkg.governorate}
                        </span>
                        <span className="text-slate-400 block font-mono text-[10px]">{formatTND(pkg.totalPrice)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddPackage(pkg.trackingNumber)}
                        className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
                      >
                        + Ajouter
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ======================================================== */}
      {/* MODAL 3 : CLÔTURE & VALIDATION CAISSE                    */}
      {/* ======================================================== */}
      {showCloseModal && (
        <Modal
          isOpen={showCloseModal}
          onClose={() => setShowCloseModal(false)}
          title="Clôture Financière de la Tournée"
          subtitle={`Rapprochement des espèces pour #${runsheet?.runsheetNumber}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCloseRunsheet}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isSubmitting && <Spinner size="sm" className="text-white" />}
                <span>Confirmer Caisse & Clôturer</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 rounded border flex justify-between items-center">
              <div>
                <span className="text-slate-500 block">Total CRBT Attendu</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {formatTND(runsheet?.expectedCash || 0)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-500 block">Colis Livrés</span>
                <span className="font-mono font-bold text-emerald-700 text-sm">
                  {runsheet?.deliveredCount} / {runsheet?.totalPackages}
                </span>
              </div>
            </div>

            <FormField label="Montant en Espèces remis par le livreur (TND) *" required>
              <Input
                type="number"
                step="0.001"
                required
                value={closeForm.collectedCash}
                onChange={(e) => setCloseForm({ ...closeForm, collectedCash: parseFloat(e.target.value) || 0 })}
                className="font-mono font-bold text-emerald-700 text-sm"
              />
            </FormField>

            <FormField label="Observations / Contrôle Caisse">
              <Input
                value={closeForm.notes}
                onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })}
                placeholder="Rapprochement espèces conforme..."
              />
            </FormField>
          </div>
        </Modal>
      )}
    </div>
  );
}
