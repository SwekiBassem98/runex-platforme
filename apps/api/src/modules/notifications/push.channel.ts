/**
 * Canal « push » — notification système du téléphone via FCM.
 *
 * La notification est déjà écrite en base : le canal ne fait que réveiller le
 * téléphone. Un téléphone éteint ne perd rien — il verra la notification dans
 * l'application à la prochaine ouverture.
 *
 * Le canal respecte :
 * - `User.pushEnabled === false` → skipped (l'utilisateur a coupé le push) ;
 * - aucun appareil actif → skipped (pas d'échec, pas de réessai inutile) ;
 * - FCM non configuré → skipped (graceful degradation en développement) ;
 * - jeton invalide → failed + désactivation (pas de spam futur) ;
 * - erreur réseau → failed (rejouable via le registre `NotificationDelivery`).
 */

import type { NotificationChannel, ChannelContext, ChannelResult } from './channels';
import { NOTIFICATION_CHANNELS } from './channels';
import { getPrisma } from '../../common/database/prisma-context';
import { isPushEnabled, sendToUser } from './push.service';

export const pushChannel: NotificationChannel = {
  name: NOTIFICATION_CHANNELS.PUSH,

  supports: (ctx: ChannelContext): boolean => {
    // La vérification fine (appareil actif, pushEnabled) est faite dans
    // `deliver` ; `supports` ne filtre que le cas où le poussé est globalement
    // désactivé — pour que le registre note `skipped` plutôt que `failed`.
    // Si FCM n'est pas configuré, on reste en skipped pour ne pas polluer le
    // registre de tentatives vouées à l'échec.
    // On laisse passer si au moins un appareil pourrait exister : la requête
    // suivante le dira. Le coût est une lecture DB courte, négligeable.
    return true;
  },

  deliver: async (ctx: ChannelContext): Promise<ChannelResult> => {
    try {
      // Respect du choix utilisateur : si `pushEnabled` est explicitement faux,
      // on ne réveille pas l'appareil.
      const prisma = getPrisma();
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { pushEnabled: true },
      });
      if (user?.pushEnabled === false) {
        return { status: 'skipped', error: 'Push désactivé par l\'utilisateur' };
      }

      const hasDevice = await prisma.pushDevice.count({
        where: { userId: ctx.userId, isActive: true },
      });
      const legacyToken = hasDevice === 0
        ? (await prisma.user.findUnique({ where: { id: ctx.userId }, select: { pushToken: true } }))?.pushToken ?? null
        : null;
      if (hasDevice === 0 && !legacyToken) {
        return { status: 'skipped', error: 'Aucun appareil enregistré' };
      }

      if (!isPushEnabled()) {
        return { status: 'skipped', error: 'FCM non configuré (skipped)' };
      }

      const result = await sendToUser(ctx.userId, ctx.notification);

      if (result.failed.length > 0 && result.succeeded.length === 0) {
        // Tous les jetons invalides → failed (déjà désactivés par le service)
        const first = result.failed[0]!;
        const isInvalid = first.invalid;
        return {
          status: isInvalid ? 'failed' : 'failed',
          error: first.error,
          externalId: null,
        };
      }

      if (result.succeeded.length > 0) {
        return { status: 'sent', error: null, externalId: result.succeeded[0] ?? null };
      }

      // Aucun jeton à envoyer (cas déjà filtré) → skipped
      return { status: 'skipped', error: 'Aucun jeton actif' };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
      };
    }
  },
};
