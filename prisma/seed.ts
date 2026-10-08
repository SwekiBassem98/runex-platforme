/**
 * Jeu de données de référence LogiXpress.
 *
 * Crée les enregistrements dont le schéma relationnel a besoin (entreprise,
 * agences, dépôts, expéditeurs, clients, livreurs, utilisateurs) puis un
 * portefeuille de colis couvrant les différents stades du cycle de vie.
 *
 * Le script est idempotent : rejoué sans paramètre, il ne recrée pas les
 * colis mais complète le référentiel.
 *
 *   npm run prisma:seed
 */

import { PrismaClient, Prisma, PackageStatus, PackageType, PackageSize } from '@prisma/client';
import crypto from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Hachage des mots de passe (format identique à celui de l'API)      */
/* ------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha512';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Hachage du code secret de déblocage d'un bordereau.
 *
 * Colonne `VarChar(100)` : le format PBKDF2 des mots de passe (161 caractères)
 * n'y tient pas. On utilise donc un condensat SHA-256 (64 caractères hex) avec
 * un sel court, soit 81 caractères. Le même format est appliqué et vérifié par
 * l'API lors du décaissement.
 */
function hashPaymentCode(code: string): string {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.pbkdf2Sync(code, salt, 50000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Référentiels                                                       */
/* ------------------------------------------------------------------ */

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

/** Rôle métier de l'API (celui des permissions) ↔ rôle du schéma Prisma. */
const API_ROLE_TO_PRISMA: Record<string, (typeof ROLES)[number]['name']> = {
  ADMIN: 'SUPER_ADMIN',
  GESTIONNAIRE: 'DISPATCHER',
  EXPEDITEUR: 'EXPEDITEUR_ADMIN',
  LIVREUR: 'LIVREUR',
  AGENT_DEPOT: 'MAGASINIER',
  FINANCE: 'CAISSIER',
};

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

const SHIPPERS = [

  { code: 'EXP-BLUESTAR', companyName: 'BlueStar E-Commerce', brandName: 'BlueStar', taxId: '1234567/A/M/000', phone: '58199108', email: 'contact@bluestar.tn', governorate: 'Ben Arous', address: 'Zone industrielle, Ben Arous', secretCode: '1234' },
  { code: 'EXP-BENHCINE', companyName: 'Benhcine Delivery', brandName: 'Benhcine', taxId: '7654321/B/M/000', phone: '71234567', email: 'commandes@benhcine.tn', governorate: 'Tunis', address: 'Avenue Habib Bourguiba, Tunis', secretCode: '5678' },
  { code: 'EXP-TECHSTORE', companyName: 'TechStore Tunisie', brandName: 'TechStore', taxId: '9876543/C/M/000', phone: '70345678', email: 'support@techstore.tn', governorate: 'Sousse', address: 'Avenue Yasser Arafat, Sousse', secretCode: '9012' },
];

const CUSTOMERS = [
  { code: 'CLI-2026-000001', fullName: 'Mohamed Ben Salah', primaryPhone: '20123456', governorate: 'Ben Arous', delegation: 'Ben Arous', locality: 'El Mourouj', streetAddress: 'Rue des Roses 12' },
  { code: 'CLI-2026-000002', fullName: 'Sarra Bouazizi', primaryPhone: '22554433', governorate: 'Tunis', delegation: 'Tunis', locality: 'Menzah', streetAddress: 'Cité El Amal, Bâtiment B' },
  { code: 'CLI-2026-000003', fullName: 'Ahmed Ksouri', primaryPhone: '98765432', governorate: 'Sousse', delegation: 'Sousse', locality: 'Khezama', streetAddress: 'Avenue Taieb Mhiri 45' },
  { code: 'CLI-2026-000004', fullName: 'Nadia Gharbi', primaryPhone: '50778899', governorate: 'Sfax', delegation: 'Sfax', locality: 'Sfax Ville', streetAddress: 'Route de Gabes 88' },
  { code: 'CLI-2026-000005', fullName: 'Youssef Meddeb', primaryPhone: '96112233', governorate: 'Ariana', delegation: 'Ariana', locality: 'Lafayette', streetAddress: 'Rue de la Liberte 7' },
];

/**
 * Comptes de démonstration.
 *
 * Les identifiants et mots de passe sont identiques à ceux utilisés
 * jusqu'ici par l'API : la migration vers la base ne change rien pour
 * l'utilisateur.
 */
const USERS = [
  { email: 'admin@logixpress.tn', password: 'Admin123!', fullName: 'Sami Khemir (Super Administrateur)', phone: '21000001', apiRole: 'ADMIN', depositCode: 'DEP-BEN-AROUS-HUB' },
  { email: 'gestionnaire@logixpress.tn', password: 'Gest123!', fullName: 'Yassine Dridi (Chef Exploitation)', phone: '22000002', apiRole: 'GESTIONNAIRE', depositCode: 'DEP-BEN-AROUS-HUB' },
  { email: 'agent.magasin@logixpress.tn', password: 'Agent123!', fullName: 'Slim Amri (Agent Depot)', phone: '23000003', apiRole: 'AGENT_DEPOT', depositCode: 'DEP-BEN-AROUS-HUB' },
  { email: 'finance@logixpress.tn', password: 'Fin123!', fullName: 'Ines Ben Amor (Finance)', phone: '24000004', apiRole: 'FINANCE', depositCode: 'DEP-BEN-AROUS-HUB' },
  { email: 'expediteur@bluestar.tn', password: 'Exp123!', fullName: 'Karim BlueStar (Expediteur)', phone: '58199108', apiRole: 'EXPEDITEUR', shipperCode: 'EXP-BLUESTAR' },
  { email: 'livreur.hamza@logixpress.tn', password: 'Liv123!', fullName: 'Hamza Ben Dhif (Livreur)', phone: '50123456', apiRole: 'LIVREUR', driverCode: 'LIV-BEN-001', depositCode: 'DEP-BEN-AROUS-HUB' },
  { email: 'livreur.ghassan@logixpress.tn', password: 'Liv123!', fullName: 'Ghassen Trabelsi (Livreur)', phone: '50765432', apiRole: 'LIVREUR', driverCode: 'LIV-SOU-002', depositCode: 'DEP-BEN-AROUS-HUB' },
];

const DRIVERS = [
  { driverCode: 'LIV-BEN-001', vehicleType: 'Moto', licensePlate: '214 TUN 4512', cashCeiling: '2000.000' },
  { driverCode: 'LIV-SOU-002', vehicleType: 'Camionnette', licensePlate: '208 TUN 8890', cashCeiling: '3500.000' },
  { driverCode: 'LIV-SOU-003', vehicleType: 'Berline', licensePlate: '201 TUN 2231', cashCeiling: '5000.000' },
];

/* ------------------------------------------------------------------ */
/* Utilitaires                                                        */
/* ------------------------------------------------------------------ */

function buildTrackingNumber(sequence: number): string {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}${String(900000 + sequence)}`;
}

interface SeedContext {
  hub: { id: string; name: string };
  deposits: Map<string, { id: string; name: string }>;
  shippers: Map<string, { id: string; name: string }>;
  customers: Map<string, { id: string; fullName: string; primaryPhone: string; addressId: string; governorate: string }>;
  users: Map<string, { id: string; fullName: string; apiRole: string }>;
  drivers: { id: string; driverCode: string; fullName: string }[];
}

async function seedReferenceData(): Promise<SeedContext> {
  console.log('Referentiel\n');

  const company = await prisma.company.upsert({
    where: { code: 'LOGIXPRESS-TN' },
    create: {
      code: 'LOGIXPRESS-TN',
      legalName: 'LogiXpress Tunisie SARL',
      taxRegistration: '9876543/M/000',
      headquarters: 'Zone industrielle, Ben Arous 4061, Tunisie',
      contactPhone: '27400000',
      contactEmail: 'contact@logixpress.tn',
    },
    update: {},
  });
  console.log(`  Societe       ${company.legalName}`);

  const branchByCode = new Map<string, string>();
  for (const branch of BRANCHES) {
    const record = await prisma.branch.upsert({
      where: { code: branch.code },
      create: {
        code: branch.code,
        name: branch.name,
        governorate: branch.governorate,
        address: branch.address,
        phone: branch.phone,
        email: `${branch.code.toLowerCase().replace(/-/g, '.')}@logixpress.tn`,
        companyId: company.id,
      },
      update: {},
    });
    branchByCode.set(branch.code, record.id);
  }
  console.log(`  Agences       ${BRANCHES.length}`);

  const deposits = new Map<string, { id: string; name: string }>();
  for (const deposit of DEPOSITS) {
    const record = await prisma.deposit.upsert({
      where: { code: deposit.code },
      create: {
        code: deposit.code,
        name: deposit.name,
        governorate: deposit.governorate,
        city: deposit.city,
        address: deposit.address,
        isMainHub: deposit.isMainHub,
        phone: deposit.phone,
        companyId: company.id,
        branchId: branchByCode.get(deposit.branchCode) ?? null,
      },
      update: {},
    });
    deposits.set(deposit.code, { id: record.id, name: record.name });
  }
  const hub = deposits.get('DEP-BEN-AROUS-HUB')!;
  console.log(`  Depots        ${DEPOSITS.length} (hub : ${hub.name})`);

  const roleByName = new Map<string, string>();
  for (const role of ROLES) {
    const record = await prisma.role.upsert({
      where: { name: role.name },
      create: { name: role.name, displayName: role.displayName, description: role.displayName, isSystem: true },
      update: {},
    });
    roleByName.set(role.name, record.id);
  }
  console.log(`  Roles         ${ROLES.length}`);

  const shippers = new Map<string, { id: string; name: string }>();
  for (const shipper of SHIPPERS) {
    const record = await prisma.shipper.upsert({
      where: { code: shipper.code },
      create: {
        code: shipper.code,
        companyName: shipper.companyName,
        brandName: shipper.brandName,
        taxId: shipper.taxId,
        phone: shipper.phone,
        email: shipper.email,
        governorate: shipper.governorate,
        address: shipper.address,
        config: {
          create: {
            defaultDeliveryFee: '7.000',
            defaultReturnFee: '3.000',
            defaultExchangeFee: '8.000',
            // Code secret de déblocage des bordereaux (démonstration).
            secretPaymentCode: hashPaymentCode(shipper.secretCode),
            bankName: 'Banque de Tunisie',
            bankRib: '20001234567890123456',
            canOpenPackage: false,
            allowPartialDelivery: true,
          },
        },
      },
      update: {},
    });
    shippers.set(shipper.code, { id: record.id, name: record.brandName ?? record.companyName });
  }
  console.log(`  Expediteurs   ${SHIPPERS.length}`);

  const customers = new Map<string, { id: string; fullName: string; primaryPhone: string; addressId: string; governorate: string }>();
  for (const customer of CUSTOMERS) {
    const record = await prisma.customer.upsert({
      where: { code: customer.code },
      create: {
        code: customer.code,
        fullName: customer.fullName,
        primaryPhone: customer.primaryPhone,
        phones: { create: [{ phoneNumber: customer.primaryPhone, label: 'Personnel', isVerified: true }] },
        addresses: {
          create: {
            governorate: customer.governorate,
            delegation: customer.delegation,
            locality: customer.locality,
            streetAddress: customer.streetAddress,
            isDefault: true,
          },
        },
      },
      update: {},
      include: { addresses: true },
    });
    const address = record.addresses[0];
    if (!address) continue;
    customers.set(customer.code, {
      id: record.id,
      fullName: record.fullName,
      primaryPhone: record.primaryPhone,
      addressId: address.id,
      governorate: address.governorate,
    });
  }
  console.log(`  Clients       ${CUSTOMERS.length}`);

  const users = new Map<string, { id: string; fullName: string; apiRole: string }>();
  for (const user of USERS) {
    const prismaRole = API_ROLE_TO_PRISMA[user.apiRole]!;
    const deposit = user.depositCode ? deposits.get(user.depositCode) : undefined;

    const record = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        email: user.email,
        passwordHash: hashPassword(user.password),
        fullName: user.fullName,
        phone: user.phone,
        companyId: company.id,
        depositId: deposit?.id ?? null,
      },
      update: deposit ? { depositId: deposit.id } : {},
    });

    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: record.id, roleId: roleByName.get(prismaRole)! } },
      create: { userId: record.id, roleId: roleByName.get(prismaRole)! },
      update: {},
    });

    if (user.shipperCode) {
      const shipper = shippers.get(user.shipperCode)!;
      await prisma.shipperUser.upsert({
        where: { userId: record.id },
        create: { userId: record.id, shipperId: shipper.id, isPrimaryContact: true },
        update: {},
      });
    }

    users.set(user.email, { id: record.id, fullName: user.fullName, apiRole: user.apiRole });
  }
  console.log(`  Utilisateurs  ${USERS.length}`);

  // Livreurs : rattachement au compte de démonstration quand il existe,
  // sinon création d'un compte dédié.
  const drivers: { id: string; driverCode: string; fullName: string }[] = [];
  for (const driver of DRIVERS) {
    const owner = USERS.find((u) => u.driverCode === driver.driverCode);
    let userId: string;
    let fullName: string;

    if (owner) {
      const user = await prisma.user.findUnique({ where: { email: owner.email } });
      userId = user!.id;
      fullName = user!.fullName;
    } else {
      const email = `${driver.driverCode.toLowerCase().replace(/-/g, '.')}@logixpress.tn`;
      const created = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          passwordHash: hashPassword('Liv123!'),
          fullName: `${driver.driverCode} (Livreur)`,
          phone: '50000000',
          companyId: company.id,
          depositId: hub.id,
        },
        update: {},
      });
      userId = created.id;
      fullName = created.fullName;
      await prisma.userRoleAssignment.upsert({
        where: { userId_roleId: { userId: created.id, roleId: roleByName.get('LIVREUR')! } },
        create: { userId: created.id, roleId: roleByName.get('LIVREUR')! },
        update: {},
      });
    }

    const record = await prisma.driver.upsert({
      where: { driverCode: driver.driverCode },
      create: {
        driverCode: driver.driverCode,
        vehicleType: driver.vehicleType,
        licensePlate: driver.licensePlate,
        cashCeiling: driver.cashCeiling,
        userId,
      },
      update: { vehicleType: driver.vehicleType, licensePlate: driver.licensePlate },
    });
    drivers.push({ id: record.id, driverCode: record.driverCode, fullName });
  }
  console.log(`  Livreurs      ${drivers.length}`);

  return { hub, deposits, shippers, customers, users, drivers };
}

/* ------------------------------------------------------------------ */
/* Colis de démonstration                                             */
/* ------------------------------------------------------------------ */

interface Blueprint {
  customerCode: string;
  shipperCode: string;
  status: PackageStatus;
  packageType: PackageType;
  totalPrice: string;
  pieceCount: number;
  contentSummary: string;
  sizeCategory?: PackageSize;
  allowOpen?: boolean;
  isFragile?: boolean;
  driverIndex?: number;
  /** Age en heures : dater la création du colis dans le passé. */
  ageHours: number;
}

const BLUEPRINTS: Blueprint[] = [
  { customerCode: 'CLI-2026-000001', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.CREE, packageType: PackageType.NORMAL, totalPrice: '58.000', pieceCount: 2, contentSummary: '1 batterie externe + 1 chargeur', ageHours: 2 },
  { customerCode: 'CLI-2026-000002', shipperCode: 'EXP-BENHCINE', status: PackageStatus.CREE, packageType: PackageType.NORMAL, totalPrice: '120.500', pieceCount: 1, contentSummary: '1 smartphone reconditionne', allowOpen: true, isFragile: true, ageHours: 1 },
  { customerCode: 'CLI-2026-000004', shipperCode: 'EXP-BENHCINE', status: PackageStatus.CREE, packageType: PackageType.EXCHANGE, totalPrice: '180.000', pieceCount: 1, contentSummary: '1 article defectueux - echange', allowOpen: true, ageHours: 3 },
  { customerCode: 'CLI-2026-000005', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.CREE, packageType: PackageType.REPORTED, totalPrice: '130.000', pieceCount: 1, contentSummary: 'Colis signale manquant par le client', ageHours: 5 },
  { customerCode: 'CLI-2026-000003', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.RAMASSAGE_PROGRAMME, packageType: PackageType.NORMAL, totalPrice: '75.000', pieceCount: 3, contentSummary: '3 articles mode', sizeCategory: PackageSize.VOLUMINEUSE, ageHours: 8 },
  { customerCode: 'CLI-2026-000004', shipperCode: 'EXP-BENHCINE', status: PackageStatus.RECU_DEPOT, packageType: PackageType.NORMAL, totalPrice: '240.000', pieceCount: 1, contentSummary: '1 casque Bluetooth', allowOpen: true, isFragile: true, ageHours: 26 },
  { customerCode: 'CLI-2026-000005', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.RECU_DEPOT, packageType: PackageType.NORMAL, totalPrice: '45.000', pieceCount: 4, contentSummary: '4 accessoires maison', sizeCategory: PackageSize.LEGERE, ageHours: 24 },
  { customerCode: 'CLI-2026-000001', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.AFFECTE_RUNSHEET, packageType: PackageType.NORMAL, totalPrice: '88.000', pieceCount: 2, contentSummary: '1 montre + 1 bracelet', driverIndex: 0, ageHours: 30 },
  { customerCode: 'CLI-2026-000002', shipperCode: 'EXP-BENHCINE', status: PackageStatus.EN_COURS_LIVRAISON, packageType: PackageType.NORMAL, totalPrice: '199.000', pieceCount: 1, contentSummary: '1 tablette', sizeCategory: PackageSize.VOLUMINEUSE, driverIndex: 0, ageHours: 28 },
  { customerCode: 'CLI-2026-000005', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.REPORTE, packageType: PackageType.NORMAL, totalPrice: '95.000', pieceCount: 1, contentSummary: '1 appareil photo', driverIndex: 0, ageHours: 50 },
  { customerCode: 'CLI-2026-000003', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.LIVRE, packageType: PackageType.NORMAL, totalPrice: '64.000', pieceCount: 1, contentSummary: '1 ecouteurs sans fil', driverIndex: 1, ageHours: 72 },
  { customerCode: 'CLI-2026-000004', shipperCode: 'EXP-BENHCINE', status: PackageStatus.LIVRE, packageType: PackageType.NORMAL, totalPrice: '310.000', pieceCount: 2, contentSummary: '2 bouteilles whisky 30cl', driverIndex: 1, ageHours: 70 },
  { customerCode: 'CLI-2026-000001', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.LIVRAISON_PARTIELLE, packageType: PackageType.NORMAL, totalPrice: '150.000', pieceCount: 3, contentSummary: '3 articles de mode', driverIndex: 1, ageHours: 68 },
  { customerCode: 'CLI-2026-000002', shipperCode: 'EXP-BENHCINE', status: PackageStatus.ECHEC_LIVRAISON, packageType: PackageType.NORMAL, totalPrice: '72.000', pieceCount: 1, contentSummary: '1 imprimante', driverIndex: 0, ageHours: 40 },
  { customerCode: 'CLI-2026-000003', shipperCode: 'EXP-BLUESTAR', status: PackageStatus.RETOURNE_EXPEDITEUR, packageType: PackageType.RETURN, totalPrice: '0.000', pieceCount: 1, contentSummary: 'Retour article indisponible', ageHours: 96 },
];

/** Libellé français d'un statut, pour la chronologie de démonstration. */
const STATUS_LABELS: Record<string, string> = {
  CREE: 'Cree par expediteur',
  RAMASSAGE_PROGRAMME: 'Ramassage programme',
  RECU_DEPOT: 'Recu au depot',
  AFFECTE_RUNSHEET: 'Affecte a une tournee',
  EN_COURS_LIVRAISON: 'Livraison en cours',
  REPORTE: 'Livraison reportee',
  LIVRE: 'Colis livre et paiement encaisse',
  LIVRAISON_PARTIELLE: 'Livraison partielle',
  ECHEC_LIVRAISON: 'Echec de livraison',
  RETOURNE_EXPEDITEUR: 'Restitue a expediteur',
};

async function seedPackages(ctx: SeedContext) {
  console.log('Donnees metier\n');

  const existing = await prisma.package.count();
  if (existing > 0) {
    console.log(`  ${existing} colis deja presents - creation ignoree.`);
  } else {
    let created = 0;
    for (const [index, blueprint] of BLUEPRINTS.entries()) {
      const customer = ctx.customers.get(blueprint.customerCode);
      const shipper = ctx.shippers.get(blueprint.shipperCode);
      if (!customer || !shipper) continue;

      const trackingNumber = buildTrackingNumber(index + 1);
      const driver = blueprint.driverIndex !== undefined ? ctx.drivers[blueprint.driverIndex] : undefined;
      const createdAt = new Date(Date.now() - blueprint.ageHours * 3600_000);
      const isDelivered = blueprint.status === PackageStatus.LIVRE;

      await prisma.package.create({
        data: {
          trackingNumber,
          barcode: trackingNumber,
          shipperReference: `CMD-${1000 + index}`,
          shipperId: shipper.id,
          customerId: customer.id,
          customerAddressId: customer.addressId,
          assignedDriverId: driver?.id ?? null,
          originDepositId: ctx.hub.id,
          currentDepositId: ctx.hub.id,
          // Agence qui livre : celle du gouvernorat du destinataire, sinon le hub.
          destinationDepositId: depositForGovernorate(ctx, customer.governorate),
          packageType: blueprint.packageType,
          status: blueprint.status,
          sizeCategory: blueprint.sizeCategory ?? PackageSize.MOYENNE,
          pieceCount: blueprint.pieceCount,
          contentSummary: blueprint.contentSummary,
          allowOpen: blueprint.allowOpen ?? false,
          isFragile: blueprint.isFragile ?? false,
          totalPrice: blueprint.totalPrice,
          collectedAmount: isDelivered ? blueprint.totalPrice : '0.000',
          deliveryFee: '7.000',
          deliveredAt: isDelivered ? createdAt : null,
          createdAt,
          items: {
            create: {
              description: blueprint.contentSummary,
              quantity: blueprint.pieceCount,
              sizeCategory: blueprint.sizeCategory ?? PackageSize.MOYENNE,
            },
          },
          statusHistory: {
            create: {
              status: PackageStatus.CREE,
              title: 'Colis cree par expediteur',
              description: 'Colis enregistre sur le portail fournisseur',
              locationName: ctx.hub.name,
              operatorName: 'Systeme',
              createdAt,
            },
          },
        },
      });
      created += 1;
    }
    console.log(`  Colis         ${created} crees`);
  }

  // Les colis situés après la création portent un événement de plus dans leur
  // chronologie, afin que l'historique affiché soit représentatif.
  const advanced = await prisma.package.findMany({
    where: { status: { notIn: [PackageStatus.CREE, PackageStatus.RAMASSAGE_PROGRAMME] } },
  });
  for (const pkg of advanced) {
    const already = await prisma.packageTimeline.count({
      where: { packageId: pkg.id, status: pkg.status },
    });
    if (already > 0) continue;

    await prisma.packageTimeline.create({
      data: {
        packageId: pkg.id,
        status: pkg.status,
        title: STATUS_LABELS[pkg.status] ?? pkg.status,
        locationName: ctx.hub.name,
        operatorName: 'Systeme',
        createdAt: new Date(pkg.createdAt.getTime() + 3600_000 * 4),
      },
    });
  }
  if (advanced.length > 0) {
    console.log(`  Chronologies   ${advanced.length} colis Rennes a jour`);
  }

  /* --- Tentatives de livraison --- */
  const attemptable = await prisma.package.findMany({
    where: {
      status: {
        in: [
          PackageStatus.LIVRE,
          PackageStatus.REPORTE,
          PackageStatus.LIVRAISON_PARTIELLE,
          PackageStatus.ECHEC_LIVRAISON,
        ],
      },
      assignedDriverId: { not: null },
    },
  });
  for (const pkg of attemptable) {
    const attempts = await prisma.deliveryAttempt.count({ where: { packageId: pkg.id } });
    if (attempts > 0) continue;

    const result =
      pkg.status === PackageStatus.LIVRE
        ? 'REUSSIE'
        : pkg.status === PackageStatus.REPORTE
          ? 'REPORTEE'
          : pkg.status === PackageStatus.LIVRAISON_PARTIELLE
            ? 'LIVRAISON_PARTIELLE'
            : 'REFUSEE';

    await prisma.deliveryAttempt.create({
      data: {
        packageId: pkg.id,
        driverId: pkg.assignedDriverId!,
        attemptNumber: 1,
        result,
        callDurationSeconds: 45,
        driverComment: 'Appel effectue aupres du destinataire',
        attemptedAt: new Date(pkg.createdAt.getTime() + 3600_000 * 6),
      },
    });
  }
  console.log(`  Tentatives     ${attemptable.length} enregistrees`);

  /* --- Livraison partielle --- */
  const partial = await prisma.package.findFirst({
    where: { status: PackageStatus.LIVRAISON_PARTIELLE, partialDelivery: null },
  });
  if (partial) {
    // Le livreur ayant validé la livraison partielle est celui affecté au colis.
    const driver =
      (partial.assignedDriverId ? ctx.drivers.find((d) => d.id === partial.assignedDriverId) : undefined) ??
      ctx.drivers[0]!;

    await prisma.partialDelivery.create({
      data: {
        packageId: partial.id,
        deliveredDescription: '1 paire de chaussures pointure 42',
        returnedDescription: '1 chemise blanche taille M, 1 robe verte taille L',
        // Le colis de démonstration compte 3 pièces : une livrée, deux reprises.
        deliveredPieces: 1,
        returnedPieces: 2,
        originalAmount: partial.totalPrice.toString(),
        amountCollected: '80.000',
        amountReturned: '70.000',
        reason: 'Client refuse la seconde piece',
        validatedByDriverId: driver.id,
      },
    });
    console.log('  Partiel        1 livraison partielle');
  }

  /* --- Feuille de route --- */
  const hasRunsheet = await prisma.runsheet.count();
  if (hasRunsheet === 0) {
    const driver = ctx.drivers[0]!;
    const runsheet = await prisma.runsheet.create({
      data: {
        runsheetNumber: `RUN-1100${String(Date.now()).slice(-6)}`,
        depositId: ctx.hub.id,
        driverId: driver.id,
        type: 'DISTRIBUTION',
        status: 'EN_COURS',
        tourDate: new Date(),
        expectedCash: '382.000',
        totalPackages: 3,
        departureTime: new Date(Date.now() - 3600_000 * 4),
      },
    });

    const items = await prisma.package.findMany({
      where: {
        assignedDriverId: driver.id,
        status: {
          in: [
            PackageStatus.AFFECTE_RUNSHEET,
            PackageStatus.EN_COURS_LIVRAISON,
            PackageStatus.REPORTE,
          ],
        },
      },
      take: 3,
    });

    for (const [position, pkg] of items.entries()) {
      await prisma.runsheetItem.create({
        data: {
          runsheetId: runsheet.id,
          packageId: pkg.id,
          orderIndex: position + 1,
          isHandled: pkg.status !== PackageStatus.AFFECTE_RUNSHEET,
          statusAtClose: pkg.status,
          collectedAmount: pkg.collectedAmount,
        },
      });
    }
    console.log(`  Tournee        ${runsheet.runsheetNumber} (${items.length} colis)`);
  }

  /* --- Bordereau de paiement --- */
  const hasVoucher = await prisma.paymentVoucher.count();
  if (hasVoucher === 0) {
    const shipper = ctx.shippers.get('EXP-BLUESTAR')!;
    const voucher = await prisma.paymentVoucher.create({
      data: {
        voucherNumber: String(100000 + (Date.now() % 899999)),
        shipperId: shipper.id,
        status: 'CONFIRME',
        paymentMethod: 'ESPECE',
        deliveredCount: 12,
        returnedCount: 2,
        grossCashCollected: '1480.000',
        deliveryFeesTotal: '84.000',
        returnFeesTotal: '6.000',
        withholdingTaxTotal: '13.900',
        netPayable: '1376.100',
        secretCodeVerified: true,
      },
    });
    console.log(`  Bordereau      ${voucher.voucherNumber}`);
  }

  // Pas de bordereau inter-dépôt fictif : un bordereau se constitue au scan
  // de colis réels (voir l'écran « Ajouter un inter dépôt »).

  /* --- Rendez-vous de ramassage --- */
  const hasPickup = await prisma.pickupAppointment.count();
  if (hasPickup === 0) {
    const shipper = ctx.shippers.get('EXP-BLUESTAR')!;
    const pickup = await prisma.pickupAppointment.create({
      data: {
        referenceNumber: `RDV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-0001`,
        shipperId: shipper.id,
        scheduledDate: new Date(),
        timeSlotStartHour: 14,
        timeSlotEndHour: 15,
        pickupAddress: 'Zone industrielle, Ben Arous',
        contactPerson: 'Karim BlueStar',
        contactPhone: '58199108',
        packageEstimate: 6,
        status: 'A_CONFIRMER',
      },
    });
    console.log(`  Ramassage      ${pickup.referenceNumber}`);
  }
}

const DEPOSIT_BY_GOVERNORATE: Record<string, string> = {
  tunis: 'DEP-TUNIS-AGT',
  sousse: 'DEP-SOUSSE-AGT',
  sfax: 'DEP-SFAX-AGT',
};

function depositForGovernorate(ctx: SeedContext, governorate: string): string {
  const code = DEPOSIT_BY_GOVERNORATE[governorate.trim().toLowerCase()];
  return (code && ctx.deposits.get(code)?.id) || ctx.hub.id;
}

/* ------------------------------------------------------------------ */
/* Point d'entree                                                     */
/* ------------------------------------------------------------------ */

async function main() {
  // Le seed crée des comptes de démonstration aux mots de passe publics
  // (Admin123!, …) : il ne doit jamais tourner sur une base de production.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Seed de démonstration refusé en production (comptes aux mots de passe publics). ' +
        'Créez le premier administrateur manuellement.'
    );
  }
  const context = await seedReferenceData();
  await seedPackages(context);
  console.log('\nSeed termine.');
}

main()
  .catch((error) => {
    console.error('\nEchec du seed :', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
