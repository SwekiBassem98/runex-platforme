'use client';

/**
 * Agences de sortie (agence qui livre) et frais de livraison pour le
 * formulaire de colis — portail expéditeur et exploitation.
 *
 * `GET /colis/agences-livraison` renvoie la liste des agences, celle que le
 * routage propose pour l'adresse saisie (agence de sortie), celle qui dessert
 * l'expéditeur (agence de départ proposée), et les frais de livraison de
 * l'expéditeur (8 DT par défaut) qui s'ajoutent au prix du colis — et
 * l'agence de rattachement proposée pour un expéditeur du gouvernorat donné.
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

/**
 * `taille` : type de colis choisi (légère, normale, lourde, volumineuse) —
 * les frais renvoyés sont ceux du tarif de l'expéditeur pour ce type.
 */
export function useAgencesLivraison(governorate: string, delegation: string, shipperId?: string | null, taille?: string) {
  const [agences, setAgences] = useState<AgenceLivraison[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionDepart, setSuggestionDepart] = useState<string | null>(null);
  const [suggestionRattachement, setSuggestionRattachement] = useState<string | null>(null);
  const [fraisNormal, setFraisNormal] = useState<number>(FRAIS_LIVRAISON_DEFAUT);
  const [tarifs, setTarifs] = useState<Partial<Record<string, number>>>({});

  useEffect(() => {
    let annule = false;
    // Petite attente : la délégation se tape lettre par lettre.
    const minuteur = window.setTimeout(() => {
      requestData<{
        agences: AgenceLivraison[];
        suggestion: string | null;
        suggestionDepart?: string | null;
        suggestionRattachement?: string | null;
        deliveryFee: number;
        tarifs?: Record<string, number>;
      }>(
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
          setSuggestionDepart(r.suggestionDepart ?? null);
          setSuggestionRattachement(r.suggestionRattachement ?? null);
          if (Number.isFinite(r.deliveryFee)) setFraisNormal(r.deliveryFee);
          setTarifs(r.tarifs ?? {});
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      annule = true;
      window.clearTimeout(minuteur);
    };
  }, [governorate, delegation, shipperId]);

  const choisi = taille ? tarifs[taille] : undefined;
  const frais = typeof choisi === 'number' && Number.isFinite(choisi) ? choisi : fraisNormal;
  return { agences, suggestion, suggestionDepart, suggestionRattachement, frais, tarifs };
}

/** Total à encaisser : prix du colis + frais de livraison (arrondi au millime). */
export function totalAEncaisser(prix: string | number, frais: number): number | null {
  const p = Number(prix);
  if (prix === '' || !Number.isFinite(p) || p < 0) return null;
  return Math.round((p + frais) * 1000) / 1000;
}

/** Trajet imprimé sur le bon de livraison : « départ => sortie => gouvernorat/délégation ». */
export function libelleTrajet(
  agences: AgenceLivraison[],
  departId: string,
  sortieId: string,
  gouvernorat: string,
  delegation: string
): string | null {
  const depart = agences.find((a) => a.id === departId)?.name;
  const sortie = agences.find((a) => a.id === sortieId)?.name;
  if (!depart || !sortie) return null;
  const zone = [gouvernorat, delegation.trim()].filter(Boolean).join('/');
  return `${depart} => ${sortie}${zone ? ` => ${zone}` : ''}`;
}
