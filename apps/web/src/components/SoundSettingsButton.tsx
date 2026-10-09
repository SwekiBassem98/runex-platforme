"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  getFeedbackSettings,
  playFeedback,
  setFeedbackSettings,
  subscribeFeedbackSettings,
  type FeedbackSettings,
} from "@/lib/feedback";

const SERVER: FeedbackSettings = { enabled: true, volume: 0.8, vibrate: true };

/**
 * Réglage du retour sonore, dans la barre supérieure (ordinateur et téléphone) :
 * son activé, volume, vibration, et un bouton pour l'essayer.
 */
export function SoundSettingsButton({
  className = "",
}: {
  className?: string;
}) {
  const settings = useSyncExternalStore(
    subscribeFeedbackSettings,
    getFeedbackSettings,
    () => SERVER,
  );
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [canVibrate, setCanVibrate] = useState(false);

  useEffect(() => {
    setCanVibrate(
      typeof navigator !== "undefined" &&
        typeof navigator.vibrate === "function",
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
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
        aria-label={muted ? t("son.coupes") : t("son.actives")}
        data-testid="sound-settings"
        className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("son.titre")}
          data-testid="sound-popup"
          /*
           * Téléphone : panneau fixé à l'écran, à 12 px de chaque bord, sous la
           * barre supérieure — quelle que soit la place du bouton et le sens
           * d'écriture, il ne déborde jamais. Écran large : bulle ancrée au
           * bouton, alignée sur son bord de fin (droite en français, gauche en
           * arabe), qui s'ouvre donc toujours vers l'intérieur de la page.
           */
          className="fixed inset-x-3 top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto sm:absolute sm:inset-x-auto sm:top-full sm:end-0 sm:mt-2 sm:w-80 sm:max-h-none sm:overflow-visible rounded-xl border border-slate-200 bg-white shadow-xl p-4 z-50 space-y-4 text-start"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                {t("son.titre")}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {t("son.aide")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("son.fermer")}
              className="p-1 -m-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
            <span>{t("son.sons")}</span>
            <input
              type="checkbox"
              role="switch"
              data-testid="sound-enabled"
              checked={settings.enabled}
              onChange={(e) =>
                setFeedbackSettings({ enabled: e.target.checked })
              }
              className="w-5 h-5 accent-red-600"
            />
          </label>
          <label className="block text-sm text-slate-700">
            <span className="flex justify-between">
              <span>{t("son.volume")}</span>
              <span className="text-xs text-slate-500 tabular-nums" dir="ltr">
                {Math.round(settings.volume * 100)} %
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              disabled={!settings.enabled}
              onChange={(e) =>
                setFeedbackSettings({ volume: Number(e.target.value) / 100 })
              }
              onPointerUp={() => playFeedback("scan")}
              className="w-full mt-2 accent-red-600"
            />
          </label>
          {canVibrate && (
            <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
              <span>{t("son.vibration")}</span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.vibrate}
                onChange={(e) =>
                  setFeedbackSettings({ vibrate: e.target.checked })
                }
                className="w-5 h-5 accent-red-600"
              />
            </label>
          )}
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
              {t("son.essayer")}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => playFeedback("success")}
                disabled={muted}
                className="px-2 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {t("son.succes")}
              </button>
              <button
                type="button"
                onClick={() => playFeedback("scan")}
                disabled={muted}
                className="px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {t("son.scan")}
              </button>
              <button
                type="button"
                onClick={() => playFeedback("error")}
                disabled={muted}
                className="px-2 py-2 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {t("son.erreur")}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            {t("son.iphone")}
          </p>
        </div>
      )}
    </div>
  );
}
