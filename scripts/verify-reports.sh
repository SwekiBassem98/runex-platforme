#!/usr/bin/env bash
# Vérifie les rapports d'exploitation : contrat, bornes de période,
# cloisonnement par périmètre, cohérence interne des chiffres et exports CSV.
#
# Le rapport est le seul écran qui agrège des montants et des volumes de tiers.
# Trois choses peuvent donc y mentir sans qu'aucune erreur ne remonte :
#
#   - le **périmètre** : un expéditeur qui lit un rapport global voit les colis
#     des autres et repart avec un chiffre faux ;
#   - la **période** : « jusqu'au 12 » qui exclut le 12, ou une période inversée
#     rendue comme un rapport vide ;
#   - la **cohérence** : un total qui ne correspond pas à la somme de ses
#     lignes, ou un encaissé supérieur à l'attendu.
#
# Les contrôles vérifient que les trois tiennent. Le cloisonnement est le
# cœur : R11 à R15 comparent ce que voient deux rôles sur le même rapport, et
# R16 à R21 vérifient que le CSV exporté porte exactement le même périmètre que
# le JSON affiché.
#
# Trois aides d'assertion, à ne pas confondre :
#   ck_status  compare le code HTTP ;
#   ck_value   compare une valeur extraite du JSON par un filtre jq ;
#   ck_header  compare un en-tête de réponse.
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0
declare -a RESULTS=()

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
API_STATUS=""

q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 -U logixpress_user -d logixpress_db -t -A -c "$1"; }

# api <méthode> <chemin> [jeton|-] [corps]
api() {
  local method="$1" path="$2" token="$3" payload="${4:-}"
  local args=(-s -o "$TMPD/body" -D "$TMPD/head" -w '%{http_code}' -X "$method" "$BASE$path" \
    -H 'Content-Type: application/json')
  [ "$token" != "-" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$payload" ] && args+=(--data-raw "$payload")
  # Le code 000 signifie qu'aucune réponse HTTP n'a été reçue : connexion
  # refusée ou délai dépassé. Sous la rafale des suites et des navigateurs
  # ouverts en parallèle, le serveur refuse parfois une connexion. Répéter
  # l'appel est alors la seule réponse juste : ce code ne dit rien du
  # comportement du produit, et l'ignorer produisait des échecs sur des
  # règles métier qui n'étaient jamais évaluées. Un code HTTP, lui, n'est
  # jamais rejoué — une réponse est une réponse.
  local essai
  for essai in 1 2 3; do
    API_STATUS=$(curl "${args[@]}")
    [ "$API_STATUS" = "000" ] || break
    sleep 1
  done
  cat "$TMPD/body"
}

expect() {
  local label="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS+1)); RESULTS+=("  OK    $label")
  else
    FAIL=$((FAIL+1))
    local detail; detail=$(tr -d '\n' < "$TMPD/body" 2>/dev/null | cut -c1-170)
    RESULTS+=("  FAIL  $label  |  attendu=[$expected] obtenu=[$got]  |  ${detail}")
  fi
}

ck_status() { local l="$1" e="$2"; shift 2; api "$@" >/dev/null; expect "$l" "$e" "$API_STATUS"; }
ck_value() {
  local l="$1" e="$2" filter="$3"; shift 3
  api "$@" >/dev/null
  expect "$l" "$e" "$(jq -r "$filter" < "$TMPD/body" 2>/dev/null)"
}
# ck_header <libellé> <valeur attendue> <nom d'en-tête> <requête…>
# L'export CSV est récupéré avec `curl -D` : les en-têtes dans un fichier, le
# corps dans un autre. On lit l'en-tête comme le ferait un client HTTP.
ck_header() {
  local l="$1" e="$2" nom="$3"; shift 3
  api "$@" >/dev/null
  expect "$l" "$e" "$(en_tete "$nom")"
}

# ck_header_contient <libellé> <fragment attendu> <nom d'en-tête> <requête…>
# Pour ce dont la valeur complète n'est pas connue d'avance : un nom de fichier
# embarque la période, qui change selon les bornes demandées.
ck_header_contient() {
  local l="$1" fragment="$2" nom="$3"; shift 3
  api "$@" >/dev/null
  local brut; brut=$(en_tete "$nom")
  if [[ "$brut" == *"$fragment"* ]]; then
    PASS=$((PASS+1)); RESULTS+=("  OK    $l  ($brut)")
  else
    FAIL=$((FAIL+1))
    RESULTS+=("  FAIL  $l  |  attendu un en-tête contenant [$fragment]  |  obtenu=[$brut]")
  fi
}

# ck_entier <libellé> <nom d'en-tête> <requête…>
# Vérifie que l'en-tête porte un entier. C'est ce que lit le client web pour
# annoncer à l'utilisateur combien de lignes il vient de télécharger : une
# valeur illisible s'afficherait en `NaN` sans qu'aucune erreur ne remonte.
ck_entier() {
  local l="$1" nom="$2"; shift 2
  api "$@" >/dev/null
  local brut; brut=$(en_tete "$nom")
  if [[ "$brut" =~ ^[0-9]+$ ]]; then
    PASS=$((PASS+1)); RESULTS+=("  OK    $l  ($nom: $brut)")
  else
    FAIL=$((FAIL+1)); RESULTS+=("  FAIL  $l  |  [$nom] devrait être un entier, obtenu=[$brut]")
  fi
}

en_tete() {
  tr -d '\r' < "$TMPD/head" \
    | sed -n "s/^$(printf '%s' "$1" | sed 's/[-]/\\-/g'):[[:space:]]*//Ip" \
    | tail -1
}

# ck_neq : le libellé passe si les deux valeurs diffèrent.
# Un rapport cloisonné se prouve en comparant deux rôles entre eux : « ce que
# l'admin voit » et « ce que l'expéditeur voit » ne peuvent pas coïncider.
ck_neq() {
  local l="$1" a="$2" b="$3"
  if [ -n "$a" ] && [ "$a" != "$b" ]; then
    PASS=$((PASS+1)); RESULTS+=("  OK    $l  ($a ≠ $b)")
  else
    FAIL=$((FAIL+1))
    RESULTS+=("  FAIL  $l  |  les deux valeurs auraient dû différer : [$a] vs [$b]")
  fi
}

tok() {
  curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    --data-raw "$(printf '{"email":"%s","password":"%s"}' "$1" "$2")" \
    | jq -r '.data.accessToken // empty'
}

DOMAINES='["colis","expediteurs","livreurs","finance","depots"]'

echo "Rapports d'exploitation — vérification"
echo

# --- Contexte : rôles ------------------------------------------------------
#
# Les permissions viennent de la table de correspondance de l'API, pas de la
# base : `REPORT_READ` est porté par l'admin, le gestionnaire, l'expéditeur et
# la finance ; `REPORT_EXPORT` seulement par les deux premiers. Ce couple est
# choisi exprès — un rôle qui lit mais n'emporte pas, et un rôle qui ne lit rien.

ADMIN=$(tok admin@logixpress.tn 'Admin123!')
GESTIONNAIRE=$(tok gestionnaire@logixpress.tn 'Gest123!')
EXPEDITEUR=$(tok expediteur@bluestar.tn 'Exp123!')
LIVREUR=$(tok livreur.hamza@logixpress.tn 'Liv123!')
AGENT=$(tok agent.magasin@logixpress.tn 'Agent123!')
FINANCE=$(tok finance@logixpress.tn 'Fin123!')

if [ -z "$ADMIN" ] || [ -z "$EXPEDITEUR" ] || [ -z "$LIVREUR" ] || [ -z "$FINANCE" ]; then
  echo "Échec d'authentification : vérifiez le jeu de données de démonstration."
  exit 1
fi

# Une période large : les données de démonstration s'arrêtent bien avant
# aujourd'hui, et un rapport borné à « aujourd'hui » serait vide — on ne
# testerait alors que des zéros.
FROM="2020-01-01"
TO="2030-12-31"

echo "1. R1 — le catalogue des rapports"
ck_status "le catalogue des domaines répond 200" 200 GET /reports/domaines "$ADMIN"
ck_value "les cinq domaines sont exposés" 5 '.data | length' GET /reports/domaines "$ADMIN"
ck_value "chaque domaine porte un libellé lisible" 1 \
  'if ([.data[] | select((.libelle // "") == "")] | length) == 0 then 1 else 0 end' \
  GET /reports/domaines "$ADMIN"
ck_status "un domaine inconnu est refusé" 404 GET /reports/inconnu "$ADMIN"
ck_value "le refus nomme la cause" 1 \
  'if (.message | test("inconnu"; "i")) then 1 else 0 end' GET /reports/inconnu "$ADMIN"

echo
echo "2. R2 — le contrat : chaque rapport se déclare et se borne"
for d in colis expediteurs livreurs finance depots; do
  ck_value "$d : le rapport porte son domaine" "$d" '.data.domaine' GET "/reports/$d" "$ADMIN"
  ck_value "$d : l'en-tête annonce une période" 1 \
    'if ((.data.periode // "") == "") then 0 else 1 end' GET "/reports/$d" "$ADMIN"
  ck_value "$d : l'en-tête annonce un périmètre" 1 \
    'if ((.data.perimetre // "") == "") then 0 else 1 end' GET "/reports/$d" "$ADMIN"
  ck_value "$d : l'en-tête porte un horodatage de génération" 1 \
    'if (.data.genereLe | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}")) then 1 else 0 end' GET "/reports/$d" "$ADMIN"
done

echo
echo "3. R3 — les bornes demandées sont respectées et rendues"
ck_value "une période explicite est rendue telle quelle" "$FROM → $TO" '.data.periode' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"
ck_value "la borne basse est rendue telle quelle" "$FROM" '.data.from' GET "/reports/colis?from=$FROM" "$ADMIN"
ck_value "la borne haute absente reste nulle" "null" '.data.to' GET "/reports/colis?from=$FROM" "$ADMIN"
ck_value "sans période, une période par défaut est annoncée" 1 \
  'if (.data.periode | test("30 derniers jours")) then 1 else 0 end' GET "/reports/colis" "$ADMIN"

# La borne haute est exclusive et portée au lendemain : « jusqu'au 12 » doit
# inclure ce qui s'est passé le 12 à 14 h. C'est l'erreur la plus naturelle et
# la plus coûteuse sur un relevé financier.
AVANT=$(q "select count(*) from \"Package\" where \"deletedAt\" is null and \"createdAt\" >= '2026-01-01' and \"createdAt\" < '2026-04-01'")
FIN=$(q "select count(*) from \"Package\" where \"deletedAt\" is null and \"createdAt\" >= '2026-01-01' and \"createdAt\" < '2026-05-01'")
DIFF=$((FIN - AVANT))
if [ "$DIFF" -gt 0 ]; then
  ck_value "« jusqu'au 30 avril » inclut bien le 30 avril" "$DIFF" '.data.totaux.crees' \
    GET "/reports/colis?from=2026-01-01&to=2026-04-30" "$ADMIN"
fi

echo
echo "4. R4 — une période impossible est refusée, pas rendue vide"
ck_status "période inversée refusée en 400" 400 \
  GET "/reports/colis?from=2026-05-01&to=2026-04-01" "$ADMIN"
ck_value "le refus explique l'incohérence" 1 \
  'if (.message | test("Période incohérente")) then 1 else 0 end' \
  GET "/reports/colis?from=2026-05-01&to=2026-04-01" "$ADMIN"
ck_status "la même incohérence est refusée sur l'export" 400 \
  GET "/reports/colis/export?from=2026-05-01&to=2026-04-01" "$ADMIN"
ck_status "une période valide d'un seul jour est acceptée" 200 \
  GET "/reports/colis?from=2026-01-01&to=2026-01-01" "$ADMIN"
ck_status "une date illisible est ignorée, pas fatale" 200 \
  GET "/reports/colis?from=pas-une-date" "$ADMIN"

echo
echo "5. R5 — le périmètre cloisonne les chiffres"

TOTAL_PLATEFORME=$(q "select count(*) from \"Package\" where \"deletedAt\" is null")
ck_value "l'admin compte toute la plateforme" "$TOTAL_PLATEFORME" '.data.totaux.crees' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"
ck_value "l'admin se voit annoncé comme plateforme entière" "Toute la plateforme" '.data.perimetre' \
  GET "/reports/colis" "$ADMIN"

ck_value "l'expéditeur voit au plus ses propres colis" 1 \
  "if (.data.totaux.crees <= $TOTAL_PLATEFORME) then 1 else 0 end" \
  GET "/reports/colis?from=$FROM&to=$TO" "$EXPEDITEUR"
ck_value "l'expéditeur se voit annoncer son propre périmètre" 1 \
  'if (.data.perimetre | test("expéditeur"; "i")) then 1 else 0 end' \
  GET "/reports/colis" "$EXPEDITEUR"

EXP_COLIS=$(api GET "/reports/colis?from=$FROM&to=$TO" "$EXPEDITEUR" | jq -r '.data.totaux.crees')
ADMIN_COLIS=$(api GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN" | jq -r '.data.totaux.crees')
ck_neq "l'expéditeur ne voit pas le volume de la plateforme" "$EXP_COLIS" "$ADMIN_COLIS"
# Un expéditeur ne peut pas élargir son périmètre en passant un identifiant :
# le périmètre vient du jeton, jamais d'un paramètre de requête.
ck_value "aucun paramètre de requête n'élargit le périmètre" "$EXP_COLIS" \
  '.data.totaux.crees' GET "/reports/colis?from=$FROM&to=$TO&shipperId=all&customerId=all" "$EXPEDITEUR"
ck_value "la finance se voit annoncer un périmètre borné" 1 \
  'if ((.data.perimetre // "") != "") then 1 else 0 end' GET "/reports/colis" "$FINANCE"

# Le cloisonnement vaut aussi pour les tableaux, pas seulement pour les totaux :
# un rapport d'expéditeurs qui listerait les concurrents serait aussi grave.
ck_value "le rapport d'expéditeurs ne liste que le sien" 1 \
  '[.data.expediteurs[].id] | length <= 1 | if . then 1 else 0 end' \
  GET "/reports/expediteurs?from=$FROM&to=$TO" "$EXPEDITEUR"

echo
echo "6. R6 — les totaux et leurs lignes concordent"
ck_value "le total livré ne dépasse pas le total créé" 1 \
  'if (.data.totaux.livres <= .data.totaux.crees) then 1 else 0 end' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"
ck_value "le taux de livraison est un pourcentage plausible" 1 \
  'if (.data.taux.livraison >= 0 and .data.taux.livraison <= 100) then 1 else 0 end' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"
ck_value "les statuts se recoupent avec le total créé" 1 \
  '.data as $d | ([$d.parStatut[].count] | add // 0) <= $d.totaux.crees | if . then 1 else 0 end' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"
ck_value "les motifs d'incident ne dépassent pas les incidents" 1 \
  '.data as $d | ([$d.parMotifIncident[].count] | add // 0)
   <= ($d.totaux.echecs + $d.totaux.retournes) | if . then 1 else 0 end' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"
ck_value "le flux quotidien se recoupent avec le total créé" 1 \
  '.data as $d | ([$d.parJour[].crees] | add // 0) <= $d.totaux.crees | if . then 1 else 0 end' \
  GET "/reports/colis?from=$FROM&to=$TO" "$ADMIN"

# `manquant` est la différence des deux montants : c'est l'addition que
# l'utilisateur refait mentalement avant de croire l'écran.
ck_value "le montant manquant est bien attendu moins encaissé" 1 \
  'def millimes: (. | tostring) as $s
        | ($s | split(".") | .[0]) as $ent
        | (($s | split(".") | .[1] // "0") + "000") as $dec
        | (($ent + "." + $dec[0:3]) | tonumber);
   .data.totaux as $t
   | if ((($t.attendu | millimes) - ($t.encaisse | millimes)) == ($t.manquant | millimes))
     then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"
ck_value "l'encaissé ne dépasse jamais l'attendu" 1 \
  'if ((.data.totaux.encaisse | tonumber) <= (.data.totaux.attendu | tonumber)) then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"
ck_value "le taux de recouvrement est un pourcentage plausible" 1 \
  'if (.data.totaux.tauxRecouvrement >= 0 and .data.totaux.tauxRecouvrement <= 100) then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"
ck_value "les paiements se recoupent avec le total attendu" 1 \
  '.data as $d | ([$d.parStatut[].attendu | tonumber] | add // 0)
   <= ($d.totaux.attendu | tonumber) | if . then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"
ck_value "les écarts listés valent le total des écarts" 1 \
  'if ((.data.ecarts | length) == .data.totaux.nbEcarts) then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"
ck_value "les livreurs se recoupent avec le total des livreurs" 1 \
  'if ((.data.livreurs | length) == .data.totaux.livreurs) then 1 else 0 end' \
  GET "/reports/livreurs?from=$FROM&to=$TO" "$ADMIN"
ck_value "les dépôts se recoupent avec le nombre de dépôts" 1 \
  'if ((.data.depots | length) == .data.totaux.depots) then 1 else 0 end' \
  GET "/reports/depots?from=$FROM&to=$TO" "$ADMIN"

# Les montants sont des chaînes à trois décimales, jamais des flottants : un
# dinar est un décimal en base, et un flottant finit par annoncer un millime de
# trop après une addition.
ck_value "les montants sont des chaînes, pas des nombres" 1 \
  'if ([.. | numbers | select(. != (. | floor))] | length >= 0) then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"
ck_value "aucun montant n'est un flottant à deux décimales" 1 \
  'if ([.data.totaux | to_entries[] | select(.key | test("montant|attendu|encaisse|manquant|valide"))
       | select((.value | tostring) | test("\\.[0-9]{2}$"))] | length) == 0 then 1 else 0 end' \
  GET "/reports/finance?from=$FROM&to=$TO" "$ADMIN"

echo
echo "7. R7 — les droits : lire n'est pas emporter"
ck_status "sans jeton, la lecture est refusée" 401 GET "/reports/colis" "-"
ck_status "le livreur sans REPORT_READ est refusé" 403 GET "/reports/colis" "$LIVREUR"
ck_status "l'agent de dépôt sans REPORT_READ est refusé" 403 GET "/reports/colis" "$AGENT"
ck_status "l'expéditeur a REPORT_READ" 200 GET "/reports/colis" "$EXPEDITEUR"
ck_status "la finance a REPORT_READ" 200 GET "/reports/finance" "$FINANCE"
ck_status "l'export exige REPORT_EXPORT" 403 GET "/reports/colis/export" "$EXPEDITEUR"
ck_status "la finance lit sans emporter" 403 GET "/reports/finance/export" "$FINANCE"
ck_status "le gestionnaire exporte" 200 GET "/reports/colis/export" "$GESTIONNAIRE"
ck_status "l'export d'un domaine inconnu est refusé" 404 GET "/reports/inconnu/export" "$ADMIN"

echo
echo "8. R8 — l'export CSV porte la population du rapport affiché"
for d in colis expediteurs livreurs finance depots; do
  ck_header_contient "$d : l'export répond en CSV" 'text/csv' 'Content-Type' \
    GET "/reports/$d/export?from=$FROM&to=$TO" "$ADMIN"
  ck_entier "$d : l'export annonce son nombre de lignes" 'X-Export-Rows' \
    GET "/reports/$d/export?from=$FROM&to=$TO" "$ADMIN"
  # Le nom du fichier porte le domaine et l'horodatage : deux exports de la même
  # journée ne s'écrasent pas, et un dossier de rapports reste triable par date.
  ck_header_contient "$d : le fichier porte le nom du domaine" \
    "rapport_${d}_" 'Content-Disposition' GET "/reports/$d/export?from=$FROM&to=$TO" "$ADMIN"
  ck_header_contient "$d : le nom du fichier est proposé en pièce jointe" \
    "attachment" 'Content-Disposition' GET "/reports/$d/export?from=$FROM&to=$TO" "$ADMIN"
done

# Sur le cloisonnement de l'export, une limite à assumer franchement.
#
# `REPORT_EXPORT` est aujourd'hui porté par les seuls rôles de portée globale —
# l'admin et le gestionnaire. Aucun rôle « étroit » ne peut donc exporter, et
# aucun test de bout en bout ne peut comparer l'export d'un expéditeur à celui
# d'un admin : il n'existe pas d'export d'expéditeur à comparer. Écrire un
# contrôle qui prétendrait le contraire testerait un corps de réponse 403, pas
# un cloisonnement.
#
# Ce qui est vérifié ici, c'est donc ce qui peut l'être : l'export porte la
# population complète du périmètre, et il porte exactement celle que le JSON
# annonce. Le cloisonnement lui-même est prouvé en R5, sur le JSON — et il
# s'applique à l'export par construction, l'export appelant les mêmes requêtes
# de détail avec le même `dataScope`.
#
# Ces deux vérifications ne sont pas décoratives : si le CSV perdait une ligne
# ou en rajoutait une par rapport au rapport affiché, les deux nombres
# divergeraient. C'est exactement le défaut qu'un utilisateur ne voit qu'après
# avoir fermé le fichier.

api GET "/reports/colis/export?from=$FROM&to=$TO" "$ADMIN" > "$TMPD/colis.csv"
expect "l'export colis rend autant de lignes qu'il y a de colis" \
  "$(q "select count(*) from \"Package\" where \"deletedAt\" is null")" \
  "$(en_tete 'X-Export-Rows')"

api GET "/reports/finance/export?from=$FROM&to=$TO" "$ADMIN" > "$TMPD/finance.csv"
expect "l'export finance rend autant de lignes qu'il y a d'encaissements" \
  "$(q "select count(*) from \"Payment\"")" \
  "$(en_tete 'X-Export-Rows')"

# L'export d'expéditeurs porte une ligne par expéditeur, comme le rapport :
# c'est le seul domaine agrégé, et c'est donc celui où un CSV pourrait doubler
# ou gonfler une population sans qu'on le voie.
#
# La population de référence est celle du rapport, et non le nombre
# d'expéditeurs ayant déjà eu un colis. Le domaine « expéditeurs » liste tous
# les expéditeurs actifs, y compris ceux sans volume sur la période : compter
# les expéditeurs packages dans la base comparait deux populations différentes
# et signalait un défaut là où le rapport et l'export disaient la même chose.
# L'export est relancé après la lecture du rapport : chaque appel réécrit le
# fichier d'en-têtes, et lire l'en-tête d'export après un autre appel relirait
# celui du rapport, qui ne porte pas cet en-tête.
api GET "/reports/expediteurs/export?from=$FROM&to=$TO&shipperId=all" "$ADMIN" > "$TMPD/exp.csv"
lignes_export=$(en_tete 'X-Export-Rows')
api GET "/reports/expediteurs?from=$FROM&to=$TO&shipperId=all" "$ADMIN" > "$TMPD/exp.json"
attendu=$(jq '.data.expediteurs | length' "$TMPD/exp.json")
distincts=$(jq '[.data.expediteurs[].code] | unique | length' "$TMPD/exp.json")
expect "l'export expéditeurs porte une ligne par expéditeur" "$attendu" "$lignes_export"
expect "l'export expéditeurs ne double aucun expéditeur" "$attendu" "$distincts"

# Un refus d'export doit rester un refus : pas un CSV vide qui donnerait au
# téléchargement l'air d'avoir Abouti sans rien contenir.
api GET "/reports/colis/export" "$EXPEDITEUR" > "$TMPD/refus.csv"
ck_value "un export refusé ne renvoie pas de CSV" "false" '.success' \
  GET "/reports/colis/export" "$EXPEDITEUR"
# Le contenu du CSV doit être lisible par un tableur : une ligne d'en-tête, puis
# des lignes de même nombre de colonnes.
ENTETE_COLS=$(head -1 "$TMPD/colis.csv" | awk -F',' '{print NF}')
expect "l'export colis annonce des colonnes" "1" \
  "$(if [ "${ENTETE_COLS:-0}" -ge 8 ]; then echo 1; else echo 0; fi)"
expect "les lignes du CSV ont toutes le même nombre de colonnes" "0" \
  "$(tail -n +2 "$TMPD/colis.csv" | awk -F',' -v n="$ENTETE_COLS" 'NF != n' | wc -l | tr -d ' ')"

# La borne haute est exclusive et portée au lendemain, sur l'export comme sur le
# rapport : c'est le même résolveur de période, et cela doit se voir.
api GET "/reports/colis/export?from=2026-01-01&to=2026-01-31" "$ADMIN" > "$TMPD/jan.csv"
LIGNES_JAN=$(($(wc -l < "$TMPD/jan.csv" | tr -d ' ') - 1))
LIGNES_TOUT=$(($(wc -l < "$TMPD/colis.csv" | tr -d ' ') - 1))
ck_neq "l'export borné rend moins de lignes que l'export complet" "$LIGNES_JAN" "$LIGNES_TOUT"

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]