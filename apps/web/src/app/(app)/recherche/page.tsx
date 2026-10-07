'use client';

/**
 * Recherche opérationnelle transversale.
 *
 * Un terme, cinq familles d'objets. Les résultats sont groupés par famille
 * plutôt que mêlés : « Karim » peut désigner un client, un livreur et un
 * expéditeur à la fois, et l'utilisateur doit pouvoir voir lequel il ouvre
 * avant de cliquer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  Building2,
  Loader2,
  Package,
  Search,
  Truck,
  Warehouse,
} from 'lucide-react';
import { searchApi, type GlobalSearchResult } from '@/lib/api';

const VIDE: GlobalSearchResult = {
  colis: [],
  shippers: [],
  drivers: [],
  runsheets: [],
  deposits: [],
};

function dateJour(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-TN');
}

export default function RecherchePage() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';

  const [terme, setTerme] = useState(initial);
  const [recherche, setRecherche] = useState(initial);
  const [resultats, setResultats] = useState<GlobalSearchResult>(VIDE);
  const [isLoading, setIsLoading] = useState(false);
  const [aRecherché, setARecherché] = useState(false);

  const lancer = useCallback(async (valeur: string) => {
    const q = valeur.trim();
    if (q.length < 2) {
      setResultats(VIDE);
      setARecherché(false);
      return;
    }
    setIsLoading(true);
    try {
      setResultats(await searchApi.global(q));
      setARecherché(true);
    } catch {
      setResultats(VIDE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void lancer(recherche);
  }, [recherche, lancer]);

  const soumettre = (event: React.FormEvent) => {
    event.preventDefault();
    const q = terme.trim();
    setRecherche(q);
    router.replace(q ? `/recherche?q=${encodeURIComponent(q)}` : '/recherche', { scroll: false });
  };

  const total =
    resultats.colis.length +
    resultats.shippers.length +
    resultats.drivers.length +
    resultats.runsheets.length +
    resultats.deposits.length;

  return (
    <div className="flex-1 p-4 lg:p-6 space-y-4">
      <div>
        <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Search className="w-4 h-4" />
          Recherche
        </h1>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Colis, expéditeurs, livreurs, runsheets et dépôts.
        </p>
      </div>

      <form onSubmit={soumettre} className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={terme}
            onChange={(event) => setTerme(event.target.value)}
            autoFocus
            placeholder="N° colis, nom, téléphone, expéditeur, livreur, dépôt…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-blue-400"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-700 transition"
        >
          Chercher
        </button>
      </form>

      {isLoading && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Recherche…
        </div>
      )}

      {!isLoading && aRecherché && total === 0 && (
        <div className="p-10 text-center text-slate-500 text-xs">
          Aucun résultat pour « {recherche} ».
        </div>
      )}

      {!isLoading && aRecherché && total > 0 && (
        <div className="space-y-4">
          {/* Colis */}
          <section className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
            <h2 className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-slate-500" />
              Colis
              <span className="text-[11px] font-mono font-normal text-slate-500">
                {resultats.colis.length}
              </span>
            </h2>
            {resultats.colis.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-slate-500">Aucun colis.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {resultats.colis.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => router.push(`/colis/${c.id}`)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] font-semibold text-slate-800">
                        {c.trackingNumber}
                      </span>
                      <span className="text-[11px] text-slate-500">{c.statusLabel}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {c.customerName} · {c.customerPhone} · {c.shipperName}
                      {c.governorate ? ` · ${c.governorate}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Expéditeurs */}
            <section className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
              <h2 className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                Expéditeurs
                <span className="text-[11px] font-mono font-normal text-slate-500">
                  {resultats.shippers.length}
                </span>
              </h2>
              {resultats.shippers.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-slate-500">Aucun expéditeur.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {resultats.shippers.map((s) => (
                    <div key={s.id} className="px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-800">{s.companyName}</p>
                        <p className="text-[11px] font-mono text-slate-500">{s.code}</p>
                      </div>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">
                        {s.packagesCount} colis
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Livreurs */}
            <section className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
              <h2 className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-slate-500" />
                Livreurs
                <span className="text-[11px] font-mono font-normal text-slate-500">
                  {resultats.drivers.length}
                </span>
              </h2>
              {resultats.drivers.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-slate-500">Aucun livreur.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {resultats.drivers.map((d) => (
                    <div key={d.id} className="px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-800">{d.fullName}</p>
                        <p className="text-[11px] font-mono text-slate-500">{d.driverCode}</p>
                      </div>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">
                        {d.packagesCount} colis
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Runsheets */}
            <section className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
              <h2 className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Archive className="w-3.5 h-3.5 text-slate-500" />
                Runsheets
                <span className="text-[11px] font-mono font-normal text-slate-500">
                  {resultats.runsheets.length}
                </span>
              </h2>
              {resultats.runsheets.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-slate-500">Aucune runsheet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {resultats.runsheets.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => router.push(`/runsheets/${r.id}`)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 transition flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-mono text-[11px] font-semibold text-slate-800">
                          {r.runsheetNumber}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {dateJour(r.tourDate)}
                          {r.driverName ? ` · ${r.driverName}` : ''}
                        </p>
                      </div>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">
                        {r.packagesCount} colis
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Dépôts */}
            <section className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
              <h2 className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Warehouse className="w-3.5 h-3.5 text-slate-500" />
                Dépôts
                <span className="text-[11px] font-mono font-normal text-slate-500">
                  {resultats.deposits.length}
                </span>
              </h2>
              {resultats.deposits.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-slate-500">Aucun dépôt.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {resultats.deposits.map((d) => (
                    <div key={d.id} className="px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-800">{d.name}</p>
                        <p className="text-[11px] font-mono text-slate-500">
                          {d.code} · {d.city}
                        </p>
                      </div>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">
                        {d.packagesCount} colis
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
