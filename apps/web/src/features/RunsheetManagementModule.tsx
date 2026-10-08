'use client';

/*
 * Module métier migré depuis l'application Vite archivée (legacy/vite-app).
 * La logique métier est conservée à l'identique ; seules la résolution des
 * imports et l'origine des requêtes ont changé (client API RUNEX).
 */

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
  Pencil,
  Trash2,
  Eye,
  Save,
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
  ErrorState,
  ErrorBanner,
  ChargementEnCours,
  FicheLigne,
  BasculeFiches,
  ConfirmDialog,
  formatTND,
  formatDate,
  formatMontant,
  PACKAGE_STATUS_MAP,
  useDifferee,
} from '@logixpress/ui';

import {
  RoleType,
  RunsheetStatus,
  PackageStatus,
  type RunsheetSummaryDto,
  type PackageDto,
  type AuthUser,
} from '@logixpress/types';
import { createApiFetch } from '@/lib/api';
import { PermissionCode } from '@logixpress/types';

// Les requêtes de ce module passent par le client API commun : aucune URL
// d'API n'est écrite en dur ici.
const fetch = createApiFetch();


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
  EN_ATTENTE: { label: 'Prête au départ', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
  VALIDEE_DEPART: { label: 'Départ validé', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  RETOUR_DEPOT: { label: 'Retour dépôt (caisse à valider)', bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-300' },
  CLOTUREE_CONFORME: { label: 'Clôturée conforme', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
  CLOTUREE_DEFICIT: { label: 'Clôturée en déficit', bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-300' },
  ANNULEE: { label: 'Annulée', bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-300' },
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
  const [erreur, setErreur] = useState<string | null>(null);
  const [enFiches, setEnFiches] = useState(false);
  // Le filtrage de la liste est fait dans le navigateur : sans différé, chaque
  // frappe repeignait un tableau de dix colonnes.
  const searchTermDiffere = useDifferee(searchTerm, 200);

  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddPackageModal, setShowAddPackageModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [erreurDetail, setErreurDetail] = useState<string | null>(null);
  const [enFichesDetail, setEnFichesDetail] = useState(false);
  /** Transition de statut en attente de confirmation : indissociable du geste. */
  const [transitionAConfirmer, setTransitionAConfirmer] = useState<{ status: string; label: string } | null>(null);
  /** Colis à retirer de la tournée, en attente de confirmation. */
  const [retraitAConfirmer, setRetraitAConfirmer] = useState<{ trackingNumber: string; client: string } | null>(null);
  /** Runsheet à supprimer, en attente de confirmation. */
  const [suppressionAConfirmer, setSuppressionAConfirmer] = useState<RunsheetSummaryDto | null>(null);
  /** Runsheet en édition */
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRunsheet, setEditingRunsheet] = useState<RunsheetSummaryDto | null>(null);
  const [editForm, setEditForm] = useState({ driverId: '', tourDate: '', notes: '' });
  const [isUpdating, setIsUpdating] = useState(false);

  // Formulaire Création
  const [createForm, setCreateForm] = useState({
    driverId: '',
    driverName: '',
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

  // Livreurs réels — remplace la liste écrite en dur (drv-xxx) qui n'existe dans aucune table.
  const [availableDrivers, setAvailableDrivers] = useState<
    { id: string; name: string; phone: string; driverCode: string }[]
  >([]);

  // Charge la flotte réelle depuis l'API (Driver.id canonique, pas User.id ni matricule).
  useEffect(() => {
    if (!token) return;
    let annule = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/drivers?limit=100', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!annule && data.success && Array.isArray(data.data)) {
          const liste = data.data.map((d: any) => ({
            id: d.id as string,
            name: (d.user?.fullName as string) ?? d.driverCode,
            phone: (d.user?.phone as string) ?? '',
            driverCode: d.driverCode as string,
          }));
          setAvailableDrivers(liste);
          // Pré-sélectionne le premier livreur réel si aucun n'est encore choisi.
          if (liste.length > 0) {
            setCreateForm((prev) => {
              if (prev.driverId && liste.some((x: any) => x.id === prev.driverId)) return prev;
              return { ...prev, driverId: liste[0].id, driverName: liste[0].name };
            });
          }
        }
      } catch {}
    })();
    return () => {
      annule = true;
    };
  }, [token]);

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
      if (!res.ok || !data.success) {
        setErreur(data.message ?? 'Le serveur n\'a pas pu renvoyer les tournées.');
        setRunsheets([]);
        return;
      }
      setErreur(null);
      setRunsheets(data.data);
    } catch {
      setRunsheets([]);
      setErreur('Impossible de joindre le serveur RUNEX. Vérifiez votre connexion.');
    } finally {
      setIsLoading(false);
    }
  };

  // Chargement des détails d'une runsheet
  const loadRunsheetDetails = async (id: string) => {
    // La tournée précédente est vidée avant le fetch : sans cela, la fiche
    // affichait le contenu de la tournée précédente sous le numéro de la
    // nouvelle pendant toute la requête, et le gardait si le fetch échouait.
    setRunsheet(null);
    setChargementDetail(true);
    setErreurDetail(null);
    try {
      const res = await fetch(`/api/v1/runsheets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErreurDetail(data.message ?? 'Cette tournée est introuvable ou inaccessible.');
        return;
      }
      setRunsheet(data.data);
      setCloseForm({
        collectedCash: data.data.collectedCash || data.data.expectedCash,
        notes: 'Rapprochement de caisse au retour du chauffeur',
      });
    } catch {
      setErreurDetail('Impossible de joindre le serveur RUNEX. Vérifiez votre connexion.');
    } finally {
      setChargementDetail(false);
    }
  };

  // Chargement des colis disponibles au dépôt
  const loadAvailablePackages = async () => {
    try {
      const res = await fetch('/api/v1/packages?limit=200', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        // Colis au dépôt sans runsheet ou en statut RECU_DEPOT / RECU_DEPOT_DESTINATION
        // Colis éligibles (mêmes règles que l'API) : hors tournée, dans un
        // statut qui peut partir en distribution, et libres ou déjà affectés
        // au livreur de cette tournée.
        const eligibles: string[] = [
          PackageStatus.CREE,
          PackageStatus.RECU_DEPOT,
          PackageStatus.RECU_DEPOT_DESTINATION,
          PackageStatus.AFFECTE_RUNSHEET,
          PackageStatus.REPORTE,
          PackageStatus.ECHEC_LIVRAISON,
        ];
        const unassigned = data.data.filter((p: PackageDto) => {
          const driverId = (p as PackageDto & { assignedDriverId?: string | null }).assignedDriverId ?? null;
          return (
            !p.runsheetNumber &&
            eligibles.includes(p.status) &&
            (!driverId || !runsheet || driverId === runsheet.driverId)
          );
        });
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
          sound: 'complete',
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
          sound: 'scan',
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
          sound: 'remove',
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
  // La déclaration et la validation de caisse exigent RUNSHEET_VALIDATE (caisse, exploitation).
  const peutValiderCaisse =
    currentUser.role === 'ADMIN' ||
    (currentUser.permissions ?? []).includes(PermissionCode.RUNSHEET_VALIDATE);

  // Validation de la caisse : la tournée revenue au dépôt est clôturée.
  const handleValidateRunsheet = async () => {
    if (!runsheet) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/runsheets/${runsheet.runsheetNumber}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setRunsheet(data.data);
        loadRunsheets();
        addToast({ type: 'success', title: 'Caisse validée', message: `Tournée ${runsheet.runsheetNumber} clôturée.`, sound: 'complete' });
      } else {
        addToast({ type: 'error', title: 'Validation impossible', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de la validation de caisse.' });
    } finally {
      setIsSubmitting(false);
    }
  };

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
          sound: 'complete',
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

  // Ouvrir édition
  const openEditModal = (r: RunsheetSummaryDto) => {
    setEditingRunsheet(r);
    setEditForm({ driverId: r.driverId, tourDate: r.tourDate.slice(0, 10), notes: r.notes ?? '' });
    setShowEditModal(true);
  };

  const handleUpdateRunsheet = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!editingRunsheet) return;
    setIsUpdating(true);
    try {
      const payload: Record<string, string> = {};
      if (editForm.driverId !== editingRunsheet.driverId) payload.driverId = editForm.driverId;
      if (editForm.tourDate !== editingRunsheet.tourDate.slice(0, 10)) payload.tourDate = editForm.tourDate;
      if ((editForm.notes ?? '') !== (editingRunsheet.notes ?? '')) payload.notes = editForm.notes;
      if (Object.keys(payload).length === 0) {
        addToast({ type: 'info', title: 'Aucune modification', message: 'Aucun champ n\u2019a été modifié.' });
        setShowEditModal(false);
        return;
      }
      const res = await fetch(`/api/v1/runsheets/${editingRunsheet.runsheetNumber}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        addToast({ type: 'success', title: 'Tournée mise à jour', message: `N° ${data.data.runsheetNumber} mise à jour.` });
        setShowEditModal(false);
        setEditingRunsheet(null);
        loadRunsheets();
        if (runsheet && runsheet.runsheetNumber === data.data.runsheetNumber) setRunsheet(data.data);
      } else {
        addToast({ type: 'error', title: 'Modification impossible', message: data.message });
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de la mise à jour.' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteRunsheet = async () => {
    if (!suppressionAConfirmer) return;
    const target = suppressionAConfirmer;
    try {
      const res = await fetch(`/api/v1/runsheets/${target.runsheetNumber}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success || res.ok) {
        addToast({ type: 'success', title: 'Tournée supprimée', message: `N° ${target.runsheetNumber} supprimée.`, sound: 'remove' });
        setSuppressionAConfirmer(null);
        if (viewMode === 'detail' && runsheet?.runsheetNumber === target.runsheetNumber) {
          setViewMode('list');
          setRunsheet(null);
          setSelectedRunsheetId(null);
        }
        loadRunsheets();
      } else {
        addToast({ type: 'error', title: 'Suppression impossible', message: data.message });
        setSuppressionAConfirmer(null);
      }
    } catch {
      addToast({ type: 'error', title: 'Erreur', message: 'Échec de la suppression.' });
      setSuppressionAConfirmer(null);
    }
  };

  const isRunsheetEditable = (r: RunsheetSummaryDto) => ['BROUILLON', 'EN_ATTENTE'].includes(r.status);
  const isRunsheetDeletable = (r: RunsheetSummaryDto) => ['BROUILLON', 'EN_ATTENTE'].includes(r.status) && r.totalPackages === 0;

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

  /** Un filtre est posé dès qu'un critère s'écarte de sa valeur neutre. */
  const aFiltres =
    Boolean(searchTerm) || statusFilter !== 'ALL' || driverFilter !== 'ALL' || Boolean(dateFilter);

  const reinitialiserFiltres = () => {
    setSearchTerm('');
    setStatusFilter('ALL');
    setDriverFilter('ALL');
    setDateFilter('');
  };

  /** Filtres en cours, énumérés en clair. */
  const resumeFiltres = [
    searchTerm ? `recherche « ${searchTerm} »` : null,
    statusFilter !== 'ALL'
      ? `statut ${RUNSHEET_STATUS_BADGES[statusFilter]?.label.toLowerCase() ?? statusFilter}`
      : null,
    driverFilter !== 'ALL' ? `chauffeur ${driverFilter}` : null,
    dateFilter ? `le ${formatDate(dateFilter)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /** Applique la recherche au fil de la frappe, sans repeindre à chaque lettre. */
  const rechercher = (valeur: string) => setSearchTerm(valeur);

  // Filtrage dans la liste des runsheets
  const filteredRunsheets = runsheets.filter((r) => {
    const terme = searchTermDiffere.trim().toLowerCase();
    const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const matchChauffeur = driverFilter === 'ALL' || r.driverId === driverFilter;
    const matchDate = !dateFilter || formatDate(r.tourDate) === formatDate(dateFilter);
    const matchSearch =
      !terme ||
      r.runsheetNumber.toLowerCase().includes(terme) ||
      r.driverName.toLowerCase().includes(terme);
    return matchSearch && matchStatus && matchChauffeur && matchDate;
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
                <span className="font-mono">{filteredRunsheets.length} tournées</span>
              </Badge>
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Créer Runsheet</span>
                </button>
                <button
                  type="button"
                  onClick={loadRunsheets}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Actualiser</span>
                </button>
              </div>
            }
          />

          <div className="px-4 sm:px-6 space-y-4">
            <FilterBar
              hasActiveFilters={aFiltres}
              resume={resumeFiltres}
              onReset={() => {
                setSearchTerm('');
                setStatusFilter('ALL');
                setDriverFilter('ALL');
                setDateFilter('');
              }}
            >
              <div className="w-full sm:w-64">
                <SearchInput
                  libelle="Rechercher une runsheet par numéro ou nom de livreur"
                  value={searchTerm}
                  onChange={rechercher}
                  onSubmit={rechercher}
                  placeholder="N° Runsheet, nom livreur..."
                />
              </div>

              <FilterSelect
                label="Statut tournée"
                selectedValue={statusFilter}
                actif={statusFilter !== 'ALL'}
                onChange={setStatusFilter}
                options={[
                  { label: 'Tous les statuts', value: 'ALL' },
                  { label: 'Brouillon', value: 'BROUILLON' },
                  { label: 'Prête au départ', value: 'EN_ATTENTE' },
                  { label: 'En tournée', value: 'EN_COURS' },
                  { label: 'Retour dépôt (caisse à valider)', value: 'RETOUR_DEPOT' },
                  { label: 'Clôturée conforme', value: 'CLOTUREE_CONFORME' },
                  { label: 'Clôturée en déficit', value: 'CLOTUREE_DEFICIT' },
                  { label: 'Annulée', value: 'ANNULEE' },
                ]}
              />

              <FilterSelect
                label="Chauffeur"
                selectedValue={driverFilter}
                actif={driverFilter !== 'ALL'}
                onChange={setDriverFilter}
                options={[
                  { label: 'Tous les chauffeurs', value: 'ALL' },
                  ...availableDrivers.map((d) => ({ label: d.name, value: d.id })),
                ]}
              />

              <div className="flex flex-col gap-1 min-w-0">
                {/* Le libellé était détaché du champ : cliquer dessus ne
                    plaçait pas le focus, et le champ était annoncé sans nom. */}
                <label
                  htmlFor="filtre-date-tournee"
                  className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
                >
                  Date tournée
                </label>
                <input
                  id="filtre-date-tournee"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full min-w-0 px-2 py-1.5 bg-white border border-slate-200 rounded-md text-sm text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-600/20"
                />
              </div>
            </FilterBar>

            {erreur ? (
              <ErrorState
                title="Les feuilles de tournée n'ont pas pu être chargées"
                message={erreur}
                onRetry={loadRunsheets}
              />
            ) : isLoading ? (
              <>
                <ChargementEnCours message="Chargement des feuilles de tournée" />
                <SkeletonTable rows={4} cols={8} />
              </>
            ) : filteredRunsheets.length === 0 ? (
              aFiltres ? (
                /* Filtré à vide : proposer de créer une tournée est le
                   contre-sens le plus courant d'un état vide. On remit les
                   filtres à zéro, qui est l'action réellement attendue. */
                <EmptyState
                  title="Aucune tournée ne correspond à cette recherche"
                  description={`${resumeFiltres}. Élargissez la période ou retirez un filtre.`}
                  action={
                    <button
                      type="button"
                      onClick={reinitialiserFiltres}
                      className="px-4 py-2 bg-slate-900 text-white rounded text-xs font-semibold cursor-pointer"
                    >
                      Réinitialiser les filtres
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="Aucune feuille de tournée"
                  description="Les tournées créées pour ce dépôt apparaîtront ici, avec leur composition et leur état de caisse."
                  action={
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold cursor-pointer"
                    >
                      Créer une Runsheet
                    </button>
                  }
                />
              )
            ) : (
              <>
                <div className="flex justify-end">
                  <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
                </div>

                {enFiches && (
                  <div className="sm:hidden bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                    {filteredRunsheets.map((r) => {
                      const badge = RUNSHEET_STATUS_BADGES[r.status] ?? {
                        label: r.status,
                        bg: 'bg-slate-100',
                        text: 'text-slate-800',
                        border: 'border-slate-300',
                      };
                      const editable = isRunsheetEditable(r);
                      const deletable = isRunsheetDeletable(r);
                      return (
                        <div key={r.id} className="space-y-0">
                          <FicheLigne
                            titre={r.runsheetNumber}
                            sousTitre={`${r.driverName} · ${r.depositName}`}
                            onClick={() => {
                              setSelectedRunsheetId(r.runsheetNumber);
                              setViewMode('detail');
                            }}
                            action={
                              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                                {badge.label}
                              </span>
                            }
                            champs={[
                              { libelle: 'Date tournée', valeur: formatDate(r.tourDate) },
                              { libelle: 'Colis prévus', valeur: r.totalPackages },
                              { libelle: 'Livrés', valeur: r.deliveredCount },
                              { libelle: 'À encaisser', valeur: formatTND(r.expectedCash), numerique: true },
                              { libelle: 'Encaissé', valeur: formatTND(r.collectedCash), numerique: true },
                              { libelle: 'Reportés / retournés', valeur: r.postponedCount + r.returnedCount },
                            ]}
                          />
                          <div className="flex items-center gap-2 px-3 pb-3">
                            <button type="button" onClick={() => { setSelectedRunsheetId(r.runsheetNumber); setViewMode('detail'); }} className="flex-1 py-1.5 rounded border border-slate-200 bg-white text-slate-700 text-xs font-semibold flex items-center justify-center gap-1"><Eye className="w-3.5 h-3.5" /> Voir</button>
                            <button type="button" onClick={() => openEditModal(r)} disabled={!editable} title={!editable ? `Non modifiable (${r.status})` : r.totalPackages>0 ? 'Contient des colis' : 'Modifier'} className={`flex-1 py-1.5 rounded border text-xs font-semibold flex items-center justify-center gap-1 ${editable && r.totalPackages===0 ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-100 bg-slate-50 text-slate-300'}`}><Pencil className="w-3.5 h-3.5" /> Modifier</button>
                            <button type="button" onClick={() => setSuppressionAConfirmer(r)} disabled={!deletable} title={!deletable ? (r.totalPackages>0 ? `Contient ${r.totalPackages} colis` : `Non supprimable (${r.status})`) : 'Supprimer'} className={`flex-1 py-1.5 rounded border text-xs font-semibold flex items-center justify-center gap-1 ${deletable ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-100 bg-slate-50 text-slate-300'}`}><Trash2 className="w-3.5 h-3.5" /> Supprimer</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className={enFiches ? 'hidden sm:block' : ''}>
                <Table libelle="Feuilles de tournée" largeurMin="1180px">
                  <Thead>
                    <tr>
                      <Th figee>N° Runsheet</Th>
                      <Th>Livreur responsable</Th>
                      <Th priorite="secondaire">Date tournée</Th>
                      <Th align="center" priorite="secondaire">Colis prévus</Th>
                      <Th align="center">Livrés</Th>
                      <Th align="center" priorite="tertiaire">Rep / Ret</Th>
                      <Th align="right" priorite="tertiaire">À encaisser</Th>
                      <Th align="right">Encaissé</Th>
                      <Th align="center" priorite="tertiaire">Statut</Th>
                      <Th align="center">Actions</Th>
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
                      const editable = isRunsheetEditable(r);
                      const deletable = isRunsheetDeletable(r);
                      const editReason = !editable ? `Non modifiable (statut ${r.status})` : r.totalPackages > 0 ? `Contient ${r.totalPackages} colis — retirez-les d’abord` : '';
                      const deleteReason = !deletable ? (r.totalPackages > 0 ? `Contient ${r.totalPackages} colis — retirez-les d’abord` : `Non supprimable (statut ${r.status})`) : '';
                      return (
                        <Tr
                          key={r.id}
                          onClick={() => {
                            setSelectedRunsheetId(r.runsheetNumber);
                            setViewMode('detail');
                          }}
                          resume={`Tournée ${r.runsheetNumber}, ${r.driverName}, ${badge.label}, ${r.deliveredCount} colis livrés sur ${r.totalPackages}, ${formatTND(r.collectedCash)} encaissés`}
                        >
                          <Td figee>
                            <span className="font-mono font-bold text-red-600 block">{r.runsheetNumber}</span>
                            <span className="text-[11px] text-slate-500">{r.depositName}</span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 block">{r.driverName}</span>
                          </Td>
                          <Td priorite="secondaire" className="font-mono text-slate-700">
                            {formatDate(r.tourDate)}
                          </Td>
                          <Td align="center" priorite="secondaire">
                            <span className="font-mono font-bold text-slate-900">{r.totalPackages}</span>
                            <span className="text-[11px] text-slate-500 block font-mono">{r.totalPieces} pcs</span>
                          </Td>
                          <Td align="center" className="font-mono font-bold text-emerald-700">
                            {r.deliveredCount}
                          </Td>
                          <Td align="center" priorite="tertiaire" className="font-mono font-bold text-amber-700">
                            {r.postponedCount + r.returnedCount}
                          </Td>
                          <Td align="right" priorite="tertiaire" className="font-mono font-bold text-slate-900 whitespace-nowrap">
                            {formatTND(r.expectedCash)}
                          </Td>
                          <Td align="right" className="font-mono font-bold text-emerald-700 whitespace-nowrap">
                            {formatTND(r.collectedCash)}
                          </Td>
                          <Td align="center" priorite="tertiaire">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                              {badge.label}
                            </span>
                          </Td>
                          <Td align="center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRunsheetId(r.runsheetNumber);
                                  setViewMode('detail');
                                }}
                                title="Voir"
                                className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition cursor-pointer"
                                aria-label={`Voir ${r.runsheetNumber}`}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEditModal(r); }}
                                disabled={!editable || (!!editReason && r.totalPackages > 0)}
                                title={editable && !editReason ? 'Modifier' : editReason || `Non modifiable (${r.status})`}
                                className={`p-1.5 rounded border transition cursor-pointer ${editable && (!editReason || r.totalPackages === 0) ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'}`}
                                aria-label={`Modifier ${r.runsheetNumber}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setSuppressionAConfirmer(r); }}
                                disabled={!deletable}
                                title={deletable ? 'Supprimer' : deleteReason}
                                className={`p-1.5 rounded border transition cursor-pointer ${deletable ? 'border-red-200 bg-red-50 hover:bg-red-100 text-red-700' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'}`}
                                aria-label={`Supprimer ${r.runsheetNumber}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* VUE 2 : FICHE DÉTAILLÉE RUNSHEET (DASHBOARD TOURNÉE)     */}
      {/* ======================================================== */}
      {/* Chargement et échec de la fiche. Sans ces deux branches, la vue détail
          ne rendait rien tant que la tournée n'était pas revenue du serveur : un
          échec réseau donnait un écran blanc, sans message et sans issue. */}
      {viewMode === 'detail' && !runsheet && (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-4">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Retour à la liste des tournées</span>
          </button>

          {chargementDetail ? (
            <>
              <ChargementEnCours message="Chargement de la tournée" />
              <Card>
                <SkeletonTable rows={4} cols={4} />
              </Card>
            </>
          ) : (
            <ErrorState
              title="La tournée n'a pas pu être chargée"
              message={erreurDetail ?? 'Cette tournée est introuvable ou momentanément inaccessible.'}
              onRetry={() => selectedRunsheetId && loadRunsheetDetails(selectedRunsheetId)}
            />
          )}
        </div>
      )}

      {viewMode === 'detail' && runsheet && (
        <div className="space-y-6 max-w-6xl mx-auto px-4 sm:px-6 pb-12">
          {/* Bouton Retour */}
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
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
                    Date de tournée : <strong className="text-slate-800 font-mono">{formatDate(runsheet.tourDate)}</strong> •
                    Chauffeur : <strong className="text-slate-800">{runsheet.driverName}</strong> • Dépôt : {runsheet.depositName}
                  </p>
                </div>
              </div>

              {/* Actions Export & Impression + CRUD */}
              <div className="flex items-center gap-2">
                {runsheet && (() => {
                  const editable = isRunsheetEditable(runsheet);
                  const deletable = isRunsheetDeletable(runsheet);
                  const editReason = !editable ? `Non modifiable (statut ${runsheet.status})` : runsheet.totalPackages > 0 ? 'Contient des colis — modification livreur/dépôt bloquée' : '';
                  const deleteReason = !deletable ? (runsheet.totalPackages > 0 ? `Contient ${runsheet.totalPackages} colis` : `Non supprimable (statut ${runsheet.status})`) : '';
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(runsheet)}
                        disabled={!editable}
                        title={editable ? 'Modifier la tournée' : editReason}
                        className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${editable ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-slate-50 border border-slate-200 text-slate-300 cursor-not-allowed'}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Modifier</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuppressionAConfirmer(runsheet)}
                        disabled={!deletable}
                        title={deletable ? 'Supprimer la tournée' : deleteReason}
                        className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${deletable ? 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100' : 'bg-slate-50 border border-slate-200 text-slate-300 cursor-not-allowed'}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Supprimer</span>
                      </button>
                    </>
                  );
                })()}
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Exporter CSV</span>
                </button>
                <button
                  type="button"
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
                {/* Cycle réel de l'API : BROUILLON → EN_ATTENTE → EN_COURS
                    → (déclaration de caisse) RETOUR_DEPOT → (validation caisse)
                    CLOTUREE_CONFORME / CLOTUREE_DEFICIT. */}
                {String(runsheet.status) === 'BROUILLON' && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setTransitionAConfirmer({ status: RunsheetStatus.EN_ATTENTE, label: 'Marquer la tournée « prête au départ »' })}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    1. Marquer prête (colis vérifiés)
                  </button>
                )}
                {['EN_ATTENTE', 'VALIDEE_DEPART'].includes(String(runsheet.status)) && (
                  <button
                    type="button"
                    disabled={isSubmitting || runsheet.totalPackages === 0}
                    title={runsheet.totalPackages === 0 ? 'Ajoutez au moins un colis avant le départ' : undefined}
                    onClick={() => setTransitionAConfirmer({ status: RunsheetStatus.EN_COURS, label: 'Valider le départ de la tournée' })}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    2. Valider le départ (en tournée)
                  </button>
                )}
                {String(runsheet.status) === 'EN_COURS' && peutValiderCaisse && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setShowCloseModal(true)}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    3. Retour chauffeur : déclarer la caisse
                  </button>
                )}
                {String(runsheet.status) === 'RETOUR_DEPOT' && peutValiderCaisse && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleValidateRunsheet()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs transition cursor-pointer"
                  >
                    4. Valider la caisse et clôturer
                  </button>
                )}
                {['CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT'].includes(String(runsheet.status)) && (
                  <Badge variant={String(runsheet.status) === 'CLOTUREE_DEFICIT' ? 'warning' : 'success'}>
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      {String(runsheet.status) === 'CLOTUREE_DEFICIT'
                        ? `Clôturée avec déficit de ${Number(runsheet.deficitAmount).toFixed(3)} DT`
                        : 'Tournée clôturée, caisse conforme'}
                    </span>
                  </Badge>
                )}
                {['BROUILLON', 'EN_ATTENTE', 'VALIDEE_DEPART'].includes(String(runsheet.status)) && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setTransitionAConfirmer({ status: RunsheetStatus.ANNULE, label: 'Annuler la tournée (les colis restent affectés au livreur)' })}
                    className="px-3 py-1.5 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 rounded font-semibold text-xs transition cursor-pointer"
                  >
                    Annuler la tournée
                  </button>
                )}
              </div>

              {/* Bouton Ajouter Colis si avant départ */}
              {['BROUILLON', 'EN_ATTENTE'].includes(String(runsheet.status)) && (
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
              <span className="text-[11px] uppercase font-semibold text-slate-500 block truncate">Total Colis</span>
              <span className="text-xl font-bold text-slate-900 mt-1 block font-mono">{runsheet.totalPackages}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-[11px] uppercase font-semibold text-slate-500 block truncate">Pièces</span>
              <span className="text-xl font-bold text-slate-800 mt-1 block font-mono">{runsheet.totalPieces}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-emerald-200 bg-emerald-50/20 shadow-2xs">
              <span className="text-[11px] uppercase font-semibold text-emerald-700 block truncate">Livrés</span>
              <span className="text-xl font-bold text-emerald-800 mt-1 block font-mono">{runsheet.deliveredCount}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-rose-200 bg-rose-50/20 shadow-2xs">
              <span className="text-[11px] uppercase font-semibold text-rose-700 block truncate">Retours</span>
              <span className="text-xl font-bold text-rose-800 mt-1 block font-mono">{runsheet.returnedCount}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-amber-200 bg-amber-50/20 shadow-2xs">
              <span className="text-[11px] uppercase font-semibold text-amber-700 block truncate">Reportés</span>
              <span className="text-xl font-bold text-amber-800 mt-1 block font-mono">{runsheet.postponedCount}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-[11px] uppercase font-semibold text-slate-500 block truncate">À encaisser</span>
              <span className="text-base font-bold text-slate-900 mt-1 block font-mono">{formatTND(runsheet.expectedCash)}</span>
            </div>

            <div className="p-3 bg-white rounded-lg border border-emerald-200 bg-emerald-50/30 shadow-2xs">
              <span className="text-[11px] uppercase font-semibold text-emerald-700 block truncate">Encaissé</span>
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
                <div className="w-full sm:w-56">
                  <SearchInput
                    libelle="Rechercher un colis dans cette runsheet"
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
                  ['BROUILLON', 'EN_ATTENTE'].includes(String(runsheet.status)) ? (
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
              <>
                <div className={enFichesDetail ? 'hidden sm:block' : ''}>
                <Table libelle="Colis de la tournée" largeurMin="900px">
                  <Thead>
                    <tr>
                      <Th figee>N° Colis / Code</Th>
                      <Th>Destinataire</Th>
                      <Th priorite="tertiaire">Adresse / Localité</Th>
                      <Th priorite="secondaire">Expéditeur</Th>
                      <Th align="center" priorite="secondaire">Pièces</Th>
                      <Th align="right">Montant CRBT</Th>
                      <Th align="center">État livraison</Th>
                      <Th align="right">Retirer</Th>
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
                      const canRemove = ['BROUILLON', 'EN_ATTENTE'].includes(
                        String(runsheet.status)
                      );

                      return (
                        <Tr key={pkg.id} resume={`Colis ${pkg.trackingNumber}, ${pkg.customerName}, ${badge.label}, ${formatTND(pkg.totalPrice)}`}>
                          <Td figee>
                            <span className="font-mono font-bold text-red-600 block">{pkg.trackingNumber}</span>
                            <span className="text-[11px] text-slate-500 font-mono">{pkg.barcode}</span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 block">{pkg.customerName}</span>
                            <span className="text-slate-500 font-mono text-[11px] flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-500" aria-hidden="true" />
                              {pkg.customerPhone}
                            </span>
                          </Td>
                          <Td priorite="tertiaire">
                            <span className="font-semibold text-slate-800 block">{pkg.governorate}</span>
                            <span className="text-slate-500 text-[11px] truncate max-w-xs block">{pkg.address}</span>
                          </Td>
                          <Td priorite="secondaire">
                            <span className="font-medium text-slate-800">{pkg.shipperName}</span>
                          </Td>
                          <Td align="center" priorite="secondaire">
                            <span className="font-mono font-bold text-slate-900">{pkg.pieceCount}</span>
                          </Td>
                          <Td align="right" numerique>
                            <span className="font-mono font-bold text-slate-900 whitespace-nowrap">
                              {formatTND(pkg.totalPrice)}
                            </span>
                          </Td>
                          <Td align="center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                              {badge.label}
                            </span>
                          </Td>
                          {/* Le retrait est confirmé : le colis sort du chargement
                              sans retour possible depuis cet écran. */}
                          <Td align="right">
                            {canRemove && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRetraitAConfirmer({
                                    trackingNumber: pkg.trackingNumber,
                                    client: pkg.customerName,
                                  })
                                }
                                aria-label={`Retirer le colis ${pkg.trackingNumber} de la tournée`}
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
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CONFIRMATIONS                                            */}
      {/* Les transitions de statut figent la tournée sans retour possible */}
      {/* depuis cet écran ; le retrait sort un colis du chargement. Dans */}
      {/* les deux cas, l'utilisateur n'apprenait le résultat qu'après coup. */}
      {/* ======================================================== */}
      <ConfirmDialog
        isOpen={transitionAConfirmer !== null}
        onClose={() => setTransitionAConfirmer(null)}
        onConfirm={() => {
          if (!transitionAConfirmer) return;
          const { status } = transitionAConfirmer;
          setTransitionAConfirmer(null);
          void handleStatusChange(status as RunsheetStatus);
        }}
        title="Confirmer l'étape de la tournée"
        message={`${transitionAConfirmer?.label ?? ''} pour ${runsheet?.runsheetNumber ?? 'cette tournée'}. L'étape est définitive depuis cet écran.`}
        confirmText="Confirmer l'étape"
        type="warning"
      />

      <ConfirmDialog
        isOpen={retraitAConfirmer !== null}
        onClose={() => setRetraitAConfirmer(null)}
        onConfirm={() => {
          if (!retraitAConfirmer) return;
          const { trackingNumber } = retraitAConfirmer;
          setRetraitAConfirmer(null);
          void handleRemovePackage(trackingNumber);
        }}
        title="Retirer ce colis de la tournée ?"
        message={`Le colis ${retraitAConfirmer?.trackingNumber ?? ''} (${retraitAConfirmer?.client ?? ''}) sort du chargement de cette tournée.`}
        confirmText="Retirer le colis"
        type="danger"
      />

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
                <p className="text-slate-500 italic">Aucun colis en attente au dépôt.</p>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y border rounded">
                  {availablePackages.map((pkg) => (
                    <div key={pkg.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <span className="font-mono font-bold text-red-600 block">{pkg.trackingNumber}</span>
                        <span className="text-slate-700 font-medium">
                          {pkg.customerName} • {pkg.governorate}
                        </span>
                        <span className="text-slate-500 block font-mono text-[11px]">{formatTND(pkg.totalPrice)}</span>
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

      {/* ======================================================== */}
      {/* MODAL 4 : ÉDITION RUNSHEET                               */}
      {/* ======================================================== */}
      {showEditModal && editingRunsheet && (
        <Modal
          isOpen={showEditModal}
          onClose={() => { setShowEditModal(false); setEditingRunsheet(null); }}
          title={`Modifier la Tournée #${editingRunsheet.runsheetNumber}`}
          subtitle={`Statut actuel : ${editingRunsheet.status} — seules les tournées en attente sont modifiables`}
          footer={
            <>
              <button
                type="button"
                onClick={() => { setShowEditModal(false); setEditingRunsheet(null); }}
                className="px-4 py-2 border rounded text-slate-700 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleUpdateRunsheet}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isUpdating && <Spinner size="sm" className="text-white" />}
                <Save className="w-3.5 h-3.5" />
                <span>Enregistrer</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            {editingRunsheet.totalPackages > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-amber-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Cette tournée contient {editingRunsheet.totalPackages} colis. Le changement de livreur/dépôt est bloqué pour éviter l’incohérence colis↔tournée. Retirez les colis d’abord.</span>
              </div>
            )}
            {['EN_COURS','VALIDEE_DEPART','RETOUR_DEPOT','CLOTUREE_CONFORME','CLOTUREE_DEFICIT','ANNULEE'].includes(editingRunsheet.status) && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-800 flex gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Tournée non modifiable (statut {editingRunsheet.status}). Seules les tournées BROUILLON/EN_ATTENTE peuvent être modifiées.</span>
              </div>
            )}
            <FormField label="Chauffeur / Livreur *">
              <Select
                value={editForm.driverId}
                onChange={(e) => setEditForm({ ...editForm, driverId: e.target.value })}
                disabled={editingRunsheet.totalPackages > 0 || !isRunsheetEditable(editingRunsheet)}
              >
                {availableDrivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.phone})</option>
                ))}
              </Select>
              {editingRunsheet.totalPackages > 0 && <p className="text-[11px] text-amber-700 mt-1">Changement de livreur bloqué — tournée avec colis.</p>}
            </FormField>
            <FormField label="Date de la tournée *">
              <Input
                type="date"
                value={editForm.tourDate}
                onChange={(e) => setEditForm({ ...editForm, tourDate: e.target.value })}
                disabled={!isRunsheetEditable(editingRunsheet)}
              />
            </FormField>
            <FormField label="Zone / Secteur">
              <Input
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="Ex: Tunis Ouest, Bardo…"
                disabled={!isRunsheetEditable(editingRunsheet)}
              />
            </FormField>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={suppressionAConfirmer !== null}
        onClose={() => setSuppressionAConfirmer(null)}
        onConfirm={() => void handleDeleteRunsheet()}
        title="Supprimer cette tournée ?"
        message={suppressionAConfirmer ? `La tournée ${suppressionAConfirmer.runsheetNumber} (${suppressionAConfirmer.driverName}, ${formatDate(suppressionAConfirmer.tourDate)}, ${suppressionAConfirmer.totalPackages} colis) sera définitivement supprimée. Cette action est irréversible. Seules les tournées vides en attente peuvent être supprimées.` : ''}
        confirmText="Supprimer définitivement"
        type="danger"
      />
    </div>
  );
}
