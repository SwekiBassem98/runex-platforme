#!/usr/bin/env python3
"""
Sons d'interface RUNEX — synthèse reproductible (aucun échantillon tiers).

    python3 scripts/sounds/generate-sounds.py <dossier de sortie>

Produit des WAV 44,1 kHz mono 16 bits, crête à -3 dBFS, courts (≤ 0,9 s) :
scan, success, complete, error, warning, notify, remove, et « alert »
(1,7 s, notification poussée du livreur). Les mêmes fichiers
servent au web (apps/web/public/sounds) et à l'application livreur
(assets/sounds), pour que l'utilisateur reconnaisse le même retour partout.
"""
import sys, wave
from pathlib import Path
import numpy as np

SR = 44100
rng = np.random.default_rng(7)  # salle reproductible


def tone(freq, dur, *, attack=0.004, decay=0.18, partials=((1, 1.0), (2, 0.22), (3, 0.06)), wave_shape='sine'):
    t = np.arange(int(SR * dur)) / SR
    sig = np.zeros_like(t)
    for mult, amp in partials:
        ph = 2 * np.pi * freq * mult * t
        if wave_shape == 'triangle':
            s = 2 / np.pi * np.arcsin(np.sin(ph))
        else:
            s = np.sin(ph)
        sig += amp * s
    env = np.minimum(t / attack, 1.0) * np.exp(-t / decay)
    # Relâchement en cosinus sur les 12 dernières ms : pas de clic de coupure.
    rel = min(int(SR * 0.012), len(t))
    env[-rel:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, rel)))
    return sig * env


def place(chunks, total):
    out = np.zeros(int(SR * total))
    for start, sig in chunks:
        i = int(SR * start)
        n = min(len(sig), len(out) - i)
        out[i:i + n] += sig[:n]
    return out


def room(sig, length=0.12, level=0.08):
    """Petite réverbération (bruit à décroissance exponentielle) : du corps, pas d'écho."""
    n = int(SR * length)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * length / 5))
    ir = ir / np.abs(ir).sum()
    wet = np.convolve(sig, ir)[: len(sig)]
    return sig + level * wet / (np.abs(wet).max() + 1e-9) * np.abs(sig).max()


def lowpass(sig, cutoff):
    """Passe-bas 1 pôle : arrondit les timbres triangulaires (erreur non agressive)."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    out = np.empty_like(sig)
    y = 0.0
    for i, x in enumerate(sig):
        y = (1 - a) * x + a * y
        out[i] = y
    return out


def finish(sig, peak_db=-3.0):
    fade = int(SR * 0.004)
    sig[:fade] *= np.linspace(0, 1, fade)
    sig[-fade:] *= np.linspace(1, 0, fade)
    # silence final coupé au-delà de -60 dB
    thr = np.abs(sig).max() * 10 ** (-60 / 20)
    last = np.nonzero(np.abs(sig) > thr)[0]
    sig = sig[: (last[-1] + int(SR * 0.01)) if len(last) else len(sig)]
    return sig / np.abs(sig).max() * 10 ** (peak_db / 20)


def bell(freq, dur, decay):
    # cloche douce : partiels légèrement inharmoniques
    return tone(freq, dur, attack=0.003, decay=decay, partials=((1, 1.0), (2.0, 0.3), (2.76, 0.12), (5.4, 0.04)))


SOUNDS = {
    # Bip de lecteur : bref, aigu, net — confirme qu'un code a été lu.
    'scan': lambda: finish(room(place([(0, tone(2093, 0.11, attack=0.002, decay=0.045, partials=((1, 1), (3, 0.08))))], 0.14), level=0.04)),
    # Succès : deux notes ascendantes (mi → la), type marimba.
    'success': lambda: finish(room(place([
        (0.00, tone(1318.5, 0.35, decay=0.09)),
        (0.09, tone(1760.0, 0.45, decay=0.14)),
    ], 0.55))),
    # Opération majeure terminée : arpège do-mi-sol-do.
    'complete': lambda: finish(room(place([
        (0.00, tone(1046.5, 0.30, decay=0.08)),
        (0.08, tone(1318.5, 0.30, decay=0.08)),
        (0.16, tone(1568.0, 0.30, decay=0.09)),
        (0.24, bell(2093.0, 0.70, decay=0.22)),
    ], 0.95))),
    # Erreur : deux impulsions graves, timbre arrondi — signal clair sans stridence.
    'error': lambda: finish(room(place([
        (0.00, lowpass(tone(311.1, 0.13, attack=0.005, decay=0.09, partials=((1, 1), (2, 0.3)), wave_shape='triangle'), 2200)),
        (0.17, lowpass(tone(261.6, 0.20, attack=0.005, decay=0.12, partials=((1, 1), (2, 0.3)), wave_shape='triangle'), 2200)),
    ], 0.42), level=0.05)),
    # Avertissement : deux notes identiques médium (« attention »).
    'warning': lambda: finish(room(place([
        (0.00, tone(880.0, 0.14, decay=0.06)),
        (0.16, tone(880.0, 0.20, decay=0.08)),
    ], 0.40))),
    # Notification : accord de cloche doux (sol-ré).
    'notify': lambda: finish(room(place([
        (0.00, bell(784.0, 0.8, decay=0.25)),
        (0.06, bell(1174.7, 0.8, decay=0.22) * 0.7),
    ], 0.85), level=0.1)),
    # Retrait : succès inversé, plus discret (la → mi).
    'remove': lambda: finish(room(place([
        (0.00, tone(1760.0, 0.25, decay=0.07)),
        (0.08, tone(1318.5, 0.35, decay=0.10)),
    ], 0.45)), peak_db=-5.0),
    # (En dernier : le générateur aléatoire de la salle est partagé, et les
    # sons précédents restent ainsi identiques à ceux déjà publiés.)
    # Alerte livreur (notification poussée, téléphone en poche) : carillon
    # sol-si-ré joué deux fois, plus long et plus fort que « notify » pour
    # être entendu dans la rue. Fichier copié dans l'application sous
    # assets/sounds/runex_alert.wav (nom de ressource Android).
    'alert': lambda: finish(room(place([
        (0.00, bell(784.0, 0.6, decay=0.20)),
        (0.13, bell(987.8, 0.6, decay=0.20)),
        (0.26, bell(1174.7, 0.8, decay=0.28)),
        (0.80, bell(784.0, 0.6, decay=0.20)),
        (0.93, bell(987.8, 0.6, decay=0.20)),
        (1.06, bell(1174.7, 0.9, decay=0.32)),
    ], 1.9), level=0.1), peak_db=-1.0),
}


def write_wav(path, sig):
    data = np.clip(sig, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'sounds')
    out.mkdir(parents=True, exist_ok=True)
    for name, make in SOUNDS.items():
        sig = make()
        write_wav(out / f'{name}.wav', sig)
        print(f'{name:9s} {len(sig) / SR:5.2f} s')
