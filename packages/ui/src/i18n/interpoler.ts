/**
 * Substitution des variables d'un modèle de libellé.
 *
 * Volontairement minimal : `{n}` et `{libelle}` couvrent tout ce dont la
 * plateforme a besoin, et une bibliothèque d'interpolation serait une
 * dépendance de plus pour un besoin qui n'existe pas. La fonction est pure et
 * vit hors de tout composant : les formateurs de dates et de durées l'utilisent
 * autant que le fournisseur de langue.
 */
export function interpoler(
  modele: string,
  valeurs: Record<string, string | number> = {}
): string {
  return modele.replace(/\{(\w+)\}/g, (entier, nom: string) =>
    nom in valeurs ? String(valeurs[nom]) : entier
  );
}
