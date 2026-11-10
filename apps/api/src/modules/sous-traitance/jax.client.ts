/**
 * Client de l'API JAX (partenaire de livraison en sous-traitance).
 *
 * D'après la collection Postman fournie par JAX — toutes les routes prennent
 * le jeton en paramètre `token` :
 *
 *   POST /user/colis/add                       créer un colis → code EAN
 *   POST /client/createByean                   demander un enlèvement (liste d'EAN)
 *   GET  /user/colis/getstatubyean/{ean}       statut d'un colis
 *   GET  /user/colis/getstatut_uptated/{ref}   statut et date de mise à jour
 *   GET  /user/colis/colisByean/{ean}          fiche d'un colis
 *   GET  /user/colis/AllColisByean             plusieurs colis (GET avec corps : non utilisé,
 *                                              un client HTTP standard n'envoie pas de corps en GET)
 *   GET  /client/colisProbleme/{ref}           problèmes signalés sur un colis
 *   GET  /statuts/                             référentiel des statuts
 *   GET  /gouvernorats                         référentiel des gouvernorats (identifiants numériques)
 *
 * La collection ne documente pas les réponses : elles sont lues avec
 * tolérance (plusieurs noms de champ possibles), et la réponse brute
 * (tronquée) accompagne toute erreur pour le diagnostic.
 *
 * Configuration (variables d'environnement de l'API) :
 *   JAX_API_TOKEN 🔒  jeton fourni par JAX — sans lui, la sous-traitance est désactivée ;
 *   JAX_API_URL       défaut https://core.jax-delivery.com/api ;
 *   JAX_EXPEDITEUR_NOM / JAX_EXPEDITEUR_TEL  l'expéditeur vu par JAX (défaut RUNEX) ;
 *   JAX_STATUT_ENLEVEMENT  `colis_statut` d'une demande d'enlèvement (défaut 10, comme l'exemple JAX) ;
 *   JAX_SYNC_MINUTES  fréquence de relecture des statuts (défaut 10, 0 = désactivée).
 *
 * Le jeton n'apparaît jamais dans un message d'erreur ni dans un journal.
 */

export class JaxError extends Error {
  constructor(
    message: string,
    /** Statut HTTP renvoyé par JAX — volontairement pas `status` : il ne doit
     *  jamais devenir le statut de la réponse Runex (un 401 JAX n'est pas une
     *  session Runex expirée). */
    readonly statutJax: number | null = null,
    readonly brut: string | null = null
  ) {
    super(message);
    this.name = 'JaxError';
  }
}

export interface JaxConfig {
  url: string;
  token: string | null;
  expediteurNom: string;
  expediteurTel: string;
  statutEnlevement: string;
  syncMinutes: number;
}

export function jaxConfig(): JaxConfig {
  const token = process.env.JAX_API_TOKEN?.trim() || null;
  return {
    url: (process.env.JAX_API_URL?.trim() || 'https://core.jax-delivery.com/api').replace(/\/+$/, ''),
    token,
    expediteurNom: process.env.JAX_EXPEDITEUR_NOM?.trim() || 'RUNEX',
    expediteurTel: process.env.JAX_EXPEDITEUR_TEL?.trim() || '',
    statutEnlevement: process.env.JAX_STATUT_ENLEVEMENT?.trim() || '10',
    syncMinutes: Number(process.env.JAX_SYNC_MINUTES ?? 10),
  };
}

const DELAI_MS = Number(process.env.JAX_TIMEOUT_MS ?? 20_000);
const extrait = (v: string) => v.replace(/\s+/g, ' ').slice(0, 300);

type Json = unknown;

async function appel(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<Json> {
  const cfg = jaxConfig();
  if (!cfg.token) {
    throw new JaxError('Sous-traitance JAX non configurée : le jeton JAX (JAX_API_TOKEN) est absent sur le serveur.', null);
  }
  const url = `${cfg.url}${chemin}${chemin.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_MS);
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: methode,
      headers: { Accept: 'application/json', ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const raison = e instanceof Error && e.name === 'AbortError' ? `pas de réponse en ${DELAI_MS / 1000} s` : 'connexion impossible';
    throw new JaxError(`API JAX injoignable (${raison}).`);
  } finally {
    clearTimeout(minuteur);
  }
  const texte = await reponse.text();
  let json: Json = texte;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    /* réponse non JSON : gardée en texte */
  }
  if (!reponse.ok) {
    const msg = messageDe(json) ?? extrait(texte) ?? '';
    throw new JaxError(
      reponse.status === 401 || reponse.status === 403
        ? 'JAX refuse le jeton (JAX_API_TOKEN invalide ou expiré).'
        : `JAX a répondu ${reponse.status}${msg ? ` : ${msg}` : ''}.`,
      reponse.status,
      extrait(texte)
    );
  }
  // Certaines API répondent 200 avec { success: false, message }.
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (o.success === false || o.status === 'error' || o.error === true) {
      throw new JaxError(`JAX a refusé la demande${messageDe(o) ? ` : ${messageDe(o)}` : ''}.`, reponse.status, extrait(texte));
    }
  }
  return json;
}

/* ------------------------------------------------------------------ */
/* Lecture tolérante des réponses                                       */
/* ------------------------------------------------------------------ */

function messageDe(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  for (const k of ['message', 'msg', 'error', 'erreur', 'errors']) {
    const x = o[k];
    if (typeof x === 'string' && x.trim()) return extrait(x);
    if (x && typeof x === 'object') return extrait(JSON.stringify(x));
  }
  return null;
}

/** Parcourt un objet JSON (profondeur limitée) et rend les paires clé/valeur. */
function* parcours(v: unknown, profondeur = 0, cle = ''): Generator<[string, unknown]> {
  if (profondeur > 5 || v === null || v === undefined) return;
  if (Array.isArray(v)) {
    for (const x of v) yield* parcours(x, profondeur + 1, cle);
    return;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      yield [k, x];
      yield* parcours(x, profondeur + 1, k);
    }
  }
}

const EAN = /^[A-Z]{2,4}\d{6,}$/;

/** Code EAN du colis dans la réponse de création. */
export function lireEan(reponse: unknown): string | null {
  if (typeof reponse === 'string' && EAN.test(reponse.trim())) return reponse.trim();
  const preferes = ['ean', 'code_ean', 'codeEan', 'code_barre', 'codeBarre', 'barcode', 'code', 'tracking', 'reference'];
  const vus: [string, unknown][] = [...parcours(reponse)];
  for (const cle of preferes) {
    const trouve = vus.find(([k, v]) => k.toLowerCase() === cle.toLowerCase() && typeof v === 'string' && EAN.test(v.trim()));
    if (trouve) return String(trouve[1]).trim();
  }
  const quelconque = vus.find(([, v]) => typeof v === 'string' && EAN.test(v.trim()));
  return quelconque ? String(quelconque[1]).trim() : null;
}

export interface StatutJax {
  code: string | null;
  libelle: string;
  le: Date | null;
}

const CLES_LIBELLE = ['libelle', 'label', 'nom', 'name', 'statut_libelle', 'libelle_statut', 'status_name', 'statut_name', 'etat'];
const CLES_CODE = ['statut_id', 'status_id', 'id_statut', 'code_statut', 'statut_code', 'code'];
const CLES_DATE = ['updated_at', 'updatedAt', 'date_statut', 'date_update', 'date', 'created_at'];

/** Statut d'un colis, quelle que soit la forme de la réponse. */
export function lireStatut(reponse: unknown): StatutJax | null {
  if (typeof reponse === 'string' && reponse.trim()) return { code: null, libelle: extrait(reponse), le: null };
  let code: string | null = null;
  let libelle: string | null = null;
  let le: Date | null = null;
  const prends = (o: Record<string, unknown>) => {
    for (const k of ['statut', 'status', 'etat']) {
      const x = o[k];
      if (typeof x === 'string' && x.trim() && !libelle) {
        if (/^\d+$/.test(x.trim())) code ??= x.trim();
        else libelle = x.trim();
      } else if (typeof x === 'number') code ??= String(x);
      else if (x && typeof x === 'object' && !Array.isArray(x)) {
        const s = x as Record<string, unknown>;
        code ??= s.id !== undefined ? String(s.id) : s.code !== undefined ? String(s.code) : null;
        for (const c of CLES_LIBELLE) if (!libelle && typeof s[c] === 'string') libelle = String(s[c]).trim();
      }
    }
  };
  if (reponse && typeof reponse === 'object') {
    const racines: Record<string, unknown>[] = [];
    const base = reponse as Record<string, unknown>;
    racines.push(base);
    for (const k of ['data', 'colis', 'result', 'response']) {
      const x = base[k];
      if (x && typeof x === 'object') racines.push(...(Array.isArray(x) ? (x as Record<string, unknown>[]) : [x as Record<string, unknown>]));
    }
    for (const r of racines) prends(r);
    for (const [k, v] of parcours(reponse)) {
      if (!libelle && CLES_LIBELLE.includes(k) && typeof v === 'string' && v.trim()) libelle = v.trim();
      if (!code && CLES_CODE.includes(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) code = String(v).trim();
      if (!le && CLES_DATE.includes(k) && typeof v === 'string') {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) le = d;
      }
    }
  }
  if (!libelle && !code) return null;
  return { code, libelle: libelle ?? `Statut ${code}`, le };
}

/** Éléments d'une liste de référentiel (`[{id, nom}]`, `{data: [...]}`…). */
export function lireReferentiel(reponse: unknown): { id: string; nom: string }[] {
  const liste = Array.isArray(reponse)
    ? reponse
    : reponse && typeof reponse === 'object'
      ? (Object.values(reponse as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? []
      : [];
  const sortie: { id: string; nom: string }[] = [];
  for (const el of liste) {
    if (!el || typeof el !== 'object') continue;
    const o = el as Record<string, unknown>;
    const id = o.id ?? o.code ?? o.value;
    const nom = ['nom', 'libelle', 'name', 'label', 'gouvernorat', 'statut', 'title'].map((k) => o[k]).find((x) => typeof x === 'string' && x.trim());
    if ((typeof id === 'string' || typeof id === 'number') && typeof nom === 'string') sortie.push({ id: String(id), nom: nom.trim() });
  }
  return sortie;
}

/** Texte lisible des problèmes signalés (liste, objet ou texte). */
export function lireProblemes(reponse: unknown): string | null {
  if (!reponse) return null;
  if (typeof reponse === 'string') return reponse.trim() ? extrait(reponse) : null;
  const textes: string[] = [];
  for (const [k, v] of parcours(reponse)) {
    if (typeof v === 'string' && v.trim() && /probl|motif|comment|description|remarque|message|libelle|raison/i.test(k)) textes.push(v.trim());
  }
  const uniques = [...new Set(textes)].filter((t) => !/^(ok|success|aucun)$/i.test(t));
  return uniques.length ? uniques.join(' · ').slice(0, 1000) : null;
}

/* ------------------------------------------------------------------ */
/* Routes JAX                                                           */
/* ------------------------------------------------------------------ */

export interface ColisJax {
  referenceExterne: string;
  nomContact: string;
  tel: string;
  tel2: string;
  adresseLivraison: string;
  governorat: string;
  delegation: string;
  description: string;
  cod: string;
  echange: 0 | 1;
  gouvernorat_pickup: number | string;
  adresse_pickup: string;
  expediteur_phone: number | string;
  expediteur_name: string;
}

export const jaxClient = {
  creerColis: (colis: ColisJax) => appel('POST', '/user/colis/add', colis),
  demanderEnlevement: (corps: { adresse: string; nbrColis: string; colis_statut: string; colis_list: string[]; note: string; gouvernorat_id: number | string }) =>
    appel('POST', '/client/createByean', corps),
  statut: (ean: string) => appel('GET', `/user/colis/getstatubyean/${encodeURIComponent(ean)}`),
  statutDate: (ref: string) => appel('GET', `/user/colis/getstatut_uptated/${encodeURIComponent(ref)}`),
  colis: (ean: string) => appel('GET', `/user/colis/colisByean/${encodeURIComponent(ean)}`),
  problemes: (ref: string) => appel('GET', `/client/colisProbleme/${encodeURIComponent(ref)}`),
  statuts: () => appel('GET', '/statuts/'),
  /**
   * Montant à encaisser d'un colis. La collection d'API fournie par JAX n'a pas
   * de route de modification : elle n'est appelée que si JAX en communique une
   * (JAX_ROUTE_MODIF_PRIX, ex. « /user/colis/update/{ean} »).
   */
  modifierPrix: (ean: string, prix: number) => {
    const route = process.env.JAX_ROUTE_MODIF_PRIX?.trim();
    if (!route) return Promise.reject(new JaxError('Pas de route JAX de modification du prix.', null));
    return appel('POST', route.replace('{ean}', encodeURIComponent(ean)), { ean, prix, cod: prix });
  },
  gouvernorats: () => appel('GET', '/gouvernorats'),
};
