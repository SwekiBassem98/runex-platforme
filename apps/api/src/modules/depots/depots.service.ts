/**
 * Référentiel des dépôts.
 *
 * Ben Arous est le dépôt principal : il centralise les charges et sert de
 * point de transit par défaut. Le modèle en supporte néanmoins plusieurs,
 * parce que le réseau est régional — un dépôt n'est pas un cas particulier
 * du hub, c'est un site qui expédie et qui reçoit.
 *
 * Chaque dépôt porte son état opérationnel. La distinction est importante :
 * un dépôt fermé n'est pas un dépôt désactivé, et un dépôt en maintenance
 * continue de recevoir. C'est pourquoi `status` porte la sémantique et
 * `isActive` reste le simple filtre technique historique.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { DepositStatus, PackageStatus } from '@logixpress/types';
import { notFound, badRequest, conflict, asUuid } from '../../common/errors/api-error';

export interface DepositDto {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  governorate: string;
  zone: string | null;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  isMainHub: boolean;
  status: DepositStatus;
  managerId: string | null;
  managerName: string | null;
  managerPhone: string | null;
  /** Colis physiquement présents sur le site. */
  packagesCount: number;
  /** Colis immobilisés par un transfert inter-dépôts en cours. */
  inTransitCount: number;
  createdAt: string;
  updatedAt: string;
}

const DEPOSIT_INCLUDE = {
  manager: { select: { id: true, fullName: true, phone: true } },
  _count: { select: { currentPackages: true } },
} as const;

/**
 * Statuts de colis qu'un dépôt peut encore traiter.
 *
 * Le dépôt ne « contient » que des colis qui ne sont pas partis en livraison
 * ni en retour. Un colis livré reste comptabilisé par la requête d'historique,
 * mais il ne doit pas gonfler le stock disponible du site.
 */
const STOCKABLE_STATUSES: PackageStatus[] = [
  PackageStatus.CREE,
  PackageStatus.RAMASSAGE_PROGRAMME,
  PackageStatus.RAMASSE,
  PackageStatus.RECU_DEPOT,
  PackageStatus.REPORTE,
  PackageStatus.ECHEC_LIVRAISON,
  PackageStatus.RETOUR_DEPOT,
];

export class DepotsService {
  async findAll(filters?: { status?: string; search?: string }): Promise<DepositDto[]> {
    const prisma = getPrisma();

    const where: Record<string, unknown> = {};
    if (filters?.status && filters.status !== 'ALL') {
      where.status = filters.status as DepositStatus;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
        { city: { contains: filters.search, mode: 'insensitive' } },
        { address: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const records = await prisma.deposit.findMany({
      where,
      include: {
        ...DEPOSIT_INCLUDE,
        currentPackages: {
          where: { status: { in: STOCKABLE_STATUSES as never }, deletedAt: null },
          select: { id: true, interDepotTransferId: true },
        },
      },
      orderBy: [{ isMainHub: 'desc' }, { name: 'asc' }],
    });

    return records.map((record) => this.toDto(record));
  }

  async findById(identifier: string): Promise<DepositDto | null> {
    const prisma = getPrisma();
    const id = asUuid(identifier);
    if (!id) return null;

    const record = await prisma.deposit.findFirst({
      where: { OR: [{ id }, { code: identifier }] },
      include: {
        ...DEPOSIT_INCLUDE,
        currentPackages: {
          where: { status: { in: STOCKABLE_STATUSES as never }, deletedAt: null },
          select: { id: true, interDepotTransferId: true },
        },
      },
    });

    return record ? this.toDto(record) : null;
  }

  /** Dépôt principal, point de transit par défaut des charges. */
  async mainHub(): Promise<{ id: string; name: string; code: string }> {
    const prisma = getPrisma();
    const hub =
      (await prisma.deposit.findFirst({ where: { isMainHub: true, status: DepositStatus.ACTIF } })) ??
      (await prisma.deposit.findFirst({ where: { status: DepositStatus.ACTIF } }));
    if (!hub) throw badRequest('Aucun dépôt actif : le référentiel des dépôts est vide.');
    return { id: hub.id, name: hub.name, code: hub.code };
  }

  async create(payload: {
    code: string;
    name: string;
    address: string;
    city: string;
    governorate?: string;
    zone?: string;
    phone?: string;
    managerId?: string;
    isMainHub?: boolean;
    status?: DepositStatus;
    companyId?: string;
  }): Promise<DepositDto> {
    const prisma = getPrisma();

    if (!payload.code?.trim() || !payload.name?.trim() || !payload.city?.trim()) {
      throw badRequest('Les champs « Code », « Nom » et « Ville » sont obligatoires.');
    }

    const existing = await prisma.deposit.findUnique({ where: { code: payload.code.trim() } });
    if (existing) {
      throw conflict(`Le code dépôt « ${payload.code} » est déjà utilisé.`);
    }

    const companyId = await this.resolveCompanyId(payload.companyId);
    const managerId = await this.resolveManager(payload.managerId);

    if (payload.isMainHub) {
      // Ben Arous est unique : deux dépôts principaux rendraient la notion de
      // dépôt de transit par défaut ambiguë.
      await prisma.deposit.updateMany({ where: { isMainHub: true }, data: { isMainHub: false } });
    }

    const created = await prisma.deposit.create({
      data: {
        code: payload.code.trim(),
        name: payload.name.trim(),
        address: (payload.address ?? '').trim(),
        city: payload.city.trim(),
        governorate: (payload.governorate ?? payload.city ?? '').trim(),
        zone: payload.zone?.trim() ?? null,
        phone: payload.phone?.trim() ?? '',
        managerId,
        isMainHub: payload.isMainHub ?? false,
        status: payload.status ?? DepositStatus.ACTIF,
        companyId,
      },
    });

    await auditService.record({
      entityType: 'DEPOSIT',
      entityId: created.id,
      action: 'DEPOT_CREE',
      reason: `Dépôt ${created.name} (${created.code}) créé.`,
    });

    const record = await prisma.deposit.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        ...DEPOSIT_INCLUDE,
        currentPackages: {
          where: { status: { in: STOCKABLE_STATUSES as never }, deletedAt: null },
          select: { id: true, interDepotTransferId: true },
        },
      },
    });
    return this.toDto(record);
  }

  async update(
    identifier: string,
    patch: Partial<{
      name: string;
      address: string;
      city: string;
      governorate: string;
      zone: string;
      phone: string;
      managerId: string | null;
      status: DepositStatus;
      isMainHub: boolean;
      isActive: boolean;
    }>,
    actor?: { id?: string }
  ): Promise<DepositDto> {
    const prisma = getPrisma();
    const id = asUuid(identifier);
    if (!id) throw notFound('Dépôt introuvable.');

    const current = await prisma.deposit.findUnique({ where: { id } });
    if (!current) throw notFound('Dépôt introuvable.');

    if (patch.status && !Object.values(DepositStatus).includes(patch.status)) {
      throw badRequest(`État de dépôt inconnu : ${patch.status}.`);
    }

    // Fermer un dépôt qui détient encore une charge laisserait ces colis sans
    // site : ils ne seraient plus déplaçables, ni réceptionnables nulle part.
    if (patch.status === DepositStatus.FERME) {
      const stock = await prisma.package.count({
        where: { currentDepositId: id, deletedAt: null, interDepotTransferId: null },
      });
      if (stock > 0) {
        throw conflict(
          `Impossible de fermer « ${current.name} » : ${stock} colis y sont encore ` +
            'présentés. Videz le dépôt ou retirez-les d\'abord.'
        );
      }
    }

    if (patch.isMainHub) {
      await prisma.deposit.updateMany({ where: { isMainHub: true }, data: { isMainHub: false } });
    }

    if (patch.managerId !== undefined) {
      patch.managerId = await this.resolveManager(patch.managerId);
    }

    await prisma.deposit.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.address !== undefined ? { address: patch.address.trim() } : {}),
        ...(patch.city !== undefined ? { city: patch.city.trim() } : {}),
        ...(patch.governorate !== undefined ? { governorate: patch.governorate.trim() } : {}),
        ...(patch.zone !== undefined ? { zone: patch.zone?.trim() || null } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone.trim() } : {}),
        ...(patch.managerId !== undefined ? { managerId: patch.managerId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.isMainHub !== undefined ? { isMainHub: patch.isMainHub } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });

    await auditService.record({
      entityType: 'DEPOSIT',
      entityId: id,
      action: 'DEPOT_MODIFIE',
      reason: `Dépôt ${current.name} mis à jour.`,
      previousValues: { status: current.status, managerId: current.managerId },
      newValues: patch,
      userId: actor?.id,
    });

    const updated = await prisma.deposit.findUniqueOrThrow({
      where: { id },
      include: {
        ...DEPOSIT_INCLUDE,
        currentPackages: {
          where: { status: { in: STOCKABLE_STATUSES as never }, deletedAt: null },
          select: { id: true, interDepotTransferId: true },
        },
      },
    });
    return this.toDto(updated);
  }

  /** CompanyId par défaut : la société du dépôt principal, sinon la première. */
  private async resolveCompanyId(companyId?: string): Promise<string> {
    const prisma = getPrisma();
    const explicit = asUuid(companyId);
    if (explicit) return explicit;

    const hub = await prisma.deposit.findFirst({
      where: { isMainHub: true },
      select: { companyId: true },
    });
    if (hub) return hub.companyId;

    const first = await prisma.company.findFirst({ select: { id: true } });
    if (!first) throw badRequest('Aucune société en base : impossible de rattacher un dépôt.');
    return first.id;
  }

  private async resolveManager(managerId?: string | null): Promise<string | null> {
    if (managerId === null || managerId === undefined || managerId === '') return null;
    const id = asUuid(managerId);
    if (!id) throw badRequest('Identifiant de responsable invalide.');
    const user = await getPrisma().user.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw notFound('Responsable introuvable ou désactivé.');
    return user.id;
  }

  private toDto(record: any): DepositDto {
    const packages = record.currentPackages as { id: string; interDepotTransferId: string | null }[];
    return {
      id: record.id,
      code: record.code,
      name: record.name,
      address: record.address,
      city: record.city,
      governorate: record.governorate,
      zone: record.zone,
      phone: record.phone,
      latitude: record.latitude,
      longitude: record.longitude,
      isMainHub: record.isMainHub,
      status: record.status as DepositStatus,
      managerId: record.managerId,
      managerName: record.manager?.fullName ?? null,
      managerPhone: record.manager?.phone ?? null,
      packagesCount: packages.length,
      inTransitCount: packages.filter((p) => p.interDepotTransferId !== null).length,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const depotsService = new DepotsService();
