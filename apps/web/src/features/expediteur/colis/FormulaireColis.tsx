'use client';

/**
 * Déclaration d'un colis.
 *
 * Les champs sont exactement ceux que l'API consomme. Aucun n'est ajouté pour
 * l'affichage : `weightKg`, `declaredValue` ou `returnFee` existent dans la
 * base mais aucun service ne les écrit, les proposer serait inviter l'utilisateur
 * à saisir une valeur qui disparaîtrait.
 *
 * La validation est celle du navigateur, complétée par le refus explicite de ce
 * que le serveur contrôle : le serveur reste seul juge, et son message est
 * affiché tel quel plutôt que reformulé.
 *
 * ## Langue
 *
 * Aucun mot n'est écrit en dur : les intitulés viennent du dictionnaire et les
 * valeurs de domaine — gouvernorats, tailles, types d'expédition — du
 * vocabulaire lié à la langue courante. Un `<select>` renvoie toujours la valeur
 * brute du serveur ; seul le texte lu par l'utilisateur est traduit.
 */

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info, PackagePlus } from 'lucide-react';
import { PackageSize, PackageType } from '@logixpress/types';
import {
  Checkbox,
  ErrorBanner,
  FormField,
  Input,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@logixpress/ui';
import { useAuth } from '@/lib/auth';
import { creerColis } from '@/features/expediteur/lib/client';
import { GOUVERNORATS, useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n } from '@/i18n';

interface EtatFormulaire {
  customerName: string;
  customerPhone: string;
  governorate: string;
  delegation: string;
  address: string;
  totalPrice: string;
  pieceCount: string;
  sizeCategory: PackageSize;
  packageType: PackageType;
  contentSummary: string;
  allowOpen: boolean;
  isFragile: boolean;
  notes: string;
}

const VIDE: EtatFormulaire = {
  customerName: '',
  customerPhone: '',
  governorate: 'Tunis',
  delegation: '',
  address: '',
  totalPrice: '',
  pieceCount: '1',
  sizeCategory: PackageSize.MOYENNE,
  packageType: PackageType.NORMAL,
  contentSummary: '',
  allowOpen: false,
  isFragile: false,
  notes: '',
};

export function FormulaireColis() {
  const router = useRouter();
  const { t } = useI18n();
  const voc = useVocabulaire();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [form, setForm] = React.useState<EtatFormulaire>(VIDE);
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const modifier = <K extends keyof EtatFormulaire>(cle: K, valeur: EtatFormulaire[K]) =>
    setForm((f) => ({ ...f, [cle]: valeur }));

  async function soumettre(event: React.FormEvent) {
    event.preventDefault();
    setErreur(null);
    setEnvoi(true);

    try {
      /*
       * Le montant part en nombre, le reste en texte. Aucun `shipperId` n'est
       * envoyé : l'entreprise vient du jeton, et le serveur refuserait de toute
       * façon qu'on lui désigne un autre expéditeur.
       */
      const reponse = await creerColis({
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        governorate: form.governorate,
        delegation: form.delegation.trim() || undefined,
        address: form.address.trim(),
        totalPrice: Number(form.totalPrice),
        pieceCount: Number(form.pieceCount),
        sizeCategory: form.sizeCategory,
        packageType: form.packageType,
        contentSummary: form.contentSummary.trim(),
        allowOpen: form.allowOpen,
        isFragile: form.isFragile,
        notes: form.notes.trim() || undefined,
      });

      if (!reponse.success || !reponse.data) {
        // Rejet du serveur sans message : aucune clé ne couvre encore ce refus.
        setErreur(reponse.message ?? 'Le serveur a refusé la création du colis.');
        return;
      }

      addToast({
        type: 'success',
        // Le titre et la phrase qui suit n'ont pas encore de clé : le numéro de
        // suivi est une donnée, la phrase qui l'introduit non plus.
        title: 'Colis créé',
        message: `N° ${reponse.data.trackingNumber} pour ${reponse.data.customerName}`,
      });
      router.push(`/expediteur/colis/${reponse.data.id}`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : t('colis.formulaire.erreurGenerique'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/expediteur/colis"
          aria-label={t('colis.formulaire.retourListe')}
          className="p-2 -ms-2 rounded-md text-slate-500 hover:bg-slate-100 transition"
        >
          {/* En arabe, la flèche « retour » pointe dans l'autre sens : elle se
              retourne avec la page. */}
          <ArrowLeft className="w-5 h-5 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('colis.formulaire.titre')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t('colis.formulaire.declareAuNom', {
              entreprise: user?.shipperName ?? t('colis.formulaire.declareAuNom.valeurParDefaut'),
            })}
          </p>
        </div>
      </div>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      <form onSubmit={soumettre} className="space-y-4" noValidate={false}>
        <fieldset className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
          <legend className="px-1.5 text-xs font-bold text-slate-900 uppercase tracking-wide">
            {t('colis.formulaire.groupe.destinataire')}
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('colis.formulaire.nom')} required>
              <Input
                required
                value={form.customerName}
                onChange={(e) => modifier('customerName', e.target.value)}
                placeholder={t('colis.formulaire.nomAide')}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t('colis.formulaire.telephone')}
              required
              helpText={t('colis.formulaire.telephoneAide')}
            >
              <Input
                required
                type="tel"
                inputMode="tel"
                value={form.customerPhone}
                onChange={(e) => modifier('customerPhone', e.target.value)}
                placeholder="20123456"
                className="font-mono"
                dir="ltr"
              />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
          <legend className="px-1.5 text-xs font-bold text-slate-900 uppercase tracking-wide">
            {t('colis.formulaire.groupe.destination')}
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('colis.formulaire.gouvernorat')} required>
              <Select
                required
                value={form.governorate}
                onChange={(e) => modifier('governorate', e.target.value)}
              >
                {/* La valeur envoyée reste celle du domaine ; seul le libellé lu
                    change avec la langue. */}
                {GOUVERNORATS.map((g) => (
                  <option key={g} value={g}>
                    {voc.gouvernorat(g)}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label={t('colis.formulaire.delegation')}
              helpText={t('colis.formulaire.delegationAide')}
            >
              <Input
                value={form.delegation}
                onChange={(e) => modifier('delegation', e.target.value)}
                placeholder="El Menzah"
              />
            </FormField>
          </div>

          <FormField label={t('colis.formulaire.adresse')} required>
            <Input
              required
              value={form.address}
              onChange={(e) => modifier('address', e.target.value)}
              placeholder={t('colis.formulaire.adresseAide')}
            />
          </FormField>
        </fieldset>

        <fieldset className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
          <legend className="px-1.5 text-xs font-bold text-slate-900 uppercase tracking-wide">
            {t('colis.formulaire.groupe.colis')}
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              label={t('colis.formulaire.montant')}
              required
              // Cette aide n'a pas encore de clé au dictionnaire.
              helpText="Ce que le livreur collecte auprès du destinataire"
            >
              <Input
                required
                type="number"
                min="0"
                step="0.001"
                value={form.totalPrice}
                onChange={(e) => modifier('totalPrice', e.target.value)}
                className="font-mono font-semibold"
                placeholder="0.000"
              />
            </FormField>

            <FormField
              label={t('colis.formulaire.nombrePieces')}
              required
              helpText={t('colis.formulaire.nombrePiecesAide')}
            >
              <Input
                required
                type="number"
                min="1"
                step="1"
                value={form.pieceCount}
                onChange={(e) => modifier('pieceCount', e.target.value)}
                className="font-mono"
              />
            </FormField>

            <FormField label={t('colis.formulaire.taille')} required>
              <Select
                value={form.sizeCategory}
                onChange={(e) => modifier('sizeCategory', e.target.value as PackageSize)}
              >
                {Object.values(PackageSize).map((taille) => (
                  <option key={taille} value={taille}>
                    {voc.taille(taille)}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label={t('colis.formulaire.type')} required>
              <Select
                value={form.packageType}
                onChange={(e) => modifier('packageType', e.target.value as PackageType)}
              >
                {Object.values(PackageType).map((type) => (
                  <option key={type} value={type}>
                    {voc.type(type)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField
            label={t('colis.formulaire.description')}
            required
            helpText={t('colis.formulaire.descriptionAide')}
          >
            <Input
              required
              value={form.contentSummary}
              onChange={(e) => modifier('contentSummary', e.target.value)}
              placeholder={t('colis.formulaire.descriptionAide2')}
              maxLength={255}
            />
          </FormField>

          <Checkbox
            label={t('colis.formulaire.ouvrirAutorise')}
            checked={form.allowOpen}
            onChange={(v) => modifier('allowOpen', v)}
          />
          <Checkbox
            label={t('colis.formulaire.fragile')}
            checked={form.isFragile}
            onChange={(v) => modifier('isFragile', v)}
          />

          <FormField
            label={t('colis.formulaire.instructions')}
            helpText={t('colis.formulaire.instructionsAide2')}
          >
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => modifier('notes', e.target.value)}
              placeholder={t('colis.formulaire.instructionsAide')}
              maxLength={500}
            />
          </FormField>
        </fieldset>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="submit"
            disabled={envoi}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-md text-sm font-semibold shadow-xs transition cursor-pointer"
          >
            {envoi ? (
              <>
                <Spinner size="sm" className="text-white" />
                {t('colis.formulaire.envoi')}
              </>
            ) : (
              <>
                <PackagePlus className="w-4 h-4" aria-hidden="true" />
                {t('colis.formulaire.soumettre')}
              </>
            )}
          </button>
          <Link
            href="/expediteur/colis"
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-md text-sm font-medium text-center transition hover:bg-slate-50"
          >
            {t('commun.annuler')}
          </Link>
        </div>

        {/*
          * Ce qui décide après coup. L'API écrit les frais de livraison depuis
          * la configuration de l'entreprise, et le numéro de suivi comme le code
          * barres : rien à saisir, rien à deviner.
        */}
        <p className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-100 rounded-md px-3 py-2.5">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>{t('colis.formulaire.avertissement')}</span>
        </p>
      </form>
    </div>
  );
}