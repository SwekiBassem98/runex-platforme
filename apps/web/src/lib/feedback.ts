'use client';

/**
 * Retour sonore (et vibration) des actions — web, ordinateur comme téléphone.
 *
 * Sept sons courts, synthétisés pour RUNEX (scripts/sounds/generate-sounds.py),
 * identiques à ceux de l'application livreur :
 *
 *  scan      un code a été lu                 (bip bref)
 *  success   action enregistrée                (deux notes montantes)
 *  complete  opération majeure terminée        (arpège : tournée créée, transfert reçu…)
 *  error     action refusée / code erroné      (deux impulsions graves)
 *  warning   à vérifier                        (deux notes égales)
 *  notify    nouvelle notification             (cloche douce)
 *  remove    élément retiré                    (deux notes descendantes)
 *
 * Téléphone : les navigateurs n'autorisent le son qu'après un premier geste
 * de l'utilisateur. Le moteur se « déverrouille » au premier toucher / clic /
 * touche, précharge les sons, puis les joue sans latence (Web Audio). Sur
 * Android, une vibration accompagne erreur, avertissement et succès.
 *
 * Préférences (son, volume, vibration) : par appareil, dans le navigateur.
 */

export type SoundKind = 'scan' | 'success' | 'complete' | 'error' | 'warning' | 'notify' | 'remove';

export const SOUND_KINDS: SoundKind[] = ['scan', 'success', 'complete', 'error', 'warning', 'notify', 'remove'];

export interface FeedbackSettings {
  enabled: boolean;
  /** 0 → 1 */
  volume: number;
  vibrate: boolean;
}

const KEY = 'runex.feedback.v1';
const DEFAULTS: FeedbackSettings = { enabled: true, volume: 0.8, vibrate: true };

/** Une erreur prime sur un succès joué au même instant (toast + écran). */
const PRIORITY: Record<SoundKind, number> = {
  error: 6,
  warning: 5,
  complete: 4,
  success: 3,
  remove: 2,
  scan: 1,
  notify: 0,
};
const DEDUP_MS = 250;

const VIBRATION: Partial<Record<SoundKind, number | number[]>> = {
  error: [70, 50, 70],
  warning: [40, 60, 40],
  success: 25,
  complete: [25, 40, 25],
  scan: 15,
};

let settings: FeedbackSettings = DEFAULTS;
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;
const buffers = new Map<SoundKind, AudioBuffer>();
let loading: Promise<void> | null = null;
let last: { kind: SoundKind; at: number } | null = null;

function isBrowser() {
  return typeof window !== 'undefined';
}

function readSettings(): FeedbackSettings {
  if (!isBrowser()) return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<FeedbackSettings>;
    return {
      enabled: v.enabled !== false,
      volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : DEFAULTS.volume,
      vibrate: v.vibrate !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

if (isBrowser()) settings = readSettings();

export function getFeedbackSettings(): FeedbackSettings {
  return settings;
}

export function setFeedbackSettings(patch: Partial<FeedbackSettings>) {
  settings = { ...settings, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* stockage indisponible : réglage gardé pour la session */
  }
  listeners.forEach((l) => l());
}

export function subscribeFeedbackSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

async function loadBuffers() {
  const c = audioContext();
  if (!c) return;
  await Promise.all(
    SOUND_KINDS.map(async (kind) => {
      if (buffers.has(kind)) return;
      try {
        const res = await fetch(`/sounds/${kind}.wav`);
        const data = await res.arrayBuffer();
        buffers.set(kind, await c.decodeAudioData(data));
      } catch {
        /* son manquant : la lecture passera par <audio> */
      }
    })
  );
}

/**
 * Déverrouillage au premier geste : reprise du contexte audio (iOS/Android
 * le créent suspendu) et préchargement des sons.
 */
function unlock() {
  const c = audioContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  // Un tampon silencieux joué dans le geste « débloque » Safari iOS.
  try {
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch {
    /* rien */
  }
  loading = loading ?? loadBuffers();
}

if (isBrowser()) {
  const once = () => {
    unlock();
    ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.removeEventListener(e, once, true));
  };
  ['pointerdown', 'touchend', 'keydown'].forEach((e) =>
    window.addEventListener(e, once, { capture: true, passive: true })
  );
  // Retour sur l'onglet (téléphone verrouillé puis rouvert) : contexte relancé.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
  });
}

/** Joue le retour d'une action. Ne lève jamais d'erreur. */
export function playFeedback(kind: SoundKind): void {
  if (!isBrowser()) return;
  const now = performance.now();
  if (last && now - last.at < DEDUP_MS && PRIORITY[kind] <= PRIORITY[last.kind]) return;
  last = { kind, at: now };

  if (settings.vibrate && VIBRATION[kind] && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(VIBRATION[kind]!);
    } catch {
      /* rien */
    }
  }
  if (!settings.enabled || settings.volume <= 0) return;

  // Trace pour les tests de bout en bout (aucun effet en production).
  (window as unknown as { __runexSounds?: SoundKind[] }).__runexSounds?.push(kind);

  const c = ctx;
  const buffer = buffers.get(kind);
  if (c && buffer && c.state === 'running') {
    try {
      const src = c.createBufferSource();
      const gain = c.createGain();
      gain.gain.value = settings.volume;
      src.buffer = buffer;
      src.connect(gain).connect(c.destination);
      src.start();
      return;
    } catch {
      /* repli ci-dessous */
    }
  }
  // Repli : élément <audio> (premier son avant préchargement, ou Web Audio absent).
  try {
    const a = new Audio(`/sounds/${kind}.wav`);
    a.volume = settings.volume;
    void a.play().catch(() => undefined);
  } catch {
    /* rien */
  }
  if (!loading && c) loading = loadBuffers();
}

/** Raccourcis lisibles dans les écrans. */
export const feedback = {
  scan: () => playFeedback('scan'),
  success: () => playFeedback('success'),
  complete: () => playFeedback('complete'),
  error: () => playFeedback('error'),
  warning: () => playFeedback('warning'),
  notify: () => playFeedback('notify'),
  remove: () => playFeedback('remove'),
};
