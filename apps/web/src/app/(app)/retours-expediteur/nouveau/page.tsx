'use client';

/**
 * Ajouter un bon de retour — étape 1 : l'expéditeur.
 * Le bon est créé dès l'enregistrement ; on continue sur sa fiche (livreur,
 * véhicule, scan des colis).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Card, PageHeader, useToast } from '@logixpress/ui';
import { retoursExpediteurApi, shippersApi, type ExpediteurARendre } from '@/lib/api';

export default function NouveauBonRetourPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [expediteurs, setExpediteurs] = useState<{ id: string; nom: string; tel: string }[]>([]);
  const [aRendre, setARendre] = useState<Map<string, ExpediteurARendre>>(new Map());
  const [recherche, setRecherche] = useState('');
  const [choix, setChoix] = useState<string>('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    shippersApi
      .list({ limit: 200 })
      // Retours expéditeur : expéditeurs de la zone du hub (Tunis, Ben Arous)
      // seulement ; les autres récupèrent leurs retours dans leur agence.
      .then((r) =>
        setExpediteurs(
          r.items
            .filter((s) => s.isActive && s.zoneHub !== false)
            .map((s) => ({ id: s.id, nom: s.companyName, tel: s.phone }))
        )
      )
      .catch(() => undefined);
    retoursExpediteurApi
      .aRendre()
      .then((a) => setARendre(new Map(a.map((x) => [x.shipperId, x]))))
      .catch(() => undefined);
  }, []);

  // Ceux qui ont des retours en attente d'abord : c'est pour eux qu'on crée un bon.
  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return expediteurs
      .filter((e) => !q || e.nom.toLowerCase().includes(q) || e.tel.includes(q))
      .sort((a, b) => {
        const na = (aRendre.get(a.id)?.colis ?? 0) + (aRendre.get(a.id)?.echanges ?? 0);
        const nb = (aRendre.get(b.id)?.colis ?? 0) + (aRendre.get(b.id)?.echanges ?? 0);
        return nb - na || a.nom.localeCompare(b.nom);
      });
  }, [expediteurs, aRendre, recherche]);

  const enregistrer = async (shipperId = choix) => {
    if (!shipperId) return;
    setEnvoi(true);
    try {
      const r = await retoursExpediteurApi.creer({ shipperId });
      if (r.data) router.replace(`/retours-expediteur/${r.data.id}`);
    } catch (e) {
      addToast({ type: 'error', title: 'Création impossible', message: e instanceof Error ? e.message : undefined });
      setEnvoi(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajouter un bon de retour"
        description="Choisissez l'expéditeur à qui rendre ses colis (expéditeurs de Tunis et Ben Arous). Vous ajouterez ensuite le livreur et les colis."
        breadcrumbs={[{ label: 'Retours expéditeur', href: '/retours-expediteur' }, { label: 'Nouveau bon', active: true }]}
      />
      <div className="px-6 max-w-2xl">
        <Card>
          <label className="block text-sm font-semibold text-slate-700" htmlFor="recherche-expediteur">
            Expéditeur
          </label>
          <div className="relative mt-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              id="recherche-expediteur"
              autoFocus
              placeholder="Rechercher un expéditeur (nom ou téléphone)…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="w-full border border-slate-200 rounded-md pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md" role="listbox" data-testid="liste-expediteurs">
            {liste.length === 0 ? (
              <li className="px-3 py-4 text-sm text-slate-500">Aucun expéditeur.</li>
            ) : (
              liste.map((e) => {
                const a = aRendre.get(e.id);
                const n = (a?.colis ?? 0) + (a?.echanges ?? 0);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={choix === e.id}
                      onClick={() => setChoix(e.id)}
                      onDoubleClick={() => {
                        setChoix(e.id);
                        void enregistrer(e.id);
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm ${
                        choix === e.id ? 'bg-red-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span>
                        <span className="font-medium text-slate-900">{e.nom}</span>
                        <span className="ml-2 text-xs text-slate-400">{e.tel}</span>
                      </span>
                      {n > 0 ? (
                        <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                          {n} colis à rendre
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">aucun retour en attente</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => router.push('/retours-expediteur')}
              className="px-3 py-2 rounded-md border border-slate-200 text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!choix || envoi}
              onClick={() => void enregistrer()}
              data-testid="enregistrer-expediteur"
              className="px-4 py-2 rounded-md bg-orange-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {envoi ? 'Création…' : 'Enregistrer'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
