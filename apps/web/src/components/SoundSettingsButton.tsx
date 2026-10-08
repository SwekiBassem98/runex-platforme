'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  getFeedbackSettings,
  playFeedback,
  setFeedbackSettings,
  subscribeFeedbackSettings,
  type FeedbackSettings,
} from '@/lib/feedback';

const SERVER: FeedbackSettings = { enabled: true, volume: 0.8, vibrate: true };

/**
 * Réglage du retour sonore, dans la barre supérieure (ordinateur et téléphone) :
 * son activé, volume, vibration, et un bouton pour l'essayer.
 */
export function SoundSettingsButton({ className = '' }: { className?: string }) {
  const settings = useSyncExternalStore(subscribeFeedbackSettings, getFeedbackSettings, () => SERVER);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [canVibrate, setCanVibrate] = useState(false);

  useEffect(() => {
    setCanVibrate(typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function');
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const muted = !settings.enabled || settings.volume <= 0;
  const Icon = muted ? VolumeX : Volume2;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={muted ? 'Sons désactivés — réglages' : 'Sons activés — réglages'}
        data-testid="sound-settings"
        className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Retour sonore"
          className="absolute end-0 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl p-4 z-50 space-y-4"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Retour sonore</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Un son confirme chaque scan, réussite ou refus. Réglage propre à cet appareil.
            </p>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
            <span>Sons</span>
            <input
              type="checkbox"
              role="switch"
              data-testid="sound-enabled"
              checked={settings.enabled}
              onChange={(e) => setFeedbackSettings({ enabled: e.target.checked })}
              className="w-5 h-5 accent-red-600"
            />
          </label>
          <label className="block text-sm text-slate-700">
            <span className="flex justify-between">
              <span>Volume</span>
              <span className="text-xs text-slate-500 tabular-nums">{Math.round(settings.volume * 100)} %</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              disabled={!settings.enabled}
              onChange={(e) => setFeedbackSettings({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => playFeedback('scan')}
              className="w-full mt-2 accent-red-600"
            />
          </label>
          {canVibrate && (
            <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
              <span>Vibration</span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.vibrate}
                onChange={(e) => setFeedbackSettings({ vibrate: e.target.checked })}
                className="w-5 h-5 accent-red-600"
              />
            </label>
          )}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => playFeedback('success')}
              disabled={muted}
              className="px-2 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              Succès
            </button>
            <button
              type="button"
              onClick={() => playFeedback('scan')}
              disabled={muted}
              className="px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              Scan
            </button>
            <button
              type="button"
              onClick={() => playFeedback('error')}
              disabled={muted}
              className="px-2 py-2 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              Erreur
            </button>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Sur iPhone, le bouton « silencieux » coupe aussi ces sons.
          </p>
        </div>
      )}
    </div>
  );
}
