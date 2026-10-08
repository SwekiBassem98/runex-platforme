/**
 * Spécification OpenAPI 3.0.3 de l'API RUNEX.
 *
 * Elle décrit les routes RÉELLEMENT montées dans `app.router.ts`.
 * Les chemins canoniques sont ceux par module (`/colis`, `/ramassages`,
 * `/inter-depots`) ; les alias historiques (`/packages`, `/pickups`,
 * `/inter-depot`) sont mentionnés mais non répétés.
 */

const json = { 'application/json': {} };

/** Réponse de succès. */
const ok = (description: string, schema?: unknown) => ({
  description,
  ...(schema
    ? { content: { 'application/json': { schema } } }
    : {}),
});

/** Réponse d'erreur au format `{ success: false, message }`. */
const failure = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
});

const UNAUTHORIZED = failure('Jeton Bearer absent, expiré ou invalide');
const FORBIDDEN = failure('Rôle ou permissions insuffisants');
const NOT_FOUND = failure('Ressource inexistante ou hors périmètre de l\'utilisateur');
const BAD_REQUEST = failure('Données d\'entrée invalides');

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const envelope = (name: string) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    data: ref(name),
    message: { type: 'string' },
  },
});

export const openApiSpecification = {
  openapi: '3.0.3',
  info: {
    title: 'RUNEX - API Logistique & Livraison Express',
    description:
      "API REST de la plateforme RUNEX : colis, feuilles de tournée, ramassages, " +
      'transferts inter-dépôts, bordereaux de paiement et tableaux de bord.\n\n' +
      "**Authentification** — appeler `POST /api/v1/auth/login`, puis envoyer le jeton dans " +
      "l'en-tête `Authorization: Bearer <accessToken>`.\n\n" +
      "**Cloisonnement des données** — les réponses sont automatiquement filtrées selon le " +
      'rôle : un expéditeur ne voit que ses colis, un livreur seulement ses tournées.',
    version: '1.0.0',
    contact: {
      name: 'Support Technique RUNEX',
      email: 'tech@logixpress.tn',
    },
  },
  servers: [
    { url: 'http://localhost:4000/api/v1', description: 'API locale (développement)' },
  ],
  tags: [
    { name: 'Health', description: 'État de santé de l\'API et de ses dépendances' },
    { name: 'Auth', description: 'Connexion, jetons et cycle de vie de session' },
    { name: 'Colis', description: 'Gestion du cycle complet des colis' },
    { name: 'Dépôt', description: 'Opérations physiques en magasin' },
    { name: 'Runsheets', description: 'Feuilles de route de tournée' },
    { name: 'Ramassages', description: 'Rendez-vous de collecte chez les expéditeurs' },
    { name: 'Paiements', description: 'Bordereaux de règlement expéditeurs (CRBT)' },
    { name: 'Inter-Dépôts', description: 'Transferts entre dépôts' },
    { name: 'Dashboard', description: 'Indicateurs opérationnels' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Jeton renvoyé par POST /auth/login',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Message décrivant l\'erreur.' },
        },
        required: ['success', 'message'],
      },
      HealthCheckResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
          timestamp: { type: 'string', format: 'date-time' },
          uptime: { type: 'number' },
          version: { type: 'string' },
          services: {
            type: 'object',
            properties: {
              api: {
                type: 'object',
                properties: { status: { type: 'string', enum: ['up'] } },
              },
              database: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['up', 'down'] },
                  latencyMs: { type: 'integer' },
                  message: { type: 'string' },
                },
              },
              redis: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['up', 'down'] },
                  latencyMs: { type: 'integer' },
                  required: { type: 'boolean' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@logixpress.tn' },
          password: { type: 'string', format: 'password', example: 'Admin123!' },
        },
        required: ['email', 'password'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'integer', example: 900, description: 'Durée de validité en secondes.' },
              user: ref('AuthUser'),
            },
          },
          message: { type: 'string' },
        },
      },
      AuthUser: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          fullName: { type: 'string' },
          phone: { type: 'string' },
          role: {
            type: 'string',
            enum: ['ADMIN', 'GESTIONNAIRE', 'EXPEDITEUR', 'LIVREUR', 'AGENT_DEPOT', 'FINANCE'],
          },
          permissions: { type: 'array', items: { type: 'string' } },
          shipperId: { type: 'string' },
          driverId: { type: 'string' },
          depositId: { type: 'string' },
        },
      },
      Package: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          trackingNumber: { type: 'string', example: '26092402490551' },
          barcode: { type: 'string' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          governorate: { type: 'string' },
          delegation: { type: 'string' },
          address: { type: 'string' },
          packageType: { type: 'string', enum: ['NORMAL', 'EXCHANGE', 'REPORTED', 'RETURN'] },
          status: { type: 'string', example: 'RECU_DEPOT' },
          sizeCategory: { type: 'string', enum: ['LEGERE', 'MOYENNE', 'LOURDE', 'VOLUMINEUSE'] },
          pieceCount: { type: 'integer' },
          totalPrice: { type: 'number', description: 'Montant en Dinar Tunisien (TND).' },
          collectedAmount: { type: 'number' },
          shipperId: { type: 'string' },
          assignedDriverId: { type: 'string' },
          currentDepositId: { type: 'string' },
          trackingTimeline: { type: 'array', items: { type: 'object' } },
          deliveryAttempts: { type: 'array', items: { type: 'object' } },
        },
      },
      Runsheet: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          runsheetNumber: { type: 'string', example: 'RUN-1100092681' },
          driverId: { type: 'string' },
          driverName: { type: 'string' },
          depositId: { type: 'string' },
          status: {
            type: 'string',
            enum: ['BROUILLON', 'PREPARE', 'ASSIGNE', 'EN_COURS', 'TERMINE', 'VALIDE', 'ANNULE'],
          },
          tourDate: { type: 'string', format: 'date' },
          totalPackages: { type: 'integer' },
          expectedCash: { type: 'number' },
          collectedCash: { type: 'number' },
          deficitAmount: { type: 'number' },
        },
      },
      PickupAppointment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          referenceNumber: { type: 'string', example: 'RDV-20260928-0001' },
          shipperId: { type: 'string' },
          scheduledDate: { type: 'string', format: 'date' },
          timeSlotStartHour: { type: 'integer' },
          timeSlotEndHour: { type: 'integer' },
          pickupAddress: { type: 'string' },
          status: {
            type: 'string',
            enum: ['A_CONFIRMER', 'EN_ATTENTE', 'ASSIGNE', 'EN_COURS', 'EFFECTUE', 'ANNULE'],
          },
        },
      },
      PaymentVoucher: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          voucherNumber: { type: 'string', example: '137831' },
          shipperName: { type: 'string' },
          status: { type: 'string', enum: ['EN_ATTENTE', 'CONFIRME', 'PAYE', 'ANNULE'] },
          paymentMethod: { type: 'string', enum: ['ESPECE', 'CHEQUE', 'VIREMENT', 'TRAITE'] },
          netPayable: { type: 'number' },
          paidAt: { type: 'string', format: 'date-time' },
        },
      },
      InterDepotTransfer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          transferNumber: { type: 'string', example: 'ID-3-20260924-0010' },
          sourceDeposit: { type: 'string' },
          destinationDeposit: { type: 'string' },
          status: { type: 'string' },
          totalPackages: { type: 'integer' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'État de santé du système',
        description:
          'Exécute une sonde réelle `SELECT 1` (PostgreSQL) et un `PING` (Redis). ' +
          'Répond 200 si les dépendances obligatoires sont joignables, 503 sinon.',
        security: [],
        responses: {
          '200': ok('Système opérationnel', ref('HealthCheckResponse')),
          '503': failure('API en service mais dépendance indisponible'),
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Connexion utilisateur',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref('LoginRequest') } },
        },
        responses: {
          '200': ok('Connexion réussie', ref('LoginResponse')),
          '400': failure('Email ou mot de passe manquant'),
          '401': failure('Identifiants incorrects ou compte désactivé'),
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Renouveler le jeton d\'accès',
        description: 'Rotation du refresh token : l\'ancien est invalidé.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { refreshToken: { type: 'string' } },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          '200': ok('Jeton renouvelé', ref('LoginResponse')),
          '400': failure('Refresh token manquant'),
          '401': failure('Refresh token inconnu ou expiré'),
        },
      },
    },
    '/auth/demo-users': {
      get: {
        tags: ['Auth'],
        summary: 'Comptes de démonstration',
        description: 'Endpoint de développement : ne pas exposer en production.',
        security: [],
        responses: { '200': ok('Liste des comptes de démonstration') },
      },
    },
    '/auth/password-reset/request': {
      post: {
        tags: ['Auth'],
        summary: 'Demander une réinitialisation de mot de passe',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' } },
                required: ['email'],
              },
            },
          },
        },
        responses: {
          '200': ok('Demande enregistrée (réponse volontairement indifférenciée)'),
          '400': failure('Email manquant'),
        },
      },
    },
    '/auth/password-reset/confirm': {
      post: {
        tags: ['Auth'],
        summary: 'Confirmer un nouveau mot de passe',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  newPassword: { type: 'string' },
                },
                required: ['token', 'newPassword'],
              },
            },
          },
        },
        responses: {
          '200': ok('Mot de passe réinitialisé'),
          '400': failure('Jeton invalide, expiré ou champs manquants'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Profil de l\'utilisateur authentifié',
        responses: {
          '200': ok('Profil courant', ref('AuthUser')),
          '401': UNAUTHORIZED,
          '404': NOT_FOUND,
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Fermer la session',
        responses: {
          '200': ok('Déconnexion effectuée'),
          '401': UNAUTHORIZED,
        },
      },
    },

    '/colis': {
      get: {
        tags: ['Colis'],
        summary: 'Lister les colis',
        description:
          'Filtré automatiquement par périmètre : expéditeur → ses colis, livreur → ses ' +
          'affectations, agent dépôt → son dépôt. Alias historique : `GET /packages`.',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Tracking, code-barres, nom ou téléphone du destinataire.' },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'city', in: 'query', schema: { type: 'string' }, description: 'Gouvernorat.' },
          { name: 'driver', in: 'query', schema: { type: 'string' }, description: 'ID ou nom du livreur.' },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['NORMAL', 'EXCHANGE', 'REPORTED', 'RETURN'] } },
          { name: 'paymentStatus', in: 'query', schema: { type: 'string', enum: ['NON_REGLE', 'EN_BORDEREAU', 'PAYE'] } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, default: 20 } },
        ],
        responses: {
          '200': {
            description: 'Page de colis',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: ref('Package') },
                    meta: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        totalPages: { type: 'integer' },
                        scopedTo: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
      post: {
        tags: ['Colis'],
        summary: 'Créer un colis',
        description: 'Alias historique : `POST /packages`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['customerName', 'customerPhone', 'address'],
                properties: {
                  customerName: { type: 'string', example: 'Ahlem Ben Salem' },
                  customerPhone: { type: 'string', example: '27660505' },
                  governorate: { type: 'string', example: 'Zaghouan' },
                  delegation: { type: 'string', example: 'Ennadhour' },
                  address: { type: 'string' },
                  packageType: { type: 'string', enum: ['NORMAL', 'EXCHANGE', 'REPORTED', 'RETURN'] },
                  sizeCategory: { type: 'string', enum: ['LEGERE', 'MOYENNE', 'LOURDE', 'VOLUMINEUSE'] },
                  pieceCount: { type: 'integer', minimum: 1 },
                  contentSummary: { type: 'string' },
                  totalPrice: { type: 'number', minimum: 0, description: 'Montant à encaisser en TND.' },
                  allowOpen: { type: 'boolean' },
                  isFragile: { type: 'boolean' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': ok('Colis créé', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
    },

    '/colis/{identifier}': {
      parameters: [
        {
          name: 'identifier',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'UUID, numéro de suivi ou code-barres. Alias : `/packages/{identifier}`.',
        },
      ],
      get: {
        tags: ['Colis'],
        summary: 'Consulter un colis',
        responses: {
          '200': ok('Colis trouvé', envelope('Package')),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
      put: {
        tags: ['Colis'],
        summary: 'Modifier un colis',
        description:
          'Les colis livrés, partiellement livrés, retournés ou annulés sont verrouillés ' +
          '(409 métier, 400 ici). Une modification de montant ou de pièces sur un colis ' +
          'affecté notifie le livreur et produit une entrée d\'audit.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  customerName: { type: 'string' },
                  customerPhone: { type: 'string' },
                  address: { type: 'string' },
                  contentSummary: { type: 'string' },
                  pieceCount: { type: 'integer', minimum: 1 },
                  totalPrice: { type: 'number', minimum: 0 },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Colis mis à jour'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/cancel': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Annuler un colis',
        description: 'Impossible si le colis est déjà livré. Alias : `/packages/{identifier}/cancel`.',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': ok('Colis annulé', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/assign': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Affecter un colis à un livreur et une tournée',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['driverId', 'driverName'],
                properties: {
                  driverId: { type: 'string' },
                  driverName: { type: 'string' },
                  runsheetNumber: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Colis affecté', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/deliver': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Déclarer un colis livré',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  collectedAmount: { type: 'number', minimum: 0 },
                  driverNote: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Livraison enregistrée', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/partial-delivery': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Déclarer une livraison partielle',
        description:
          'Ventile les pièces livrées et les articles retournés à l\'agence. ' +
          'Le montant restant est intégralement restitué à l\'expéditeur.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deliveredPieces', 'collectedAmount', 'reason'],
                properties: {
                  deliveredPieces: { type: 'integer', minimum: 0 },
                  collectedAmount: { type: 'number', minimum: 0 },
                  reason: { type: 'string' },
                  driverNote: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Livraison partielle enregistrée', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/exchange': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Enregistrer un échange (article repris contre article neuf)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['returnedItemBarcode', 'returnedItemDescription'],
                properties: {
                  returnedItemBarcode: { type: 'string' },
                  returnedItemDescription: { type: 'string' },
                  collectedAmount: { type: 'number', minimum: 0 },
                  driverNote: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Échange enregistré', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/postpone': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Reporter une livraison',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string' },
                  rescheduledDate: { type: 'string', format: 'date' },
                  driverNote: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Report enregistré', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/colis/{identifier}/return': {
      parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Colis'],
        summary: 'Retourner un colis au dépôt',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: { reason: { type: 'string' }, driverNote: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': ok('Retour enregistré', envelope('Package')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': NOT_FOUND,
        },
      },
    },

    '/warehouse/scan-accept': {
      post: {
        tags: ['Dépôt'],
        summary: 'Accepter un colis au magasin par scan code-barres',
        description:
          'Réservé aux agents dépôt, gestionnaires et admins. Si le code-barres est inconnu, ' +
          'un colis est créé avec le code scanné comme numéro de suivi.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['barcode'],
                properties: {
                  barcode: { type: 'string', example: '26092402490551' },
                  depositId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Colis accepté', envelope('Package')),
          '400': failure('Code-barres manquant'),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
    },

    '/runsheets': {
      get: {
        tags: ['Runsheets'],
        summary: 'Lister les feuilles de tournée',
        parameters: [
          { name: 'driverId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': ok('Liste des tournées', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: ref('Runsheet') },
              meta: { type: 'object', properties: { total: { type: 'integer' } } },
            },
          }),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
      post: {
        tags: ['Runsheets'],
        summary: 'Créer une feuille de tournée',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['driverId', 'driverName', 'tourDate'],
                properties: {
                  driverId: { type: 'string' },
                  driverName: { type: 'string' },
                  tourDate: { type: 'string', format: 'date', example: '2026-09-29' },
                  depositId: { type: 'string' },
                  depositName: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': ok('Tournée créée', envelope('Runsheet')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
    },

    '/runsheets/driver/active': {
      get: {
        tags: ['Runsheets'],
        summary: 'Tournée active d\'un livreur',
        description: 'Utilisé par l\'application livreur pour reprendre la tournée en cours.',
        parameters: [{ name: 'driverId', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': ok('Tournée active', envelope('Runsheet')),
          '400': failure('Identifiant chauffeur absent'),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Aucune tournée active'),
        },
      },
    },

    '/runsheets/{id}': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'UUID interne ou numéro de tournée (RUN-…).',
        },
      ],
      get: {
        tags: ['Runsheets'],
        summary: 'Consulter une tournée et ses colis',
        responses: {
          '200': ok('Tournée détaillée', envelope('Runsheet')),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Tournée introuvable'),
        },
      },
    },

    '/runsheets/{id}/add-package': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Runsheets'],
        summary: 'Ajouter un colis à une tournée',
        description: 'Uniquement à l\'état BROUILLON, PREPARE ou ASSIGNE.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['packageIdentifier'],
                properties: { packageIdentifier: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': ok('Colis ajouté', envelope('Runsheet')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Tournée ou colis introuvable'),
        },
      },
    },

    '/runsheets/{id}/remove-package': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Runsheets'],
        summary: 'Retirer un colis d\'une tournée',
        description: 'Interdit une fois la tournée partie.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['packageIdentifier'],
                properties: { packageIdentifier: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': ok('Colis retiré', envelope('Runsheet')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Tournée introuvable'),
        },
      },
    },

    '/runsheets/{id}/status': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Runsheets'],
        summary: 'Changer le statut d\'une tournée',
        description:
          'Le passage à EN_COURS bascule automatiquement les colis affectés en ' +
          'EN_COURS_LIVRAISON.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['BROUILLON', 'PREPARE', 'ASSIGNE', 'EN_COURS', 'TERMINE', 'VALIDE', 'ANNULE'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Statut mis à jour', envelope('Runsheet')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Tournée introuvable'),
        },
      },
    },

    '/runsheets/{id}/close': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Runsheets'],
        summary: 'Clôturer une tournée (remise de caisse)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['collectedCash'],
                properties: {
                  collectedCash: { type: 'number', minimum: 0 },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Tournée clôturée', envelope('Runsheet')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Tournée introuvable'),
        },
      },
    },

    '/runsheets/{id}/validate': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Runsheets'],
        summary: 'Valider et rapprocher une tournée en caisse',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { notes: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': ok('Tournée validée', envelope('Runsheet')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Tournée introuvable'),
        },
      },
    },

    '/ramassages': {
      get: {
        tags: ['Ramassages'],
        summary: 'Lister les rendez-vous de ramassage',
        description: 'Alias historique : `GET /pickups`.',
        responses: {
          '200': ok('Liste des ramassages', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: ref('PickupAppointment') },
              meta: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  toConfirm: { type: 'integer' },
                  pending: { type: 'integer' },
                  done: { type: 'integer' },
                },
              },
            },
          }),
          '401': UNAUTHORIZED,
        },
      },
      post: {
        tags: ['Ramassages'],
        summary: 'Programmer un ramassage',
        description: 'Réservé aux admins, gestionnaires et expéditeurs.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  shipperId: { type: 'string' },
                  shipperName: { type: 'string' },
                  scheduledDate: { type: 'string', format: 'date' },
                  timeSlotStartHour: { type: 'integer', minimum: 0, maximum: 23 },
                  timeSlotEndHour: { type: 'integer', minimum: 0, maximum: 23 },
                  pickupAddress: { type: 'string' },
                  contactPerson: { type: 'string' },
                  contactPhone: { type: 'string' },
                  packageEstimate: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          '201': ok('Rendez-vous créé', envelope('PickupAppointment')),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
    },

    '/ramassages/{id}/confirm': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: {
        tags: ['Ramassages'],
        summary: 'Confirmer un rendez-vous de ramassage',
        description: 'Réservé aux admins et gestionnaires. Bascule le statut de A_CONFIRMER à EN_ATTENTE.',
        responses: {
          '200': ok('Rendez-vous confirmé', envelope('PickupAppointment')),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Ramassage introuvable'),
        },
      },
    },

    '/payments/vouchers': {
      get: {
        tags: ['Paiements'],
        summary: 'Lister les bordereaux de règlement expéditeurs (CRBT)',
        responses: {
          '200': ok('Liste des bordereaux', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: ref('PaymentVoucher') },
              meta: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  totalAmountTND: { type: 'number' },
                  confirmedCount: { type: 'integer' },
                  confirmedAmountTND: { type: 'number' },
                  paidCount: { type: 'integer' },
                  paidAmountTND: { type: 'number' },
                },
              },
            },
          }),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
    },

    '/payments/vouchers/{voucherNumber}/validate': {
      parameters: [
        {
          name: 'voucherNumber',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          example: '137831',
        },
      ],
      post: {
        tags: ['Paiements'],
        summary: 'Valider et décaisser un bordereau',
        description: 'Exige le code secret de l\'expéditeur. Réservé à la finance et aux admins.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['secretCode'],
                properties: {
                  secretCode: { type: 'string' },
                  paymentMethod: {
                    type: 'string',
                    enum: ['ESPECE', 'CHEQUE', 'VIREMENT', 'TRAITE'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok('Bordereau décaissé', envelope('PaymentVoucher')),
          '400': failure('Code secret manquant ou trop court'),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
          '404': failure('Bordereau introuvable'),
          '409': failure('Bordereau déjà réglé'),
        },
      },
    },

    '/inter-depots': {
      get: {
        tags: ['Inter-Dépôts'],
        summary: 'Suivre les transferts inter-dépôts',
        description: 'Navettes régionales entre le hub central et les agences. Alias : `GET /inter-depot`.',
        responses: {
          '200': ok('Liste des transferts', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: ref('InterDepotTransfer') },
              meta: { type: 'object', properties: { total: { type: 'integer' } } },
            },
          }),
          '401': UNAUTHORIZED,
          '403': FORBIDDEN,
        },
      },
    },

    '/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Indicateurs opérationnels consolidés',
        description:
          'Agrège colis, livreurs, ramassages, paiements et dépôts, avec alertes et activité récente.',
        responses: {
          '200': ok('Indicateurs du tableau de bord'),
          '401': UNAUTHORIZED,
        },
      },
    },
  },
};
