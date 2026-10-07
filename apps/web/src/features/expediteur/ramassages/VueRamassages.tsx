'use client';

/**
 * Rendez-vous de collecte.
 *
 * Un expéditeur peut demander un ramassage et l'annuler tant que la machine à
 * états l'autorise. Il ne peut ni le confirmer, ni l'affecter à un chauffeur,
 * ni y rattacher ses colis : ces opérations sont réservées à l'exploitation et
 * à la caisse. L'écran ne propose donc que ce qui est réellement permis, plutôt
 * que d'afficher des boutons qui se feraient refuser.
 *
 * L'écart entre le nombre de colis annoncés et le nombre réellement collectés
 * est affiché tel quel. Il se remplit tout seul au fil de la collecte, et il
 * vaut mieux qu'un « conforme » écrit par avance.
 *
 * ## Langue
 *
 * Les statuts affichés sont des identifiants renvoyés par l'API : ils passent par
 * le vocabulaire, qui renvoie le mot de la langue courante. Les numéros de
 * référence, les téléphones et les créneaux horaires sont des données : ils
 * restent en `dir="ltr"`, pour rester lisibles dans une phrase arabe. Les
 * créneaux, eux, ne se traduisent pas — `10h` s'écrit pareil dans les deux
 * langues.
 */

import React from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  Clock,
  MapPin,
  Phone,
  Truck,
  User,
} from 'lucide-react';
import { PickupStatus, type PickupAppointmentDto } from '@logixpress/types';
import {
  Badge,
  BasculeFiches,
  Card,
  ChargementEnCours,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  FicheLigne,
  FormField,
  Input,
  Modal,
  Select,
  SkeletonTable,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useToast,
} from '@logixpress/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { annulerRamassage, demanderRamassage, listerRamassages } from '@/features/expediteur/lib/client';
import {
  CRENEAUX_RAMASSAGE,
  VARIANTE_STATUT_RDV,
  peutAnnulerRdv,
  useVocabulaire,
} from '@/features/expediteur/lib/libelles';

export function VueRamassages() {
  const { t, formatDate } = useI18n();
  const voc = useVocabulaire();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [rendezVous, setRendezVous] = React.useState<PickupAppointmentDto[]>([]);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [enFiches, setEnFiches] = React.useState(false);

  const [demandeOuverte, setDemandeOuverte] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const [erreurForm, setErreurForm] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    scheduledDate: new Date().toISOString().slice(0, 10),
    creneau: 1,
    pickupAddress: '',
    contactPerson: '',
    contactPhone: '',
    packageEstimate: '1',
    notes: '',
  });

  const [aAnnuler, setAAnnuler] = React.useState<PickupAppointmentDto | null>(null);
  const [annulationEnCours, setAnnulationEnCours] = React.useState(false);

  const charger = React.useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const reponse = await listerRamassages();
      setRendezVous(reponse.rendezVous);
    } catch (err) {
      setRendezVous([]);
      setErreur(err instanceof Error ? err.message : t('ramassages.erreur'));
    } finally {
      setChargement(false);
    }
  }, [t]);

  React.useEffect(() => {
    void charger();
  }, [charger]);

  /*
   * Le formulaire est réamorcée à l'ouverture, pas au rendu : le composant est
   * monté une fois pour la durée de la session, et une adresse saisie puis
   * abandonnée reviendrait à l'écran suivant.
   */
  const ouvrirDemande = () => {
    setForm({
      scheduledDate: new Date().toISOString().slice(0, 10),
      creneau: 1,
      pickupAddress: '',
      contactPerson: user?.fullName ?? '',
      contactPhone: user?.phone ?? '',
      packageEstimate: '1',
      notes: '',
    });
    setErreurForm(null);
    setDemandeOuverte(true);
  };

  async function soumettreDemande(event: React.FormEvent) {
    event.preventDefault();
    setErreurForm(null);
    setEnvoi(true);
    try {
      const creneau = CRENEAUX_RAMASSAGE[form.creneau];
      const cree = await demanderRamassage({
        scheduledDate: form.scheduledDate,
        timeSlotStartHour: creneau.debut,
        timeSlotEndHour: creneau.fin,
        pickupAddress: form.pickupAddress.trim(),
        contactPerson: form.contactPerson.trim(),
        contactPhone: form.contactPhone.trim(),
        packageEstimate: Number(form.packageEstimate),
        notes: form.notes.trim() || undefined,
      });
      setDemandeOuverte(false);
      addToast({
        type: 'success',
        title: t('ramassages.formulaire.succes'),
        message: t('ramassages.formulaire.succesDetail', {
          reference: cree.referenceNumber,
          date: formatDate(cree.scheduledDate),
        }),
      });
      await charger();
    } catch (err) {
      setErreurForm(err instanceof Error ? err.message : t('ramassages.formulaire.erreur'));
    } finally {
      setEnvoi(false);
    }
  }

  async function confirmerAnnulation() {
    if (!aAnnuler) return;
    setAnnulationEnCours(true);
    try {
      await annulerRamassage(aAnnuler.referenceNumber);
      setAAnnuler(null);
      addToast({ type: 'warning', title: t('ramassages.annule') });
      await charger();
    } catch (err) {
      // Message d'erreur non encore traduit : il reste en français.
      setErreur(err instanceof Error ? err.message : 'L\'annulation a échoué.');
      setAAnnuler(null);
    } finally {
      setAnnulationEnCours(false);
    }
  }

  const aVenir = rendezVous.filter(
    (r) => r.status !== PickupStatus.EFFECTUE && r.status !== PickupStatus.ANNULE
  );
  const passes = rendezVous.filter(
    (r) => r.status === PickupStatus.EFFECTUE || r.status === PickupStatus.ANNULE
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('ramassages.titre')}</h1>
          {/* Le compte de rendez-vous n'a pas d'entrée dans le dictionnaire : il reste français. */}
          <p className="text-sm text-slate-500 mt-0.5">
            {chargement ? t('commun.chargement') : `${rendezVous.length} rendez-vous`}
          </p>
        </div>
        <button
          type="button"
          onClick={ouvrirDemande}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-semibold shadow-xs transition cursor-pointer shrink-0"
        >
          <CalendarPlus className="w-4 h-4" aria-hidden="true" />
          {t('ramassages.demander')}
        </button>
      </div>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {chargement ? (
        <>
          <ChargementEnCours message={t('ramassages.chargement')} />
          <SkeletonTable rows={4} cols={5} />
        </>
      ) : rendezVous.length === 0 ? (
        <EmptyState
          icon={<Truck className="w-8 h-8" aria-hidden="true" />}
          title={t('ramassages.aucun')}
          description={t('ramassages.aucunDescription')}
          action={
            <button
              type="button"
              onClick={ouvrirDemande}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition"
            >
              {t('ramassages.demander')}
            </button>
          }
        />
      ) : (
        <>
          {aVenir.length > 0 && (
            /* Sous-titre non traduit : aucun décompte de rendez-vous au dictionnaire. */
            <Card
              title={t('ramassages.aVenir')}
              subtitle={`${aVenir.length} rendez-vous en cours`}
              action={
                <div className="sm:hidden">
                  <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
                </div>
              }
            >
              <div className={enFiches ? 'hidden sm:block' : ''}>
                <Table libelle={t('ramassages.aVenir')} largeurMin="820px">
                  <Thead>
                    <tr>
                      <Th figee>{t('ramassages.colonne.reference')}</Th>
                      <Th>{t('ramassages.colonne.date')}</Th>
                      <Th priorite="secondaire">{t('ramassages.colonne.adresse')}</Th>
                      <Th align="center">{t('ramassages.colonne.colis')}</Th>
                      <Th priorite="secondaire">{t('ramassages.colonne.chauffeur')}</Th>
                      <Th align="center">{t('ramassages.colonne.statut')}</Th>
                      <Th align="right">{t('ramassages.colonne.action')}</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {aVenir.map((rdv) => (
                      <LigneRamassage
                        key={rdv.id}
                        rdv={rdv}
                        onAnnuler={() => setAAnnuler(rdv)}
                      />
                    ))}
                  </Tbody>
                </Table>
              </div>

              {enFiches && (
                <div className="sm:hidden space-y-2">
                  {aVenir.map((rdv) => (
                    <FicheRdv key={rdv.id} rdv={rdv} onAnnuler={() => setAAnnuler(rdv)} />
                  ))}
                </div>
              )}
            </Card>
          )}

          {passes.length > 0 && (
            /* Sous-titre non traduit, comme celui du bloc précédent. */
            <Card title={t('ramassages.historique')} subtitle={`${passes.length} rendez-vous passés`}>
              <ul className="space-y-2.5">
                {passes.map((rdv) => (
                  <li
                    key={rdv.id}
                    className="flex items-center gap-3 text-xs pb-2.5 border-b border-slate-100 last:border-0 last:pb-0"
                  >
                    <span className="font-mono font-semibold text-slate-700 shrink-0" dir="ltr">
                      {rdv.referenceNumber}
                    </span>
                    <span className="text-slate-500">
                      {formatDate(rdv.scheduledDate)} ·{' '}
                      <span dir="ltr">
                        {rdv.timeSlotStartHour}h–{rdv.timeSlotEndHour}h
                      </span>
                    </span>
                    <Badge
                      variant={VARIANTE_STATUT_RDV[rdv.status] ?? 'default'}
                      className="ms-auto shrink-0"
                    >
                      {voc.rdv(rdv.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {/* Demande de ramassage */}
      <Modal
        isOpen={demandeOuverte}
        onClose={() => setDemandeOuverte(false)}
        title={t('ramassages.formulaire.titre')}
        subtitle={t('ramassages.aucunDescription')}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDemandeOuverte(false)}
              className="px-4 py-2 border border-slate-200 text-slate-700 rounded text-xs font-medium transition cursor-pointer"
            >
              {t('commun.annuler')}
            </button>
            <button
              type="submit"
              form="formulaire-ramassage"
              disabled={envoi}
              className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded text-xs font-semibold transition cursor-pointer"
            >
              {envoi && <Spinner size="sm" className="text-white" />}
              {t('ramassages.formulaire.soumettre')}
            </button>
          </>
        }
      >
        <form id="formulaire-ramassage" onSubmit={soumettreDemande} className="space-y-4">
          {erreurForm && <ErrorBanner message={erreurForm} onDismiss={() => setErreurForm(null)} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('ramassages.formulaire.date')} required>
              <Input
                required
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={form.scheduledDate}
                onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
              />
            </FormField>

            {/* Les créneaux sont des heures : `value` reste l'index, seul le libellé est rendu tel quel. */}
            <FormField label={t('ramassages.formulaire.creneau')} required>
              <Select
                value={String(form.creneau)}
                onChange={(e) => setForm((f) => ({ ...f, creneau: Number(e.target.value) }))}
              >
                {CRENEAUX_RAMASSAGE.map((c, i) => (
                  <option key={c.libelle} value={String(i)}>
                    {c.libelle}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField
            label={t('ramassages.formulaire.adresse')}
            required
            helpText={t('ramassages.formulaire.adresseAide')}
          >
            <Input
              required
              value={form.pickupAddress}
              onChange={(e) => setForm((f) => ({ ...f, pickupAddress: e.target.value }))}
              placeholder={t('ramassages.formulaire.adresseAide')}
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('ramassages.formulaire.contact')} required>
              <Input
                required
                value={form.contactPerson}
                onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
              />
            </FormField>
            <FormField label={t('ramassages.formulaire.telephone')} required>
              <Input
                required
                type="tel"
                dir="ltr"
                className="font-mono"
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              />
            </FormField>
          </div>

          <FormField
            label={t('ramassages.formulaire.colis')}
            required
            helpText={t('ramassages.afficheNbAide')}
          >
            <Input
              required
              type="number"
              min="1"
              step="1"
              className="font-mono"
              value={form.packageEstimate}
              onChange={(e) => setForm((f) => ({ ...f, packageEstimate: e.target.value }))}
            />
          </FormField>

          <FormField label={t('ramassages.formulaire.notes')}>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t('ramassages.formulaire.notesAide')}
              maxLength={500}
            />
          </FormField>

          <p className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-100 rounded-md px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
            {/* Première phrase non encore traduite : elle reste en français. */}
            <span>
              Deux rendez-vous ne peuvent pas se chevaucher à la même date pour la même
              entreprise. {t('ramassages.afficheConfirmeAide')}
            </span>
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={aAnnuler !== null}
        onClose={() => setAAnnuler(null)}
        onConfirm={() => void confirmerAnnulation()}
        title={t('ramassages.annulerConfirme')}
        message={aAnnuler ? t('ramassages.annulerAide') : ''}
        confirmText={t('ramassages.annuler')}
        cancelText={t('commun.revenir')}
        isLoading={annulationEnCours}
      />
    </div>
  );
}

function LigneRamassage({
  rdv,
  onAnnuler,
}: {
  rdv: PickupAppointmentDto;
  onAnnuler: () => void;
}) {
  const { t, formatDate } = useI18n();
  const voc = useVocabulaire();
  const ecart = rdv.actualPickedCount - rdv.packageEstimate;
  return (
    <Tr
      resume={`${t('ramassages.colonne.reference')} ${rdv.referenceNumber}, ${voc.rdv(rdv.status)}`}
    >
      <Td figee>
        <span className="font-mono text-xs font-bold text-slate-900" dir="ltr">
          {rdv.referenceNumber}
        </span>
      </Td>
      <Td>
        <span className="text-xs font-medium">{formatDate(rdv.scheduledDate)}</span>
        <span className="block text-[11px] text-slate-500 font-mono" dir="ltr">
          {rdv.timeSlotStartHour}h – {rdv.timeSlotEndHour}h
        </span>
      </Td>
      <Td priorite="secondaire">
        <span className="text-xs text-slate-700 block max-w-[220px] truncate">
          {rdv.pickupAddress}
        </span>
        <span className="text-[11px] text-slate-500 font-mono" dir="ltr">
          {rdv.contactPhone}
        </span>
      </Td>
      <Td align="center">
        <span className="font-mono text-xs font-semibold">{rdv.packageEstimate}</span>
        <span className="text-slate-400 mx-1">/</span>
        <span className="font-mono text-xs text-slate-600">{rdv.actualPickedCount}</span>
        {ecart !== 0 && (
          <span
            className={`block text-[10px] ${ecart > 0 ? 'text-emerald-600' : 'text-amber-600'}`}
          >
            {/* « manquants » n'a pas d'entrée dans le dictionnaire : le mot reste français. */}
            {ecart > 0 ? `+${ecart} ${t('etape.ramasse')}` : `${ecart} manquants`}
          </span>
        )}
      </Td>
      <Td priorite="secondaire">
        <span className="text-xs text-slate-700">
          {rdv.assignedDriverName ?? t('ramassages.afficheChauffeurAucun')}
        </span>
      </Td>
      <Td align="center">
        <Badge variant={VARIANTE_STATUT_RDV[rdv.status] ?? 'default'}>
          {voc.rdv(rdv.status)}
        </Badge>
      </Td>
      <Td align="right">
        {peutAnnulerRdv(rdv.status) && (
          <button
            type="button"
            onClick={onAnnuler}
            className="text-[11px] font-semibold text-red-600 hover:text-red-700 cursor-pointer"
          >
            {t('commun.annuler')}
          </button>
        )}
      </Td>
    </Tr>
  );
}

function FicheRdv({
  rdv,
  onAnnuler,
}: {
  rdv: PickupAppointmentDto;
  onAnnuler: () => void;
}) {
  const { t, formatDate, formatDateTime } = useI18n();
  const voc = useVocabulaire();
  return (
    <FicheLigne
      titre={
        <span className="flex items-center gap-2">
          <CalendarPlus className="w-4 h-4 text-red-500" aria-hidden="true" />
          {formatDate(rdv.scheduledDate)}
        </span>
      }
      sousTitre={<span dir="ltr">{`${rdv.timeSlotStartHour}h – ${rdv.timeSlotEndHour}h`}</span>}
      identifiant={rdv.referenceNumber}
      action={
        <Badge variant={VARIANTE_STATUT_RDV[rdv.status] ?? 'default'}>
          {voc.rdv(rdv.status)}
        </Badge>
      }
      champs={[
        {
          libelle: t('ramassages.colonne.adresse'),
          valeur: (
            <span className="flex items-start gap-1">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
              {rdv.pickupAddress}
            </span>
          ),
        },
        {
          libelle: t('ramassages.afficheContact'),
          valeur: (
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              {rdv.contactPerson}
            </span>
          ),
        },
        {
          libelle: t('ramassages.afficheTelephone'),
          valeur: (
            <span className="flex items-center gap-1 font-mono" dir="ltr">
              <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              {rdv.contactPhone}
            </span>
          ),
        },
        {
          libelle: t('ramassages.afficheNb'),
          valeur: `${rdv.packageEstimate} / ${rdv.actualPickedCount}`,
          numerique: true,
        },
        {
          libelle: t('ramassages.colonne.chauffeur'),
          valeur: rdv.assignedDriverName ?? t('ramassages.afficheChauffeurAucun'),
        },
        {
          libelle: t('ramassages.demandeLe'),
          valeur: formatDateTime(rdv.createdAt),
        },
      ]}
      onClick={peutAnnulerRdv(rdv.status) ? onAnnuler : undefined}
    />
  );
}