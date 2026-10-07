/**
 * Configuration métier partagée entre l'API et le frontend.
 *
 * Les valeurs proviennent de l'environnement lorsqu'il est disponible (API
 * Node), et tombent sur des valeurs par défaut sûres sinon (composants
 * navigateur, où `process.env` n'est pas défini).
 */
function env(name: string): string | undefined {
  const runtimeEnv = typeof process !== 'undefined' ? process.env : undefined;
  const value = runtimeEnv?.[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function envNumber(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const APP_CONFIG = {
  name: 'RUNEX',
  currency: env('CURRENCY') ?? 'TND',
  currencyDecimals: envNumber('CURRENCY_DECIMALS', 3),
  defaultHubCode: env('DEFAULT_HUB_CODE') ?? 'DEP-BEN-AROUS-HUB',
  timezone: env('TIMEZONE') ?? 'Africa/Tunis',
  defaultDeliveryFee: 7.000,
  defaultReturnFee: 3.000,
  defaultExchangeFee: 8.000,
  defaultWithholdingTaxRate: 0.010, // 1%
  ports: {
    api: envNumber('API_PORT', 4000),
    web: 3000,
  },
  governorates: [
    'Ariana',
    'Béja',
    'Ben Arous',
    'Bizerte',
    'Gabès',
    'Gafsa',
    'Jendouba',
    'Kairouan',
    'Kasserine',
    'Kébili',
    'Le Kef',
    'Mahdia',
    'La Manouba',
    'Médenine',
    'Monastir',
    'Nabeul',
    'Sfax',
    'Sidi Bouzid',
    'Siliana',
    'Sousse',
    'Tataouine',
    'Tozeur',
    'Tunis',
    'Zaghouan',
  ],
};
