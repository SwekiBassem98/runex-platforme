/**
 * Signaux sonores du poste de scan : l'opérateur regarde le colis, pas l'écran.
 * Un bip aigu = accepté, un double buzz grave = refusé, un ton descendant =
 * retiré. Générés par Web Audio : aucun fichier à charger.
 */
let contexte: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    contexte ??= new Ctor();
    return contexte;
  } catch {
    return null;
  }
}

function ton(frequence: number, debut: number, duree: number, forme: OscillatorType = 'sine', volume = 0.15) {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = forme;
  osc.frequency.value = frequence;
  gain.gain.value = volume;
  osc.connect(gain).connect(c.destination);
  const t = c.currentTime + debut;
  osc.start(t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duree);
  osc.stop(t + duree + 0.02);
}

export const sons = {
  succes() {
    ton(1320, 0, 0.12);
  },
  erreur() {
    ton(180, 0, 0.18, 'square', 0.12);
    ton(180, 0.24, 0.22, 'square', 0.12);
  },
  retrait() {
    ton(880, 0, 0.09);
    ton(520, 0.1, 0.14);
  },
};
