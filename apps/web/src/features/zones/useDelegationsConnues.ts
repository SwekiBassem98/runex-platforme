'use client';

import { useEffect, useState } from 'react';
import { zonesApi } from '@/lib/api';

/**
 * Délégations déjà connues (zones existantes) d'un gouvernorat, pour proposer
 * une saisie cohérente dans les formulaires de colis : « Hammam Lif » plutôt
 * que « hammam-lif » ou « H. Lif ». Une délégation absente de la liste reste
 * acceptée : l'API crée alors la zone à l'enregistrement du colis.
 */
export function useDelegationsConnues(governorate: string | null | undefined): string[] {
  const [liste, setListe] = useState<string[]>([]);
  useEffect(() => {
    if (!governorate) {
      setListe([]);
      return;
    }
    let actif = true;
    zonesApi
      .suggestions(governorate)
      .then((rows) => {
        if (actif) setListe([...new Set(rows.map((r) => r.delegation))]);
      })
      .catch(() => {
        if (actif) setListe([]);
      });
    return () => {
      actif = false;
    };
  }, [governorate]);
  return liste;
}

/** La délégation saisie correspond-elle à une zone existante ? */
export function estZoneConnue(liste: string[], saisie: string): boolean {
  const s = saisie.replace(/\s+/g, ' ').trim().toLowerCase();
  return !s || liste.some((d) => d.trim().toLowerCase() === s);
}
