#!/usr/bin/env bash
# Vérifie les dépôts, les transferts inter-dépôts et leurs règles de refus.
#
#   Dépôt Sousse → Inter-dépôt → Dépôt Ben Arous → Réceptionné
#
# Les contrôles D1-D6 sont des régressions : ils vérifient que les opérations
# impossibles sont refusées par le backend, et non seulement masquées dans
# l'interface.
#
# Trois aides d'assertion, à ne pas confondre :
#   ck_status  compare le code HTTP ;
#   ck_value   compare une valeur extraite du JSON par un filtre jq ;
#   ck_db      compare le résultat d'une requête SQL de contrôle.
# Tout frappe l'API, et les identifiants sont résolus à chaud.
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0
declare -a RESULTS=()

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
API_STATUS=""
JSON_H='Content-Type: application/json'

q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 -U logixpress_user -d logixpress_db -t -A -c "$1" 2>/dev/null; }

# api <méthode> <chemin> <jeton|-> [corps]
# Écrit le corps de la réponse sur la sortie standard et le code HTTP dans
# API_STATUS. Le corps est conservé dans un fichier pour être rejoué tel quel
# en cas d'échec : une valeur vide n'explique rien.
api() {
  local method="$1" path="$2" token="$3" payload="${4:-}"
  local args=(-s -o "$TMPD/body" -w '%{http_code}' -X "$method" "$BASE$path" -H "$JSON_H")
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
    local detail; detail=$(tr -d '\n' < "$TMPD/body" 2>/dev/null | cut -c1-180)
    RESULTS+=("  FAIL  $label  |  attendu=[$expected] obtenu=[$got]  |  ${detail}")
  fi
}

# ck_status <libellé> <attendu> <méthode> <chemin> <jeton> [corps]
ck_status() { local l="$1" e="$2"; shift 2; api "$@" >/dev/null; expect "$l" "$e" "$API_STATUS"; }

# ck_value <libellé> <attendu> <jq> <méthode> <chemin> <jeton> [corps]
ck_value() {
  local l="$1" e="$2" filter="$3"; shift 3
  api "$@" >/dev/null
  expect "$l" "$e" "$(jq -r "$filter" < "$TMPD/body" 2>/dev/null)"
}

# ck_db <libellé> <attendu> <sql>
ck_db() { : > "$TMPD/body"; expect "$1" "$2" "$(q "$3")"; }

# ck_last <libellé> <attendu> <jq> — assert sur la dernière réponse reçue.
ck_last() { expect "$1" "$2" "$(jq -r "$3" < "$TMPD/body" 2>/dev/null)"; }

tok() {
  curl -s -X POST "$BASE/auth/login" -H "$JSON_H" \
    --data-raw "$(printf '{"email":"%s","password":"%s"}' "$1" "$2")" \
    | jq -r '.data.accessToken // empty'
}

# macOS distingue `-v3d` (3 du mois) de `-v+3d` (+3 jours) : le signe est
# obligatoire, sinon les dates calculées tombent dans le passé.
DAY() {
  case "$1" in
    # GNU date (Linux/CI) puis BSD date (macOS).
    -*) date -d "$1 day" +%Y-%m-%d 2>/dev/null || date -v"$1"d +%Y-%m-%d ;;
    *)  date -d "+$1 day" +%Y-%m-%d 2>/dev/null || date -v"+$1d" +%Y-%m-%d ;;
  esac
}

# Crée un colis réceptionné au dépôt donné et renvoie son identifiant.
# `warehouse/scan-accept` est le seul chemin qui mène un colis à RECU_DEPOT,
# et c'est l'état de départ réel d'un transfert.
make_stored_package() { # dépôt
  local uniq created pid barcode
  uniq=$(printf '99%06d' $(( (RANDOM * 7) % 1000000 )))
  created=$(api POST /colis "$EXPEDITEUR" "$(printf '{"customerName":"%s","customerPhone":"%s","address":"Route QA %s","totalPrice":%d,"pieceCount":%d}' \
    "$QA_TAG" "$uniq" "$uniq" "$((20 + RANDOM % 90))" "$((1 + RANDOM % 3))")")
  pid=$(printf '%s' "$created" | jq -r '.data.id // empty')
  barcode=$(printf '%s' "$created" | jq -r '.data.barcode // empty')
  [ -n "$pid" ] && [ -n "$barcode" ] || return 1
  # L'acceptation se fait par code-barres. Prompt 26 : un magasinier ne reçoit
  # que dans SON dépôt ; le jeu d'essai range des colis dans tous les dépôts,
  # il passe donc par l'administration.
  api POST /warehouse/scan-accept "$ADMIN" \
    "$(printf '{"barcode":"%s","depositId":"%s"}' "$barcode" "$1")" >/dev/null
  [ "$API_STATUS" = "200" ] || return 1
  printf '%s' "$pid"
}

# Ouvre un transfert inter-dépôts et renvoie son numéro. Les colis sont créés
# et rangés juste avant, pour que le lot parte d'un état réellement transférable.
open_transfer() { # dépôtSource dépôtDest [nbColis]
  local src="${1:-$SOUSSE}" dst="${2:-$HUB}" n="${3:-1}"
  local ids="" i pid
  for i in $(seq 1 "$n"); do
    pid=$(make_stored_package "$src") || return 1
    ids="$ids${ids:+,}\"$pid\""
  done
  api POST /inter-depots "$ADMIN" "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","scheduledDate":"%s","notes":"%s","packageIds":[%s]}' \
    "$src" "$dst" "$DRIVER" "$(DAY 0)" "$QA_TAG" "$ids")" \
    | jq -r '.data.transferNumber // empty'
}

QA_TAG='Vérification Dépôts'

# Le nettoyage cible une marque distinctive : les créations faites dans une
# sous-commande `$(...)` ne peuvent pas alimenter une liste d'identifiants.
cleanup() {
  local keep="${1:-}" rdvs colis
  q "delete from \"Notification\" where \"relatedEntity\"='TRANSFER' and \"relatedEntityId\" in (select id::text from \"InterDepotTransfer\" where \"notes\"='$QA_TAG')" >/dev/null 2>&1
  # Le journal d'audit n'est pas nettoyé : il est immuable. Voir le commentaire
  # de `verify-business-flow.sh`.
  rdvs=$(q "delete from \"InterDepotTransfer\" where \"notes\"='$QA_TAG'")
  # Les colis rendus au dépôt source avant effacement gardent le lien : la
  # suppression du lot suffit, le SET NULL du FK détache les colis.
  colis=$(q "delete from \"Package\" where \"customerId\" in (select id from \"Customer\" where \"fullName\"='$QA_TAG')")
  [ -n "$keep" ] || echo "Nettoyage effectué (${rdvs:-0} transferts, ${colis:-0} colis)."
}
trap 'cleanup --keep; rm -rf "$TMPD"' EXIT

# --- Contexte : rôles, dépôts, conducteur -------------------------------

ADMIN=$(tok admin@logixpress.tn 'Admin123!')
AGENT=$(tok agent.magasin@logixpress.tn 'Agent123!')
LIVREUR=$(tok livreur.hamza@logixpress.tn 'Liv123!')
EXPEDITEUR=$(tok expediteur@bluestar.tn 'Exp123!')

if [ -z "$ADMIN" ] || [ -z "$AGENT" ] || [ -z "$LIVREUR" ] || [ -z "$EXPEDITEUR" ]; then
  echo "Échec d'authentification : vérifiez le jeu de données de démonstration."
  exit 1
fi

HUB=$(q "select id from \"Deposit\" where \"isMainHub\" = true limit 1")
SOUSSE=$(q "select id from \"Deposit\" where code = 'DEP-SOUSSE-AGT'")
HUB_NAME=$(q "select name from \"Deposit\" where id = '$HUB'")
DRIVER=$(q "select d.id from \"Driver\" d where d.\"isActive\" = true and d.\"deletedAt\" is null order by d.\"driverCode\" limit 1")
OWNER=$(q "select u.id from \"User\" u where u.email = 'agent.magasin@logixpress.tn' limit 1")

echo "Dépôt principal : $HUB_NAME"
echo "Dépôt d'origine  : Agence Sousse"
echo

if [ -z "$SOUSSE" ] || [ -z "$HUB" ] || [ -z "$DRIVER" ] || [ -z "$OWNER" ]; then
  echo "Référentiel incomplet : exécution impossible."
  exit 1
fi

# ------------------------------------------------------------------ 1
echo "1. Référentiel des dépôts"
ck_value "le dépôt principal est identifiable" "1" \
  '[.data[] | select(.isMainHub == true)] | length' GET /depots "$ADMIN"
ck_db "Ben Arous est le dépôt principal" "Ben Arous" \
  "select city from \"Deposit\" where \"isMainHub\" = true"
ck_db "le réseau comporte plusieurs dépôts" "1" \
  "select (count(*) >= 2)::int from \"Deposit\""
ck_value "chaque dépôt expose ses coordonnées" "1" \
  'if ([.data[] | select(.name and .address and .city)] | length) == (.data | length) then 1 else 0 end' \
  GET /depots "$ADMIN"
ck_value "l'état d'exploitation est exposé" "1" \
  'if ([.data[] | select(.status == "ACTIF" or .status == "MAINTENANCE" or .status == "FERME")] | length) == (.data | length) then 1 else 0 end' \
  GET /depots "$ADMIN"
ck_status "le livreur peut consulter les dépôts" "200" GET /depots "$LIVREUR"
ck_status "l'expéditeur n'a pas accès au référentiel" "403" GET /depots "$EXPEDITEUR"
ck_status "un livreur ne peut pas créer de dépôt" "403" POST /depots "$LIVREUR" \
  '{"code":"X","name":"Y","city":"Z"}'
ck_status "sans jeton -> 401" "401" GET /depots -

# ------------------------------------------------------------------ 2
echo "2. Attribution des informations de dépôt"
NEWCODE="DEP-TEST-$RANDOM"
api POST /depots "$ADMIN" "$(printf '{"code":"%s","name":"Dépôt de vérification","address":"1 rue du test","city":"Nabeul","zone":"Cap Bon","phone":"71234567","managerId":"%s"}' "$NEWCODE" "$OWNER")" >/dev/null
NEWID=$(jq -r '.data.id // empty' < "$TMPD/body")
ck_last "un dépôt se crée" "1" 'if .data.id then 1 else 0 end'
if [ -z "$NEWID" ]; then NEWID="inconnu"; fi
ck_value "la zone est enregistrée" "Cap Bon" '.data.zone' GET "/depots/$NEWID" "$ADMIN"
ck_value "le responsable est enregistré" "1" 'if .data.managerName then 1 else 0 end' GET "/depots/$NEWID" "$ADMIN"
ck_value "l'adresse et la ville sont enregistrées" "Nabeul" '.data.city' GET "/depots/$NEWID" "$ADMIN"
ck_status "un code dépôt dupliqué -> 409" "409" POST /depots "$ADMIN" \
  "$(printf '{"code":"%s","name":"Doublon","city":"Tunis"}' "$NEWCODE")"
ck_status "un code dépôt invalide est refusé" "400" POST /depots "$ADMIN" \
  '{"code":"","name":"","city":""}'
ck_value "l'état d'un dépôt se modifie" "MAINTENANCE" '.data.status' \
  PATCH "/depots/$NEWID" "$ADMIN" '{"status":"MAINTENANCE"}'
api PATCH "/depots/$NEWID" "$ADMIN" '{"status":"FERME"}' >/dev/null
CLOSED_PKG=$(make_stored_package "$NEWID")
ck_status "un dépôt fermé ne peut pas expédier" "409" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$NEWID" "$HUB" "$DRIVER" "$CLOSED_PKG")"
q "delete from \"Package\" where id = '$CLOSED_PKG'" >/dev/null 2>&1
q "delete from \"Deposit\" where code = '$NEWCODE'" >/dev/null 2>&1

# ------------------------------------------------------------------ 3
echo "3. Cycle de vie d'un transfert"
T1=$(open_transfer "$SOUSSE" "$HUB" 2)
ck_last "un transfert se crée" "1" 'if .data.id then 1 else 0 end'
ck_value "le numéro suit le format ID-AAAAMMJJ-NNNN" "1" \
  'if (.data.transferNumber | test("^ID-[0-9]{8}-[0-9]{4}$")) then 1 else 0 end' GET "/inter-depots/$T1" "$ADMIN"
ck_value "le transfert est créé à l'état CRÉÉ" "CRE" '.data.status' GET "/inter-depots/$T1" "$ADMIN"
ck_value "le nombre de colis est celui du lot" "2" '.data.totalPackages' GET "/inter-depots/$T1" "$ADMIN"
ck_value "le nombre de pièces est la somme des colis" "1" \
  'if ([.data.packages[].pieceCount] | add) == .data.totalPieces then 1 else 0 end' GET "/inter-depots/$T1" "$ADMIN"
ck_value "le conducteur est porté par le transfert" "1" 'if .data.driverName then 1 else 0 end' GET "/inter-depots/$T1" "$ADMIN"
ck_value "la date de transfert est enregistrée" "$(DAY 0)" '.data.scheduledDate' GET "/inter-depots/$T1" "$ADMIN"
ck_value "les notes sont enregistrées" "$QA_TAG" '.data.notes' GET "/inter-depots/$T1" "$ADMIN"

PKG1=$(q "select p.id from \"Package\" p join \"InterDepotTransfer\" t on t.id = p.\"interDepotTransferId\" where t.\"transferNumber\" = '$T1' order by p.\"trackingNumber\" limit 1")
ck_db "le colis quitte le stock du dépôt source" "1" \
  "select count(*) from \"Package\" where id = '$PKG1' and \"currentDepositId\" is null"
ck_db "le colis passe en lot inter-dépôt" "EN_LOT_INTER_DEPOT" \
  "select status from \"Package\" where id = '$PKG1'"
ck_db "un événement de suivi est écrit à la constitution" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$PKG1' and \"transferNumber\" = '$T1'"

ck_value "étape suivante : PRÉPARÉ" "PREPARE" '.data.status' \
  POST "/inter-depots/$T1/prepare" "$ADMIN" '{}'
ck_value "étape suivante : EN_TRANSIT" "EN_TRANSIT" '.data.status' \
  POST "/inter-depots/$T1/dispatch" "$ADMIN" '{}'
ck_db "le colis roule en inter-dépôt" "EN_TRANSIT_INTER_DEPOT" \
  "select status from \"Package\" where id = '$PKG1'"
ck_value "étape suivante : REÇU" "RECU" '.data.status' \
  POST "/inter-depots/$T1/receive" "$ADMIN" '{}'
ck_db "le colis est installé au dépôt de destination" "$HUB" \
  "select \"currentDepositId\" from \"Package\" where id = '$PKG1'"
ck_db "le colis est reçu au dépôt de destination" "RECU_DEPOT_DESTINATION" \
  "select status from \"Package\" where id = '$PKG1'"
ck_db "le colis n'est plus rattaché au transfert" "1" \
  "select count(*) from \"Package\" where id = '$PKG1' and \"interDepotTransferId\" is null"
ck_db "le transfert est complet" "4" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$PKG1' and \"transferNumber\" = '$T1'"

# ------------------------------------------------------------------ 4
echo "4. D1 — l'historique du colis raconte le trajet"
ck_value "les trois étapes du transfert figurent à l'historique" "1" \
  '([.data.trackingTimeline[].status] | (index("EN_LOT_INTER_DEPOT") != null) and (index("EN_TRANSIT_INTER_DEPOT") != null) and (index("RECU_DEPOT_DESTINATION") != null)) | if . then 1 else 0 end' \
  GET "/colis/$PKG1" "$ADMIN"
ck_db "l'étape de transit est localisée « Inter-dépôt »" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$PKG1' and \"locationName\" = 'Inter-dépôt'"
ck_db "l'arrivée est localisée au dépôt de destination" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$PKG1' and \"locationName\" = 'Dépôt $HUB_NAME'"
ck_db "la constitution et la préparation sont localisées au dépôt d'origine" "2" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$PKG1' and \"locationName\" = 'Dépôt Agence Sousse'"

# ------------------------------------------------------------------ 5
echo "5. Chronologie de mouvement"
ck_value "la chronologie expose les quatre étapes" "4" '.data.movement | length' GET "/inter-depots/$T1" "$ADMIN"
ck_value "les quatre étapes sont atteintes en fin de parcours" "4" \
  '[.data.movement[] | select(.reached == true)] | length' GET "/inter-depots/$T1" "$ADMIN"
ck_value "chaque étape atteinte est horodatée" "1" \
  '[.data.movement[] | select(.reached == true)] | if (map(.timestamp) | all(. != null)) then 1 else 0 end' \
  GET "/inter-depots/$T1" "$ADMIN"
ck_value "un transfert terminé n'admet plus de transition" "0" \
  '.data.allowedTransitions | length' GET "/inter-depots/$T1" "$ADMIN"

# ------------------------------------------------------------------ 6
echo "6. D2 — opérations impossibles refusées par le backend"
ck_status "réceptionner deux fois -> 409" "409" POST "/inter-depots/$T1/receive" "$ADMIN" '{}'
ck_status "annuler un transfert réceptionné -> 409" "409" POST "/inter-depots/$T1/cancel" "$ADMIN" '{}'
ck_status "repartir un transfert réceptionné -> 409" "409" POST "/inter-depots/$T1/dispatch" "$ADMIN" '{}'

CANCELLED=$(open_transfer "$SOUSSE" "$HUB" 1)
ck_last "un transfert annulable se crée" "1" 'if .data.id then 1 else 0 end'
# Le colis est résolu avant l'annulation : celle-ci détache le lot, et la
# jointure de la requête ne retrouverait plus rien ensuite.
CPKG=$(q "select p.id from \"Package\" p join \"InterDepotTransfer\" t on t.id = p.\"interDepotTransferId\" where t.\"transferNumber\" = '$CANCELLED' limit 1")
ck_value "l'annulation est acceptée" "ANNULE" '.data.status' \
  POST "/inter-depots/$CANCELLED/cancel" "$ADMIN" '{}'
ck_status "annuler deux fois -> 409" "409" POST "/inter-depots/$CANCELLED/cancel" "$ADMIN" '{}'
ck_db "le colis annulé redevient disponible au dépôt" "RECU_DEPOT" \
  "select status from \"Package\" where id = '$CPKG'"
ck_db "le colis annulé retourne à son dépôt d'origine" "$SOUSSE" \
  "select \"currentDepositId\" from \"Package\" where id = '$CPKG'"
ck_db "l'annulation écrit un événement de suivi" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$CPKG' and title = 'Transfert annulé'"

# D3 — colis non transférables
LIVREPKG=$(q "select id from \"Package\" where status = 'LIVRE' limit 1")
if [ -n "$LIVREPKG" ]; then
  ck_status "transférer un colis livré -> 409" "409" POST /inter-depots "$ADMIN" \
    "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$LIVREPKG")"
else
  RESULTS+=("  N/A   aucun colis livré en base pour ce contrôle")
fi
ANNULEPKG=$(q "select id from \"Package\" where status = 'ANNULE' limit 1")
if [ -n "$ANNULEPKG" ]; then
  ck_status "transférer un colis annulé -> 409" "409" POST /inter-depots "$ADMIN" \
    "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$ANNULEPKG")"
else
  RESULTS+=("  N/A   aucun colis annulé en base pour ce contrôle")
fi
ENGAGE=$(q "select id from \"Package\" where status in ('AFFECTE_RUNSHEET','EN_COURS_LIVRAISON') limit 1")
if [ -n "$ENGAGE" ]; then
  ck_status "transférer un colis engagé en tournée -> 409" "409" POST /inter-depots "$ADMIN" \
    "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$ENGAGE")"
else
  RESULTS+=("  N/A   aucun colis engagé en tournée pour ce contrôle")
fi

T2=$(open_transfer "$SOUSSE" "$HUB" 1)
BUSY=$(q "select p.id from \"Package\" p join \"InterDepotTransfer\" t on t.id = p.\"interDepotTransferId\" where t.\"transferNumber\" = '$T2' limit 1")
ck_status "transférer un colis déjà en lot -> 409" "409" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$BUSY")"

# D4 — cohérence de la demande
ck_status "un transfert sans colis -> 400" "400" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":[]}' "$SOUSSE" "$HUB" "$DRIVER")"
ck_status "même source et destination -> 400" "400" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$HUB" "$HUB" "$DRIVER" "$PKG1")"
ck_status "un identifiant de colis mal formé -> 400" "400" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["pas-un-uuid"]}' "$SOUSSE" "$HUB" "$DRIVER")"
ck_status "un colis inexistant -> 404" "404" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["00000000-0000-4000-8000-000000000000"]}' "$SOUSSE" "$HUB" "$DRIVER")"
ck_status "un conducteur inconnu -> 404" "404" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"00000000-0000-4000-8000-000000000000","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$PKG1")"
ck_status "un conducteur absent -> 400" "400" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$PKG1")"
ck_status "une date mal formée -> 400" "400" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","scheduledDate":"hier","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$PKG1")"
ck_status "un dépôt inconnu -> 404" "404" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"00000000-0000-4000-8000-000000000000","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$HUB" "$DRIVER" "$PKG1")"
ck_status "un transfert inconnu -> 404" "404" GET /inter-depots/ID-19700101-9999 "$ADMIN"
# Le lot part d'abord : ces deux contrôles portent sur le comptage, pas sur
# l'étape. Sans cela, l'état refuserait la réception avant que le nombre soit
# regardé, et le test ne mesurerait pas la règle qu'il prétend vérifier.
api POST "/inter-depots/$T2/dispatch" "$ADMIN" '{}' >/dev/null
ck_status "une réception avec trop de colis -> 400" "400" POST "/inter-depots/$T2/receive" "$ADMIN" '{"receivedPackages":99}'
ck_status "une réception avec un nombre négatif -> 400" "400" POST "/inter-depots/$T2/receive" "$ADMIN" '{"receivedPackages":-1}'
ck_status "réceptionner avant le départ -> 409" "409" POST "/inter-depots/$CANCELLED/receive" "$ADMIN" '{}'

# ------------------------------------------------------------------ 7
echo "7. D5 — réception partielle tracée, jamais bloquée"
T3=$(open_transfer "$SOUSSE" "$HUB" 3)
ck_value "un lot de 3 colis se crée" "3" '.data.totalPackages' GET "/inter-depots/$T3" "$ADMIN"
api POST "/inter-depots/$T3/dispatch" "$ADMIN" '{}' >/dev/null
ck_value "l'écart de réception est calculé, non déclaré" "1" '.data.discrepancy' \
  POST "/inter-depots/$T3/receive" "$ADMIN" '{"receivedPackages":2,"receptionNotes":"1 colis manquant"}'
ck_value "le transfert reste réceptionné malgré l'écart" "RECU" '.data.status' GET "/inter-depots/$T3" "$ADMIN"
ck_value "l'anomalie est signalée" "true" '.data.hasDiscrepancy' GET "/inter-depots/$T3" "$ADMIN"
ck_value "la réception est néanmoins datée" "1" 'if .data.receivedAt then 1 else 0 end' GET "/inter-depots/$T3" "$ADMIN"

# ------------------------------------------------------------------ 8
echo "8. D6 — droits sur les transferts"
D6PKG=$(make_stored_package "$SOUSSE")
D6HUB=$(make_stored_package "$HUB")
ck_status "l'agent de dépôt gère les transferts de son dépôt" "201" POST /inter-depots "$AGENT" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","notes":"%s","packageIds":["%s"]}' "$HUB" "$SOUSSE" "$DRIVER" "$QA_TAG" "$D6HUB")"
ck_status "l'agent ne crée pas de transfert depuis un autre dépôt" "403" POST /inter-depots "$AGENT" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","notes":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$QA_TAG" "$D6PKG")"
ck_status "le livreur ne peut pas créer de transfert" "403" POST /inter-depots "$LIVREUR" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$D6PKG")"
ck_status "le livreur ne peut pas réceptionner" "403" POST "/inter-depots/$T3/receive" "$LIVREUR" '{}'
ck_status "l'expéditeur ne peut pas créer de transfert" "403" POST /inter-depots "$EXPEDITEUR" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$D6PKG")"
ck_status "le livreur peut consulter les transferts" "200" GET /inter-depots "$LIVREUR"
ck_status "sans jeton -> 401" "401" GET /inter-depots -

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
cleanup
[ "$FAIL" -eq 0 ]
