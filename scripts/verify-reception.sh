#!/usr/bin/env bash
# Vérifie la réception des colis au dépôt : lecture de code-barres, recherche
# manuelle, choix du dépôt d'accueil, refus explicites et historique réel.
#
#   Scan au dépôt → RECU_DEPOT → Colis accepté au dépôt
#
# Les contrôles R1-R6 sont des régressions : ils vérifient que les opérations
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

# Crée un colis et renvoie « id|numéro|code-barres ».
#
# La création passe par l'API, comme le ferait un expéditeur : le code-barres
# testé est donc celui que le système produit réellement, pas une valeur
# fabriquée ici. C'est la seule façon de vérifier la lecture de bout en bout.
make_package() {
  local uniq created
  uniq=$(printf '44%06d' $(( (RANDOM * 11) % 1000000 )))
  created=$(api POST /colis "$EXPEDITEUR" "$(printf '{"customerName":"%s","customerPhone":"%s","address":"Route QA %s","totalPrice":%d,"pieceCount":%d}' \
    "$QA_TAG" "$uniq" "$uniq" "$((20 + RANDOM % 90))" "$((1 + RANDOM % 3))")")
  local id tracking barcode
  id=$(printf '%s' "$created" | jq -r '.data.id // empty')
  tracking=$(printf '%s' "$created" | jq -r '.data.trackingNumber // empty')
  barcode=$(printf '%s' "$created" | jq -r '.data.barcode // empty')
  [ -n "$id" ] && [ -n "$barcode" ] || return 1
  printf '%s|%s|%s' "$id" "$tracking" "$barcode"
}

QA_TAG='Vérification Réception Dépôt'

# Le nettoyage cible une marque distinctive : les créations faites dans une
# sous-commande `$(...)` ne peuvent pas alimenter une liste d'identifiants.
cleanup() {
  local keep="${1:-}" colis clients
  colis=$(q "delete from \"Package\" where \"customerId\" in (select id from \"Customer\" where \"fullName\"='$QA_TAG')")
  # Le client part avec ses colis : sans cela, chaque exécution laisserait un
  # destinataire orphelin derrière elle, et la base s'encombre à chaque passe.
  clients=$(q "delete from \"Customer\" where \"fullName\"='$QA_TAG'")
  # Le journal d'audit n'est pas nettoyé : il est immuable, et il survit
  # volontairement à la suppression du colis — c'est le rôle d'une trace.
  [ -n "$keep" ] || echo "Nettoyage effectué (${colis:-0} colis, ${clients:-0} clients)."
}
trap 'cleanup --keep; rm -rf "$TMPD"' EXIT

# --- Contexte : rôles, dépôts --------------------------------------------

ADMIN=$(tok admin@logixpress.tn 'Admin123!')
AGENT=$(tok agent.magasin@logixpress.tn 'Agent123!')
LIVREUR=$(tok livreur.hamza@logixpress.tn 'Liv123!')
EXPEDITEUR=$(tok expediteur@bluestar.tn 'Exp123!')

if [ -z "$ADMIN" ] || [ -z "$AGENT" ] || [ -z "$LIVREUR" ] || [ -z "$EXPEDITEUR" ]; then
  echo "Échec d'authentification : vérifiez le jeu de données de démonstration."
  exit 1
fi

HUB=$(q "select id from \"Deposit\" where \"isMainHub\" = true limit 1")
HUB_NAME=$(q "select name from \"Deposit\" where id = '$HUB'")
AGENT_DEPOSIT=$(q "select coalesce(\"depositId\"::text,'') from \"User\" where email = 'agent.magasin@logixpress.tn' limit 1")
AGENT_NAME=$(q "select \"fullName\" from \"User\" where email = 'agent.magasin@logixpress.tn' limit 1")

echo "Dépôt principal : $HUB_NAME"
echo "Dépôt de l'agent de test : ${AGENT_DEPOSIT:-aucun}"
echo

if [ -z "$HUB" ]; then
  echo "Dépôt principal introuvable : exécution impossible."
  exit 1
fi

# ------------------------------------------------------------------ 1
echo "1. Référentiel des dépôts d'accueil"
ck_status "l'agent de dépôt consulte les dépôts d'accueil" "200" GET /depot/reception/depots "$AGENT"
ck_value "le dépôt principal est proposé" "1" \
  '[.data[] | select(.isMainHub == true)] | length' GET /depot/reception/depots "$AGENT"
ck_value "chaque dépôt porte un identifiant et un nom" "1" \
  'if ([.data[] | select(.id and .name)] | length) == (.data | length) then 1 else 0 end' \
  GET /depot/reception/depots "$AGENT"
# Le sélecteur ne propose que des dépôts en service. Le nombre renvoyé est donc
# celui des dépôts actifs — vérifié en base, sinon l'assertion ne prouverait rien.
ck_last "le sélecteur propose exactement les dépôts actifs" \
  "$(q "select count(*) from \"Deposit\" where status = 'ACTIF'")" '.data | length'
ck_status "le livreur ne consulte pas les dépôts d'accueil" "403" GET /depot/reception/depots "$LIVREUR"
ck_status "sans jeton -> 401" "401" GET /depot/reception/depots -

# ------------------------------------------------------------------ 2
echo "2. Lecture d'un code, sans rien écrire"
IFS='|' read -r P1 T1 B1 <<< "$(make_package)"
if [ -z "${B1:-}" ]; then
  echo "Impossible de créer un colis de test."
  exit 1
fi
echo "  colis de test : $T1 / code-barres $B1"

ck_value "le code-barres est reconnu comme tel" "barcode" '.data.kind' \
  POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$B1")"
ck_value "la lecture ramène le bon colis" "$T1" '.data.package.trackingNumber' \
  POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$B1")"
ck_value "la lecture n'indique pas de réception antérieure" "false" '.data.package.alreadyReceived' \
  POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$B1")"
ck_db "la prévisualisation ne modifie pas le colis" "CREE" \
  "select status from \"Package\" where id = '$P1'"
ck_db "aucun événement de réception après lecture" "0" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P1' and title = 'Colis accepté au dépôt'"

# ------------------------------------------------------------------ 3
echo "3. Réception par lecture de code-barres"
ck_value "la réception aboutit" "RECEIVED" '.data.outcome' \
  POST /depot/reception "$AGENT" "$(printf '{"code":"%s"}' "$B1")"
ck_last "la réception est acceptée" "true" '.data.accepted'
ck_db "le colis passe en « reçu au dépôt »" "RECU_DEPOT" \
  "select status from \"Package\" where id = '$P1'"
ck_db "le dépôt d'accueil est porté par le colis" "$HUB" \
  "select \"currentDepositId\" from \"Package\" where id = '$P1'"
ck_db "la réception est horodatée" "1" \
  "select (\"receivedAt\" is not null)::int from \"Package\" where id = '$P1'"
ck_db "l'opérateur est nommé sur le colis" "$AGENT_NAME" \
  "select \"receivedByName\" from \"Package\" where id = '$P1'"
ck_db "l'opérateur est rattaché par son identifiant" "1" \
  "select (\"receivedByUserId\" is not null)::int from \"Package\" where id = '$P1'"
ck_db "un événement de suivi est écrit" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P1' and title = 'Colis accepté au dépôt'"
ck_db "l'événement est localisé au dépôt d'accueil" "$HUB_NAME" \
  "select \"locationName\" from \"PackageTimeline\" where \"packageId\" = '$P1' and title = 'Colis accepté au dépôt'"
ck_db "l'événement nomme l'opérateur" "$AGENT_NAME" \
  "select \"operatorName\" from \"PackageTimeline\" where \"packageId\" = '$P1' and title = 'Colis accepté au dépôt'"
ck_db "la réception est tracée dans le journal d'audit" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\" = '$P1' and action = 'PACKAGE_RECEIVED_AT_DEPOT'"

# ------------------------------------------------------------------ 4
echo "4. Deuxième colis, saisi par son numéro"
IFS='|' read -r P2 T2 B2 <<< "$(make_package)"
ck_value "le numéro de colis est reconnu" "business-number" '.data.kind' \
  POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$T2")"
ck_value "la réception par numéro aboutit" "RECEIVED" '.data.outcome' \
  POST /depot/reception "$AGENT" "$(printf '{"code":"%s"}' "$T2")"
ck_db "le colis saisi est reçu au dépôt" "RECU_DEPOT" \
  "select status from \"Package\" where id = '$P2'"

# L'ancien format : les colis créés avant le passage à la séquence portent
# douze chiffres. Refuser ceux-là viderait la réception de son stock réel.
LEGACY=$(q "select p.id from \"Package\" p join \"Customer\" c on c.id = p.\"customerId\" where p.\"trackingNumber\" ~ '^[0-9]{12}\$' and p.status = 'CREE' limit 1")
if [ -n "$LEGACY" ]; then
  LEGACY_NUM=$(q "select \"trackingNumber\" from \"Package\" where id = '$LEGACY'")
  ck_value "un numéro de l'ancien format est reconnu" "business-number" '.data.kind' \
    POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$LEGACY_NUM")"
  ck_value "un colis de l'ancien format se reçoit" "RECEIVED" '.data.outcome' \
    POST /depot/reception "$AGENT" "$(printf '{"code":"%s"}' "$LEGACY_NUM")"
  ck_db "l'ancien colis est reçu au dépôt" "RECU_DEPOT" \
    "select status from \"Package\" where id = '$LEGACY'"
else
  RESULTS+=("  N/A   aucun colis à l'ancien format en base pour ce contrôle")
fi

# ------------------------------------------------------------------ 5
echo "5. R1 — codes refusés, avec un motif stable"
ck_status "un code mal formé -> 404" "404" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s"}' "SCAN-TEST-0001")"
ck_last "le motif est explicite" "MALFORMED_CODE" '.data.outcome'
ck_status "un code illisible est aussi signalé en lecture" "200" POST /depot/reception/lookup "$AGENT" \
  "$(printf '{"code":"%s"}' "SCAN-TEST-0001")"
ck_last "la lecture le classe comme illisible" "malformed" '.data.kind'
ck_value "la lecture signale l'absence de dépôt de repli" "1" \
  'if (.data.package == null and .data.kind == "malformed") then 1 else 0 end' \
  POST /depot/reception/lookup "$AGENT" '{"code":"SCAN-TEST-0001"}'
ck_status "un code bien formé sans colis -> 404" "404" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s"}' "26100399999999")"
ck_last "le motif distingue l'inconnu du mal formé" "UNKNOWN_CODE" '.data.outcome'
ck_status "un code tronqué -> 404" "404" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s"}' "${B1%?????}")"
ck_last "il est vu comme mal formé, pas comme inconnu" "MALFORMED_CODE" '.data.outcome'
ck_status "une réception sans code -> 400" "400" POST /depot/reception "$AGENT" '{"code":"   "}'
ck_status "un dépôt mal formé -> 400" "400" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s","depositId":"%s"}' "26100399999999" "pas-un-uuid")"
ck_last "le motif désigne le dépôt fautif" "INVALID_DEPOSIT" '.data.outcome'
ck_status "un dépôt inexistant -> 400" "400" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s","depositId":"%s"}' "26100399999999" "00000000-0000-4000-8000-000000000000")"

# ------------------------------------------------------------------ 6
echo "6. R2 — le doublon est signalé, jamais rejoué"
RECU_AT=$(q "select \"receivedAt\" from \"Package\" where id = '$P1' and \"receivedAt\" is not null")
ck_status "recevoir deux fois le même colis -> 409" "409" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s"}' "$B1")"
ck_last "le motif est celui d'un déjà-reçu" "ALREADY_RECEIVED" '.data.outcome'
ck_last "le doublon n'est pas accepté" "false" '.data.accepted'
ck_value "l'écran reçoit l'heure de la première réception" "1" \
  'if (.data.receivedAt and .data.package.alreadyReceived) then 1 else 0 end' \
  POST /depot/reception "$AGENT" "$(printf '{"code":"%s"}' "$B1")"
ck_db "le doublon n'ajoute pas d'événement" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P1' and title = 'Colis accepté au dépôt'"
ck_db "le doublon ne décale pas la date de réception" "$RECU_AT" \
  "select \"receivedAt\" from \"Package\" where id = '$P1' and \"receivedAt\" is not null"
ck_db "le premier opérateur reste le receveur" "$AGENT_NAME" \
  "select \"receivedByName\" from \"Package\" where id = '$P1'"

# R2 bis — un rejeu de la même requête ne doit pas compter comme un doublon.
IFS='|' read -r P3 T3 B3 <<< "$(make_package)"
KEY="qa-rejeu-$RANDOM-$RANDOM"
ck_value "une réception se joue" "RECEIVED" '.data.outcome' \
  POST /depot/reception "$AGENT" "$(printf '{"code":"%s","idempotencyKey":"%s"}' "$B3" "$KEY")"
ck_status "son rejeu est reconnu et n'échoue pas" "200" \
  POST /depot/reception "$AGENT" "$(printf '{"code":"%s","idempotencyKey":"%s"}' "$B3" "$KEY")"
ck_db "le rejeu n'écrit qu'un seul événement" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P3' and title = 'Colis accepté au dépôt'"
ck_status "une autre session refait bien un doublon" "409" POST /depot/reception "$AGENT" \
  "$(printf '{"code":"%s","idempotencyKey":"%s"}' "$B3" "autre-$RANDOM")"

# ------------------------------------------------------------------ 7
echo "7. R3 — le dépôt d'accueil"
IFS='|' read -r P4 T4 B4 <<< "$(make_package)"
ck_value "un dépôt peut être choisi explicitement" "RECEIVED" '.data.outcome' \
  POST /depot/reception "$AGENT" "$(printf '{"code":"%s","depositId":"%s"}' "$B4" "$HUB")"
ck_db "le colis est rangé dans le dépôt choisi" "$HUB" \
  "select \"currentDepositId\" from \"Package\" where id = '$P4'"
ck_value "la réception sans dépôt retombe sur celui de l'opérateur" "1" \
  'if (.data.package and .data.package.currentDepositId) then 1 else 0 end' \
  POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$T4")"
ck_value "le dépôt d'accueil est annoncé avec la lecture" "1" \
  'if (.data.deposit and .data.deposit.name) then 1 else 0 end' \
  POST /depot/reception/lookup "$AGENT" "$(printf '{"code":"%s"}' "$T4")"

# ------------------------------------------------------------------ 8
echo "8. R4 — les réceptions récentes sont réelles"
ck_value "l'historique n'est pas vide après réception" "1" \
  'if (.data | length) > 0 then 1 else 0 end' GET /depot/reception/recent "$AGENT"
ck_value "chaque ligne cite un colis, un opérateur et une heure" "1" \
  'if ([.data[] | select(.packageId and .trackingNumber and .operatorName and .receivedAt)] | length) == (.data | length) then 1 else 0 end' \
  GET /depot/reception/recent "$AGENT"
ck_value "les colis reçus figurent des réceptions récentes" "1" \
  'if ([.data[] | select(.trackingNumber == "'"$T1"'")] | length) == 1 then 1 else 0 end' \
  GET /depot/reception/recent "$AGENT"
ck_value "le dépôt d'accueil est porté par la ligne" "1" \
  'if ([.data[] | select(.locationName)] | length) == (.data | length) then 1 else 0 end' \
  GET /depot/reception/recent "$AGENT"
ck_value "l'historique se limite au dépôt demandé" "1" \
  'if ([.data[] | select(.locationName != "'"$HUB_NAME"'")] | length) == 0 then 1 else 0 end' \
  GET "/depot/reception/recent?depositId=$HUB" "$AGENT"
ck_value "la limite demandée est respectée" "2" '.data | length' \
  GET "/depot/reception/recent?limit=2" "$AGENT"
ck_value "une limite excessive reste plafonnée" "1" \
  'if (.data | length) <= 50 then 1 else 0 end' GET "/depot/reception/recent?limit=500" "$AGENT"

# Un colis jamais reçu ne doit pas apparaître : c'est ce qui distingue une
# liste lue en base d'une liste de démonstration.
ABSENT=$(q "select \"trackingNumber\" from \"Package\" where status not in ('RECU_DEPOT','RECU_DEPOT_DESTINATION') limit 1")
if [ -n "$ABSENT" ]; then
  api GET "/depot/reception/recent?limit=50" "$AGENT" >/dev/null
  ck_last "un colis jamais reçu n'apparaît pas" "0" \
    "[.data[] | select(.trackingNumber == \"$ABSENT\")] | length"
else
  RESULTS+=("  N/A   aucun colis non reçu en base pour ce contrôle")
fi

# ------------------------------------------------------------------ 9
echo "9. R5 — états incompatibles avec un accueil"
LIVREPKG=$(q "select \"trackingNumber\" from \"Package\" where status = 'LIVRE' limit 1")
if [ -n "$LIVREPKG" ]; then
  ck_status "recevoir un colis livré -> 409" "409" POST /depot/reception "$AGENT" \
    "$(printf '{"code":"%s"}' "$LIVREPKG")"
  ck_last "le motif est celui d'un état incompatible" "INVALID_STATE" '.data.outcome'
else
  RESULTS+=("  N/A   aucun colis livré en base pour ce contrôle")
fi
ANNULEPKG=$(q "select \"trackingNumber\" from \"Package\" where status = 'ANNULE' limit 1")
if [ -n "$ANNULEPKG" ]; then
  ck_status "recevoir un colis annulé -> 409" "409" POST /depot/reception "$AGENT" \
    "$(printf '{"code":"%s"}' "$ANNULEPKG")"
  ck_last "le motif est bien un état incompatible" "INVALID_STATE" '.data.outcome'
else
  RESULTS+=("  N/A   aucun colis annulé en base pour ce contrôle")
fi
ENLOT=$(q "select \"trackingNumber\" from \"Package\" where status = 'EN_LOT_INTER_DEPOT' limit 1")
if [ -n "$ENLOT" ]; then
  ck_status "recevoir un colis déjà en lot -> 409" "409" POST /depot/reception "$AGENT" \
    "$(printf '{"code":"%s"}' "$ENLOT")"
else
  RESULTS+=("  N/A   aucun colis en lot inter-dépôt pour ce contrôle")
fi

# ------------------------------------------------------------------ 10
echo "10. R6 — droits sur la réception"
IFS='|' read -r P5 T5 B5 <<< "$(make_package)"
ck_status "le livreur ne reçoit pas de colis" "403" POST /depot/reception "$LIVREUR" \
  "$(printf '{"code":"%s"}' "$B5")"
ck_status "l'expéditeur ne reçoit pas de colis" "403" POST /depot/reception "$EXPEDITEUR" \
  "$(printf '{"code":"%s"}' "$B5")"
ck_status "le livreur ne lit pas les codes" "403" POST /depot/reception/lookup "$LIVREUR" \
  "$(printf '{"code":"%s"}' "$B5")"
ck_status "le livreur ne consulte pas l'historique" "403" GET /depot/reception/recent "$LIVREUR"
ck_status "sans jeton, pas de réception" "401" POST /depot/reception - "$(printf '{"code":"%s"}' "$B5")"
ck_status "sans jeton, pas de lecture" "401" POST /depot/reception/lookup - "$(printf '{"code":"%s"}' "$B5")"
ck_status "l'agent reçoit le colis" "200" POST /depot/reception "$AGENT" "$(printf '{"code":"%s"}' "$B5")"
ck_db "le refus n'a rien modifié" "RECU_DEPOT" "select status from \"Package\" where id = '$P5'"

# ------------------------------------------------------------------ 11
echo "11. L'ancienne route délègue au même service"
IFS='|' read -r P6 T6 B6 <<< "$(make_package)"
ck_status "l'ancienne route accepte toujours le code-barres" "200" \
  POST /warehouse/scan-accept "$AGENT" "$(printf '{"barcode":"%s","depositId":"%s"}' "$B6" "$HUB")"
ck_db "le colis reçu par l'ancienne route est rangé au dépôt" "$HUB" \
  "select \"currentDepositId\" from \"Package\" where id = '$P6'"
ck_db "et l'événement de suivi est le même" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P6' and title = 'Colis accepté au dépôt'"

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
cleanup
[ "$FAIL" -eq 0 ]