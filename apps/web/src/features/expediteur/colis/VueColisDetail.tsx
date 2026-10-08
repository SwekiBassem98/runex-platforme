'use client';

/**
 * Fiche d'un colis.
 *
 * Elle rassemble ce que l'API expose réellement sur un colis : l'identification,
 * le destinataire, la livraison, les montants, la chronologie
 * (`trackingTimeline`), les tentatives de passage (`deliveryAttempts`), les
 * retours (`returns`), l'échange (`exchange`) et le journal d'audit.
 *
 * Deux règles de fond.
 *
 * La première : ne rien afficher qui n'existe pas. `paymentStatus` est déclaré
 * dans le type `PackageDto` mais l'API ne le renseigne jamais ; `pickupReference`
 * non plus. Les lire afficherait « undefined » ou une case vide prise pour une
 * valeur absente. Les montants affichés — attendu, encaissé, frais — sont ceux
 * que le serveur renvoie.
 *
 * La deuxième : la chronologie est lue du plus ancien au plus récent. Le
 * serveur les renvoie à l'envers, ce qui est pratique pour un tableau et
 * injuste pour une histoire : on veut lire ce qui s'est passé avant ce qui se
 * passe.
 */

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Banknote,
  Box,
  CheckCircle2,
  Clock,
  MapPin,
  PackageCheck,
  PackageX,
  Pencil,
  Phone,
  Printer,
  ShieldCheck,
  Truck,
  User,
  XCircle,
} from 'lucide-react';
import {
  PackageStatus,
  canShipperCancelOrDelete,
  isFullyEditableByShipper,
  isLockedForEditing,
  type PackageDto,
  type TrackingTimelineEvent,
} from '@logixpress/types';
import {
  Badge,
  Card,
  Checkbox,
  EmptyState,
  ErrorBanner,
  FormField,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@logixpress/ui';
import { annulerColis, lireAuditColis, lireBonsLivraison, lireColis, modifierColis } from '@/features/expediteur/lib/client';
import { imprimerBonsLivraison } from '@/features/colis/bonLivraison';
import { GOUVERNORATS, useVocabulaire, VARIANTE_TYPE } from '@/features/expediteur/lib/libelles';
import { useI18n, type Cle } from '@/i18n';
import { genererHtmlColisUnique, ouvrirImpression } from './impression';

/** Entrée du journal d'audit, telle que l'API la renvoie pour un colis. */
interface EntreeAudit {
  id: string;
  action: string;
  actionLabel?: string;
  category?: string;
  reason?: string | null;
  userName?: string | null;
  userRole?: string | null;
  timestamp: string;
}

export function VueColisDetail({ identifiant }: { identifiant: string }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { t, formatDate, formatDateTime, formatTND, traduireValeur } = useI18n();
  const voc = useVocabulaire();

  const [colis, setColis] = React.useState<PackageDto | null>(null);
  const [audit, setAudit] = React.useState<EntreeAudit[]>([]);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const [edition, setEdition] = React.useState(false);
  const [enregistrement, setEnregistrement] = React.useState(false);
  const [erreurEdition, setErreurEdition] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    customerName: '',
    customerPhone: '',
    governorate: '',
    delegation: '',
    address: '',
    totalPrice: '',
    pieceCount: '',
    notes: '',
    isFragile: false,
  });

  const [confirmationAnnulation, setConfirmationAnnulation] = React.useState(false);
  const [motifAnnulation, setMotifAnnulation] = React.useState('');
  const [annulationEnCours, setAnnulationEnCours] = React.useState(false);

  const charger = React.useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const fiche = await lireColis(identifiant);
      setColis(fiche);
      setForm({
        customerName: fiche.customerName ?? '',
        customerPhone: fiche.customerPhone ?? '',
        governorate: fiche.governorate ?? '',
        delegation: fiche.delegation ?? '',
        address: fiche.address ?? '',
        totalPrice: String(fiche.totalPrice ?? ''),
        pieceCount: String(fiche.pieceCount ?? 1),
        notes: fiche.notes ?? '',
        isFragile: Boolean(fiche.isFragile),
      });
      // Le journal est secondaire : son absence ne doit pas masquer la fiche.
      try {
        const entrees = (await lireAuditColis(identifiant)) as unknown as EntreeAudit[];
        setAudit(Array.isArray(entrees) ? entrees : []);
      } catch {
        setAudit([]);
      }
    } catch (err) {
      setColis(null);
      setErreur(err instanceof Error ? err.message : t('colis.detail.creerEchec'));
    } finally {
      setChargement(false);
    }
  }, [identifiant, t]);

  React.useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
        <Spinner />
        <span className="text-sm">{t('colis.detail.chargement')}</span>
      </div>
    );
  }

  if (erreur || !colis) {
    return (
      <div className="space-y-4">
        <LienRetour />
        <EmptyState
          title={t('colis.detail.indisponible')}
          description={erreur ?? t('colis.detail.inexistant')}
          action={
            <Link
              href="/expediteur/colis"
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition"
            >
              {t('colis.detail.retourListe')}
            </Link>
          }
        />
      </div>
    );
  }

  const badge = voc.statutColis(colis.status);
  const livre = colis.status === PackageStatus.LIVRE;
  const attendu = Number(colis.totalPrice ?? 0);
  const encaisse = Number(colis.collectedAmount ?? 0);
  const reste = Math.max(attendu - encaisse, 0);
  const verrouille = isLockedForEditing(colis.status);
  const annulable = canShipperCancelOrDelete(colis.status);
  /*
   * L'API n'interdit l'édition que sur sept statuts. Le libellé dit ce qui
   * s'applique vraiment : sur un colis antara depot ou en tournée, une
   * modification du montant déclenche une alerte au livreur.
   */
  const modifiable = !verrouille;

  const handleImprimer = () => {
    if (!colis) return;
    const entreprise = colis.shipperName ?? t('coque.entreprise');
    const lang = document.documentElement.lang || 'fr';
    const dir = (document.documentElement.dir as 'ltr' | 'rtl') || 'ltr';
    const html = genererHtmlColisUnique(colis, {
      entreprise,
      langue: lang,
      dir,
      formatTND,
      formatDate,
      formatDateTime,
      traduireStatut: (s) => voc.statutColis(s).label,
      traduireType: (s) => voc.type(s as never),
    });
    ouvrirImpression(html);
  };

  const handleBonLivraison = async () => {
    if (!colis) return;
    try {
      imprimerBonsLivraison(await lireBonsLivraison([colis.id]));
    } catch (e) {
      addToast({ type: 'error', title: t('colis.liste.impressionErreur'), message: e instanceof Error ? e.message : undefined });
    }
  };

  const chronologie = [...(colis.trackingTimeline ?? [])].reverse();
  const tentatives = colis.deliveryAttempts ?? [];

  async function enregistrer(event: React.FormEvent) {
    event.preventDefault();
    setErreurEdition(null);
    setEnregistrement(true);
    try {
      const reponse = await modifierColis(colis!.id, {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        governorate: form.governorate,
        delegation: form.delegation.trim() || undefined,
        address: form.address.trim(),
        totalPrice: Number(form.totalPrice),
        pieceCount: Number(form.pieceCount),
        notes: form.notes.trim(),
        isFragile: form.isFragile,
      });
      if (!reponse.success) {
        setErreurEdition(reponse.message ?? t('colis.detail.erreurEnregistrement'));
        return;
      }
      setEdition(false);
      addToast({
        type: 'success',
        title: t('colis.detail.sauvegardeTitre'),
        message: t('colis.detail.sauvegarde'),
      });
      await charger();
    } catch (err) {
      setErreurEdition(err instanceof Error ? err.message : t('colis.detail.modificationEchec'));
    } finally {
      setEnregistrement(false);
    }
  }

  async function confirmerAnnulation() {
    setAnnulationEnCours(true);
    try {
      const reponse = await annulerColis(colis!.id, motifAnnulation.trim());
      if (!reponse.success) {
        setErreur(reponse.message ?? t('colis.detail.erreurAnnulation'));
        setConfirmationAnnulation(false);
        return;
      }
      addToast({ type: 'warning', title: t('colis.detail.annulationTitre') });
      router.push('/expediteur/colis');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : t('colis.detail.annulationEchec'));
      setConfirmationAnnulation(false);
    } finally {
      setAnnulationEnCours(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <LienRetour />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-mono text-lg sm:text-xl font-bold text-red-600 truncate">
                <span dir="ltr">{colis.trackingNumber}</span>
              </h1>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
              >
                {badge.label}
              </span>
              <Badge variant={VARIANTE_TYPE[colis.packageType] ?? 'default'}>
                {voc.type(colis.packageType)}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              <span dir="ltr">{t('colis.detail.champ.codeBarres')} {colis.barcode} · {t('colis.detail.champ.creeLe')} {formatDateTime(colis.createdAt)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => void handleBonLivraison()}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800 transition cursor-pointer"
            title={t('colis.detail.bonLivraison')}
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            {t('colis.detail.bonLivraison')}
          </button>
          <button
            type="button"
            onClick={handleImprimer}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
            title={t('colis.detail.fiche')}
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            {t('colis.detail.fiche')}
          </button>
          {modifiable && (
            <>
              <button
                type="button"
                onClick={() => setEdition(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                {t('colis.detail.modifier')}
              </button>
              {annulable && (
                <button
                  type="button"
                  onClick={() => setConfirmationAnnulation(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 rounded-md text-xs font-semibold transition cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('colis.detail.annuler')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {verrouille && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-xs">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('colis.detail.terminal')}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* --- Colonne principale --------------------------------------- */}
        <div className="lg:col-span-2 space-y-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" aria-hidden="true" />
                {t('colis.detail.colonne.destinataire')}
              </span>
            }
          >
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Champ libelle={t('colis.detail.champ.nomComplet')}>{colis.customerName ?? '—'}</Champ>
              <Champ libelle={t('colis.detail.champ.telephone')}>
                <span className="font-mono inline-flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span dir="ltr">{colis.customerPhone}</span>
                </span>
              </Champ>
              <Champ libelle={t('colis.detail.champ.gouvernorat')}>
                <span dir="ltr">{voc.gouvernorat(colis.governorate) ?? '—'}</span>
              </Champ>
              <Champ libelle={t('colis.detail.champ.delegation')}>{colis.delegation ?? '—'}</Champ>
              <Champ libelle={t('colis.detail.champ.adresse')} className="sm:col-span-2">
                {colis.address ?? '—'}
              </Champ>
            </dl>
            {colis.notes && (
              <div className="mt-3 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <p className="font-semibold mb-1">{t('colis.detail.colonne.vosInstructions')}</p>
                {colis.notes}
              </div>
            )}
          </Card>

          {/* Chronologie */}
          <Card
            title={
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" aria-hidden="true" />
                {t('colis.detail.chronologie')}
              </span>
            }
            subtitle={t('colis.detail.chronologieAide')}
          >
            {chronologie.length === 0 ? (
              <p className="text-xs text-slate-500">{t('colis.detail.aucunEvenement')}</p>
            ) : (
              <ol className="relative ps-6 space-y-4 border-s-2 border-slate-200 ms-2.5">
                {chronologie.map((evenement: TrackingTimelineEvent, index) => (
                  <li key={`${evenement.timestamp}-${index}`} className="relative">
                    <span
                      className={`absolute -start-[31px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                        index === chronologie.length - 1 ? 'bg-red-500' : 'bg-slate-300'
                      }`}
                      aria-hidden="true"
                    />
                    <p className="text-xs font-semibold text-slate-900">
                      {evenement.label ?? voc.statutColis(evenement.status ?? '').label}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTime(evenement.timestamp)}
                    </p>
                    {(evenement.location || evenement.actor) && (
                      <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                        {evenement.location && (
                          <>
                            <MapPin className="w-3 h-3" aria-hidden="true" />
                            {evenement.location}
                          </>
                        )}
                        {evenement.location && evenement.actor && ' · '}
                        {evenement.actor && t('echanges.par', { nom: evenement.actor })}
                      </p>
                    )}
                    {evenement.notes && (
                      <p className="text-[11px] text-slate-600 mt-1 italic">{evenement.notes}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {/* Tentatives */}
          {tentatives.length > 0 && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  {t('colis.detail.tentatives')}
                </span>
              }
              subtitle={t('colis.detail.attemptsEffectuees', { n: tentatives.length })}
            >
              <ul className="space-y-3">
                {tentatives.map((tentative, index) => (
                  <li key={tentative.id ?? index} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0">
                      {tentative.reasonCode ? (
                        <XCircle className="w-4 h-4 text-red-400" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">
                        {tentative.reasonCode
                          ? traduireValeur('motif', tentative.reasonCode)
                          : tentative.status === 'LIVRE'
                            ? t('tentative.livre')
                            : t('tentative.passageEffectue')}
                      </p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <span dir="ltr">{formatDateTime(tentative.timestamp ?? null)}</span>
                        {tentative.driverName ? ` · ${tentative.driverName}` : ''}
                      </p>
                      {tentative.notes && (
                        <p className="text-[11px] text-slate-600 italic mt-0.5">{tentative.notes}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Journal d'audit */}
          {audit.length > 0 && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  {t('colis.detail.historique')}
                </span>
              }
              subtitle={t('colis.detail.historiqueAide')}
            >
              <ul className="space-y-2.5">
                {audit.map((entree) => (
                  <li key={entree.id} className="text-xs">
                    <p className="font-medium text-slate-800">
                      {entree.actionLabel ?? entree.action}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      <span dir="ltr">{formatDateTime(entree.timestamp)}</span>
                      {entree.userName ? ` · ${entree.userName}` : ''}
                    </p>
                    {entree.reason && (
                      <p className="text-[11px] text-slate-600 mt-0.5">{entree.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* --- Colonne latérale ---------------------------------------- */}
        <div className="space-y-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-slate-400" aria-hidden="true" />
                {t('colis.detail.montants')}
              </span>
            }
          >
            <dl className="space-y-2.5 text-sm">
              <Ligne libelle={t('colis.detail.champ.montantEncaisser')} valeur={formatTND(attendu)} />
              <Ligne libelle={t('colis.detail.champ.dejaEncaisse')} valeur={formatTND(encaisse)} />
              <Ligne
                libelle={t('colis.detail.champ.resteARassembler')}
                valeur={formatTND(reste)}
                fort={reste > 0}
              />
              <Ligne libelle={t('colis.detail.champ.fraisLivraison')} valeur={formatTND(colis.deliveryFee)} />
            </dl>
            <p className="mt-3 text-[11px] text-slate-500">
              {livre ? t('colis.detail.livraisonRemisee') : t('colis.detail.livraisonNonRemisee')}
            </p>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Box className="w-4 h-4 text-slate-400" aria-hidden="true" />
                {t('colis.detail.colis')}
              </span>
            }
          >
            <dl className="space-y-2.5 text-sm">
              <Ligne libelle={t('colis.detail.champ.type')} valeur={voc.type(colis.packageType)} />
              <Ligne libelle={t('colis.detail.champ.taille')} valeur={voc.taille(colis.sizeCategory)} />
              <Ligne libelle={t('colis.detail.champ.nombrePieces')} valeur={String(colis.pieceCount ?? 1)} />
              <Ligne
                libelle={t('colis.detail.champ.ouverture')}
                valeur={colis.allowOpen ? t('colis.detail.champ.ouvertureAutorisee') : t('colis.detail.champ.ouvertureRefusee')}
              />
              <Ligne
                libelle={t('colis.detail.champ.fragile')}
                valeur={colis.isFragile ? t('commun.oui') : t('commun.non')}
              />
              <Ligne libelle={t('colis.detail.champ.contenu')} valeur={colis.contentSummary ?? '—'} />
            </dl>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-slate-400" aria-hidden="true" />
                {t('colis.detail.livraison')}
              </span>
            }
          >
            <dl className="space-y-2.5 text-sm">
              <Ligne libelle={t('colis.detail.champ.statut')} valeur={badge.label} />
              <Ligne libelle={t('colis.detail.champ.livreur')} valeur={colis.assignedDriverName ?? '—'} />
              <Ligne libelle={t('colis.detail.champ.tournee')} valeur={colis.runsheetNumber ?? '—'} />
              <Ligne libelle={t('colis.detail.champ.positionActuelle')} valeur={colis.currentLocation ?? '—'} />
              {colis.expectedDeliveryDate && (
                <Ligne
                  libelle={t('colis.detail.champ.livraisonPrevue')}
                  valeur={formatDate(colis.expectedDeliveryDate)}
                />
              )}
            </dl>
          </Card>

          {/* Échange */}
          {colis.exchange && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-amber-500" aria-hidden="true" />
                  {t('colis.detail.echange')}
                </span>
              }
            >
              <dl className="space-y-2.5 text-sm">
                <Ligne
                  libelle={t('colis.detail.champ.ancienCodeBarres')}
                  valeur={<span dir="ltr">{colis.exchange.oldPackageBarcode}</span>}
                  mono
                />
                <Ligne
                  libelle={t('colis.detail.champ.nouveauCodeBarres')}
                  valeur={<span dir="ltr">{colis.exchange.newPackageBarcode}</span>}
                  mono
                  fort
                />
                <Ligne
                  libelle={t('colis.detail.champ.articleRepris')}
                  valeur={colis.exchange.returnedItemSummary ?? '—'}
                />
                {colis.exchange.financialDifference != null && (
                  <Ligne
                    libelle={t('colis.detail.champ.differenceFinanciere')}
                    valeur={formatTND(colis.exchange.financialDifference)}
                  />
                )}
                <Ligne
                  libelle={t('colis.detail.champ.effectueLe')}
                  valeur={formatDateTime(colis.exchange.createdAt)}
                />
              </dl>
            </Card>
          )}

          {/* Retours */}
          {colis.returns && colis.returns.length > 0 && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <PackageX className="w-4 h-4 text-red-500" aria-hidden="true" />
                  {t('colis.detail.retours')}
                </span>
              }
            >
              <ul className="space-y-3">
                {colis.returns.map((retour) => (
                  <li key={retour.id} className="text-xs">
                    <p className="font-mono font-semibold text-slate-800">
                      <span dir="ltr">{retour.returnNumber}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      <span dir="ltr">{formatDateTime(retour.createdAt)}</span>
                    </p>
                    {retour.reason && (
                      <p className="text-[11px] text-slate-600 mt-0.5">{retour.reason}</p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {t('colis.detail.champ.depot')} {retour.returnDepositName ?? '—'}
                      {retour.amount != null ? ` · ${formatTND(retour.amount)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Livraison partielle */}
          {colis.partialDelivery && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-amber-500" aria-hidden="true" />
                  {t('colis.detail.livraisonPartielle')}
                </span>
              }
            >
              <dl className="space-y-2.5 text-sm">
                <Ligne
                  libelle={t('colis.detail.champ.livre')}
                  valeur={colis.partialDelivery.deliveredDescription ?? '—'}
                />
                <Ligne
                  libelle={t('colis.detail.champ.retourne')}
                  valeur={colis.partialDelivery.returnedDescription ?? '—'}
                />
                <Ligne
                  libelle={t('colis.detail.champ.piecesLivrees')}
                  valeur={String(colis.partialDelivery.deliveredPieces ?? 0)}
                />
                <Ligne
                  libelle={t('colis.detail.champ.piecesRetournees')}
                  valeur={String(colis.partialDelivery.returnedPieces ?? 0)}
                />
                <Ligne
                  libelle={t('colis.detail.champ.motif')}
                  valeur={colis.partialDelivery.reason ?? '—'}
                />
              </dl>
            </Card>
          )}
        </div>
      </div>

      {/* Modification */}
      <Modal
        isOpen={edition}
        onClose={() => setEdition(false)}
        title={t('colis.detail.modifierTitre')}
        subtitle={t('colis.detail.modificationsTracees')}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEdition(false)}
              className="px-4 py-2 border border-slate-200 text-slate-700 rounded text-xs font-medium transition cursor-pointer"
            >
              {t('commun.annuler')}
            </button>
            <button
              type="submit"
              form="formulaire-modification"
              disabled={enregistrement}
              className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded text-xs font-semibold transition cursor-pointer"
            >
              {enregistrement && <Spinner size="sm" className="text-white" />}
              {t('commun.enregistrer')}
            </button>
          </>
        }
      >
        <form id="formulaire-modification" onSubmit={enregistrer} className="space-y-4">
          {erreurEdition && (
            <ErrorBanner message={erreurEdition} onDismiss={() => setErreurEdition(null)} />
          )}

          {/*
            Le montant est le champ sensible : une modification après l'affectation
            à une tournée alerte le livreur. L'écran le dit avant l'enregistrement,
            pour que la surprise ne vienne pas du chauffeur.
          */}
          {Number(form.totalPrice) !== attendu && (
            <p className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              <Banknote className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t('colis.detail.champ.montantEncaisser')} {formatTND(attendu)} →{' '}
                {formatTND(Number(form.totalPrice) || 0)}. {t('colis.detail.terminal')}
              </span>
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('colis.detail.champ.nomComplet')} required>
              <Input
                required
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              />
            </FormField>
            <FormField label={t('colis.detail.champ.telephone')} required>
              <Input
                required
                type="tel"
                className="font-mono"
                value={form.customerPhone}
                onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
              />
            </FormField>
            <FormField label={t('colis.detail.champ.gouvernorat')} required>
              <Select
                required
                value={form.governorate}
                onChange={(e) => setForm((f) => ({ ...f, governorate: e.target.value }))}
              >
                {GOUVERNORATS.map((g) => (
                  <option key={g} value={g}>
                    {voc.gouvernorat(g)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('colis.detail.champ.delegation')}>
              <Input
                value={form.delegation}
                onChange={(e) => setForm((f) => ({ ...f, delegation: e.target.value }))}
              />
            </FormField>
          </div>

          <FormField label={t('colis.detail.champ.adresse')} required>
            <Input
              required
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('colis.detail.champ.montantEncaisser')} required>
              <Input
                required
                type="number"
                min="0"
                step="0.001"
                className="font-mono font-semibold"
                value={form.totalPrice}
                onChange={(e) => setForm((f) => ({ ...f, totalPrice: e.target.value }))}
              />
            </FormField>
            <FormField label={t('colis.detail.champ.nombrePieces')} required>
              <Input
                required
                type="number"
                min="1"
                step="1"
                className="font-mono"
                value={form.pieceCount}
                onChange={(e) => setForm((f) => ({ ...f, pieceCount: e.target.value }))}
              />
            </FormField>
          </div>

          <FormField label={t('colis.detail.instructions')}>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </FormField>
          <Checkbox
            label={t('colis.formulaire.fragile')}
            checked={form.isFragile}
            onChange={(v) => setForm((f) => ({ ...f, isFragile: v }))}
          />
        </form>
      </Modal>

      {/*
        * Annulation.
        *
        * Une seule fenêtre, pas une confirmation suivie d'une saisie : l'API
        * exige un motif sur une annulation et l'inscrit au journal du colis.
        * Demander la confirmation avant de proposer le motif ferait perdre une
        * étape pour une règle connue.
        */}
      {confirmationAnnulation && (
        <Modal
          isOpen
          onClose={() => setConfirmationAnnulation(false)}
          title={t('colis.detail.motif')}
          subtitle={t('colis.detail.motifAide')}
          size="sm"
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmationAnnulation(false)}
                className="px-4 py-2 border border-slate-200 text-slate-700 rounded text-xs font-medium transition cursor-pointer"
              >
                {t('commun.retour')}
              </button>
              <button
                type="button"
                disabled={motifAnnulation.trim() === '' || annulationEnCours}
                onClick={() => void confirmerAnnulation()}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition cursor-pointer"
              >
                {annulationEnCours && <Spinner size="sm" className="text-white" />}
                {t('colis.detail.annulerConfirme')}
              </button>
            </>
          }
        >
          <FormField label={t('colis.detail.motif')} required helpText={t('colis.detail.motifPlaceholder')}>
            <Textarea
              rows={3}
              value={motifAnnulation}
              onChange={(e) => setMotifAnnulation(e.target.value)}
              placeholder={t('colis.detail.motifPlaceholder')}
              maxLength={255}
            />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

function LienRetour() {
  const { t } = useI18n();
  return (
    <Link
      href="/expediteur/colis"
      aria-label={t('colis.detail.retourListe')}
      className="p-2 -ms-2 rounded-md text-slate-500 hover:bg-slate-100 transition shrink-0"
    >
      <ArrowLeft className="w-5 h-5 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

function Champ({
  libelle,
  children,
  className = '',
}: {
  libelle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] text-slate-500 uppercase tracking-wide">{libelle}</dt>
      <dd className="text-sm text-slate-900 mt-0.5">{children}</dd>
    </div>
  );
}

function Ligne({
  libelle,
  valeur,
  fort = false,
  mono = false,
}: {
  libelle: string;
  valeur: React.ReactNode;
  fort?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-500">{libelle}</dt>
      <dd
        className={`text-xs text-slate-900 text-end ${mono ? 'font-mono' : ''} ${
          fort ? 'font-semibold' : ''
        }`}
      >
        {valeur}
      </dd>
    </div>
  );
}