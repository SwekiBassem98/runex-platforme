'use client';

/*
 * Module métier migré depuis l'application Vite archivée (legacy/vite-app).
 * La logique métier est conservée à l'identique ; seules la résolution des
 * imports et l'origine des requêtes ont changé (client API RUNEX).
 */

import React, { useState, useEffect, useRef } from 'react';
import { useDifferee } from '@logixpress/ui';
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
  Printer,
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
  FicheLigne,
  BasculeFiches,
  Pagination,
  ErrorState,
  ChargementEnCours,
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
} from '@logixpress/ui';

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
} from '@logixpress/types';
import { colisApi, createApiFetch, runsheetsApi, searchApi, shippersApi, zonesApi, type DriverSuggestions, type ZoneDto } from '@/lib/api';
import { GOUVERNORATS } from '@/features/expediteur/lib/libelles';
import { estZoneConnue, useDelegationsConnues } from '@/features/zones/useDelegationsConnues';
import { imprimerBonsLivraison } from '@/features/colis/bonLivraison';

// Les requêtes de ce module passent par le client API commun : aucune URL
// d'API n'est écrite en dur ici.
const fetch = createApiFetch();


interface ColisManagementModuleProps {
  currentUser: AuthUser;
  token: string;
  /**
   * Colis à ouvrir directement (route `/colis/<id>`) : lien d'une
   * notification, de la recherche globale ou du magasin.
   */
  initialColisId?: string | null;
}

/**
 * Charge utile d'une action sur un colis.
 *
 * Elle démarre comme les données du colis lui-même — c'est ce que la fiche
 * chargée fournit — puis se complète des champs propres à l'action en cours :
 * montant encaissé, pièces livrées, motif, code-barres de remplacement.
 *
 * Tous les champs sont optionnels, et c'est délibéré. La charge utile est
 * réinitialisée à chaque ouverture de fiche, puis se remplit au fil du
 * formulaire ; un formulaire d'action n'est jamais « complet ». Elle est
 * volontairement typée : l'ancien `any` autorisait `setActionPayload(null)`,
 * et une seule lecture non protégée suffisait à faire tomber la fiche entière
 * sur une exception. Le type rend désormais cet état impossible à écrire.
 */
type ActionPayload = Partial<PackageDto> & {
  driverId?: string;
  driverName?: string;
  amount?: number;
  cancellationReason?: string;
  customerNote?: string;
  deliveredDescription?: string;
  financialDifference?: string | number;
  newPackageBarcode?: string;
  note?: string;
  notes?: string;
  oldPackageBarcode?: string;
  reason?: string;
  rescheduledDate?: string;
  returnedDescription?: string;
  returnedItemSummary?: string;
  /** Description libre des éléments ramenés, pas un compte. */
  returnedItems?: string;
  returnedQuantity?: number;
};

export function ColisManagementModule({ currentUser, token, initialColisId = null }: ColisManagementModuleProps) {
  const { addToast } = useToast();

  // Navigation dans le module Colis
  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'nouveau'>(
    initialColisId ? 'detail' : 'list'
  );
  const [selectedColisId, setSelectedColisId] = useState<string | null>(initialColisId);

  // Ouvert par `/colis/<id>` : en revenant à la liste, l'adresse redevient
  // `/colis`, pour qu'un rechargement ne rouvre pas la fiche quittée.
  useEffect(() => {
    if (viewMode !== 'detail' && window.location.pathname.startsWith('/colis/')) {
      window.history.replaceState(window.history.state, '', '/colis');
    }
  }, [viewMode]);
  const [colis, setColis] = useState<PackageDto | null>(null);
  // Chargement et erreur de la fiche sont distincts : sans cette distinction, un
  // échec de lecture et une fiche encore en vol se rendent de la même façon, et
  // l'écran de détail affiche un aplat blanc — sans message, sans « Réessayer »,
  // sans issue.
  const [chargementFiche, setChargementFiche] = useState(false);
  const [erreurFiche, setErreurFiche] = useState<string | null>(null);

  // Liste et filtres serveur
  const [packages, setPackages] = useState<PackageDto[]>([]);
  const [totalPackages, setTotalPackages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  // La frappe est différée avant d'être appliquée : sans cela, chaque caractère
  // relançait une requête serveur, et l'opérateur voyait défiler le tableau
  // sous ses doigts pendant qu'il finissait de taper un numéro de suivi.
  const searchTermApplique = useDifferee(searchTerm, 300);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [cityFilter, setCityFilter] = useState('ALL');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [zonesOptions, setZonesOptions] = useState<ZoneDto[]>([]);
  const [driverFilter, setDriverFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Sous 640 px, le tableau cède la place à des fiches. La bascule reste
  // offered à l'utilisateur au-dessus de cette largeur : la réponse dépend de ce
  // qu'il cherche — une ligne à comparer à une autre, ou dix lignes à parcourir.
  const [enFiches, setEnFiches] = useState(false);

  // Modales d'actions opérationnelles
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [suggestionsZone, setSuggestionsZone] = useState<DriverSuggestions | null>(null);
  const [showDeliverModal, setShowDeliverModal] = useState(false);
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Formulaire d'action
  const [actionPayload, setActionPayload] = useState<ActionPayload>({});
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  /** Libellé humain d'un statut, pour le résumé de filtres. */
  const LIBELLE_STATUT: Record<string, string> = {
    CREE: 'créé',
    RECU_DEPOT: 'reçu au dépôt',
    AFFECTE_RUNSHEET: 'affecté à une tournée',
    EN_COURS_LIVRAISON: 'en cours de livraison',
    LIVRE: 'livré',
    LIVRAISON_PARTIELLE: 'livraison partielle',
    REPORTE: 'reporté',
    RETOUR_DEPOT: 'retour dépôt',
    ANNULE: 'annulé',
  };

  /** Un filtre est posé dès qu'un critère s'écarte de sa valeur neutre. */
  const hasFiltres =
    Boolean(searchTerm) ||
    statusFilter !== 'ALL' ||
    cityFilter !== 'ALL' ||
    zoneFilter !== 'ALL' ||
    driverFilter !== 'ALL' ||
    typeFilter !== 'ALL' ||
    paymentStatusFilter !== 'ALL' ||
    Boolean(dateFilter);

  const reinitialiserFiltres = () => {
    setSearchTerm('');
    setStatusFilter('ALL');
    setCityFilter('ALL');
    setZoneFilter('ALL');
    setDriverFilter('ALL');
    setTypeFilter('ALL');
    setPaymentStatusFilter('ALL');
    setDateFilter('');
    setCurrentPage(1);
  };

  /**
   * Les filtres en cours, en clair.
   *
   * Un menu déroulant qui affiche « Tous les statuts » ne dit pas qu'un statut
   * est posé. Énumérer les filtres actifs est le seul moyen de savoir *lequel*,
   * et de comprendre pourquoi le tableau est vide.
   */
  const resumeFiltres = [
    searchTerm ? `recherche « ${searchTerm} »` : null,
    statusFilter !== 'ALL' ? `statut ${LIBELLE_STATUT[statusFilter] ?? statusFilter}` : null,
    cityFilter !== 'ALL' ? `gouvernorat ${cityFilter}` : null,
    zoneFilter !== 'ALL' ? `zone ${zonesOptions.find((z) => z.id === zoneFilter)?.name ?? ''}` : null,
    driverFilter !== 'ALL' ? `livreur ${driverFilter}` : null,
    typeFilter !== 'ALL' ? `type ${typeFilter}` : null,
    paymentStatusFilter !== 'ALL' ? `paiement ${paymentStatusFilter}` : null,
    dateFilter ? `le ${dateFilter}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Bilan de la livraison partielle, recalculé à chaque frappe.
  //
  // Le montant repris est le reliquat du dû : c'est un calcul que le
  // navigateur fait ici pour l'afficher, mais c'est l'API qui l'écrit et qui
  // refuse un bilan qui ne se referme pas. L'affichage évite au livreur
  // l'aller-retour d'un refus qu'il allait de toute façon provoquer.
  const collectedForBalance = Number(actionPayload.collectedAmount) || 0;
  const balanceReturned = Math.max(0, (colis?.totalPrice ?? 0) - collectedForBalance);
  const balanceReturnedPieces = Math.max(0, (colis?.pieceCount ?? 0) - (Number(actionPayload.deliveredPieces) || 0));
  const balanceIsClosed =
    Math.abs(collectedForBalance + balanceReturned - (colis?.totalPrice ?? 0)) < 0.001;

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
    isFragile: false,
    notes: '',
    // Saisie par l'exploitation : expéditeur pour le compte duquel le colis
    // est créé. Ignoré par l'API pour un compte expéditeur.
    shipperId: '',
  });
  const delegationsConnues = useDelegationsConnues(newColisForm.governorate);

  // Un compte sans expéditeur (exploitation) doit en désigner un.
  const saisiePourExpediteur = !currentUser.shipperId;
  const [expediteurs, setExpediteurs] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    if (!saisiePourExpediteur || viewMode !== 'nouveau' || expediteurs.length > 0) return;
    shippersApi
      .list({ status: 'actif', limit: 200 })
      .then((page) =>
        setExpediteurs(
          page.items
            .filter((s) => s.isActive)
            .map((s) => ({ id: s.id, label: `${s.brandName || s.companyName} (${s.code})` }))
        )
      )
      .catch(() => setExpediteurs([]));
  }, [saisiePourExpediteur, viewMode, expediteurs.length]);

  /*
   * Livreurs proposés à l'affectation.
   *
   * La liste était écrite en dur dans le composant, avec des identifiants
   * (`drv-001`) qui n'existent dans aucune table. Le serveur résout le livreur
   * par `driver.findUnique({ id })` : chaque affectation renvoyait donc « Livreur
   * introuvable », et l'opérateur choisissait parmi quatre noms qui n'étaient
   * pas les siens. Les livreurs viennent maintenant de l'API, à partir d'une
   * recherche : il n'existe pas d'endpoint de flotte, mais la recherche globale
   * interroge la table des livreurs.
   */
  const [rechercheLivreur, setRechercheLivreur] = useState('');
  const [livreursTrouves, setLivreursTrouves] = useState<
    { id: string; driverCode: string; fullName: string; packagesCount: number }[]
  >([]);
  const [chargementLivreurs, setChargementLivreurs] = useState(false);
  /** Tournée active du livreur choisi, proposée avec l'affectation. */
  const [tourneeActive, setTourneeActive] = useState<{
    runsheetNumber: string;
    tourDate: string;
  } | null>(null);

  // La recherche est relue depuis l'URL au montage : c'est ce qui rend
  // l'écran relisible par un lien, et ce qui permet aux autres écrans d'y mener
  // par « ouvrir ce colis » au lieu d'une route qui n'existe pas.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const depuisUrl = query.get('tracking');
    if (depuisUrl) setSearchTerm(depuisUrl);
    // `/colis?zone=<id>` : ouvert depuis l'écran des zones.
    const zone = query.get('zone');
    if (zone) setZoneFilter(zone);
    void zonesApi
      .list({ active: 'true' })
      .then(setZonesOptions)
      .catch(() => setZonesOptions([]));
  }, []);

  /*
   * Recherche des livreurs réels, différée.
   *
   * L'API de recherche globale n'accepte que deux caractères au minimum : sans
   * minimum imposé côté interface, la saisie d'un seul caractère renvoyait
   * « aucun livreur », ce que l'opérateur lisait comme une flotte vide.
   */
  useEffect(() => {
    const terme = rechercheLivreur.trim();
    if (terme.length < 2) {
      setLivreursTrouves([]);
      return;
    }
    let annule = false;
    const minuteur = setTimeout(async () => {
      setChargementLivreurs(true);
      try {
        const resultat = await searchApi.global(terme);
        if (!annule) setLivreursTrouves(resultat.drivers);
      } catch {
        if (!annule) setLivreursTrouves([]);
      } finally {
        if (!annule) setChargementLivreurs(false);
      }
    }, 300);
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [rechercheLivreur]);

  // La tournée active du livreur sélectionné accompagne l'affectation : elle
  // existe déjà côté serveur, et l'affectation y rattache le colis.
  useEffect(() => {
    if (!actionPayload.driverId) {
      setTourneeActive(null);
      return;
    }
    let annule = false;
    void (async () => {
      try {
        const tournee = await runsheetsApi.driverActive(actionPayload.driverId as string);
        if (!annule && tournee) {
          setTourneeActive({
            runsheetNumber: tournee.runsheetNumber,
            tourDate: tournee.tourDate,
          });
        }
      } catch {
        // Un livreur sans tournée active n'est pas une erreur : l'affectation
        // reste possible, le colis sera rattaché plus tard.
        if (!annule) setTourneeActive(null);
      }
    })();
    return () => {
      annule = true;
    };
  }, [actionPayload.driverId]);

  // Chargement des colis. Chaque appel porte un numéro : seule la réponse du
  // dernier est affichée. Sans cela, une réponse lente d'un filtre précédent
  // (ex. ouverture par `/colis?zone=…`, où le filtre arrive juste après le
  // premier chargement) écrasait la liste filtrée.
  const derniereRequete = useRef(0);
  const loadPackages = async () => {
    const numero = ++derniereRequete.current;
    const perimee = () => numero !== derniereRequete.current;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
      });
      if (searchTermApplique) params.append('search', searchTermApplique);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (cityFilter !== 'ALL') params.append('city', cityFilter);
      if (zoneFilter !== 'ALL') params.append('zone', zoneFilter);
      if (driverFilter !== 'ALL') params.append('driver', driverFilter);
      if (typeFilter !== 'ALL') params.append('type', typeFilter);
      if (paymentStatusFilter !== 'ALL') params.append('paymentStatus', paymentStatusFilter);
      if (dateFilter) params.append('date', dateFilter);

      const res = await fetch(`/api/v1/packages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (perimee()) return;
      if (!res.ok || !data.success) {
        // Une réponse 401 ou 500 n'est pas un cas muet : sans ce contrôle, le
        // squelette disparaissait, aucun message n'apparaissait, et l'opérateur
        // lisait les lignes du chargement précédent comme si elles étaient
        // fraîches — ou un « aucun colis » qui en était un.
        setError(
          data.message ??
            (res.status === 401
              ? 'Session expirée. Reconnectez-vous pour retrouver la liste des colis.'
              : "Le serveur n'a pas pu renvoyer les colis. Réessayez.")
        );
        setPackages([]);
        return;
      }
      setError(null);
      setPackages(data.data);
      setTotalPackages(data.meta?.total ?? data.data.length);
    } catch {
      if (perimee()) return;
      setPackages([]);
      setError('Impossible de joindre le serveur RUNEX. Vérifiez votre connexion.');
    } finally {
      if (!perimee()) setIsLoading(false);
    }
  };

  // Chargement de la fiche d'un colis précis
  const loadColisDetails = async (id: string) => {
    // La fiche précédente est vidée avant le fetch. Sans cela, passer d'un colis
    // à un autre affichait le contenu de A sous le titre de B pendant toute la
    // requête — et, en cas d'échec, le gardait définitivement.
    setColis(null);
    // La charge utile est vidée, pas mise à null : les formulaires d'action la
    // lisent pendant que la fiche se recharge, et un `null` suffisait à faire
    // tomber la fiche sur une exception au premier rendu.
    setActionPayload({});
    setChargementFiche(true);
    setErreurFiche(null);
    try {
      const res = await fetch(`/api/v1/packages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErreurFiche(data.message ?? "Ce colis n'a pas pu être chargé.");
        return;
      }
      setColis(data.data);
      setActionPayload(data.data);
    } catch {
      setErreurFiche('Impossible de joindre le serveur RUNEX. Vérifiez votre connexion.');
    } finally {
      setChargementFiche(false);
    }
  };

  useEffect(() => {
    loadPackages();
  }, [
    currentPage,
    pageSize,
    statusFilter,
    cityFilter,
    zoneFilter,
    driverFilter,
    typeFilter,
    paymentStatusFilter,
    dateFilter,
    // `searchTerm` manque ici : la recherche lit la valeur au moment du fetch,
    // mais ne déclenchait aucun fetch. Déjà en page 1 — donc après une
    // recherche — `setCurrentPage(1)` ne changeait rien, et l'utilisateur
    // tapait un numéro de suivi sans jamais rien voir bouger.
    searchTermApplique,
  ]);

  useEffect(() => {
    if (selectedColisId) {
      loadColisDetails(selectedColisId);
    }
  }, [selectedColisId]);

  // Fenêtre d'affectation : livreurs de la zone du colis.
  useEffect(() => {
    if (!showAssignModal || !colis) {
      setSuggestionsZone(null);
      return;
    }
    let actif = true;
    zonesApi
      .driverSuggestions(colis.id)
      .then((r) => actif && setSuggestionsZone(r))
      .catch(() => actif && setSuggestionsZone(null));
    return () => {
      actif = false;
    };
  }, [showAssignModal, colis]);

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

          <div className="px-4 sm:px-6 space-y-4">
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
              resume={resumeFiltres}
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
              <div className="w-full sm:w-64">
                <SearchInput
                  libelle="Rechercher un colis par numéro de suivi, destinataire ou ville"
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
                options={[{ label: 'Tous', value: 'ALL' }, ...GOUVERNORATS.map((g) => ({ label: g, value: g }))]}
              />

              <FilterSelect
                label="Zone"
                selectedValue={zoneFilter}
                onChange={(val) => {
                  setZoneFilter(val);
                  setCurrentPage(1);
                }}
                options={[
                  { label: 'Toutes', value: 'ALL' },
                  ...zonesOptions
                    .filter((z) => cityFilter === 'ALL' || z.governorate === cityFilter)
                    .map((z) => ({ label: `${z.name} (${z.governorate})`, value: z.id })),
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
            {error ? (
              <ErrorState
                message={error}
                onRetry={loadPackages}
                title="La liste des colis n'a pas pu être chargée"
              />
            ) : isLoading ? (
              <>
                <ChargementEnCours message="Chargement des colis" />
                <SkeletonTable rows={5} cols={7} />
              </>
            ) : packages.length === 0 ? (
              hasFiltres ? (
                /* Filtré à vide et réellement vide ne sont pas la même chose. On
                   propose de revoir les filtres dans un cas, et de créer un
                   colis dans l'autre : proposer « Nouveau colis » à quelqu'un
                   dont la recherche est trop restrictive est le contre-sens le
                   plus courant d'un état vide. */
                <EmptyState
                  title="Aucun colis ne correspond à ces filtres"
                  description={`${totalPackages === 0 ? 'Aucune donnée' : 'Le périmètre a été ramené à zéro'} — ${resumeFiltres}. Élargissez la période ou retirez un filtre pour retrouver des colis.`}
                  action={
                    <button
                      type="button"
                      onClick={reinitialiserFiltres}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Réinitialiser les filtres</span>
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="Aucun colis enregistré"
                  description="Les colis créés par vos expéditeurs apparaîtront ici, avec leur statut et leur montant."
                  action={
                    <button
                      type="button"
                      onClick={() => setViewMode('nouveau')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Nouveau Colis</span>
                    </button>
                  }
                />
              )
            ) : (
              <>
                <div className="flex justify-end">
                  <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
                </div>

                {/* Fiches : la seule disposition lisible sur un téléphone, où
                    huit colonnes n'ont plus aucune largeur possible. */}
                {enFiches && (
                  <div className="sm:hidden bg-white border border-slate-200 rounded-lg overflow-hidden">
                    {packages.map((pkg) => {
                      const badge = PACKAGE_STATUS_MAP[pkg.status] ?? {
                        label: pkg.status,
                        bg: 'bg-slate-100',
                        text: 'text-slate-800',
                        border: 'border-slate-300',
                      };
                      return (
                        <FicheLigne
                          key={pkg.id}
                          titre={pkg.customerName}
                          identifiant={pkg.trackingNumber}
                          sousTitre={`${pkg.governorate}${pkg.assignedDriverName ? ` · ${pkg.assignedDriverName}` : ''}`}
                          onClick={() => {
                            setSelectedColisId(pkg.id);
                            setViewMode('detail');
                          }}
                          action={
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                              {badge.label}
                            </span>
                          }
                          champs={[
                            { libelle: 'Téléphone', valeur: pkg.customerPhone },
                            { libelle: 'Montant', valeur: formatTND(pkg.totalPrice), numerique: true },
                            { libelle: 'Expéditeur', valeur: pkg.shipperName },
                            { libelle: 'Code-barres', valeur: pkg.barcode },
                          ]}
                        />
                      );
                    })}
                  </div>
                )}

                <div className={enFiches ? 'hidden sm:block' : ''}>
                <Table libelle="Colis" largeurMin="880px">
                  <Thead>
                    <tr>
                      <Th figee>Colis / Code</Th>
                      <Th>Destinataire</Th>
                      <Th priorite="secondaire">Expéditeur</Th>
                      <Th priorite="secondaire">Livreur Assigné</Th>
                      <Th align="right">Montant (DT)</Th>
                      <Th align="center">Statut</Th>
                      <Th priorite="tertiaire">Destination</Th>
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
                          resume={`Colis ${pkg.trackingNumber}, ${pkg.customerName}, ${badge.label}, ${formatTND(pkg.totalPrice)}`}
                        >
                          <Td figee>
                            <span className="font-mono font-bold text-red-600 block">{pkg.trackingNumber}</span>
                            <span className="text-[11px] text-slate-500 font-mono">{pkg.barcode}</span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 block">{pkg.customerName}</span>
                            <span className="text-slate-500 font-mono text-[11px] flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-500" />
                              {pkg.customerPhone}
                            </span>
                          </Td>
                          <Td priorite="secondaire">
                            <span className="font-medium text-slate-800">{pkg.shipperName}</span>
                          </Td>
                          <Td priorite="secondaire">
                            <span className="text-slate-700 font-medium">
                              {pkg.assignedDriverName || <span className="text-slate-500 italic">Non assigné</span>}
                            </span>
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
                          {/* Même ordre que l'en-tête : la destination est la dernière colonne. */}
                          <Td priorite="tertiaire">
                            <span className="font-semibold text-slate-800 block">
                              {pkg.governorate}
                              {pkg.delegation ? ` · ${pkg.delegation}` : ''}
                            </span>
                            <span className="text-slate-500 text-[11px] truncate max-w-xs block">{pkg.address}</span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
                </div>

                <Pagination
                  currentPage={currentPage}
                  totalPages={Math.ceil(totalPackages / pageSize)}
                  totalItems={totalPackages}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  libelle="colis"
                />
              </>
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
                  {saisiePourExpediteur && (
                    <div className="sm:col-span-2">
                      <FormField label="Expéditeur (compte client) *" required>
                        <Select
                          required
                          value={newColisForm.shipperId}
                          onChange={(e) => setNewColisForm({ ...newColisForm, shipperId: e.target.value })}
                        >
                          <option value="">— Choisir l'expéditeur —</option>
                          {expediteurs.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </div>
                  )}
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
                      {GOUVERNORATS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="Délégation / Cité *" required>
                    <Input
                      required
                      list="delegations-connues-ops"
                      value={newColisForm.delegation}
                      onChange={(e) => setNewColisForm({ ...newColisForm, delegation: e.target.value })}
                      placeholder="Ex: Hammam Lif, Ennadhour..."
                    />
                    <datalist id="delegations-connues-ops">
                      {delegationsConnues.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                    {newColisForm.delegation.trim() !== '' &&
                      !estZoneConnue(delegationsConnues, newColisForm.delegation) && (
                        <p className="mt-1 text-[11px] text-sky-700">
                          Nouvelle zone : « {newColisForm.delegation.trim()} » sera ajoutée à la liste des zones à
                          l’enregistrement.
                        </p>
                      )}
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

                  <div className="sm:col-span-2 flex flex-wrap gap-6">
                    <Checkbox
                      label="Autorisation d'ouverture du colis"
                      checked={newColisForm.allowOpen}
                      onChange={(v) => setNewColisForm({ ...newColisForm, allowOpen: v })}
                    />
                    <Checkbox
                      label="Colis fragile"
                      checked={newColisForm.isFragile}
                      onChange={(v) => setNewColisForm({ ...newColisForm, isFragile: v })}
                    />
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
      {/* Chargement et échec de la fiche. Sans ces deux branches, la vue détail
          ne rendait rien tant que `colis` était null : un échec réseau — ou
          même un clic un peu rapide — donnait un écran entièrement blanc, sans
          message, sans issue, sur l'écran le plus important du module. */}
      {viewMode === 'detail' && !colis && (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-4">
          <button
            type="button"
            onClick={() => {
              setViewMode('list');
              if (selectedColisId) loadColisDetails(selectedColisId);
            }}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Retour à la liste des colis</span>
          </button>

          {chargementFiche ? (
            <>
              <ChargementEnCours message="Chargement de la fiche du colis" />
              <Card>
                <SkeletonTable rows={5} cols={4} />
              </Card>
            </>
          ) : (
            <ErrorState
              title="La fiche n'a pas pu être chargée"
              message={erreurFiche ?? 'Ce colis est introuvable ou momentanément inaccessible.'}
              onRetry={() => selectedColisId && loadColisDetails(selectedColisId)}
            />
          )}
        </div>
      )}

      {viewMode === 'detail' && colis && (
        <div className="space-y-6 max-w-6xl mx-auto px-4 sm:px-6 pb-12">
          {/* Bouton Retour */}
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
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
                <span className="text-[11px] uppercase tracking-wider text-slate-500 block font-semibold">
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
                  // Le livreur du colis est proposé, pas imposé : c'est le choix
                  // explicite de l'opérateur qui affecte, jamais la fiche en cache.
                  setActionPayload({
                    driverId: colis?.assignedDriverId,
                    driverName: colis?.assignedDriverName,
                    runsheetNumber: colis?.runsheetNumber,
                  });
                  setRechercheLivreur('');
                  setLivreursTrouves([]);
                  setTourneeActive(null);
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
                      deliveredDescription: '',
                      returnedDescription: '',
                      reason: `Le client ne garde que 1 pièce sur ${colis.pieceCount}`,
                      driverNote: '',
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
                    // Le code de l'article repris est pré-rempli à partir du
                    // colis : quand le client rend le colis entier, c'est ce
                    // code qui revient. Le livreur le remplace s'il ne rend
                    // qu'une pièce.
                    oldPackageBarcode: colis.barcode || colis.trackingNumber,
                    returnedItemSummary: '',
                    newPackageBarcode: '',
                    financialDifference: 0,
                    note: '',
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
                      driverNote: '',
                      customerNote: '',
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
                    setActionPayload({
                      reason: 'Refus de commande par le destinataire',
                      // Un retour porte d'ordinaire sur tout le colis : la
                      // quantité et le montant sont donc pré-remplis par ce
                      // que le livreur ramène réellement, et restent
                      // modifiables.
                      returnedItems: '',
                      returnedQuantity: colis.pieceCount,
                      amount: colis.collectedAmount ?? 0,
                      driverName: colis.assignedDriverName,
                    });
                    setShowReturnModal(true);
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retour Dépôt</span>
                </button>
              )}

              {/* Bon de livraison : l'étiquette collée sur chaque pièce */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    imprimerBonsLivraison([await colisApi.bonLivraison(colis.id)]);
                  } catch (err) {
                    addToast({ type: 'error', title: 'Impression impossible', message: err instanceof Error ? err.message : undefined });
                  }
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Bon de livraison</span>
              </button>

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
                  <span className="text-slate-500 block text-[11px]">Nom complet :</span>
                  <span className="font-bold text-slate-900 text-sm">{colis.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Numéro de téléphone :</span>
                  <span className="font-mono font-bold text-slate-800 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-red-600" />
                    {colis.customerPhone}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Gouvernorat & Délégation :</span>
                  <span className="font-semibold text-slate-800">{colis.governorate}, {colis.delegation}</span>
                </div>
                {colis.zoneName && (
                  <div>
                    <span className="text-slate-500 block text-[11px]">Zone de livraison :</span>
                    <a
                      href={`/colis?zone=${colis.zoneId}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-800 text-xs font-semibold hover:bg-sky-100"
                    >
                      {colis.zoneName}
                    </a>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block text-[11px]">Adresse exacte de livraison :</span>
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
                  <span className="text-slate-500 block text-[11px]">Compte Expéditeur :</span>
                  <span className="font-bold text-slate-900 text-sm">{colis.shipperName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Contact & Téléphone :</span>
                  <span className="font-mono font-semibold text-slate-800 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-500" />
                    +216 58 199 108
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Agence de Dépôt Actuelle :</span>
                  <span className="font-semibold text-slate-800">{colis.currentDepositName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Statut Règlement Facturation :</span>
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
                  <span className="text-slate-500 block text-[11px]">Livreur Assigné :</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {colis.assignedDriverName || <span className="text-slate-500 italic">Non assigné</span>}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Feuille de Tournée (Runsheet) :</span>
                  <span className="font-mono font-bold text-red-600">
                    {colis.runsheetNumber || 'Aucune runsheet'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Date prévue de livraison :</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {colis.expectedDeliveryDate || 'Aujourd\'hui'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Nombre de tentatives :</span>
                  <span className="font-mono font-bold">{colis.deliveryAttempts?.length || 0} passage(s)</span>
                </div>
              </div>
            </Card>

            {/* E. CONTENT */}
            <Card title="Contenu & Colisage (Content)">
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Description du contenu :</span>
                  <p className="p-2 bg-slate-50 rounded border border-slate-200 text-slate-800 font-medium">
                    {colis.contentSummary}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500 block text-[11px]">Nombre de pièces :</span>
                    <span className="font-mono font-bold text-slate-900">{colis.pieceCount} pièce(s)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Gabarit :</span>
                    <span className="font-medium text-slate-800">{colis.sizeCategory}</span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Ouverture colis :</span>
                  <Badge variant={colis.allowOpen ? 'success' : 'default'}>
                    {colis.allowOpen ? 'Ouverture Autorisée' : 'Ouverture Interdite'}
                  </Badge>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Fragile :</span>
                  <Badge variant={colis.isFragile ? 'warning' : 'default'}>{colis.isFragile ? 'Fragile' : 'Non'}</Badge>
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
                        <span className="text-[11px] font-mono text-slate-500">
                          {new Date(item.timestamp).toLocaleString('fr-TN')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-600">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          <strong>{item.location}</strong>
                        </span>
                        {item.actor && (
                          <span className="flex items-center gap-1 text-slate-500">
                            <User className="w-3 h-3 text-slate-500" />
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
                      <span className="text-[11px] text-slate-500 font-mono">
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
                disabled={isSubmittingAction || !actionPayload.driverId}
                aria-busy={isSubmittingAction}
                onClick={() =>
                  executeColisAction(
                    'assign',
                    {
                      driverId: actionPayload.driverId,
                      driverName: actionPayload.driverName,
                      ...(actionPayload.runsheetNumber
                        ? { runsheetNumber: actionPayload.runsheetNumber }
                        : {}),
                    },
                    `Colis assigné à ${actionPayload.driverName} avec succès`
                  )
                }
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold flex items-center gap-1.5"
              >
                {isSubmittingAction && <Spinner size="sm" className="text-white" />}
                <span>Confirmer l'assignation</span>
              </button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Livreurs qui couvrent la zone du colis : proposés en premier. */}
            {suggestionsZone && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
                <p className="font-semibold text-sky-900">
                  {suggestionsZone.zone
                    ? `Livreurs de la zone ${suggestionsZone.zone.name}`
                    : 'Ce colis n’a pas encore de zone'}
                </p>
                {suggestionsZone.zone && suggestionsZone.drivers.filter((d) => d.coversZone).length === 0 ? (
                  <p className="mt-1 text-[11px] text-sky-800">
                    Aucun livreur ne couvre cette zone pour l’instant. Rattachez-en un dans « Zones de livraison »,
                    ou cherchez ci-dessous.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggestionsZone.drivers
                      .filter((d) => d.coversZone)
                      .map((d) => {
                        const choisi = actionPayload.driverId === d.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            aria-pressed={choisi}
                            onClick={() => {
                              setActionPayload({
                                ...actionPayload,
                                driverId: d.id,
                                driverName: d.fullName,
                                runsheetNumber: undefined,
                              });
                              setRechercheLivreur(d.fullName);
                              setLivreursTrouves([]);
                            }}
                            className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition ${
                              choisi
                                ? 'bg-slate-900 border-slate-900 text-white'
                                : 'bg-white border-sky-300 text-sky-900 hover:bg-sky-100'
                            }`}
                          >
                            {d.fullName} · {d.driverCode}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
            {/* Le livreur se choisit dans la flotte réelle. Aucune valeur n'est
                pré-remplie : ouvrir la fenêtre puis confirmer sans choisir
                affectait le colis au premier nom d'une liste inventée. */}
            <FormField
              label="Rechercher le livreur"
              required
              helpText="Deux caractères au minimum : le nom ou le matricule suffit."
            >
              <Input
                value={rechercheLivreur}
                onChange={(e) => setRechercheLivreur(e.target.value)}
                placeholder="Ex : Hamza, ou son matricule"
                autoComplete="off"
                role="combobox"
                aria-expanded={livreursTrouves.length > 0}
                aria-controls="liste-livreurs"
              />
            </FormField>

            {chargementLivreurs && (
              <p className="text-[11px] text-slate-500">Recherche des livreurs…</p>
            )}

            {!chargementLivreurs &&
              rechercheLivreur.trim().length >= 2 &&
              livreursTrouves.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  Aucun livreur ne correspond à « {rechercheLivreur.trim()} ». L'affectation
                  exige un livreur enregistré dans la flotte.
                </p>
              )}

            {livreursTrouves.length > 0 && (
              <ul id="liste-livreurs" role="listbox" aria-label="Livreurs trouvés" className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {livreursTrouves.map((driver) => {
                  const choisi = actionPayload.driverId === driver.id;
                  return (
                    <li key={driver.id} role="option" aria-selected={choisi}>
                      <button
                        type="button"
                        onClick={() => {
                          setActionPayload({
                            ...actionPayload,
                            driverId: driver.id,
                            driverName: driver.fullName,
                            // La tournée du nouveau livreur remplace celle du
                            // précédent : les conserver ensemble aurait rattaché
                            // le colis à la tournée d'un autre chauffeur.
                            runsheetNumber: undefined,
                          });
                          setRechercheLivreur(driver.fullName);
                          setLivreursTrouves([]);
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 ${
                          choisi ? 'bg-slate-100' : ''
                        }`}
                      >
                        <span className="font-semibold text-slate-900">{driver.fullName}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {driver.driverCode} · {driver.packagesCount} colis
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {actionPayload.driverName && (
              <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                Livreur sélectionné : {actionPayload.driverName}. Sans tournée, le colis reste en
                attente d'affectation à une tournée.
              </p>
            )}

            <FormField
              label="Tournée de rattachement (facultatif)"
              helpText={
                tourneeActive
                  ? `Tournée active de ${actionPayload.driverName} : ${tourneeActive.runsheetNumber}`
                  : "Laisser vide si le livreur n'a pas de tournée ouverte aujourd'hui."
              }
            >
              <Select
                value={actionPayload.runsheetNumber ?? ''}
                onChange={(e) =>
                  setActionPayload({
                    ...actionPayload,
                    runsheetNumber: e.target.value || undefined,
                  })
                }
              >
                <option value="">Aucune tournée — affectation seule</option>
                {tourneeActive && <option value={tourneeActive.runsheetNumber}>{tourneeActive.runsheetNumber}</option>}
              </Select>
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

            <p className="text-[11px] text-slate-500">
              {actionPayload.deliveredPieces || 0} pièce(s) livrée(s),{' '}
              {Math.max(0, (colis?.pieceCount ?? 0) - (actionPayload.deliveredPieces || 0))} pièce(s) reprise(s)
              {' — soit la totalité du colis, aucune ne peut rester sans suite.'}
            </p>

            <FormField label="Montant recalculé et encaissé (TND) *" required>
              <Input
                type="number"
                step="0.001"
                value={actionPayload.collectedAmount}
                onChange={(e) => setActionPayload({ ...actionPayload, collectedAmount: parseFloat(e.target.value) || 0 })}
                className="font-mono font-bold text-sm text-cyan-800"
              />
            </FormField>

            {/* Le bilan s'affiche pendant la saisie, pas au retour de l'API :
                une erreur de balance se corrige sur place, alors qu'un refus
                de l'API se découvre au dépôt, colis parti. */}
            <div
              className={`rounded-md border px-3 py-2 text-[11px] space-y-0.5 ${
                balanceIsClosed
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <p className="font-semibold">Bilan de l'opération</p>
              <p>
                {(actionPayload.collectedAmount || 0).toFixed(3)} DT encaissés +{' '}
                {balanceReturned.toFixed(3)} DT repris ={' '}
                {(collectedForBalance + balanceReturned).toFixed(3)} DT, pour un montant dû de{' '}
                {(colis?.totalPrice ?? 0).toFixed(3)} DT.
              </p>
              <p>
                {actionPayload.deliveredPieces || 0} + {balanceReturnedPieces} ={' '}
                {colis?.pieceCount} pièces.
              </p>
              {!balanceIsClosed && (
                <p className="font-medium">
                  Le bilan ne se referme pas encore : il manque{' '}
                  {((colis?.totalPrice ?? 0) - collectedForBalance - balanceReturned).toFixed(3)} DT.
                </p>
              )}
            </div>

            <FormField
              label="Contenu réellement livré au client *"
              helpText="Décrivez ce que le client a reçu, pas le nombre de pièces compté plus haut."
              required
            >
              <Textarea
                rows={2}
                value={actionPayload.deliveredDescription || ''}
                onChange={(e) =>
                  setActionPayload({ ...actionPayload, deliveredDescription: e.target.value })
                }
                placeholder="Ex: Une robe bleue taille M, emballage d'origine ouvert..."
              />
            </FormField>

            <FormField
              label="Contenu repris en livraison partielle *"
              helpText="Ce qui repart au dépôt avec le livreur, sera restitué plus tard."
              required
            >
              <Textarea
                rows={2}
                value={actionPayload.returnedDescription || ''}
                onChange={(e) =>
                  setActionPayload({ ...actionPayload, returnedDescription: e.target.value })
                }
                placeholder="Ex: Une robe verte taille L sous housse, pliée dans le carton..."
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
            <div className="rounded-md bg-purple-50 border border-purple-200 px-3 py-2 space-y-0.5">
              <p className="font-semibold text-purple-900">
                Colis d'origine #{colis?.trackingNumber} — {colis?.customerName}
              </p>
              <p className="text-purple-700">
                {colis?.pieceCount} pièce(s) · {colis?.totalPrice?.toFixed(3)} DT à encaisser
              </p>
            </div>

            <FormField
              label="Article repris chez le client *"
              helpText="Décrivez l'article rendu. S'il s'agit du colis entier, le code ci-dessus convient."
              required
            >
              <Input
                required
                value={actionPayload.returnedItemSummary || ''}
                onChange={(e) =>
                  setActionPayload({ ...actionPayload, returnedItemSummary: e.target.value })
                }
                placeholder="Ex: Chaussures pointure 42 rouge (boîte d'origine)"
              />
            </FormField>

            <FormField label="Code-barres de l'article repris *" required>
              <Input
                required
                value={actionPayload.oldPackageBarcode || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, oldPackageBarcode: e.target.value })}
                className="font-mono font-bold text-purple-700"
              />
            </FormField>

            <FormField
              label="Code-barres de l'article de remplacement *"
              helpText="Le colis remis au client en remplacement."
              required
            >
              <Input
                required
                value={actionPayload.newPackageBarcode || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, newPackageBarcode: e.target.value })}
                placeholder="Scan du colis de remplacement"
                className="font-mono font-bold text-purple-700"
              />
            </FormField>

            <FormField
              label="Écart financier (TND)"
              helpText="À payer si le remplacement vaut plus, à Rembourser s'il vaut moins. 0 si l'échange est à valeur égale."
            >
              <Input
                type="number"
                step="0.001"
                value={actionPayload.financialDifference ?? 0}
                onChange={(e) =>
                  setActionPayload({
                    ...actionPayload,
                    financialDifference: parseFloat(e.target.value) || 0,
                  })
                }
                className="font-mono font-bold"
              />
            </FormField>

            <p className="text-[11px] text-slate-500">
              {Number(actionPayload.financialDifference ?? 0) === 0
                ? 'Échange à valeur égale : aucun écart financier.'
                : Number(actionPayload.financialDifference) > 0
                  ? `Le client doit ajouter ${Number(actionPayload.financialDifference).toFixed(3)} DT.`
                  : `${Math.abs(Number(actionPayload.financialDifference)).toFixed(3)} DT sont à rembourser au client.`}
            </p>

            <FormField label="Note interne">
              <Textarea
                rows={2}
                value={actionPayload.note || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, note: e.target.value })}
                placeholder="Ex: Article d'origine defectueux, photos prises avant reprise."
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
                value={actionPayload.rescheduledDate || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, rescheduledDate: e.target.value })}
              />
            </FormField>

            <FormField
              label="Note tournée"
              helpText="Ce que le livreur retient pour ajuster la feuille de route. Visible en interne."
            >
              <Textarea
                rows={2}
                value={actionPayload.driverNote || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, driverNote: e.target.value })}
                placeholder="Ex: Client absent à 16h, passage à re-planifier le surlendemain."
              />
            </FormField>

            <FormField
              label="Message au client"
              helpText="Ce que le client sera informé. C'est la promesse qui sera rappelée à la prochaine tentative."
            >
              <Textarea
                rows={2}
                value={actionPayload.customerNote || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, customerNote: e.target.value })}
                placeholder="Ex: Nous repassons chez vous le 14/10 entre 9h et 12h."
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
                value={actionPayload.reason || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, reason: e.target.value })}
              >
                <option value="Refus de commande par le destinataire">Refus de commande par le destinataire</option>
                <option value="Colis non conforme aux attentes client">Colis non conforme aux attentes client</option>
                <option value="Destinataire introuvable après 3 passages">Destinataire introuvable après 3 passages</option>
                <option value="Annulation par l'expéditeur">Annulation par l'expéditeur</option>
              </Select>
            </FormField>

            <FormField
              label="Éléments repris"
              helpText="Ce que le livreur ramène au dépôt. À renseigner si le retour ne porte pas sur tout le colis."
            >
              <Textarea
                rows={2}
                value={actionPayload.returnedItems || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, returnedItems: e.target.value })}
                placeholder="Ex: 1 carton ouvert, 1 article manquant à l'intérieur."
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Quantité reprise"
                helpText={`Par défaut : les ${colis?.pieceCount} pièces du colis.`}
              >
                <Input
                  type="number"
                  min="1"
                  max={colis?.pieceCount}
                  value={actionPayload.returnedQuantity ?? colis?.pieceCount ?? 1}
                  onChange={(e) =>
                    setActionPayload({
                      ...actionPayload,
                      returnedQuantity: parseInt(e.target.value, 10) || 1,
                    })
                  }
                  className="font-mono font-bold"
                />
              </FormField>

              <FormField
                label="Montant ramené (TND)"
                helpText="Espèces ou spécimen que le livreur rapporte au dépôt."
              >
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={actionPayload.amount ?? 0}
                  onChange={(e) =>
                    setActionPayload({ ...actionPayload, amount: parseFloat(e.target.value) || 0 })
                  }
                  className="font-mono font-bold"
                />
              </FormField>
            </div>

            <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-800 space-y-0.5">
              <p>
                Le retour sera enregistré au dépôt et rattaché à{' '}
                <span className="font-semibold">{actionPayload.driverName || 'votre tournée'}</span>.
              </p>
              <p>
                {actionPayload.returnedQuantity ?? colis?.pieceCount} pièce(s) reprise(s) pour{' '}
                {(actionPayload.amount ?? 0).toFixed(3)} DT.
              </p>
            </div>
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
              <div className="col-span-2 flex flex-wrap gap-6">
                <Checkbox
                  label="Autorisation d'ouverture du colis"
                  checked={Boolean(actionPayload.allowOpen)}
                  onChange={(v) => setActionPayload({ ...actionPayload, allowOpen: v })}
                />
                <Checkbox
                  label="Colis fragile"
                  checked={Boolean(actionPayload.isFragile)}
                  onChange={(v) => setActionPayload({ ...actionPayload, isFragile: v })}
                />
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
