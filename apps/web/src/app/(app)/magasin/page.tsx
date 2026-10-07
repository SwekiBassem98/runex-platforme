'use client';

/**
 * DEPOT / ACCEPTATION MAGASIN — réception des colis à l'entrée.
 *
 * L'écran est taillé pour un poste de douane, pas pour un formulaire : un
 * opérateur enchaîne les scans, les mains occupées, un colis à la fois. Trois
 * conséquences en découlent.
 *
 *   - le champ de lecture garde le focus après chaque passage. Un lecteur
 *     optique se comporte comme un clavier : il « tape » le code puis envoie
 *     *Entrée*. Perdre le focus obligerait à reprendre la souris à chaque
 *     colis ;
 *   - le verdict est immédiat et explicite. Un refus se lit sur place — code
 *     illisible, colis inconnu, déjà reçu, état incompatible — parce que c'est
 *     à cet instant, devant la balance, qu'on peut encore resscanner ;
 *   - la réception n'est jamais déduite d'un clic ailleurs dans l'écran. Seule
 *     la lecture d'un code, puis la confirmation, enregistrent quelque chose.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ErrorBanner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatDateTime,
  formatTND,
} from '@logixpress/ui';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
  PackageSearch,
  ScanLine,
  Search,
  XCircle,
} from 'lucide-react';
import {
  receptionApi,
  type DepotOption,
  type ReceptionOutcome,
  type ReceptionResult,
  type RecentReception,
} from '@/lib/api';

/** Aspect d'un verdict, déduit du motif et non du succès HTTP. */
const ASPECT: Record<
  ReceptionOutcome,
  { tone: string; icon: typeof CheckCircle2; titre: string }
> = {
  RECEIVED: {
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    icon: CheckCircle2,
    titre: 'Réception enregistrée',
  },
  PREVIEW: {
    // Le vert est réservé à ce qui a été enregistré. Une simple lecture n'a rien
    // changé : elle est annoncée sur un ton neutre.
    tone: 'border-slate-200 bg-slate-50 text-slate-800',
    icon: Search,
    titre: 'Colis trouvé — rien n\'a été enregistré',
  },
  ALREADY_RECEIVED: {
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: AlertTriangle,
    titre: 'Déjà reçu en dépôt',
  },
  UNKNOWN_CODE: {
    tone: 'border-red-200 bg-red-50 text-red-900',
    icon: XCircle,
    titre: 'Aucun colis pour ce code',
  },
  MALFORMED_CODE: {
    tone: 'border-red-200 bg-red-50 text-red-900',
    icon: XCircle,
    titre: 'Code illisible',
  },
  INVALID_DEPOSIT: {
    tone: 'border-red-200 bg-red-50 text-red-900',
    icon: XCircle,
    titre: 'Dépôt d\'accueil refusé',
  },
  INVALID_STATE: {
    tone: 'border-orange-200 bg-orange-50 text-orange-900',
    icon: XCircle,
    titre: 'Réception impossible',
  },
};

export default function MagasinPage() {
  const router = useRouter();

  const [depots, setDepots] = useState<DepotOption[]>([]);
  const [depotId, setDepotId] = useState('');
  const [code, setCode] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [verdict, setVerdict] = useState<ReceptionResult | null>(null);
  const [recents, setRecents] = useState<RecentReception[]>([]);
  const [erreurRecents, setErreurRecents] = useState<string | null>(null);

  const champRef = useRef<HTMLInputElement>(null);

  /**
   * Rend la main au lecteur.
   *
   * L'opérateur enchaîne les colis sans reprendre la souris : le focus doit
   * revenir au champ à chaque verdict.
   */
  const rendreFocus = useCallback(() => {
    window.setTimeout(() => champRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    receptionApi
      .depots()
      .then((liste) => {
        setDepots(liste);
        // Le dépôt de l'opérateur prime s'il figure parmi les dépôts actifs.
        setDepotId((actuel) => actuel || liste.find((d) => d.isMainHub)?.id || liste[0]?.id || '');
      })
      .catch(() => setDepots([]));
  }, []);

  const chargerRecents = useCallback(async (depot: string) => {
    setErreurRecents(null);
    try {
      setRecents(await receptionApi.recent(depot || undefined, 12));
    } catch (error) {
      // Sans cet état, une panne se lisait « aucune réception à ce dépôt » :
      // un dépôt plein et un serveur injoignable donnaient le même écran.
      setRecents([]);
      setErreurRecents(
        error instanceof Error ? error.message : 'Réceptions récentes inaccessibles.'
      );
    }
  }, []);

  useEffect(() => {
    void chargerRecents(depotId);
  }, [depotId, chargerRecents]);

  /**
   * Lecture du code, puis réception.
   *
   * Le dépôt est résolu avant l'appel : un agent affecté à Sousse reçoit dans
   * Sousse sans avoir à choisir. Le choix manuel reste possible, pour un colis
   * déposé par erreur au mauvais guichet.
   */
  const recevoir = useCallback(
    async (raw: string) => {
      const lu = raw.trim();
      if (!lu || isBusy) return;

      setIsBusy(true);
      try {
        const resultat = await receptionApi.receive(lu, depotId || undefined);
        setVerdict(resultat);
        setCode('');
        if (resultat.accepted) void chargerRecents(depotId);
      } catch (error) {
        setVerdict({
          outcome: 'UNKNOWN_CODE',
          accepted: false,
          message: error instanceof Error ? error.message : 'Réception impossible.',
          package: null,
        });
      } finally {
        setIsBusy(false);
        rendreFocus();
      }
    },
    [depotId, isBusy, chargerRecents, rendreFocus]
  );

  const surSoumission = (event: React.FormEvent) => {
    event.preventDefault();
    void recevoir(code);
  };

  /** Prévisualisation sans enregistrer : sert à retrouver un colis avant de confirmer. */
  const previsualiser = async () => {
    const lu = code.trim();
    if (!lu) return;
    setIsBusy(true);
    try {
      const lu1 = await receptionApi.lookup(lu, depotId || undefined);
      if (lu1.package) {
        // Une simple lecture ne ré-annonce pas une réception : `RECEIVED`
        // affichait « Réception enregistrée » en vert alors que rien n'avait été
        // enregistré — l'opérateur devant la balance lisait un résultat qui
        // n'existait pas, et la note sous le lecteur promettait l'inverse.
        setVerdict({
          outcome: lu1.package.alreadyReceived ? 'ALREADY_RECEIVED' : 'PREVIEW',
          accepted: false,
          message: lu1.package.alreadyReceived
            ? `Déjà reçu — ${lu1.package.receivedBy ?? 'opérateur inconnu'}, le ${formatDateTime(lu1.package.receivedAt)}.`
            : `${lu1.package.customerName} — prêt à être reçu.`,
          package: lu1.package,
          receivedAt: lu1.package.receivedAt,
          receivedBy: lu1.package.receivedBy,
        });
      } else {
        setVerdict({
          outcome: lu1.kind === 'malformed' ? 'MALFORMED_CODE' : 'UNKNOWN_CODE',
          accepted: false,
          message:
            lu1.kind === 'malformed'
              ? `« ${lu} » n'est ni un code-barres valide ni un numéro de colis.`
              : `Aucun colis ne porte le code « ${lu} ».`,
          package: null,
        });
      }
    } catch (error) {
      setVerdict({
        outcome: 'UNKNOWN_CODE',
        accepted: false,
        message:
          error instanceof Error
            ? error.message
            : 'Serveur injoignable. Le code n\'a pas pu être vérifié — réessayez le scan.',
        package: null,
      });
    } finally {
      setIsBusy(false);
      rendreFocus();
    }
  };

  const aspect = verdict ? ASPECT[verdict.outcome] : null;
  const Icone = aspect?.icon;
  const colis = verdict?.package ?? null;

  return (
    <div className="flex-1 p-4 lg:p-6 space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ScanLine className="w-4 h-4" />
            Dépôt / Acceptation Magasin
          </h1>
          <p className="text-[11px] text-slate-600 mt-0.5">
            Scannez un code-barres, ou saisissez le numéro du colis.
          </p>
        </div>

        <label htmlFor="depot-accueil" className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] uppercase font-semibold text-slate-600 shrink-0">
            Dépôt d'accueil
          </span>
          <select
            id="depot-accueil"
            value={depotId}
            onChange={(event) => {
              setDepotId(event.target.value);
              // Le verdict affiché appartenait au dépôt précédent : le laisser
              // afficher « Réception enregistrée » pendant que la liste des
              // réceptions change de dépôt, c'est afficher une vérité fausse.
              setVerdict(null);
              // Changer de dépôt une seule fois suffisait à perdre le focus du
              // lecteur pour le reste de la session : le `onBlur` du champ
              // sagement laisse la main à un `select`, et personne ne la rendait
              // ensuite. Or l'opérateur enchaîne les scans à l'aveugle.
              rendreFocus();
            }}
            className="min-w-0 px-2 py-1.5 text-sm border border-slate-300 rounded-md bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-600/20"
          >
            {depots.length === 0 && <option value="">Chargement des dépôts…</option>}
            {depots.map((depot) => (
              <option key={depot.id} value={depot.id}>
                {depot.code} — {depot.name}
                {depot.isMainHub ? ' (hub)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Lecteur */}
      <form onSubmit={surSoumission} className="bg-white border border-slate-200 rounded-lg shadow-2xs p-3">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          <div className="relative flex-1">
            <Barcode className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              ref={champRef}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Scanner un code-barres, ou saisir le numéro du colis…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              // Le lecteur se comporte comme un clavier : sans ce retour, un clic
              // dans une zone neutre perdrait la saisie suivante. En revanche,
              // un clic sur le dépôt d'accueil ou sur un bouton laisse la main
              // à ce contrôle — lui voler le focus fermerait le sélecteur que
              // l'opérateur venait d'ouvrir.
              onBlur={(event) => {
                const cible = event.relatedTarget as HTMLElement | null;
                if (cible?.closest('select, button, a, input, textarea')) return;
                rendreFocus();
              }}
              aria-invalid={verdict && !verdict.accepted ? true : undefined}
              aria-describedby={verdict && !verdict.accepted ? 'verdict-message' : undefined}
              aria-label="Code-barres ou numéro de colis à recevoir"
              className="w-full min-w-[240px] pl-9 pr-3 py-2.5 text-sm font-mono font-semibold border border-slate-300 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600/30 focus:border-red-500"
            />
          </div>

          <button
            type="submit"
            disabled={isBusy || !code.trim()}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-md text-xs font-semibold transition flex items-center justify-center gap-1.5"
          >
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <ScanLine className="w-4 h-4" aria-hidden="true" />
            )}
            Recevoir
          </button>

          <button
            type="button"
            onClick={() => void previsualiser()}
            disabled={isBusy || !code.trim()}
            className="px-4 py-2.5 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-md text-xs font-semibold transition flex items-center justify-center gap-1.5"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
            Chercher
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          « Recevoir » enregistre la réception. « Chercher » ne fait que retrouver le colis et
          afficher son état.
        </p>
      </form>

      {/* Verdict */}
      {verdict && aspect && Icone && (
        /* `role="status"` : le verdict est la réponse à un scan. Sans annonce,
           un agent qui ne regarde pas l'écran ne sait pas si le colis est passé. */
        <div role="status" aria-live="polite" className={`rounded-lg border p-3 ${aspect.tone}`}>
          <div className="flex items-start gap-2">
            <Icone className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">{aspect.titre}</p>
              <p id="verdict-message" className="text-[11px] mt-0.5 whitespace-pre-line">
                {verdict.message}
              </p>

              {colis && (
                <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      Colis
                    </span>
                    <button
                      type="button"
                      onClick={() => router.push(`/colis/${colis.id}`)}
                      className="font-mono font-semibold underline underline-offset-2"
                    >
                      {colis.trackingNumber}
                    </button>
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      Destinataire
                    </span>
                    {colis.customerName}
                    <span className="block font-mono opacity-70">{colis.customerPhone}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      Statut
                    </span>
                    {colis.statusLabel}
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      À encaisser
                    </span>
                    <span className="font-mono whitespace-nowrap">
                      {formatTND(colis.totalPrice)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      Expéditeur
                    </span>
                    {colis.shipperName}
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      Destination
                    </span>
                    {colis.city || colis.governorate || '—'}
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">Dépôt</span>
                    {colis.currentDepositName ?? '—'}
                  </div>
                  <div>
                    <span className="block text-[11px] uppercase font-semibold opacity-80">
                      Code-barres
                    </span>
                    <span className="font-mono">{colis.barcode}</span>
                  </div>
                </div>
              )}

              {/* La réception qui a déjà eu lieu : qui, et quand. C'est ce qui
                  répond à l'opérateur qui se demande si son scan est passé. */}
              {verdict.outcome === 'ALREADY_RECEIVED' && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold">
                  <Info className="w-3.5 h-3.5" />
                  Reçu le {formatDateTime(verdict.receivedAt)}
                  {verdict.receivedBy ? ` par ${verdict.receivedBy}` : ''}
                  {colis?.currentDepositName ? ` à ${colis.currentDepositName}` : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Réceptions récentes */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
            <PackageSearch className="w-3.5 h-3.5 text-slate-500" />
            Réceptions récentes
          </h2>
          <span className="text-[11px] text-slate-500 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {depots.find((d) => d.id === depotId)?.name ?? 'Tous dépôts'}
          </span>
        </div>

        {erreurRecents && (
          <ErrorBanner message={erreurRecents} onDismiss={() => setErreurRecents(null)} />
        )}

        {recents.length === 0 ? (
          <p className="p-6 text-center text-[11px] text-slate-500">
            Aucune réception à cet dépôt.
          </p>
        ) : (
          <Table libelle="Réceptions récentes au dépôt" largeurMin="720px">
            <Thead>
              <tr>
                <Th figee>Reçu le</Th>
                <Th>Colis</Th>
                <Th>Destinataire</Th>
                <Th priorite="secondaire">Expéditeur</Th>
                <Th priorite="tertiaire">Opérateur</Th>
                <Th priorite="tertiaire">Dépôt</Th>
              </tr>
            </Thead>
            <Tbody>
              {recents.map((r) => (
                <Tr
                  key={r.id}
                  resume={`Réception du colis ${r.trackingNumber}, ${r.customerName}, par ${r.operatorName}`}
                >
                  <Td figee className="font-mono whitespace-nowrap text-slate-600">
                    {formatDateTime(r.receivedAt)}
                  </Td>
                  <Td className="font-mono font-semibold whitespace-nowrap">
                    {/* La route `/colis/<id>` n'existe pas : chaque clic partait
                        sur une 404. Le numéro saisi dans la recherche relit la
                        fiche, et le lien est partageable. */}
                    <button
                      type="button"
                      onClick={() => router.push(`/colis?tracking=${r.trackingNumber}`)}
                      className="inline-flex items-center min-h-6 px-1 -mx-1 rounded text-red-600 hover:underline cursor-pointer"
                    >
                      {r.trackingNumber}
                    </button>
                  </Td>
                  <Td>{r.customerName}</Td>
                  <Td priorite="secondaire">{r.shipperName}</Td>
                  <Td priorite="tertiaire" className="whitespace-nowrap">
                    {r.operatorName}
                  </Td>
                  <Td priorite="tertiaire" className="whitespace-nowrap">
                    {r.locationName ?? '—'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  );
}