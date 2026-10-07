/**
 * Langue appliquée avant la première peinture.
 *
 * La direction d'écriture est une propriété de `<html>` : rien dans la page ne
 * peut la corriger après coup sans provoquer un miroitement. Un utilisateur qui
 * enregistre l'arabe verrait donc son portail se composer en français — barre
 * latérale à gauche, colonnes dans le mauvais ordre — avant qu'un effet React ne
 * bascule tout en miroir. Sur une page dense comme un tableau de colis, ce
 * décalage se lit comme un défaut de rendu, pas comme un choix de langue.
 *
 * Le script est donc exécuté dans `<head>`, avant que le navigateur peigne quoi
 * que ce soit. Il ne fait que trois choses : lire la préférence, vérifier qu'elle
 * s'applique à cette route, poser `lang` et `dir`. La traduction des textes reste
 * le travail de `I18nProvider` après l'hydratation — un script ne traduit pas
 * React.
 *
 * ## Périmètre
 *
 * Le chemin est connu dès ce point, alors que la préférence ne l'est pas côté
 * serveur. La même règle que le fournisseur s'applique donc ici : l'arabe ne
 * touche que `/expediteur`, y compris la connexion du client. L'administration et
 * la porte d'entrée de l'exploitation, non traduites, restent en français et de
 * gauche à droite quel que soit le poste.
 *
 * ## Pourquoi une constante et non un script littéral
 *
 * Ce code est du JavaScript exécuté tel quel. Il est produit par interpolation
 * pour que les chemins, la clé de stockage et le sens d'écriture viennent de
 * `config.ts` — les mêmes valeurs que celles lues par le fournisseur. Dupliqués
 * à la main, ils finiraient par diverger, et le symptôme serait rare et dur à
 * rattacher : une seule des deux surfaces qui resterait en français.
 *
 * L'interpolation ne touche qu'à la structure — littéraux et appels de
 * `config.ts`. Aucune valeur ne vient de l'URL, du stockage ou d'une requête :
 * `JSON.stringify` sur une liste de chemins littéraux suffit à neutraliser toute
 * injection, sans échappement à écrire.
 */

import { CLE_LANGUE, DIR_PAR_LANGUE, LANGUES, SURFACES_I18N } from './config';

/** Liste des chemins traduits, à injecter telle quelle. */
const SURFACES: string = JSON.stringify(SURFACES_I18N);

/** Langues supportées, à valider avant d'être posée sur `<html>`. */
const LANGUES_CONNUES: string = JSON.stringify(LANGUES);

export const SCRIPT_PREMIER_RENDU: string = `(function(){
  try {
    var l = localStorage.getItem(${JSON.stringify(CLE_LANGUE)});
    if (${LANGUES_CONNUES}.indexOf(l) === -1) return;
    var p = location.pathname;
    var s = ${SURFACES};
    for (var i = 0; i < s.length; i++) {
      var d = s[i];
      if (p === d || p.indexOf(d + '/') === 0) {
        document.documentElement.lang = l;
        document.documentElement.dir = (${JSON.stringify(DIR_PAR_LANGUE)})[l];
        return;
      }
    }
  } catch (e) {}
})();`;