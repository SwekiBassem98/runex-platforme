import { Router } from 'express';
import { healthController } from './modules/health/health.controller';
import { authController } from './modules/auth/auth.controller';
import { colisController } from './modules/colis/colis.controller';
import { scanController } from './modules/scan/scan.controller';
import { runsheetsController } from './modules/runsheets/runsheets.controller';
import { notificationsController } from './modules/notifications/notifications.controller';
import { ramassagesController } from './modules/ramassages/ramassages.controller';
import { paymentsController } from './modules/payments/payments.controller';
import { interDepotsController } from './modules/inter-depots/inter-depots.controller';
import { depotsController } from './modules/depots/depots.controller';
import { dashboardController } from './modules/dashboard/dashboard.controller';
import { inventoryController } from './modules/inventory/inventory.controller';
import { inventoryExceptionsController } from './modules/inventory/inventory-exceptions.controller';
import { devicesController } from './modules/devices/devices.controller';
import { presenceController } from './modules/presence/presence.controller';
import { getOwnDriverProfile } from './modules/admin/driver-self.controller';
import { searchController } from './modules/search/search.controller';
import { auditController } from './modules/audit/audit.controller';
import { reportsController } from './modules/reports/reports.controller';
import { receptionController } from './modules/depot/reception.controller';
import {
  usersController,
  shippersController,
  driversController,
} from './modules/admin/admin.controller';
import { openApiSpecification } from './common/swagger/swagger.config';
import { asyncHandler } from './common/http/async-handler';
import {
  loginFailuresLimiter,
  loginIpLimiter,
  refreshLimiter,
  passwordResetLimiter,
  voucherSecretLimiter,
} from './common/http/rate-limit';
import {
  authenticateToken,
  requireRoles,
  requirePermissions,
  requireAnyPermission,
} from './common/auth/auth.middleware';
import { RoleType, PermissionCode } from '@logixpress/types';

/**
 * Rôles autorisés à déclarer un événement de livraison (démarrage, livraison,
 * échec, report, échange, retour) : le livreur, sur ses propres colis, et
 * l'exploitation depuis le back-office. Un expéditeur détient COLIS_UPDATE pour
 * modifier ses colis, mais ne déclare jamais une livraison.
 */
const FIELD_ROLES = [RoleType.LIVREUR, RoleType.ADMIN, RoleType.GESTIONNAIRE] as const;

export function createApiRouter(): Router {
  const router = Router();

  // Chemins canoniques + alias historiques.
  // `/packages` et `/pickups` sont conservés car l'application Vite archivée
  // (legacy/vite-app) appelle encore ces URLs.
  const COLIS = ['/colis', '/packages'];
  const COLIS_ITEM = ['/colis/:identifier', '/packages/:identifier'];
  // Variantes de la route d'un colis, suffixe ajouté à chaque alias.
  const withColisSuffix = (suffix: string): string[] =>
    COLIS_ITEM.map((path) => `${path}${suffix}`);
  const COLIS_ACTION_CANCEL = ['/colis/:identifier/cancel', '/packages/:identifier/cancel'];
  const COLIS_ACTION_ASSIGN = ['/colis/:identifier/assign', '/packages/:identifier/assign'];
  const COLIS_ACTION_DELIVER = ['/colis/:identifier/deliver', '/packages/:identifier/deliver'];
  const COLIS_ACTION_PARTIAL_DELIVERY = [
    '/colis/:identifier/partial-delivery',
    '/packages/:identifier/partial-delivery',
  ];
  const COLIS_ACTION_EXCHANGE = ['/colis/:identifier/exchange', '/packages/:identifier/exchange'];
  const COLIS_ACTION_POSTPONE = ['/colis/:identifier/postpone', '/packages/:identifier/postpone'];
  const COLIS_ACTION_RETURN = ['/colis/:identifier/return', '/packages/:identifier/return'];
  const COLIS_ACTION_START = ['/colis/:identifier/start', '/packages/:identifier/start'];
  const COLIS_ACTION_FAILED = ['/colis/:identifier/failed-attempt', '/packages/:identifier/failed-attempt'];
  const COLIS_ACTION_RETURN_TO_SHIPPER = [
    '/colis/:identifier/return-to-shipper',
    '/packages/:identifier/return-to-shipper',
  ];
  const RAMASSAGES = ['/ramassages', '/pickups'];
  const RAMASSAGE_DRIVER_ACTIVE = ['/ramassages/driver/active', '/pickups/driver/active'];
  const RAMASSAGE_ITEM = ['/ramassages/:id', '/pickups/:id'];
  const RAMASSAGE_PACKAGES = ['/ramassages/:id/packages', '/pickups/:id/packages'];
  const RAMASSAGE_CONFIRM = ['/ramassages/:id/confirm', '/pickups/:id/confirm'];
  const RAMASSAGE_ASSIGN = ['/ramassages/:id/assign', '/pickups/:id/assign'];
  const RAMASSAGE_START = ['/ramassages/:id/start', '/pickups/:id/start'];
  const RAMASSAGE_COMPLETE = ['/ramassages/:id/complete', '/pickups/:id/complete'];
  const RAMASSAGE_CANCEL = ['/ramassages/:id/cancel', '/pickups/:id/cancel'];
  const INTER_DEPOTS = ['/inter-depots', '/inter-depot'];
  const INTER_DEPOT_ITEM = ['/inter-depots/:id', '/inter-depot/:id'];
  const INTER_DEPOT_PREPARE = ['/inter-depots/:id/prepare', '/inter-depot/:id/prepare'];
  const INTER_DEPOT_DISPATCH = ['/inter-depots/:id/dispatch', '/inter-depot/:id/dispatch'];
  const INTER_DEPOT_RECEIVE = ['/inter-depots/:id/receive', '/inter-depot/:id/receive'];
  const INTER_DEPOT_CANCEL = ['/inter-depots/:id/cancel', '/inter-depot/:id/cancel'];
  const DEPOTS = ['/depots', '/deposits'];
  const DEPOT_ITEM = ['/depots/:id', '/deposits/:id'];
  // Les agrégats sont déclarés avant l'élément : Express matche dans
  // l'ordre, et « /payments/summary » deviendrait sinon un identifiant.
  const PAYMENTS = '/payments';
  const PAYMENTS_SUMMARY = '/payments/summary';
  const PAYMENTS_BY_SHIPPER = '/payments/by-shipper';
  const PAYMENTS_BY_DRIVER = '/payments/by-driver';
  const PAYMENTS_ITEM = '/payments/:id';
  const PAYMENTS_VALIDATE = '/payments/:id/validate';
  const PAYMENTS_REJECT = '/payments/:id/reject';

  // -------------------------------------------------------------
  // Routes Publiques
  // -------------------------------------------------------------

  // Health check
  router.get('/health', asyncHandler((req, res) => healthController.check(req, res)));

  // Swagger OpenAPI Documentation
  // Documentation OpenAPI : ouverte en développement, fermée en production
  // sauf décision explicite (ENABLE_API_DOCS=true).
  const docsEnabled = (): boolean =>
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true';
  router.use('/docs', (req, res, next) => {
    if (docsEnabled()) {
      next();
      return;
    }
    res.status(404).json({ success: false, message: 'Ressource introuvable.' });
  });

  router.get('/docs/json', (req, res) => {
    res.json(openApiSpecification);
  });

  router.get('/docs', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>RUNEX - Documentation API Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { background-color: #121417 !important; border-bottom: 3px solid #DC2626; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/api/v1/docs/json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`);
  });

  // Authentification publique
  router.post('/auth/login', loginIpLimiter, loginFailuresLimiter, asyncHandler((req, res) => authController.login(req, res)));
  router.post('/auth/refresh', refreshLimiter, asyncHandler((req, res) => authController.refreshToken(req, res)));
  router.get('/auth/demo-users', asyncHandler((req, res) => authController.getDemoUsers(req, res)));
  router.post(
    '/auth/password-reset/request',
    passwordResetLimiter,
    asyncHandler((req, res) => authController.requestPasswordReset(req, res))
  );
  router.post(
    '/auth/password-reset/confirm',
    passwordResetLimiter,
    asyncHandler((req, res) => authController.confirmPasswordReset(req, res))
  );

  // -------------------------------------------------------------
  // Routes Protégées par Authentification & RBAC / PBAC
  // -------------------------------------------------------------

  // Profil et session courante
  router.get('/auth/me', authenticateToken, asyncHandler((req, res) => authController.getMe(req, res)));
  router.post('/auth/logout', authenticateToken, asyncHandler((req, res) => authController.logout(req, res)));

  // Colis (Filtrage automatique par DataScope selon le périmètre du jeton)
  router.get(
    COLIS,
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => colisController.getAll(req, res))
  );

  router.get(
    COLIS_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => colisController.getByIdentifier(req, res))
  );

  router.post(
    COLIS,
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_CREATE),
    asyncHandler((req, res) => colisController.create(req, res))
  );

  router.put(
    COLIS_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.update(req, res))
  );

  router.post(
    COLIS_ACTION_CANCEL,
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_CANCEL),
    asyncHandler((req, res) => colisController.cancel(req, res))
  );

  // Suppression définitive : l'expéditeur tant que le colis lui appartient,
  // l'administration ensuite. Refusée une fois le colis engagé.
  router.delete(
    COLIS_ITEM,
    authenticateToken,
    requireAnyPermission(PermissionCode.COLIS_UPDATE, PermissionCode.COLIS_CANCEL),
    asyncHandler((req, res) => colisController.remove(req, res))
  );

  router.post(
    COLIS_ACTION_ASSIGN,
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => colisController.assign(req, res))
  );

  // Livraison : le livreur sur ses propres colis (COLIS_DELIVER), le rôle
  // d'exploitation depuis le back-office (COLIS_UPDATE).
  router.post(
    COLIS_ACTION_DELIVER,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requireAnyPermission(PermissionCode.COLIS_DELIVER, PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.deliver(req, res))
  );

  // Livraison partielle, échange et report : gestes de terrain du livreur,
  // au même titre que la livraison ou l'échec. Les exiger en `COLIS_UPDATE`
  // seul les rendait impossibles à exécuter depuis le terrain, le livreur
  // n'ayant pas cette permission. La propriété du colis reste vérifiée dans le
  // service : élargir la permission n'ouvre aucun colis à un autre livreur.
  router.post(
    COLIS_ACTION_PARTIAL_DELIVERY,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requireAnyPermission(PermissionCode.COLIS_DELIVER, PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.partialDelivery(req, res))
  );

  router.post(
    COLIS_ACTION_EXCHANGE,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requireAnyPermission(PermissionCode.COLIS_DELIVER, PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.exchange(req, res))
  );

  router.post(
    COLIS_ACTION_POSTPONE,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requireAnyPermission(PermissionCode.COLIS_DELIVER, PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.postpone(req, res))
  );

  // Retour dépôt : le livreur sur ses propres colis (COLIS_RETURN), le rôle
  // d'exploitation depuis le back-office (COLIS_UPDATE).
  router.post(
    COLIS_ACTION_RETURN,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requireAnyPermission(PermissionCode.COLIS_RETURN, PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.returnPackage(req, res))
  );

  // Démarrage de la livraison par le livreur affecté.
  router.post(
    COLIS_ACTION_START,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requirePermissions(PermissionCode.COLIS_DELIVER),
    asyncHandler((req, res) => colisController.startDelivery(req, res))
  );

  // Tentative de livraison infructueuse, déclarée par le livreur.
  router.post(
    COLIS_ACTION_FAILED,
    authenticateToken,
    requireRoles(...FIELD_ROLES),
    requireAnyPermission(PermissionCode.COLIS_DELIVER, PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.failedAttempt(req, res))
  );

  // Restitution définitive à l'expéditeur : action d'administration.
  router.post(
    COLIS_ACTION_RETURN_TO_SHIPPER,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE),
    requirePermissions(PermissionCode.COLIS_UPDATE),
    asyncHandler((req, res) => colisController.returnToShipper(req, res))
  );

  // Scan d'un code (QR / code-barres du bon de livraison) → colis et actions
  // possibles pour l'utilisateur. Conçu pour l'application mobile du livreur.
  router.get(
    ['/scan/:code', '/colis/scan/:code'],
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => scanController.scan(req, res))
  );
  router.post(
    ['/scan', '/colis/scan'],
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => scanController.scan(req, res))
  );

  // Bon de livraison : l'étiquette collée sur chaque pièce du colis.
  router.get(
    withColisSuffix('/bon-livraison'),
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => colisController.bonLivraison(req, res))
  );
  router.post(
    ['/colis/bons-livraison', '/packages/bons-livraison'],
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => colisController.bonsLivraison(req, res))
  );

  // Journal d'audit d'un colis (traçabilité des modifications)
  router.get(
    withColisSuffix('/audit'),
    authenticateToken,
    requirePermissions(PermissionCode.COLIS_READ),
    asyncHandler((req, res) => colisController.auditTrail(req, res))
  );

  // ---------------------------------------------------------------------
  // Recherche opérationnelle transversale
  // ---------------------------------------------------------------------
  //
  // `SEARCH_GLOBAL` et non `COLIS_READ` : la recherche interroge l'annuaire
  // complet — expéditeurs, livreurs, runsheets, dépôts. L'accorder à qui peut
  // juste lire des colis ouvrirait la plateforme entière.
  router.get(
    '/search',
    authenticateToken,
    requirePermissions(PermissionCode.SEARCH_GLOBAL),
    asyncHandler((req, res) => searchController.global(req, res))
  );

  // ---------------------------------------------------------------------
  // Inventaire et historique
  // ---------------------------------------------------------------------
  //
  // `/inventaire/export` est déclaré avant `/inventaire` : sans cela, la
  // chaîne « export » serait lue comme un identifiant de filtre et l'export
  // renverrait une page de résultats au lieu d'un fichier.
  router.get(
    '/inventaire/export',
    authenticateToken,
    requirePermissions(PermissionCode.INVENTORY_EXPORT),
    asyncHandler((req, res) => inventoryController.exportCsv(req, res))
  );

  router.get(
    '/inventaire/facets',
    authenticateToken,
    requirePermissions(PermissionCode.INVENTORY_READ),
    asyncHandler((req, res) => inventoryController.facets(req, res))
  );

  // Exceptions d'inventaire — colis suspects / à investiguer.
  // Ordre : facets avant :id avant liste, pour ne pas capturer « facets » comme id.
  router.get(
    '/inventaire/exceptions/facets',
    authenticateToken,
    requirePermissions(PermissionCode.INVENTORY_READ),
    asyncHandler((req, res) => inventoryExceptionsController.facets(req, res))
  );

  router.get(
    '/inventaire/exceptions/:id',
    authenticateToken,
    requirePermissions(PermissionCode.INVENTORY_READ),
    asyncHandler((req, res) => inventoryExceptionsController.getById(req, res))
  );

  router.get(
    '/inventaire/exceptions',
    authenticateToken,
    requirePermissions(PermissionCode.INVENTORY_READ),
    asyncHandler((req, res) => inventoryExceptionsController.list(req, res))
  );

  router.get(
    '/inventaire',
    authenticateToken,
    requirePermissions(PermissionCode.INVENTORY_READ),
    asyncHandler((req, res) => inventoryController.list(req, res))
  );

  // ---------------------------------------------------------------------
  // --- Rapports d'exploitation -----------------------------------------
  //
  // L'export est déclaré avant la lecture : `/reports/colis/export` serait
  // sinon lu comme un domaine de rapport nommé « export », et le rapport
  // serait renvoyé au lieu d'être exporté — sans erreur, ce qui est pire.
  //
  // Deux droits distincts : `REPORT_READ` pour lire, `REPORT_EXPORT` pour
  // emporter. L'expéditeur a le premier et pas le second.
  router.get(
    '/reports/domaines',
    authenticateToken,
    requirePermissions(PermissionCode.REPORT_READ),
    asyncHandler((req, res) => reportsController.domaines(req, res))
  );

  router.get(
    '/reports/:domaine/export',
    authenticateToken,
    requirePermissions(PermissionCode.REPORT_EXPORT),
    asyncHandler((req, res) => reportsController.exporterCsv(req, res))
  );

  router.get(
    '/reports/:domaine',
    authenticateToken,
    requirePermissions(PermissionCode.REPORT_READ),
    asyncHandler((req, res) => reportsController.lire(req, res))
  );

  // Journal d'audit
  // ---------------------------------------------------------------------
  //
  // Lecture seule, et c'est délibéré. Le journal se remplit au fil des
  // opérations métier ; il n'existe aucun moyen de l'écrire depuis cette API,
  // ni de le modifier, ni de le purger. L'immuabilité est appliquée une seconde
  // fois en base — une règle qui ne tient que dans le routeur tiendrait tant
  // que le routeur serait le seul chemin vers la base.
  //
  // Les sous-routes sont déclarées avant la racine : `/audit/summary` serait
  // sinon lu comme un filtre `entityType` de la racine.
  router.get(
    '/audit/summary',
    authenticateToken,
    requirePermissions(PermissionCode.AUDIT_READ),
    asyncHandler((req, res) => auditController.summary(req, res))
  );

  router.get(
    '/audit/actions',
    authenticateToken,
    requirePermissions(PermissionCode.AUDIT_READ),
    asyncHandler((req, res) => auditController.actions(req, res))
  );

  router.get(
    '/audit',
    authenticateToken,
    requirePermissions(PermissionCode.AUDIT_READ),
    asyncHandler((req, res) => auditController.list(req, res))
  );

  // Notifications de l'utilisateur connecté.
  //
  // Aucune permission n'est exigée : une notification appartient à son
  // destinataire, désigné par le jeton et jamais par la requête. Le contrôle
  // d'accès est la propriété des lignes, pas un rôle.
  router.get(
    '/notifications',
    authenticateToken,
    asyncHandler((req, res) => notificationsController.list(req, res))
  );

  // Compteur seul : le badge l'interroge au démarrage et après reconnexion,
  // quand il n'a pas encore rechargé la liste.
  router.get(
    '/notifications/unread-count',
    authenticateToken,
    asyncHandler((req, res) => notificationsController.unreadCount(req, res))
  );

  router.post(
    '/notifications/:id/read',
    authenticateToken,
    asyncHandler((req, res) => notificationsController.markRead(req, res))
  );

  // Déclaré après `/notifications/:id/read`, sans nécessité d'ordre : les deux
  // chemins n'ont pas le même nombre de segments. Le commenter évite qu'on
  // tente un jour de « simplifier » en le remontant et de casser le routage.
  router.post(
    '/notifications/read-all',
    authenticateToken,
    asyncHandler((req, res) => notificationsController.markAllRead(req, res))
  );

  // Appareils poussés (FCM) : l'identité vient toujours du jeton JWT, jamais
  // d'un `userId` fourni par le client. Un livreur ne peut donc pas enregistrer
  // de jeton pour un autre compte, et la désinstallation d'une application
  // n'affecte que ses propres jetons.
  router.get(
    '/devices',
    authenticateToken,
    asyncHandler((req, res) => devicesController.list(req, res))
  );

  router.post(
    '/devices/push-token',
    authenticateToken,
    asyncHandler((req, res) => devicesController.register(req, res))
  );

  router.delete(
    '/devices/push-token',
    authenticateToken,
    asyncHandler((req, res) => devicesController.removeByToken(req, res))
  );

  router.delete(
    '/devices/:id',
    authenticateToken,
    asyncHandler((req, res) => devicesController.removeById(req, res))
  );

  // ---------------------------------------------------------------------
  // Réception en dépôt — Acceptation Magasin
  // ---------------------------------------------------------------------
  //
  // `DEPOT_SCAN` : le même droit que le scan d'entrée. Aucun rôle en dur —
  // un gestionnaire qui réceptionne et un agent de dépôt ont le même acte à
  // accomplir.
  //
  // L'ordre importe : `lookup` et `recent` sont déclarés avant `receive`, sans
  // quoi Express les lirait comme des variantes du paramètre `:action`.
  router.get(
    '/depot/reception/depots',
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_SCAN),
    asyncHandler((req, res) => receptionController.depots(req, res))
  );

  router.get(
    '/depot/reception/recent',
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_SCAN),
    asyncHandler((req, res) => receptionController.recent(req, res))
  );

  router.post(
    '/depot/reception/lookup',
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_SCAN),
    asyncHandler((req, res) => receptionController.lookup(req, res))
  );

  router.post(
    '/depot/reception',
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_SCAN),
    asyncHandler((req, res) => receptionController.receive(req, res))
  );

  // Ancienne route de scan, conservée pour l'application Vite archivée et les
  // scripts de régression. Elle délègue désormais au service de réception : un
  // code inconnu y répond 404 au lieu de fabriquer un colis à 0 DT.
  router.post(
    '/warehouse/scan-accept',
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_SCAN),
    asyncHandler((req, res) => colisController.scanAccept(req, res))
  );

  // Runsheets (Livreurs voient leur tournée, Gestionnaires/Finance créent et valident)
  router.get(
    '/runsheets',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_READ),
    asyncHandler((req, res) => runsheetsController.getAll(req, res))
  );

  // Doit être déclaré AVANT `/runsheets/:id` sinon "driver" serait capturé comme id.
  router.get(
    '/runsheets/driver/active',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_READ),
    asyncHandler((req, res) => runsheetsController.getActiveDriverRunsheet(req, res))
  );

  router.get(
    '/runsheets/:id',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_READ),
    asyncHandler((req, res) => runsheetsController.getByNumber(req, res))
  );

  router.post(
    '/runsheets',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.create(req, res))
  );

  router.patch(
    '/runsheets/:id',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.update(req, res))
  );

  router.put(
    '/runsheets/:id',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.update(req, res))
  );

  router.delete(
    '/runsheets/:id',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.remove(req, res))
  );

  router.post(
    '/runsheets/:id/add-package',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.addPackage(req, res))
  );

  router.post(
    '/runsheets/:id/remove-package',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.removePackage(req, res))
  );

  router.post(
    '/runsheets/:id/status',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_CREATE),
    asyncHandler((req, res) => runsheetsController.updateStatus(req, res))
  );

  router.post(
    '/runsheets/:id/close',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_VALIDATE),
    asyncHandler((req, res) => runsheetsController.close(req, res))
  );

  router.post(
    '/runsheets/:id/validate',
    authenticateToken,
    requirePermissions(PermissionCode.RUNSHEET_VALIDATE),
    asyncHandler((req, res) => runsheetsController.validate(req, res))
  );

  // Ramassages
  router.get(
    RAMASSAGES,
    authenticateToken,
    requirePermissions(PermissionCode.RAMASSAGE_READ),
    asyncHandler((req, res) => ramassagesController.getAll(req, res))
  );

  // Déclaré avant `/ramassages/:id` : « driver » n'est pas un identifiant de
  // rendez-vous, et l'ordre des routes Express fait foi.
  router.get(
    RAMASSAGE_DRIVER_ACTIVE,
    authenticateToken,
    requireRoles(RoleType.LIVREUR),
    asyncHandler((req, res) => ramassagesController.getForDriver(req, res))
  );

  router.get(
    RAMASSAGE_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.RAMASSAGE_READ),
    asyncHandler((req, res) => ramassagesController.getById(req, res))
  );

  router.post(
    RAMASSAGES,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE, RoleType.EXPEDITEUR),
    requirePermissions(PermissionCode.RAMASSAGE_DEMANDE),
    asyncHandler((req, res) => ramassagesController.create(req, res))
  );

  // Rattachement des colis collectés : c'est la source de vérité du décompte.
  router.patch(
    RAMASSAGE_PACKAGES,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE, RoleType.LIVREUR),
    asyncHandler((req, res) => ramassagesController.syncPackages(req, res))
  );

  router.patch(
    RAMASSAGE_CONFIRM,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE),
    requirePermissions(PermissionCode.RAMASSAGE_MANAGE),
    asyncHandler((req, res) => ramassagesController.confirm(req, res))
  );

  // Affectation d'un ramassage à un livreur : l'exploitation engage le chauffeur.
  router.patch(
    RAMASSAGE_ASSIGN,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE),
    requirePermissions(PermissionCode.RAMASSAGE_MANAGE),
    asyncHandler((req, res) => ramassagesController.assign(req, res))
  );

  // Démarrage et clôture de la collecte, par le livreur ou l'exploitation.
  router.patch(
    RAMASSAGE_START,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE, RoleType.LIVREUR),
    asyncHandler((req, res) => ramassagesController.start(req, res))
  );

  router.patch(
    RAMASSAGE_COMPLETE,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE, RoleType.LIVREUR),
    asyncHandler((req, res) => ramassagesController.complete(req, res))
  );

  router.patch(
    RAMASSAGE_CANCEL,
    authenticateToken,
    requireRoles(RoleType.ADMIN, RoleType.GESTIONNAIRE, RoleType.EXPEDITEUR),
    asyncHandler((req, res) => ramassagesController.cancel(req, res))
  );

  // Paiements & Bordereaux (Expéditeurs consultent les leurs, Finance valide avec code)
  router.get(
    '/payments/vouchers',
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_READ),
    asyncHandler((req, res) => paymentsController.getAll(req, res))
  );

  router.post(
    '/payments/vouchers/:voucherNumber/validate',
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_VALIDATE),
    voucherSecretLimiter,
    asyncHandler((req, res) => paymentsController.validatePayment(req, res))
  );

  // Encaissements COD : l'argent des clients pris par les livreurs.
  //
  // Aucune de ces routes n'accepte un statut en entrée. Valider, écarter et
  // rembourser sont trois actions nommées, et c'est le serveur qui décide
  // ce qu'elles écrivent — qui, quand, et pourquoi en cas d'écart.
  //
  // Elles exigent `PAYMENT_CASH_*` et non `PAYMENT_*`. Un expéditeur garde
  // `PAYMENT_READ` pour ses bordereaux, mais ces agrégats sont le relevé de
  // la caisse : le total encaissé de la plateforme, et le reliquat de chaque
  // livreur. Le lui servir ne serait pas une question de rôle d'écran, c'est
  // lui révéler la trésorerie des autres.
  router.get(
    PAYMENTS,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_READ),
    asyncHandler((req, res) => paymentsController.listPayments(req, res))
  );

  // Les agrégats passent avant `/payments/:id` : sans cela, « summary » serait
  // lu comme un identifiant et l'écran de caisse afficherait un 404.
  router.get(
    PAYMENTS_SUMMARY,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_READ),
    asyncHandler((req, res) => paymentsController.getSummary(req, res))
  );

  router.get(
    PAYMENTS_BY_SHIPPER,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_READ),
    asyncHandler((req, res) => paymentsController.getByShipper(req, res))
  );

  router.get(
    PAYMENTS_BY_DRIVER,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_READ),
    asyncHandler((req, res) => paymentsController.getByDriver(req, res))
  );

  router.get(
    PAYMENTS_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_READ),
    asyncHandler((req, res) => paymentsController.getPayment(req, res))
  );

  router.post(
    PAYMENTS_VALIDATE,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_VALIDATE),
    asyncHandler((req, res) => paymentsController.validatePaymentRecord(req, res))
  );

  router.post(
    PAYMENTS_REJECT,
    authenticateToken,
    requirePermissions(PermissionCode.PAYMENT_CASH_VALIDATE),
    asyncHandler((req, res) => paymentsController.rejectPayment(req, res))
  );

  // Dépôts : le réseau est multi-sites, Ben Arous étant le dépôt principal.
  // La lecture est ouverte au livreur, qui doit savoir où se trouve un colis ;
  // l'écriture relève de l'exploitation.
  router.get(
    DEPOTS,
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_READ),
    asyncHandler((req, res) => depotsController.getAll(req, res))
  );

  router.get(
    DEPOT_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_READ),
    asyncHandler((req, res) => depotsController.getById(req, res))
  );

  router.post(
    DEPOTS,
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_MANAGE),
    asyncHandler((req, res) => depotsController.create(req, res))
  );

  router.patch(
    DEPOT_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.DEPOT_MANAGE),
    asyncHandler((req, res) => depotsController.update(req, res))
  );

  // Inter-Dépôts (livraison & retours) — bordereau, scan de chargement,
  // acceptation pièce par pièce. Les routes fixes avant `/:id`.
  router.get(
    ['/inter-depots/form-options', '/inter-depot/form-options'],
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_READ),
    asyncHandler((req, res) => interDepotsController.formOptions(req, res))
  );
  router.get(
    ['/inter-depots/acceptance', '/inter-depot/acceptance'],
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.acceptanceBoard(req, res))
  );
  router.post(
    ['/inter-depots/acceptance/scan', '/inter-depot/acceptance/scan'],
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.acceptScan(req, res))
  );
  router.get(
    INTER_DEPOTS,
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_READ),
    asyncHandler((req, res) => interDepotsController.getAll(req, res))
  );
  router.get(
    INTER_DEPOT_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_READ),
    asyncHandler((req, res) => interDepotsController.getByNumber(req, res))
  );
  router.get(
    ['/inter-depots/:id/candidates', '/inter-depot/:id/candidates'],
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.candidates(req, res))
  );
  router.post(
    INTER_DEPOTS,
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.create(req, res))
  );
  router.patch(
    INTER_DEPOT_ITEM,
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.update(req, res))
  );
  router.post(
    ['/inter-depots/:id/scan', '/inter-depot/:id/scan'],
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.scan(req, res))
  );
  router.post(
    INTER_DEPOT_CANCEL,
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.cancel(req, res))
  );
  // Ancien cycle : 410 explicite plutôt qu'un comportement silencieux.
  router.post(
    [...INTER_DEPOT_PREPARE, ...INTER_DEPOT_DISPATCH, ...INTER_DEPOT_RECEIVE],
    authenticateToken,
    requirePermissions(PermissionCode.INTERDEPOT_MANAGE),
    asyncHandler((req, res) => interDepotsController.legacy(req, res))
  );

  // Dashboard Métriques
  //
  // Ces chiffres sont ceux de la plateforme entière : volumes, taux de réussite,
  // état de la flotte. Rien n'y est filtré par expéditeur, donc un expéditeur
  // n'y a pas sa place — son portail a ses propres indicateurs, alimentés par
  // des requêtes cloisonnées sur son entreprise. La porte est ici, et non dans
  // le service : un garde de rôle se lit sur la route, une rectification
  // silencieuse des chiffres ne se lirait nulle part.
  router.get(
    '/dashboard',
    authenticateToken,
    requireRoles(
      RoleType.ADMIN,
      RoleType.GESTIONNAIRE,
      RoleType.FINANCE,
      RoleType.AGENT_DEPOT,
      RoleType.LIVREUR
    ),
    asyncHandler((req, res) => dashboardController.getMetrics(req, res))
  );

  // ---------------------------------------------------------------------
  // Administration — comptes, expéditeurs, livreurs
  // ---------------------------------------------------------------------
  //
  // Réservé à l'administration par permission, jamais par rôle en dur : c'est la
  // même porte que le reste de l'API. Un expéditeur qui appelle l'une de ces
  // routes reçoit 403 — l'autorisation est décidée ici, pas dans l'interface qui
  // masquerait simplement le lien.
  //
  // L'ordre compte : `/users/referentiels` est déclaré avant `/users/:id`, sans
  // quoi Express lirait « referentiels » comme un identifiant.

  router.get(
    '/users/referentiels',
    authenticateToken,
    requirePermissions(PermissionCode.USER_READ),
    asyncHandler((req, res) => usersController.referentiels(req, res))
  );

  router.get(
    '/users',
    authenticateToken,
    requirePermissions(PermissionCode.USER_READ),
    asyncHandler((req, res) => usersController.list(req, res))
  );

  router.get(
    '/users/:id',
    authenticateToken,
    requirePermissions(PermissionCode.USER_READ),
    asyncHandler((req, res) => usersController.getById(req, res))
  );

  router.post(
    '/users',
    authenticateToken,
    requirePermissions(PermissionCode.USER_CREATE),
    asyncHandler((req, res) => usersController.create(req, res))
  );

  router.patch(
    '/users/:id',
    authenticateToken,
    requirePermissions(PermissionCode.USER_UPDATE),
    asyncHandler((req, res) => usersController.update(req, res))
  );

  router.patch(
    '/users/:id/status',
    authenticateToken,
    requirePermissions(PermissionCode.USER_UPDATE),
    asyncHandler((req, res) => usersController.setStatus(req, res))
  );

  router.get(
    '/shippers',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_READ),
    asyncHandler((req, res) => shippersController.list(req, res))
  );

  router.get(
    '/shippers/:id',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_READ),
    asyncHandler((req, res) => shippersController.getById(req, res))
  );

  router.post(
    '/shippers',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_CREATE),
    asyncHandler((req, res) => shippersController.create(req, res))
  );

  router.patch(
    '/shippers/:id',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_UPDATE),
    asyncHandler((req, res) => shippersController.update(req, res))
  );

  router.patch(
    '/shippers/:id/status',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_UPDATE),
    asyncHandler((req, res) => shippersController.setStatus(req, res))
  );

  router.post(
    '/shippers/:id/users',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_UPDATE),
    asyncHandler((req, res) => shippersController.rattacherCompte(req, res))
  );

  router.delete(
    '/shippers/:id/users/:userId',
    authenticateToken,
    requirePermissions(PermissionCode.EXPEDITEUR_UPDATE),
    asyncHandler((req, res) => shippersController.detacherCompte(req, res))
  );

  // Présence livreur : déclaré avant `/:id` pour éviter la capture.
  router.get(
    '/drivers/presence',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_READ),
    asyncHandler((req, res) => presenceController.list(req, res))
  );

  router.get(
    '/drivers/:id/presence',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_READ),
    asyncHandler((req, res) => presenceController.getOne(req, res))
  );

  // Fiche du livreur connecté (application mobile) : déclarée avant `/:id`.
  router.get(
    '/drivers/me',
    authenticateToken,
    requireRoles(RoleType.LIVREUR),
    asyncHandler((req, res) => getOwnDriverProfile(req, res))
  );

  router.post(
    '/drivers/presence/heartbeat',
    authenticateToken,
    asyncHandler((req, res) => presenceController.heartbeat(req, res))
  );

  // Comptes encore disponibles au rattachement : déclaré avant `/:id`.
  router.get(
    '/drivers/comptes-disponibles',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_READ),
    asyncHandler((req, res) => driversController.listComptesDisponibles(req, res))
  );

  router.get(
    '/drivers',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_READ),
    asyncHandler((req, res) => driversController.list(req, res))
  );

  router.get(
    '/drivers/:id',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_READ),
    asyncHandler((req, res) => driversController.getById(req, res))
  );

  router.post(
    '/drivers',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_CREATE),
    asyncHandler((req, res) => driversController.create(req, res))
  );

  router.patch(
    '/drivers/:id',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_UPDATE),
    asyncHandler((req, res) => driversController.update(req, res))
  );

  router.patch(
    '/drivers/:id/status',
    authenticateToken,
    requirePermissions(PermissionCode.LIVREUR_UPDATE),
    asyncHandler((req, res) => driversController.setStatus(req, res))
  );

  return router;
}
