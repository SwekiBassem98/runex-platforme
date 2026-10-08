import { getPrisma } from '../../common/database/prisma-context';
import { BusinessRuleError, isUuid } from '../../common/errors/api-error';

const VALID_PLATFORMS = new Set(['android', 'ios', 'web']);

function normalizePlatform(raw: unknown): string {
  const v = String(raw ?? 'android').trim().toLowerCase();
  return VALID_PLATFORMS.has(v) ? v : 'android';
}

export class DevicesService {
  private get prisma() {
    return getPrisma();
  }

  async listForUser(userId: string) {
    return this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        token: true,
        platform: true,
        deviceId: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Enregistre ou met à jour un jeton poussé pour l'utilisateur authentifié.
   *
   * Le jeton appartient toujours au `userId` du jeton JWT, jamais à un
   * identifiant fourni par le client. Un même jeton réenregistré par un autre
   * utilisateur est réassigné — l'ancien propriétaire perd ce jeton, pour
   * éviter qu'un téléphone revendu continue de recevoir les notifications du
   * précédent livreur.
   */
  async registerToken(
    userId: string,
    input: { token: string; platform?: string; deviceId?: string | null }
  ) {
    const token = String(input.token ?? '').trim();
    if (token.length < 20) {
      throw new BusinessRuleError('Jeton FCM invalide : trop court.', 400);
    }
    if (token.length > 500) {
      throw new BusinessRuleError('Jeton FCM trop long (max 500).', 400);
    }
    const platform = normalizePlatform(input.platform);
    const deviceId = input.deviceId ? String(input.deviceId).trim().slice(0, 255) || null : null;

    const existing = await this.prisma.pushDevice.findUnique({ where: { token } });

    // Même utilisateur : réactivation ; autre utilisateur : transfert de
    // propriété (l'appareil a changé de main) ; sinon création.
    const device = existing
      ? await this.prisma.pushDevice.update({
          where: { token },
          data: { userId, platform, deviceId, isActive: true, lastSeenAt: new Date() },
        })
      : await this.prisma.pushDevice.create({
          data: { userId, token, platform, deviceId, isActive: true },
        });

    // Enregistrer un appareil vaut consentement aux notifications poussées :
    // sans cela `pushEnabled` restait à sa valeur par défaut (false) et le
    // canal push ignorait tous les appareils.
    await this.prisma.user.update({ where: { id: userId }, data: { pushEnabled: true } });

    return device;
  }

  async removeToken(userId: string, token: string) {
    const t = String(token ?? '').trim();
    if (!t) throw new BusinessRuleError('Jeton requis.', 400);

    const device = await this.prisma.pushDevice.findFirst({
      where: { token: t, userId },
    });
    if (!device) {
      // Idempotent : supprimer un jeton inexistant n'est pas une erreur — le
      // client peut rejouer la déconnexion sans craindre un 404.
      return { removed: 0 };
    }
    await this.prisma.pushDevice.update({
      where: { id: device.id },
      data: { isActive: false },
    });
    return { removed: 1 };
  }

  async removeDevice(userId: string, deviceId: string) {
    const id = String(deviceId ?? '').trim();
    if (!id) throw new BusinessRuleError('Identifiant appareil requis.', 400);
    if (!isUuid(id)) throw new BusinessRuleError('Appareil introuvable.', 404);
    const result = await this.prisma.pushDevice.updateMany({
      where: { id, userId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new BusinessRuleError('Appareil introuvable.', 404);
    }
    return { removed: result.count };
  }
}

export const devicesService = new DevicesService();
