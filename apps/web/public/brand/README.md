# Assets de marque RUNEX

## Fichiers

| Fichier | Rôle | Origine |
|---|---|---|
| `runex-logo.jpeg` | Logo complet RUNEX | Copie **octet pour octet** de `apps/web/runex-logo.jpeg` (fourni, SHA-256 `a13a2503…aebe5e`) |
| `runex-mark.png` | Variante carrée, pour les emplacements carrés (barre latérale repliée, favicon) | `runex-logo.jpeg` encadré de noir en carré, puis réduit à 512 × 512 |
| `runex-logo-impression.png` | Variante **claire**, réservée au bon de livraison imprimé | `scripts/brand/logo-impression.py` (voir ci-dessous) |

`apps/web/src/app/icon.png` est une copie de `runex-mark.png` : Next.js en fait
la favicon du site.

## Règles de composition respectées

Ces variantes sont produites **mécaniquement**, sans retouche :

- aucun recadrage — le logo n'est jamais amputé ;
- aucune mise à l'échelle non uniforme — les proportions d'origine (719 × 480)
  sont conservées ;
- aucun changement de couleur, de contraste ni de typographie.

La variante carrée est obtenue en ajoutant des bandes noires au-dessus et
au-dessous du logo (`sips -p 719 719 --padColor 000000`), puis en réduisant
l'ensemble uniformément (`sips -Z 512`). Le fond du logo d'origine étant déjà
noir, ces bandes sont invisibles : le résultat est le logo d'origine, posé sur
son propre fond.

Une icône monochromatique ou un recadrage serré autour de la marque auraient
exigé de réinterpréter le logo, ce que la marque impose de ne pas faire. Pour
les emplacements carrés, le logo est donc affiché entier sur un fond noir.

## Emplacements recommandés

- Fond sombre (barre latérale, écran de connexion) : `runex-logo.jpeg` ou
  `runex-mark.png`, tous deux sur fond noir.
- Fond clair (écran de chargement, états vides) : afficher le logo dans un
  conteneur à fond noir et à coins arrondis. Le logo étant lui-même sur fond
  noir, le conteneur disparaît et la marque reste lisible.
## Variante claire pour l'impression (bon de livraison)

Imprimé sur papier blanc, le logo sur fond noir sortait en pavé sombre où
« RUNEX » se lisait mal. Le bon de livraison — et lui seul — utilise donc
`runex-logo-impression.png`, produit par `scripts/brand/logo-impression.py` à
partir de `runex-logo.jpeg` :

- fond noir → blanc ; lettres « RUNEX » blanches → noires ;
- facette sombre du R → gris, pour garder le relief ;
- rouge conservé en aplat (sans le halo lumineux, qui imprime en tache rose) ;
- recadrage serré autour du dessin, proportions inchangées.

Partout ailleurs (écrans, autres documents), le logo d'origine reste en place.
