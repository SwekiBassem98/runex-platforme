-- Numéro dusiness unique des colis.
--
-- L'ancien générateur composait le numéro d'un horodatage et de six chiffres
-- tirés au hasard, en testant l'unicité par lecture. Deux créations
-- simultanées pouvaient franchir la même vérification avant insertion, et la
-- seconde se heurtait alors à une violation d'unicité remontée en 500.
--
-- La séquence déplace la garantie d'unicité dans la base : `nextval` ne rend
-- jamais la même valeur, y compris pour deux transactions concurrentes.
--
-- Format retenu : 2 chiffres d'année, 4 de date (MMDD), 8 de séquence.
--
-- Pourquoi 8 et non 6 chiffres de séquence : celle-ci est globale, elle ne
-- repart pas à zéro chaque jour. Sur un compteur à six chiffres, les valeurs
-- déjà voisines du million interdisent d'augmenter le format sans risquer le
-- dépassement. Huit chiffres laissent cent millions de colis par jour ; la
-- partie date reste lisible par un humain et range les colis dans leur ordre
-- chronologique.
CREATE SEQUENCE IF NOT EXISTS "package_number_seq" START WITH 1 INCREMENT BY 1;

-- Les colis déjà numérotés font 12 caractères (« 261002793674 »). Les nouveaux
-- en font 14 : aucun recouvrement n'est possible avec les anciens, quelle que
-- soit la valeur prise par la séquence. Celle-ci repart donc de 1.
SELECT setval('package_number_seq', 1, false);

-- Le code-barres devient une représentation distincte du numéro de business,
-- appendue d'une clé de contrôle. Les deux colonnes restent uniques ; seule
-- l'application change ce qu'elle y écrit.

-- Index d'appui de la réception : elle filtre à la fois par dépôt et par
-- statut, dans cet ordre.
CREATE INDEX IF NOT EXISTS "Package_status_depot_idx" ON "Package" ("status", "currentDepositId");