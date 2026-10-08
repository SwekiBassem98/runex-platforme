'use client';

import { useEffect, useRef } from 'react';
import { playFeedback, type SoundKind } from './feedback';

/**
 * Joue un son quand un message d'écran apparaît ou change (bandeau « compte
 * créé », erreur de formulaire…). Rien au premier rendu ni à l'effacement.
 */
export function useFeedbackOn(value: unknown, kind: SoundKind) {
  const previous = useRef<unknown>(value);
  useEffect(() => {
    if (value && value !== previous.current) playFeedback(kind);
    previous.current = value;
  }, [value, kind]);
}
