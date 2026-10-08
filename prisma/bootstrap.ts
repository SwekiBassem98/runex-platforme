/**
 * Initialisation d'une base de PRODUCTION (vide, migrations appliquées).
 *
 * Contrairement à `seed.ts`, ce script ne crée AUCUN compte de démonstration,
 * aucun colis, aucun expéditeur fictif. Il pose seulement :
 *   - les rôles système ;
 *   - la société, les agences et les dépôts de référence ;
 *   - le premier administrateur, avec l'email et le mot de passe fournis.
 *
 * Il est idempotent : relancé, il ne modifie ni ne duplique rien, sauf
 * `BOOTSTRAP_RESET_ADMIN_PASSWORD=true` qui réécrit le mot de passe de
 * l'administrateur (récupération d'accès).
 *
 *   DATABASE_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_NAME="…" ADMIN_PHONE=… \
 *     npx tsx prisma/bootstrap.ts
 *
 * Le mot de passe n'est jamais affiché ni journalisé.
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

/* Même format que l'API (apps/api/src/common/auth/jwt.util.ts). */
const PBKDF2_ITERATIONS = Number(process.env.PASSWORD_HASH_ITERATIONS ?? 210_000);
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Administrateur' },
  { name: 'ADMIN_GENERAL', displayName: 'Administrateur Général' },
  { name: 'DISPATCHER', displayName: 'Exploitant / Dispatcher' },
  { name: 'MAGASINIER', displayName: 'Magasinier' },
  { name: 'CAISSIER', displayName: 'Caissier' },
  { name: 'EXPEDITEUR_ADMIN', displayName: 'Expéditeur Administrateur' },
  { name: 'EXPEDITEUR_USER', displayName: 'Expéditeur Utilisateur' },
  { name: 'LIVREUR', displayName: 'Livreur' },
] as const;

const BRANCHES = [
  { code: 'BR-BEN-AROUS', name: 'Agence Ben Arous', governorate: 'Ben Arous', address: 'Zone industrielle, Ben Arous', phone: '27400001' },
  { code: 'BR-TUNIS', name: 'Agence Tunis Centre', governorate: 'Tunis', address: 'Avenue Habib Bourguiba, Tunis', phone: '71300001' },
  { code: 'BR-SOUSSE', name: 'Agence Sousse', governorate: 'Sousse', address: 'Avenue Yasser Arafat, Sousse', phone: '73200001' },
  { code: 'BR-SFAX', name: 'Agence Sfax', governorate: 'Sfax', address: 'Avenue Al Massila, Sfax', phone: '74200001' },
];

const DEPOSITS = [
  { code: 'DEP-BEN-AROUS-HUB', name: 'Hub Central Ben Arous', governorate: 'Ben Arous', city: 'Ben Arous', address: 'Zone industrielle, Ben Arous', isMainHub: true, branchCode: 'BR-BEN-AROUS', phone: '27400001' },
  { code: 'DEP-TUNIS-AGT', name: 'Agence Tunis', governorate: 'Tunis', city: 'Tunis', address: 'Avenue Habib Bourguiba, Tunis', isMainHub: false, branchCode: 'BR-TUNIS', phone: '71300001' },
  { code: 'DEP-SOUSSE-AGT', name: 'Agence Sousse', governorate: 'Sousse', city: 'Sousse', address: 'Avenue Yasser Arafat, Sousse', isMainHub: false, branchCode: 'BR-SOUSSE', phone: '73200001' },
  { code: 'DEP-SFAX-AGT', name: 'Agence Sfax', governorate: 'Sfax', city: 'Sfax', address: 'Avenue Al Massila, Sfax', isMainHub: false, branchCode: 'BR-SFAX', phone: '74200001' },
];

/** Mots de passe trop connus pour un compte administrateur exposé sur Internet. */
const FORBIDDEN = /^(admin123!?|password1?!?|azerty|motdepasse|changeme)$/i;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable obligatoire manquante : ${name}`);
  return value;
}

function checkPassword(password: string): void {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length < 12 || classes < 3 || FORBIDDEN.test(password)) {
    throw new Error(
      'ADMIN_PASSWORD trop faible : 12 caractères minimum, avec au moins 3 types parmi ' +
        'minuscules, majuscules, chiffres et symboles.'
    );
  }
}

const prisma = new PrismaClient();

async function main() {
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  const fullName = process.env.ADMIN_NAME?.trim() || 'Administrateur RUNEX';
  const phone = process.env.ADMIN_PHONE?.trim() || '00000000';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL invalide.');
  checkPassword(password);

  const company = await prisma.company.upsert({
    where: { code: 'LOGIXPRESS-TN' },
    create: {
      code: 'LOGIXPRESS-TN',
      legalName: process.env.COMPANY_LEGAL_NAME?.trim() || 'RUNEX Tunisie',
      taxRegistration: process.env.COMPANY_TAX_ID?.trim() || '0000000/A/M/000',
      headquarters: process.env.COMPANY_ADDRESS?.trim() || 'Ben Arous, Tunisie',
      contactPhone: process.env.COMPANY_PHONE?.trim() || '27400000',
      contactEmail: process.env.COMPANY_EMAIL?.trim() || email,
    },
    update: {},
  });
  console.log(`Société        ${company.legalName}`);

  const branchByCode = new Map<string, string>();
  for (const b of BRANCHES) {
    const r = await prisma.branch.upsert({
      where: { code: b.code },
      create: { ...b, email: `${b.code.toLowerCase().replace(/-/g, '.')}@runex.tn`, companyId: company.id },
      update: {},
    });
    branchByCode.set(b.code, r.id);
  }
  let hubId = '';
  for (const { branchCode, ...d } of DEPOSITS) {
    const r = await prisma.deposit.upsert({
      where: { code: d.code },
      create: { ...d, companyId: company.id, branchId: branchByCode.get(branchCode) ?? null },
      update: {},
    });
    if (d.isMainHub) hubId = r.id;
  }
  console.log(`Agences/dépôts ${BRANCHES.length} / ${DEPOSITS.length}`);

  const roleIds = new Map<string, string>();
  for (const role of ROLES) {
    const r = await prisma.role.upsert({
      where: { name: role.name },
      create: { name: role.name, displayName: role.displayName, description: role.displayName, isSystem: true },
      update: {},
    });
    roleIds.set(role.name, r.id);
  }
  console.log(`Rôles          ${ROLES.length}`);

  const existing = await prisma.user.findUnique({ where: { email } });
  const resetPassword = process.env.BOOTSTRAP_RESET_ADMIN_PASSWORD === 'true';
  const admin = existing
    ? resetPassword
      ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: hashPassword(password) } })
      : existing
    : await prisma.user.create({
        data: { email, passwordHash: hashPassword(password), fullName, phone, companyId: company.id, depositId: hubId || null },
      });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roleIds.get('SUPER_ADMIN')! } },
    create: { userId: admin.id, roleId: roleIds.get('SUPER_ADMIN')! },
    update: {},
  });
  console.log(
    `Administrateur ${email} — ${existing ? (resetPassword ? 'mot de passe réinitialisé' : 'déjà présent, inchangé') : 'créé'}`
  );

  // Garde-fou : signale les comptes de démonstration s'ils existent (seed
  // lancé par erreur sur cette base) — leurs mots de passe sont publics.
  const demo = await prisma.user.count({
    where: { email: { in: ['admin@logixpress.tn', 'gestionnaire@logixpress.tn', 'livreur.hamza@logixpress.tn'] } },
  });
  if (demo > 0) {
    console.warn(
      `\n⚠ ${demo} compte(s) de démonstration présent(s) dans cette base (mots de passe publics) : ` +
        'désactivez-les depuis Administration → Utilisateurs.'
    );
  }
  console.log('\nInitialisation terminée.');
}

main()
  .catch((error: unknown) => {
    console.error('\nÉchec :', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
