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
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","notes":"%s"}' "$NEWID" "$HUB" "$DRIVER" "$QA_TAG")"
q "delete from \"Package\" where id = '$CLOSED_PKG'" >/dev/null 2>&1
q "delete from \"Deposit\" where code = '$NEWCODE'" >/dev/null 2>&1

# ------------------------------------------------------------------ 3
# Le cycle complet des inter-dépôts (bordereau, scan de chargement,
# contrôle de destination, acceptation pièce par pièce, retours) est vérifié
# par qa/qa-interdepot-26.mjs. Ici, seulement le contrat minimal vu des dépôts.
echo "3. Inter-dépôt au scan (contrat minimal)"
api POST /inter-depots "$ADMIN" "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","notes":"%s"}' "$SOUSSE" "$HUB" "$DRIVER" "$QA_TAG")" >/dev/null
ck_last "un bordereau se crée (en-tête seul)" "1" 'if .data.id then 1 else 0 end'
T1=$(jq -r '.data.transferNumber // empty' < "$TMPD/body")
ck_value "le numéro suit le format ID-D-AAAAMMJJ-NNNN" "1" \
  'if (.data.transferNumber | test("^ID-D-[0-9]{8}-[0-9]{4}$")) then 1 else 0 end' GET "/inter-depots/$T1" "$ADMIN"
ck_value "le bordereau est « En attente »" "CRE" '.data.status' GET "/inter-depots/$T1" "$ADMIN"
PKG1=$(make_stored_package "$SOUSSE")
BC1=$(q "select barcode from \"Package\" where id = '$PKG1'")
ck_status "un colis du dépôt se scanne dans le bordereau" "200" POST "/inter-depots/$T1/scan" "$ADMIN" \
  "$(printf '{"code":"%s","mode":"add"}' "$BC1")"
ck_db "le colis quitte le stock du dépôt source" "1" \
  "select count(*) from \"Package\" where id = '$PKG1' and \"currentDepositId\" is null and status = 'EN_TRANSIT_INTER_DEPOT'"
ck_status "les colis joints à la création sont refusés -> 400" "400" POST /inter-depots "$ADMIN" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s","packageIds":["%s"]}' "$SOUSSE" "$HUB" "$DRIVER" "$PKG1")"
ck_status "l'ancienne expédition explicite -> 410" "410" POST "/inter-depots/$T1/dispatch" "$ADMIN" '{}'
ck_status "un transfert inconnu -> 404" "404" GET /inter-depots/ID-19700101-9999 "$ADMIN"
ck_status "le livreur peut consulter les transferts" "200" GET /inter-depots "$LIVREUR"
ck_status "l'expéditeur ne peut pas créer de transfert" "403" POST /inter-depots "$EXPEDITEUR" \
  "$(printf '{"sourceDepositId":"%s","destinationDepositId":"%s","transporterDriverId":"%s"}' "$SOUSSE" "$HUB" "$DRIVER")"
ck_status "sans jeton -> 401" "401" GET /inter-depots -
api POST "/inter-depots/$T1/cancel" "$ADMIN" '{}' >/dev/null

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
cleanup
[ "$FAIL" -eq 0 ]
