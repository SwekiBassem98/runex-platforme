#!/usr/bin/env node
/**
 * Faux serveur JAX pour les tests (QA 45) — mêmes routes que la collection
 * Postman de JAX, jeton en paramètre `token`. Les formes de réponse sont des
 * hypothèses raisonnables : le client Runex les lit avec tolérance.
 *
 *   node qa/mock-jax-server.mjs            (port 4010, jeton « test-jax »)
 *
 * Routes de pilotage (tests) :
 *   POST /__control/statut   { ean, statutId }      fait avancer un colis
 *   POST /__control/probleme { ean, texte }         signale un problème
 *   GET  /__control/etat                            colis et enlèvements reçus
 *   POST /__control/reset
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_JAX_PORT ?? 4010);
const TOKEN = process.env.MOCK_JAX_TOKEN ?? 'test-jax';

const GOUVERNORATS = [
  'Tunis', 'Ariana', 'Ben arous', 'Manouba', 'Nabeul', 'Zaghouan', 'Bizerte', 'Beja', 'Jendouba', 'Kef', 'Siliana', 'Sousse',
  'Monastir', 'Mahdia', 'Sfax', 'Kairouan', 'Kasserine', 'Sidi Bouzid', 'Gabes', 'Medenine', 'Tataouine', 'Gafsa', 'Tozeur', 'Kebili',
].map((nom, i) => ({ id: i + 1, nom }));
const PREFIXES = { 1: 'TUN', 3: 'BEN', 12: 'SOU', 15: 'SFA', 5: 'NAB', 20: 'MED' };
const STATUTS = [
  { id: 1, libelle: 'En attente' },
  { id: 2, libelle: 'Enlevé' },
  { id: 3, libelle: 'Au dépôt JAX' },
  { id: 4, libelle: 'En cours de livraison' },
  { id: 5, libelle: 'Livré' },
  { id: 6, libelle: 'Retour expéditeur' },
  { id: 7, libelle: 'Annulé' },
  { id: 8, libelle: 'Reporté' },
];

let colis = new Map();
let enlevements = [];
let seq = 0;

const json = (res, code, corps) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corps));
};
const lire = (req) =>
  new Promise((ok) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { ok(b ? JSON.parse(b) : {}); } catch { ok(null); }
    });
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p.startsWith('/__control')) {
      const corps = req.method === 'POST' ? await lire(req) : {};
      if (p === '/__control/reset') { colis = new Map(); enlevements = []; return json(res, 200, { ok: true }); }
      if (p === '/__control/etat') return json(res, 200, { colis: [...colis.values()], enlevements });
      const c = colis.get(corps?.ean);
      if (!c) return json(res, 404, { message: 'colis inconnu' });
      if (p === '/__control/statut') { c.statut = STATUTS.find((s) => s.id === Number(corps.statutId)); c.updated_at = new Date().toISOString(); return json(res, 200, c); }
      if (p === '/__control/probleme') { c.problemes.push({ probleme: corps.texte, date: new Date().toISOString() }); return json(res, 200, c); }
      return json(res, 404, {});
    }
    if (url.searchParams.get('token') !== TOKEN) return json(res, 401, { message: 'Token invalide' });

    if (req.method === 'GET' && p === '/api/gouvernorats') return json(res, 200, { data: GOUVERNORATS });
    if (req.method === 'GET' && p === '/api/statuts') return json(res, 200, STATUTS);

    if (req.method === 'POST' && p === '/api/user/colis/add') {
      const b = await lire(req);
      const manque = ['referenceExterne', 'nomContact', 'tel', 'adresseLivraison', 'governorat', 'cod', 'gouvernorat_pickup', 'expediteur_name'].filter((k) => b?.[k] === undefined || b[k] === '');
      if (manque.length) return json(res, 422, { success: false, message: `Champs manquants : ${manque.join(', ')}` });
      if (!GOUVERNORATS.some((g) => String(g.id) === String(b.governorat))) return json(res, 422, { success: false, message: 'Gouvernorat inconnu' });
      seq++;
      const ean = `${PREFIXES[Number(b.governorat)] ?? 'JAX'}${String(2215600000000 + seq)}`;
      colis.set(ean, { ean, id: seq, recu: b, statut: STATUTS[0], updated_at: new Date().toISOString(), problemes: [] });
      return json(res, 200, { success: true, message: 'Colis ajouté avec succès', colis: { id: seq, ean, referenceExterne: b.referenceExterne } });
    }
    if (req.method === 'POST' && p === '/api/client/createByean') {
      const b = await lire(req);
      const inconnus = (b?.colis_list ?? []).filter((e) => !colis.has(e));
      if (!b?.colis_list?.length || inconnus.length) return json(res, 422, { success: false, message: `Colis inconnus : ${inconnus.join(', ')}` });
      const pk = { id: `PK${1000 + enlevements.length + 1}`, ...b };
      enlevements.push(pk);
      return json(res, 200, { success: true, data: { id: pk.id } });
    }
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/api\/user\/colis\/(getstatubyean|getstatut_uptated|colisByean)\/(.+)$/))) {
      const c = colis.get(decodeURIComponent(m[2])) ?? [...colis.values()].find((x) => x.recu.referenceExterne === decodeURIComponent(m[2]));
      if (!c) return json(res, 404, { message: 'Colis introuvable' });
      if (m[1] === 'colisByean') return json(res, 200, { data: { ...c.recu, ean: c.ean, statut: c.statut } });
      return json(res, 200, { ean: c.ean, statut: { id: c.statut.id, libelle: c.statut.libelle }, updated_at: c.updated_at });
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/client\/colisProbleme\/(.+)$/))) {
      const c = colis.get(decodeURIComponent(m[1]));
      if (!c) return json(res, 404, { message: 'Colis introuvable' });
      return json(res, 200, c.problemes);
    }
    return json(res, 404, { message: 'Route inconnue' });
  })
  .listen(PORT, () => console.log(`Faux JAX sur http://localhost:${PORT}/api (jeton ${TOKEN})`));
