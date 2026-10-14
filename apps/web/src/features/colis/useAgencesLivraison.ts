'use client';

/**
 * Agences de sortie (agence qui livre) et frais de livraison pour le
 * formulaire de colis — portail expéditeur et exploitation.
 *
 * `GET /colis/agences-livraison` renvoie la liste des agences, celle que le
 * routage propose pour l'adresse saisie, et les frais de livraison de
 * l'expéditeur (8 DT par défaut) qui s'ajoutent au prix du colis.
 */

import { useEffect, useState } from 'react';
import { requestData } from '@/lib/api';

export interface AgenceLivraison {
  id: string;
  name: string;
  governorate: string;
  isMainHub: boolean;
}

export const FRAIS_LIVRAISON_DEFAUT = 8;

export function useAgencesLivraison(governorate: string, delegation: string, shipperId?: string | null) {
  const [agences, setAgences] = useState<AgenceLivraison[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [frais, setFrais] = useState<number>(FRAIS_LIVRAISON_DEFAUT);

  useEffect(() => {
    let annule = false;
    // Petite attente : la délégation se tape lettre par lettre.
    const minuteur = window.setTimeout(() => {
      requestData<{ agences: AgenceLivraison[]; suggestion: string | null; deliveryFee: number }>(
        '/colis/agences-livraison',
        {
          query: {
            governorate: governorate || undefined,
            delegation: delegation.trim() || undefined,
            shipperId: shipperId || undefined,
          },
        }
      )
        .then((r) => {
          if (annule) return;
          setAgences(r.agences);
          setSuggestion(r.suggestion);
          if (Number.isFinite(r.deliveryFee)) setFrais(r.deliveryFee);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      annule = true;
      window.clearTimeout(minuteur);
    };
  }, [governorate, delegation, shipperId]);

  return { agences, suggestion, frais };
}

/** Total à encaisser : prix du colis + frais de livraison (arrondi au millime). */
export function totalAEncaisser(prix: string | number, frais: number): number | null {
  const p = Number(prix);
  if (prix === '' || !Number.isFinite(p) || p < 0) return null;
  return Math.round((p + frais) * 1000) / 1000;
}
