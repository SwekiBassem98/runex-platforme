/**
 * Graphiques des rapports.
 *
 * Un graphique earns its place only if la question qu'on se pose est une
 * question de forme. Quelques règles tenues ici, et qui expliquent l'absence de
 * certains graphiques :
 *
 * - **pas de camembert d'une répartition à huit parts.** Une part de 3 % sur 40
 *   n'est pas lisible, et celle qui l'est ne change aucune décision ;
 * - **pas de classement « top 5 » pour le seul motif d'être joli.** Un volume
 *   n'est un résultat que rapporté à ce qu'on attendait de lui ;
 * - **la couleur porte une signification.** Une barre rouge de taux de réussite
 *   signale un livreur à accompagner ; une barre rouge décorative ne dit rien et
 *   apprend à l'user à ignorer le rouge.
 *
 * Les séries qui ne se comparent pas sur la même unité — des colis et des
 * dinars — ne partagent jamais un axe : elles ont chacune leur graphique, ou
 * aucune.
 */

'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTND } from '@logixpress/ui';

const GRILLE = '#F1F5F9';
const AXE = '#94A3B8';
const INFOBULLE = {
  backgroundColor: '#1E293B',
  border: 'none',
  borderRadius: '6px',
  color: '#FFFFFF',
  fontSize: '11px',
};
const AXE_COMMUN = {
  stroke: AXE,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

/**
 * Recharts type ses valeurs d'infobulle comme `string | number | undefined`
 * selon les séries. On convertit une fois pour toutes ici plutôt que de
 * contraindre chaque `formatter` : le typage du graphique n'a pas à se mesurer
 * à celui de l'affichage d'un nombre.
 */
function nombre(valeur: unknown): number {
  if (typeof valeur === 'number') return valeur;
  if (typeof valeur === 'string') return Number(valeur) || 0;
  return 0;
}

/**
 * Montant en dinars, par le formateur de la plateforme.
 *
 * Une infobulle qui écrit `1234.890 DT` pendant que la colonne juste en dessous
 * écrit `1 234,890 DT` donne deux lectures du même chiffre sur le même écran. Le
 * formateur unique évite d'avoir à se demander laquelle des deux fait foi.
 */
function dinar(valeur: unknown): string {
  return formatTND(nombre(valeur).toFixed(3));
}

/**
 * Graduations d'un axe en dinars.
 *
 * L'axe est là pour donner l'échelle, pas la valeur exacte — le montant exact est
 * dans l'infobulle et dans le tableau. Écrire `1234567` sur une largeur de
 * quelques pixels tronque la graduation et laisse deviner le chiffre manquant ;
 * abrégé, il se lit. L'unité est annoncée une fois, sur l'axe, pour que la
 * graduation n'ait pas à la répéter à chaque trait.
 */
const COMPACT = new Intl.NumberFormat('fr-TN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const AXE_DINAR = {
  tickFormatter: (v: number) => COMPACT.format(v),
  label: { value: 'DT', position: 'insideTopLeft', fill: AXE, fontSize: 10, offset: -2 },
} as const;

/** Teinte du taux de réussite : lisible comme un feu, sans l'explication. */
function teinteTaux(taux: number): string {
  if (taux < 70) return '#DC2626';
  if (taux < 90) return '#F59E0B';
  return '#16A34A';
}

interface SerieJourSimple {
  libelle: string;
  livres: number;
}

/**
 * Flux quotidien : ce qui entre, ce qui sort, ce qui coince.
 *
 * Trois courbes plutôt qu'un compte : un total ne dit pas si le retard
 * s'accumule ou s'évacue, une courbe le dit tout de suite.
 */
export function GraphiqueFlux({
  data,
  hauteur = 240,
}: {
  data: Array<{ libelle: string; crees: number; livres: number; incidents: number }>;
  hauteur?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={hauteur}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
        <XAxis dataKey="libelle" {...AXE_COMMUN} interval="preserveStartEnd" />
        <YAxis {...AXE_COMMUN} allowDecimals={false} />
        <Tooltip
          contentStyle={INFOBULLE}
          labelStyle={{ color: '#94A3B8' }}
          formatter={(valeur, nom) => [nombre(valeur), nom as string]}
        />
        <Line
          type="monotone"
          dataKey="crees"
          name="Colis créés"
          stroke="#94A3B8"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="livres"
          name="Livrés"
          stroke="#16A34A"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="incidents"
          name="Incidents"
          stroke="#DC2626"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Taux de réussite par entité, en barres horizontales.
 *
 * Le nom porte une valeur longue — un nom d'expéditeur, un nom de livreur — et
 * une barre verticale lui laisserait un dixième de la place.
 */
export function GraphiqueTaux({
  data,
  hauteur,
}: {
  data: Array<{ nom: string; taux: number }>;
  hauteur?: number;
}) {
  // Une barre par entité, la hauteur suit donc le nombre d'entités : une
  // hauteur fixe laisserait des lignes de 4 pixels sur cent livreurs.
  const taille = hauteur ?? Math.max(140, data.length * 30 + 24);
  return (
    <ResponsiveContainer width="100%" height={taille}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} {...AXE_COMMUN} unit="%" />
        <YAxis type="category" dataKey="nom" {...AXE_COMMUN} width={130} />
        <Tooltip
          contentStyle={INFOBULLE}
          cursor={{ fill: '#F8FAFC' }}
          formatter={(valeur) => [`${nombre(valeur)} %`, 'Taux de réussite']}
        />
        <Bar dataKey="taux" radius={[0, 3, 3, 0]} barSize={14}>
          {data.map((entree) => (
            <Cell key={entree.nom} fill={teinteTaux(entree.taux)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Attendu contre encaissé, par jour.
 *
 * Les deux séries sont dans la même unité et sur la même échelle : c'est le
 * seul graphique où l'écart se lit directement, sans calcul.
 */
export function GraphiqueCaisse({
  data,
  hauteur = 240,
}: {
  data: Array<{ libelle: string; attendu: number; encaisse: number }>;
  hauteur?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={hauteur}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
        <XAxis dataKey="libelle" {...AXE_COMMUN} interval="preserveStartEnd" />
        <YAxis {...AXE_COMMUN} {...AXE_DINAR} width={58} />
        <Tooltip
          contentStyle={INFOBULLE}
          cursor={{ fill: '#F8FAFC' }}
          formatter={(valeur, nom) => [dinar(valeur), nom as string]}
        />
        <Bar dataKey="attendu" name="Attendu" fill="#CBD5E1" radius={[3, 3, 0, 0]} barSize={10} />
        <Bar dataKey="encaisse" name="Encaissé" fill="#16A34A" radius={[3, 3, 0, 0]} barSize={10} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Comptage par motif : ce qui coince, du plus fréquent au plus rare. */
export function GraphiqueMotifs({
  data,
  nomSerie,
  hauteur,
  couleur = '#DC2626',
}: {
  data: Array<{ motif: string; count: number }>;
  nomSerie: string;
  hauteur?: number;
  couleur?: string;
}) {
  if (data.length === 0) return null;
  const taille = hauteur ?? Math.max(120, data.length * 30 + 24);
  return (
    <ResponsiveContainer width="100%" height={taille}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} horizontal={false} />
        <XAxis type="number" {...AXE_COMMUN} allowDecimals={false} />
        <YAxis type="category" dataKey="motif" {...AXE_COMMUN} width={150} />
        <Tooltip
          contentStyle={INFOBULLE}
          cursor={{ fill: '#F8FAFC' }}
          formatter={(valeur) => [nombre(valeur), nomSerie]}
        />
        <Bar dataKey="count" fill={couleur} radius={[0, 3, 3, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Un volume par dépôt : où se trouve le stock. */
export function GraphiqueDepots({
  data,
  hauteur = 220,
}: {
  data: Array<{ nom: string; recus: number; livres: number }>;
  hauteur?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={hauteur}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
        <XAxis dataKey="nom" {...AXE_COMMUN} />
        <YAxis {...AXE_COMMUN} allowDecimals={false} />
        <Tooltip
          contentStyle={INFOBULLE}
          cursor={{ fill: '#F8FAFC' }}
          formatter={(valeur, nom) => [nombre(valeur), nom as string]}
        />
        <Bar dataKey="recus" name="Reçus" fill="#64748B" radius={[3, 3, 0, 0]} barSize={14} />
        <Bar dataKey="livres" name="Livrés" fill="#16A34A" radius={[3, 3, 0, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Le stock par dépôt, en valeur et en volume : ce qu'il faut liquider. */
export function GraphiqueStock({
  data,
  hauteur,
}: {
  data: Array<{ nom: string; stock: number }>;
  hauteur?: number;
}) {
  const taille = hauteur ?? Math.max(140, data.length * 32 + 24);
  return (
    <ResponsiveContainer width="100%" height={taille}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} horizontal={false} />
        <XAxis type="number" {...AXE_COMMUN} allowDecimals={false} />
        <YAxis type="category" dataKey="nom" {...AXE_COMMUN} width={130} />
        <Tooltip
          contentStyle={INFOBULLE}
          cursor={{ fill: '#F8FAFC' }}
          formatter={(valeur) => [nombre(valeur), 'Colis en stock']}
        />
        <Bar dataKey="stock" fill="#0F172A" radius={[0, 3, 3, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Une série unique dans le temps : les livraisons, jour par jour. */
export function GraphiqueLivraisons({
  data,
  hauteur = 180,
}: {
  data: SerieJourSimple[];
  hauteur?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={hauteur}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
        <XAxis dataKey="libelle" {...AXE_COMMUN} interval="preserveStartEnd" />
        <YAxis {...AXE_COMMUN} allowDecimals={false} />
        <Tooltip
          contentStyle={INFOBULLE}
          formatter={(valeur) => [nombre(valeur), 'Livrés']}
        />
        <Line type="monotone" dataKey="livres" stroke="#16A34A" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
