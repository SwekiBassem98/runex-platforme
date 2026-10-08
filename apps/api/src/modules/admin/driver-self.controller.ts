import type { Response } from 'express';
import { RoleType } from '@logixpress/types';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { getPrisma } from '../../common/database/prisma-context';

/**
 * `GET /drivers/me` — la fiche du livreur connecté, pour l'écran Profil de
 * l'application mobile. Le livreur n'a pas `LIVREUR_READ` (la liste des
 * chauffeurs reste réservée au bureau) : il ne lit que lui-même, désigné par
 * son jeton.
 */
export async function getOwnDriverProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = req.user;
  if (!user || user.role !== RoleType.LIVREUR || !user.driverId) {
    res.status(403).json({ success: false, message: 'Réservé aux livreurs.' });
    return;
  }
  const driver = await getPrisma().driver.findUnique({
    where: { id: user.driverId },
    include: { user: { include: { deposit: { select: { id: true, name: true, governorate: true } } } } },
  });
  if (!driver || driver.deletedAt) {
    res.status(404).json({ success: false, message: 'Fiche livreur introuvable.' });
    return;
  }
  res.json({
    success: true,
    data: {
      id: driver.id,
      userId: driver.userId,
      driverCode: driver.driverCode,
      fullName: driver.user.fullName,
      email: driver.user.email,
      phone: driver.user.phone,
      vehicleType: driver.vehicleType,
      licensePlate: driver.licensePlate ?? undefined,
      isActive: driver.isActive,
      cashBalance: Number(driver.currentBalance),
      cashCeiling: Number(driver.cashCeiling),
      depositId: driver.user.deposit?.id,
      depositName: driver.user.deposit?.name,
      governorate: driver.user.deposit?.governorate,
    },
  });
}
