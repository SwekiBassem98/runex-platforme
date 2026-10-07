#!/usr/bin/env bash
# Vérifie la machine à états du colis.
#
#   CRÉÉ → EN ATTENTE → AFFECTÉ → EN LIVRAISON → LIVRÉ
#                    ↘ REPORTÉ · ÉCHEC · RETOUR · PARTIELLE
#
# Les contrôles portent sur trois choses distinctes, et c'est volontaire :
# la légalité des transitions, les justifications exigées par chacune, et le
# fait que le statut ne peut pas être posé directement.
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
API_STATUS=""
JSON_H='Content-Type: application/json'

q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 -U logixpress_user -d logixpress_db -t -A -c "$1" 2>/dev/null; }

# api <méthode> <chemin> <jeton|-> [corps]
# Écrit le corps de la réponse sur la sortie standard et le code HTTP dans
# API_STATUS. Le corps est conservé pour être rejoué tel quel en cas d'échec :
# une valeur vide n'explique rien.
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
    local detail; detail=$(tr -d '\n' < "$TMPD/body" 2>/dev/null | cut -c1-190)
    RESULTS+=("  FAIL  $label  |  attendu=[$expected] obtenu=[$got]  |  ${detail}")
  fi
}

ck_status() { local l="$1" e="$2"; shift 2; api "$@" >/dev/null; expect "$l" "$e" "$API_STATUS"; }
ck_value() {
  local l="$1" e="$2" filter="$3"; shift 3
  api "$@" >/dev/null
  expect "$l" "$e" "$(jq -r "$filter" < "$TMPD/body" 2>/dev/null)"
}
ck_last() { expect "$1" "$2" "$(jq -r "$3" < "$TMPD/body" 2>/dev/null)"; }
ck_db() { : > "$TMPD/body"; expect "$1" "$2" "$(q "$3")"; }

tok() {
  curl -s -X POST "$BASE/auth/login" -H "$JSON_H" \
    --data-raw "$(printf '{"email":"%s","password":"%s"}' "$1" "$2")" \
    | jq -r '.data.accessToken // empty'
}

QA_TAG='Vérification Machine à États'

cleanup() {
  local keep="${1:-}" colis
  q "delete from \"Notification\" where \"relatedEntity\"='PACKAGE' and \"relatedEntityId\" in (select p.id::text from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  # Le journal d'audit n'est pas nettoyé : il est immuable. Voir le commentaire
  # de `verify-business-flow.sh`.
  q "delete from \"PackageItem\" where \"packageId\" in (select p.id from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  q "delete from \"DeliveryAttempt\" where \"packageId\" in (select p.id from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  q "delete from \"PartialDelivery\" where \"packageId\" in (select p.id from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  q "delete from \"ReturnRecord\" where \"packageId\" in (select p.id from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  # Les encaissements référencent le colis : ils partent avant lui, sinon la
  # clé étrangère bloque le nettoyage et la suite laisse de la casse derrière elle.
  q "delete from \"Payment\" where \"packageId\" in (select p.id from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  colis=$(q "delete from \"Package\" where \"customerId\" in (select id from \"Customer\" where \"fullName\"='$QA_TAG')")
  [ -n "$keep" ] || echo "Nettoyage effectué (${colis:-0} colis)."
}
trap 'cleanup --keep; rm -rf "$TMPD"' EXIT

# --- Contexte ----------------------------------------------------------

ADMIN=$(tok admin@logixpress.tn 'Admin123!')
AGENT=$(tok agent.magasin@logixpress.tn 'Agent123!')
SHIPPER=$(tok expediteur@bluestar.tn 'Exp123!')
HUB=$(q "select id from \"Deposit\" where \"isMainHub\" = true limit 1")
DRIVER=$(q "select d.id from \"Driver\" d where d.\"isActive\" = true and d.\"deletedAt\" is null order by d.\"driverCode\" limit 1")
DRIVER2=$(q "select d.id from \"Driver\" d where d.\"isActive\" = true and d.\"deletedAt\" is null and d.id <> '$DRIVER' order by d.\"driverCode\" limit 1")
DU1=$(q "select u.email from \"Driver\" d join \"User\" u on u.id=d.\"userId\" where d.id='$DRIVER'")
DU2=$(q "select u.email from \"Driver\" d join \"User\" u on u.id=d.\"userId\" where d.id='$DRIVER2'")
T1=$(tok "$DU1" 'Liv123!')
T2=$(tok "$DU2" 'Liv123!')

# Identifiants-resolution : la caisse contrôle qui a validé, pas seulement ce
# qui a été validé, donc les tests comparent des identifiants et non des noms.
ADMIN_USER_ID=$(q "select id from \"User\" where email = 'admin@logixpress.tn'")
SHIPPER_ID=$(q "select id from \"Shipper\" where email = 'contact@bluestar.tn'")

if [ -z "$ADMIN" ] || [ -z "$AGENT" ] || [ -z "$SHIPPER" ] || [ -z "$T1" ] || [ -z "$T2" ]; then
  echo "Échec d'authentification : vérifiez le jeu de données de démonstration."
  exit 1
fi

echo "Dépôt principal : $(q "select name from \"Deposit\" where id = '$HUB'")"
echo

# Crée un colis et renvoie « identifiant code-barres » : le scan d'entrée se
# fait par code-barres, comme au guichet, et les deux valeurs diffèrent.
make_package() { # [nbPièces] [montant]
  local pieces="${1:-1}" price="${2:-60}"
  local uniq created pid barcode essai
  # Deux tentatives : un incident de transport — serveur redémarré, connexion
  # interrompue — ne doit pas faire échouer la totalité du parcours. Ce n'est
  # pas une tolérance sur les règles métier : le colis créé par la seconde
  # tentative est vérifié exactement comme les autres.
  for essai in 1 2; do
    uniq=$(printf '99%06d' $(( (RANDOM * 13) % 1000000 )))
    created=$(api POST /colis "$SHIPPER" "$(printf '{"customerName":"%s","customerPhone":"%s","address":"Route QA %s","totalPrice":%s,"pieceCount":%s}' \
      "$QA_TAG" "$uniq" "$uniq" "$price" "$pieces")")
    pid=$(printf '%s' "$created" | jq -r '.data.id // empty')
    barcode=$(printf '%s' "$created" | jq -r '.data.barcode // empty')
    [ -n "$pid" ] && [ -n "$barcode" ] && break
    # Sans ce message, un échec de création produisait six assertions fausses
    # plus loin — le test accusait alors les règles de report au lieu de la
    # création du colis, et la cause réelle passait inaperçue.
    printf '  AVERTISSEMENT : création du colis de test impossible (HTTP %s) — %s\n' \
      "$API_STATUS" "$(printf '%s' "$created" | cut -c1-160)" >&2
    pid=""; barcode=""
  done
  [ -n "$pid" ] && [ -n "$barcode" ] || return 1
  printf '%s %s' "$pid" "$barcode"
}

# Fait accepter un colis au dépôt, par code-barres.
accept_at_depot() { # code-barres
  api POST /warehouse/scan-accept "$AGENT" \
    "$(printf '{"barcode":"%s","depositId":"%s"}' "$1" "$HUB")" >/dev/null
}

# Crée un colis, l'accepte au dépôt et l'affecte au livreur 1 : le colis est
# alors prêt à être démarré. Ne renvoie que l'identifiant.
make_ready_package() { # [nbPièces] [montant]
  local pid barcode
  read -r pid barcode <<< "$(make_package "$@")" || return 1
  accept_at_depot "$barcode"
  api POST "/colis/$pid/assign" "$ADMIN" \
    "$(printf '{"driverId":"%s"}' "$DRIVER")" >/dev/null
  printf '%s' "$pid"
}

# ------------------------------------------------------------------ 1
echo "1. Le parcours nominal"
# Le statut initial est vérifié avant toute manipulation : `make_ready_package`
# fait déjà avancer le colis jusqu'à l'affectation.
read -r P BAR <<< "$(make_package 1 60)"
ck_db "le colis est créé au statut CRÉÉ" "CREE" "select status from \"Package\" where id = '$P'"
accept_at_depot "$BAR"
api POST "/colis/$P/assign" "$ADMIN" "$(printf '{"driverId":"%s"}' "$DRIVER")" >/dev/null
ck_db "l'acceptation au dépôt est enregistrée" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and status = 'RECU_DEPOT'"
ck_value "l'affection passe le colis en AFFECTÉ" "AFFECTE_RUNSHEET" '.data.status' \
  GET "/colis/$P" "$ADMIN"
ck_value "le démarrage passe en EN LIVRAISON" "EN_COURS_LIVRAISON" '.data.status' \
  POST "/colis/$P/start" "$T1" '{}'
ck_value "la livraison passe en LIVRÉ" "LIVRE" '.data.status' \
  POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}'

# ------------------------------------------------------------------ 2
echo "2. Chaque étape est tracée : acteur, horodatage, lieu"
# Cinq événements : création, acceptation, affectation, démarrage, livraison.
ck_db "cinq événements de chronologie" "5" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P'"
ck_db "tous portent un acteur" "0" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and (\"operatorName\" is null or \"operatorName\" = '')"
ck_db "tous sont horodatés" "0" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and \"createdAt\" is null"
ck_db "le lieu est renseigné sur la livraison" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and \"status\" = 'LIVRE' and \"locationName\" is not null and \"locationName\" <> ''"
ck_db "chaque transition a une entrée d'audit" "4" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\" = '$P'"
ck_db "l'audit conserve le statut de départ" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\" = '$P' and \"previousValues\"->>'status' = 'EN_COURS_LIVRAISON'"

# ------------------------------------------------------------------ 3
echo "3. D1 — le statut ne se pose pas directement"
# Un colis modifiable : un colis livré refuse toute écriture, l'embranchement
# sur l'état terminal masquerait ce qu'on veut vérifier ici.
read -r Q QB <<< "$(make_package 1 60)"
ck_value "PUT avec un statut dans le corps -> statut ignoré" "CREE" '.data.status' \
  PUT "/colis/$Q" "$ADMIN" '{"status":"ANNULE","totalPrice":60}'
ck_db "le statut n'a pas bougé" "CREE" "select status from \"Package\" where id = '$Q'"
ck_status "aucun point d'entrée ne fixe un statut brut" "404" \
  PATCH "/colis/$Q/status" "$ADMIN" '{"status":"ANNULE"}'
ck_status "un statut inconnu est refusé en lecture de filtre" "200" \
  GET "/colis?status=N_IMPORTE_QUOI" "$ADMIN"
ck_value "le filtre renvoie une liste, jamais une écriture" "array" \
  'if (.data | type) == "array" then "array" else (.data | type) end' \
  GET "/colis?status=N_IMPORTE_QUOI" "$ADMIN"

# ------------------------------------------------------------------ 4
echo "4. D2 — les transitions interdites sont refusées"
# Un colis seulement reçu au dépôt n'est pas encore livrable : la machine à
# états exige de passer par l'affectation. On l'essaie en exploitation, car un
# livreur serait refusé d'abord pour non-affectation (403) et la machine à
# états n'aurait rien à dire sur ce cas.
read -r P BAR <<< "$(make_package 1 60)"
accept_at_depot "$BAR"
ck_status "REÇU AU DÉPÔT → LIVRÉ sans affectation -> 409" "409" \
  POST "/colis/$P/deliver" "$ADMIN" '{"collectedAmount":60}'
ck_db "le colis n'a pas bougé" "RECU_DEPOT" "select status from \"Package\" where id = '$P'"
ck_status "REÇU AU DÉPÔT → EN LIVRAISON sans affectation -> 409" "409" \
  POST "/colis/$P/start" "$ADMIN" '{}'

# Le refus d'un colis d'un autre livreur est un contrôle de propriété, pas un
# contrôle d'état : il doit se produire même quand la transition serait valide.
read -r P BAR <<< "$(make_package 1 60)"
accept_at_depot "$BAR"
ck_status "livrer le colis d'un autre livreur -> 403" "403" \
  POST "/colis/$P/deliver" "$T2" '{"collectedAmount":60}'

P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}' >/dev/null
ck_status "livrer deux fois -> 409" "409" POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}'
ck_status "un colis livré ne peut plus être reporté -> 409" "409" \
  POST "/colis/$P/postpone" "$T1" '{"reason":"client absent"}'
ck_status "un colis livré ne peut plus être retourné -> 409" "409" \
  POST "/colis/$P/return" "$T1" '{"reason":"refus du client"}'
api POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}' >/dev/null
ck_status "un état terminal ne s'ouvre pas -> 409" "409" \
  POST "/colis/$P/return-to-shipper" "$ADMIN" '{}'

# ------------------------------------------------------------------ 5
echo "5. D3 — les justifications exigées sont contrôlées"
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "REPORTÉ sans motif -> 400" "400" POST "/colis/$P/postpone" "$T1" '{"reason":""}'
ck_status "REPORTÉ avec un motif blanc -> 400" "400" POST "/colis/$P/postpone" "$T1" '{"reason":"   "}'
ck_value "le refus nomme ce qui manque" "1" \
  'if (.message | test("motif")) then 1 else 0 end' POST "/colis/$P/postpone" "$T1" '{"reason":""}'
ck_db "le colis n'a pas bougé" "EN_COURS_LIVRAISON" "select status from \"Package\" where id = '$P'"
ck_status "REPORTÉ avec motif -> 200" "200" POST "/colis/$P/postpone" "$T1" '{"reason":"Destinataire absent"}'
ck_db "le motif est conservé" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and description like '%Destinataire absent%'"

P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "ÉCHEC sans motif -> 400" "400" POST "/colis/$P/failed-attempt" "$T1" '{"reasonCode":""}'
ck_status "ÉCHEC avec motif normalisé -> 200" "200" \
  POST "/colis/$P/failed-attempt" "$T1" '{"reasonCode":"ADRESSE_INCORRECTE"}'
ck_db "l'échec est tracé avec son motif" "1" \
  "select count(*) from \"DeliveryAttempt\" where \"packageId\" = '$P' and \"reasonCode\" = 'ADRESSE_INCORRECTE'"
ck_db "le motif normalisé figure à l'historique" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and description like '%Adresse introuvable%'"

P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "RETOUR sans motif -> 400" "400" POST "/colis/$P/return" "$T1" '{"reason":""}'
ck_status "RETOUR avec motif -> 200" "200" POST "/colis/$P/return" "$T1" '{"reason":"Colis refusé"}'
ck_db "le retour est enregistré au dépôt" "1" \
  "select count(*) from \"ReturnRecord\" where \"packageId\" = '$P' and reason = 'Colis refusé'"

# ------------------------------------------------------------------ 6
echo "6. D4 — la livraison partielle exige ses cinq données"
P=$(make_ready_package 3 90)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "PARTIELLE sans rien -> 400" "400" \
  POST "/colis/$P/partial-delivery" "$T1" '{"deliveredPieces":1,"collectedAmount":30,"reason":"Colis abîmé"}'
ck_value "le refus énumère les données manquantes" "1" \
  'if (.message | test("livr|repris|montant")) then 1 else 0 end' \
  POST "/colis/$P/partial-delivery" "$T1" '{"deliveredPieces":1,"collectedAmount":30,"reason":"Colis abîmé"}'
# Les deux contenus ne sont pas facultatifs : « 1 pièce sur 3 » est le compte
# qu'on vient de donner, pas une description de ce que le client a reçu.
ck_status "PARTIELLE sans le contenu livré -> 400" "400" \
  POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":1,"collectedAmount":30,"reason":"Colis abîmé","returnedDescription":"2 cartons"}'
ck_status "PARTIELLE sans le contenu repris -> 400" "400" \
  POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":1,"collectedAmount":30,"reason":"Colis abîmé","deliveredDescription":"1 carton"}'
# Les autres règles s'apprécient avec les données complètes, sinon c'est
# l'absence de description qui ferait échouer l'essai, pas la règle visée.
PARTIAL_DESC='"deliveredDescription":"1 carton sur 3","returnedDescription":"2 cartons"'
ck_status "PARTIELLE avec un bilan qui ne se referme pas -> 400" "400" \
  POST "/colis/$P/partial-delivery" "$T1" \
  "{\"deliveredPieces\":1,\"collectedAmount\":30,\"returnedAmount\":99,\"reason\":\"Colis abîmé\",$PARTIAL_DESC}"
ck_status "PARTIELLE avec plus encaissé que dû -> 400" "400" \
  POST "/colis/$P/partial-delivery" "$T1" \
  "{\"deliveredPieces\":1,\"collectedAmount\":500,\"reason\":\"Colis abîmé\",$PARTIAL_DESC}"
# Une livraison partielle suppose qu'il reste des pièces : livrer les seules
# pièces du colis, c'est une livraison complète ou rien. Un colis d'une pièce
# est donc le cas le plus net de la règle.
ONE=$(make_ready_package 1 60)
api POST "/colis/$ONE/start" "$T1" '{}' >/dev/null
ck_status "PARTIELLE sur un colis d'une seule pièce -> 400" "400" \
  POST "/colis/$ONE/partial-delivery" "$T1" \
  "{\"deliveredPieces\":1,\"collectedAmount\":30,\"reason\":\"Colis abîmé\",$PARTIAL_DESC}"
ck_status "PARTIELLE complète -> 200" "200" \
  POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":1,"collectedAmount":30,"reason":"Colis abîmé","deliveredDescription":"1 carton sur 3","returnedDescription":"2 cartons"}'
ck_db "le montant repris est le reliquat du dû" "60.000" \
  "select \"amountReturned\" from \"PartialDelivery\" where \"packageId\" = '$P'"
ck_db "les deux contenus sont conservés" "1" \
  "select count(*) from \"PartialDelivery\" where \"packageId\" = '$P' and \"deliveredDescription\" = '1 carton sur 3' and \"returnedDescription\" = '2 cartons'"
ck_db "la chronologie porte les deux contenus" "1" \
  "select count(*) from \"PackageTimeline\" where \"packageId\" = '$P' and description like '%Livré : 1 carton sur 3%' and description like '%Repris : 2 cartons%'"

# ------------------------------------------------------------------ 7
echo "7. D5 — les issues de tournée"
# REPORTÉ puis reprise de la livraison.
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/postpone" "$T1" '{"reason":"Destinataire absent"}' >/dev/null
ck_value "le colis est REPORTÉ" "REPORTE" '.data.status' GET "/colis/$P" "$ADMIN"
ck_value "un colis reporté peut repartir en livraison" "EN_COURS_LIVRAISON" '.data.status' \
  POST "/colis/$P/start" "$T1" '{}'
ck_value "puis être livré" "LIVRE" '.data.status' POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}'

# ÉCHEC puis retour au dépôt puis restitution à l'expéditeur.
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/failed-attempt" "$T1" '{"reasonCode":"PAS_D_ARGENT"}' >/dev/null
ck_value "le colis est en ÉCHEC" "ECHEC_LIVRAISON" '.data.status' GET "/colis/$P" "$ADMIN"
ck_value "depuis un échec, le retour est possible" "RETOUR_DEPOT" '.data.status' \
  POST "/colis/$P/return" "$T1" '{"reason":"Le client refuse de payer"}'
ck_value "puis la restitution à l\'expéditeur" "RETOURNE_EXPEDITEUR" '.data.status' \
  POST "/colis/$P/return-to-shipper" "$ADMIN" '{}'

# PARTIELLE puis retour.
P=$(make_ready_package 3 90)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":2,"collectedAmount":60,"reason":"Une pièce manquante","deliveredDescription":"2 cartons sur 3","returnedDescription":"Le carton manquant était vide"}' >/dev/null
ck_value "le colis est en LIVRAISON PARTIELLE" "LIVRAISON_PARTIELLE" '.data.status' GET "/colis/$P" "$ADMIN"
ck_value "un partiel peut repartir en livraison" "LIVRE" '.data.status' \
  POST "/colis/$P/deliver" "$T1" '{"collectedAmount":30}'

P=$(make_ready_package 3 90)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":2,"collectedAmount":60,"reason":"Une pièce manquante","deliveredDescription":"2 cartons sur 3","returnedDescription":"Le carton manquant était vide"}' >/dev/null
ck_value "un partiel peut aussi être retourné" "RETOUR_DEPOT" '.data.status' \
  POST "/colis/$P/return" "$T1" '{"reason":"Le client a changé d avis"}'

# ------------------------------------------------------------------ 8
echo "8. D6 — un livreur n'agit que sur ses colis"
P=$(make_ready_package 1 60)
ck_status "le livreur 2 ne démarre pas le colis du livreur 1 -> 403" "403" \
  POST "/colis/$P/start" "$T2" '{}'
ck_status "le livreur 2 ne livre pas le colis du livreur 1 -> 403" "403" \
  POST "/colis/$P/deliver" "$T2" '{"collectedAmount":60}'
ck_status "le livreur 2 ne le reporte pas -> 403" "403" \
  POST "/colis/$P/postpone" "$T2" '{"reason":"absent"}'
ck_status "le livreur 2 ne le retourne pas -> 403" "403" \
  POST "/colis/$P/return" "$T2" '{"reason":"absent"}'
ck_status "le livreur 2 ne fait pas de livraison partielle -> 403" "403" \
  POST "/colis/$P/partial-delivery" "$T2" '{"deliveredPieces":1,"collectedAmount":30,"reason":"abîmé","deliveredDescription":"1 carton","returnedDescription":"2 cartons"}'
ck_db "le colis n'a pas bougé" "AFFECTE_RUNSHEET" "select status from \"Package\" where id = '$P'"
ck_value "le livreur titulaire, lui, peut démarrer" "EN_COURS_LIVRAISON" '.data.status' \
  POST "/colis/$P/start" "$T1" '{}'
ck_value "et livrer" "LIVRE" '.data.status' POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}'

# ------------------------------------------------------------------ 9
echo "9. D7 — la livraison partielle est tracée comme une tentative"
P=$(make_ready_package 3 90)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":1,"collectedAmount":30,"reason":"Colis abîmé","deliveredDescription":"1 carton sur 3","returnedDescription":"2 cartons"}' >/dev/null
ck_db "la tentative partielle est enregistrée" "1" \
  "select count(*) from \"DeliveryAttempt\" where \"packageId\" = '$P' and result = 'LIVRAISON_PARTIELLE'"
ck_db "elle est attribuée au livreur titulaire" "$DRIVER" \
  "select \"driverId\" from \"DeliveryAttempt\" where \"packageId\" = '$P' limit 1"
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/postpone" "$T1" '{"reason":"Destinataire absent"}' >/dev/null
ck_db "le report est enregistré comme tentative" "1" \
  "select count(*) from \"DeliveryAttempt\" where \"packageId\" = '$P' and result = 'REPORTEE'"

# ------------------------------------------------------------------ 10
echo "10. D8 — les refus sont motivés"
P=$(make_ready_package 1 60)
ck_value "le refus d'un livreur est dit" "1" \
  'if (.message | test("affecté à ce livreur")) then 1 else 0 end' \
  POST "/colis/$P/start" "$T2" '{}'
# Un colis seulement reçu au dépôt : la livraison est possible en théorie, pas
# depuis cet état. Le refus doit dire par où passer.
read -r P BAR <<< "$(make_package 1 60)"
accept_at_depot "$BAR"
ck_value "le refus de transition liste les issues possibles" "1" \
  'if (.message | test("Transitions possibles")) then 1 else 0 end' \
  POST "/colis/$P/deliver" "$ADMIN" '{"collectedAmount":60}'
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60}' >/dev/null
ck_value "le refus sur un état terminal le dit" "1" \
  'if (.message | test("terminal")) then 1 else 0 end' \
  POST "/colis/$P/return" "$ADMIN" '{"reason":"trop tard"}'

# ------------------------------------------------------------------ 11
echo "11. Opérations de livraison avancées — ce que chacune doit consigner"

# 11.1 LIVRAISON PARTIELLE : le bilan complet de l'exemple de référence.
#        3 pièces / 58 DT  →  2 livrées / 40 DT  +  1 reprise / 18 DT
P=$(make_ready_package 3 58)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "PARTIELLE 2/3 pour 40 DT -> 200" "200" \
  POST "/colis/$P/partial-delivery" "$T1" \
  '{"deliveredPieces":2,"collectedAmount":40,"reason":"La 3e piece est Abendée","deliveredDescription":"2 robes, taille M et L, emballage intact","returnedDescription":"1 robe verte taille S, eliminate par le client"}'
ck_db "la quantité livrée est conservée" "2" \
  "select \"deliveredPieces\" from \"PartialDelivery\" where \"packageId\" = '$P'"
ck_db "la quantité reprise est conservée" "1" \
  "select \"returnedPieces\" from \"PartialDelivery\" where \"packageId\" = '$P'"
ck_db "les quantités couvrent le colis entier" "3" \
  "select \"deliveredPieces\" + \"returnedPieces\" from \"PartialDelivery\" where \"packageId\" = '$P'"
ck_db "le montant repris est le reliquat du dû" "18.000" \
  "select \"amountReturned\" from \"PartialDelivery\" where \"packageId\" = '$P'"
ck_db "le livreur validateur est conservé" "$DRIVER" \
  "select \"validatedByDriverId\" from \"PartialDelivery\" where \"packageId\" = '$P'"
ck_db "l'horodatage de validation est conservé" "1" \
  "select count(*) from \"PartialDelivery\" where \"packageId\" = '$P' and \"validatedAt\" is not null"
# Le bilan doit se refermer par construction, pas seulement par convention.
ck_db "le bilan financier se referme" "1" \
  "select count(*) from \"PartialDelivery\" where \"packageId\" = '$P' and \"amountCollected\" + \"amountReturned\" = \"originalAmount\""
ck_value "le bilan est renvoyé dans le colis" "40|1|18" \
  '[.data.partialDelivery.amountCollected, .data.partialDelivery.returnedPieces, .data.partialDelivery.amountReturned] | map(tostring) | join("|")' \
  GET "/colis/$P" "$ADMIN"

# 11.2 RETOUR : ce que le livreur ramène, et où.
P=$(make_ready_package 2 90)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "RETOUR avec reprise partielle -> 200" "200" \
  POST "/colis/$P/return" "$T1" \
  '{"reason":"Le client refuse le colis","returnedItems":"1 carton ouvert sur 2, 1 article manquant","returnedQuantity":1,"amount":12.5}'
ck_db "le motif du retour est conservé" "Le client refuse le colis" \
  "select reason from \"ReturnRecord\" where \"packageId\" = '$P'"
ck_db "les éléments repris sont conservés" "1 carton ouvert sur 2, 1 article manquant" \
  "select \"returnedItems\" from \"ReturnRecord\" where \"packageId\" = '$P'"
ck_db "la quantité reprise est conservée" "1" \
  "select \"returnedQuantity\" from \"ReturnRecord\" where \"packageId\" = '$P'"
ck_db "le montant ramené est conservé" "12.500" \
  "select amount from \"ReturnRecord\" where \"packageId\" = '$P'"
ck_db "le livreur du retour est conservé" "$DRIVER" \
  "select \"driverId\" from \"ReturnRecord\" where \"packageId\" = '$P'"
ck_db "le dépôt de destination est renseigné" "1" \
  "select count(*) from \"ReturnRecord\" where \"packageId\" = '$P' and \"returnDepositId\" is not null"
ck_db "l'horodatage du retour est conservé" "1" \
  "select count(*) from \"ReturnRecord\" where \"packageId\" = '$P' and \"createdAt\" is not null"
# Un retour porte d'ordinaire sur tout le colis : la quantité par défaut est
# une donnée, pas une case laissée vide.
P=$(make_ready_package 3 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/return" "$T1" '{"reason":"Destinataire injoignable"}' >/dev/null
ck_db "un retour sans quantité déclarée vaut tout le colis" "3" \
  "select \"returnedQuantity\" from \"ReturnRecord\" where \"packageId\" = '$P'"
P=$(make_ready_package 2 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "RETOUR de plus de pièces qu'il n'y en a -> 400" "400" \
  POST "/colis/$P/return" "$T1" '{"reason":"trop","returnedQuantity":5}'

# 11.3 ÉCHANGE : les deux faces de l'échange, et ce qu'il coûte.
P=$(make_ready_package 1 120)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "ÉCHANGE sans article repris -> 400" "400" \
  POST "/colis/$P/exchange" "$T1" '{"newPackageBarcode":"REM-001"}'
ck_status "ÉCHANGE sans remplacement -> 400" "400" \
  POST "/colis/$P/exchange" "$T1" '{"returnedItemSummary":"Chemise bleue taille M"}'
ck_status "ÉCHANGE complet avec écart -> 200" "200" \
  POST "/colis/$P/exchange" "$T1" \
  '{"oldPackageBarcode":"ART-REPRIS-001","returnedItemSummary":"Chemise bleue taille M, bouton manque","newPackageBarcode":"REM-001","financialDifference":15,"note":"Photos prises avant reprise"}'
ck_db "l'article repris est conservé" "ART-REPRIS-001" \
  "select \"oldPackageBarcode\" from \"ExchangeRecord\" where \"packageId\" = '$P'"
ck_db "l'article de remplacement est conservé" "REM-001" \
  "select \"newPackageBarcode\" from \"ExchangeRecord\" where \"packageId\" = '$P'"
ck_db "la description de l'article repris est conservée" "Chemise bleue taille M, bouton manque" \
  "select \"returnedItemSummary\" from \"ExchangeRecord\" where \"packageId\" = '$P'"
ck_db "l'écart financier est conservé" "15.000" \
  "select \"financialDifference\" from \"ExchangeRecord\" where \"packageId\" = '$P'"
ck_db "le livreur de l'échange est conservé" "$DRIVER" \
  "select \"driverId\" from \"ExchangeRecord\" where \"packageId\" = '$P'"
ck_db "le client concerné est tracé dans l'audit" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\" = '$P' and action = 'PACKAGE_EXCHANGE' and \"newValues\"->>'customerId' is not null"
# L'échange ne change pas le statut : il doit malgré tout laisser une trace
# d'audit, sans quoi il n'existe que dans la chronologie vue du client.
ck_db "l'échange est audité alors qu'il ne change pas le statut" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\" = '$P' and action = 'PACKAGE_EXCHANGE'"
ck_db "l'audit dit que le statut n'a pas bougé" "true" \
  "select \"newValues\"->>'unchanged' from \"AuditLog\" where \"entityId\" = '$P' and action = 'PACKAGE_EXCHANGE' limit 1"
# L'échange ne déplace pas le colis : c'est ce qui le distingue d'une
# transition, et ce que l'audit doit continuer de dire.
ck_db "l'échange laisse le colis en cours de livraison" "EN_COURS_LIVRAISON" \
  "select status from \"Package\" where id = '$P'"

# 11.4 REPORTÉ : motif, reprise, note tournée, message au client.
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
NEXT_DAY=$(date -v+2d '+%Y-%m-%d' 2>/dev/null || date -d '+2 days' '+%Y-%m-%d')
ck_status "REPORTÉ complet -> 200" "200" \
  POST "/colis/$P/postpone" "$T1" \
  "$(printf '{"reason":"Client absent au domicile","rescheduledDate":"%s","driverNote":"Deuxieme passage a prevoir sur le meme secteur","customerNote":"Nous repassons le %s entre 9h et 12h"}' "$NEXT_DAY" "$NEXT_DAY")"
ck_db "la date de reprise est conservée" "1" \
  "select count(*) from \"DeliveryAttempt\" where \"packageId\" = '$P' and result = 'REPORTEE' and \"rescheduledFor\" is not null"
ck_db "la note tournée est conservée" "Deuxieme passage a prevoir sur le meme secteur" \
  "select \"driverComment\" from \"DeliveryAttempt\" where \"packageId\" = '$P' and result = 'REPORTEE'"
ck_db "le message au client est conservé" "Nous repassons le $NEXT_DAY entre 9h et 12h" \
  "select \"customerNote\" from \"DeliveryAttempt\" where \"packageId\" = '$P' and result = 'REPORTEE'"
ck_value "les deux notes sont distinctes dans l'API" \
  "Deuxieme passage a prevoir sur le meme secteur|Nous repassons le $NEXT_DAY entre 9h et 12h" \
  '(.data.deliveryAttempts[0].notes + "|" + .data.deliveryAttempts[0].customerNote)' \
  GET "/colis/$P" "$ADMIN"
ck_db "le report est audité" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\" = '$P' and action = 'DELIVERY_POSTPONED'"

# 11.5 Les quatre opérations laissent toutes une trace d'audit et de chronologie.
for op in partial-delivery return exchange postpone; do
  Q=$(make_ready_package 3 60)
  api POST "/colis/$Q/start" "$T1" '{}' >/dev/null
  case "$op" in
    partial-delivery) api POST "/colis/$Q/$op" "$T1" '{"deliveredPieces":2,"collectedAmount":40,"reason":"Une piece abimee","deliveredDescription":"2 cartons sur 3","returnedDescription":"1 carton ouverture"}' >/dev/null ;;
    return)           api POST "/colis/$Q/$op" "$T1" '{"reason":"Client absent"}' >/dev/null ;;
    exchange)         api POST "/colis/$Q/$op" "$T1" '{"oldPackageBarcode":"X1","returnedItemSummary":"Article repris","newPackageBarcode":"R1"}' >/dev/null ;;
    postpone)         api POST "/colis/$Q/$op" "$T1" '{"reason":"Client absent"}' >/dev/null ;;
  esac
  # Le colis passe par quatre étapes avant l'opération — création, acceptation
  # au dépôt, affectation, démarrage — et l'opération en ajoute une cinquième.
  # C'est ce « une de plus » qui est vérifié : un acte non consigné laisserait
  # le compte à quatre.
  ck_db "$op : l'opération ajoute un événement de chronologie" "5" \
    "select count(*) from \"PackageTimeline\" where \"packageId\" = '$Q'"
  ck_db "$op : un acteur nommé" "0" \
    "select count(*) from \"PackageTimeline\" where \"packageId\" = '$Q' and (\"operatorName\" is null or \"operatorName\" = '')"
  ck_db "$op : au moins une entrée d'audit" "1" \
    "select count(*) from \"AuditLog\" where \"entityId\" = '$Q' and (
      action = 'DELIVERY_PARTIAL' or action = 'PACKAGE_RETURNED' or
      action = 'PACKAGE_EXCHANGE' or action = 'DELIVERY_POSTPONED')"
done

# ------------------------------------------------------------------ 12
echo "12. Caisse COD — encaissements, validation et écarts"

# Un colis livré en espèces ouvre un encaissement. C'est le livreur qui
# déclare le montant ; la caisse ne le valide pas toute seule.
P=$(make_ready_package 1 80)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "LIVRAISON en espèces -> 200" "200" \
  POST "/colis/$P/deliver" "$T1" '{"collectedAmount":80,"paymentMethod":"ESPECE"}'
ck_db "l'encaissement est ouvert à la livraison" "EN_ATTENTE" \
  "select status from \"Payment\" where \"packageId\" = '$P'"
ck_db "le montant dû est repris du colis" "80.000" \
  "select \"amountExpected\" from \"Payment\" where \"packageId\" = '$P'"
ck_db "le montant encaissé est celui déclaré par le livreur" "80.000" \
  "select \"amountCollected\" from \"Payment\" where \"packageId\" = '$P'"
ck_db "un encaissement est numéroté" "1" \
  "select count(*) from \"Payment\" where \"packageId\" = '$P' and \"paymentNumber\" is not null"
# `amountOutstanding` et `isBalanced` ne sont pas des colonnes : ils sont
# calculés à la lecture, à partir des montants stockés. Les interroger en SQL
# ne prouverait donc rien — ils y sont toujours absents. C'est l'API qui doit
# les rendre justes, et c'est elle qui est vérifiée ici.
PID0=$(q "select id from \"Payment\" where \"packageId\" = '$P'")
ck_value "le reliquat est nul quand le montant est complet" "0.000" \
  '.data.amountOutstanding' GET "/payments/$PID0" "$ADMIN"
ck_value "un bilan complet est équilibré" "true" \
  '.data.isBalanced' GET "/payments/$PID0" "$ADMIN"

# La validation est une action de caisse, signée. Elle est atomique : deux
# validations ne peuvent pas aboutir, même si elles arrivent ensemble.
PID=$(q "select id from \"Payment\" where \"packageId\" = '$P'")
PNUM=$(q "select \"paymentNumber\" from \"Payment\" where \"packageId\" = '$P'")
ck_status "VALIDATION par la finance -> 200" "200" POST "/payments/$PID/validate" "$ADMIN" '{}'
ck_db "le statut passe à validé" "VALIDE" \
  "select status from \"Payment\" where id = '$PID'"
ck_db "la validation nomme son auteur" "$ADMIN_USER_ID" \
  "select \"validatedByUserId\" from \"Payment\" where id = '$PID'"
ck_db "la validation est horodatée" "1" \
  "select count(*) from \"Payment\" where id = '$PID' and \"validatedAt\" is not null"
ck_status "VALIDATION déjà faite -> 409" "409" POST "/payments/$PID/validate" "$ADMIN" '{}'
ck_db "la seconde validation n'a rien réécrit" "1" \
  "select count(*) from \"Payment\" where id = '$PID' and \"validatedAt\" is not null"

# Un encaissement validé est figé : ni écarter ni rembourser ne doit rouvrir
# une écriture signée par la caisse.
ck_status "ÉCART sur un encaissement validé -> 409" "409" \
  POST "/payments/$PID/reject" "$ADMIN" '{"reason":"tentative apres validation"}'

# L'expéditeur n'a rien à faire de la caisse interne : il voit ses bordereaux,
# pas les encaissements des autres, et ne valide rien.
ck_status "VALIDATION par un expéditeur -> 403" "403" \
  POST "/payments/$PID/validate" "$SHIPPER" '{}'

# 12.2 Espèces en partie : le reliquat interdit la validation, et l'écart
#      reste visible plutôt que d'être absorbé.
P=$(make_ready_package 1 100)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
api POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60,"paymentMethod":"ESPECE"}' >/dev/null
PID2=$(q "select id from \"Payment\" where \"packageId\" = '$P'")
ck_value "l'encaissement partiel calcule son reliquat" "40.000" \
  '.data.amountOutstanding' GET "/payments/$PID2" "$ADMIN"
ck_value "l'encaissement partiel n'est pas équilibré" "false" \
  '.data.isBalanced' GET "/payments/$PID2" "$ADMIN"
# Un bilan qui ne se referme pas n'est pas une donnée invalide : c'est un
# conflit d'état, la caisse ne peut pas valider ce que le livreur n'a pas
# rapporté. D'où le 409, qui distingue « tu as mal envoyé » de « tu demandes
# quelque chose d'impossible dans l'état actuel ».
ck_status "VALIDATION d'un bilan incomplet -> 409" "409" POST "/payments/$PID2/validate" "$ADMIN" '{}'
ck_db "l'encaissement incomplet reste en attente" "EN_ATTENTE" \
  "select status from \"Payment\" where id = '$PID2'"

# L'écart se motive : un refus sans raison n'apprend rien à personne.
ck_status "ÉCART sans motif -> 400" "400" POST "/payments/$PID2/reject" "$ADMIN" '{"reason":"  "}'
ck_status "ÉCART motivé -> 200" "200" \
  POST "/payments/$PID2/reject" "$ADMIN" '{"reason":"Le client a regle 60 sur 100"}'
ck_db "l'écart motivé est enregistré" "Le client a regle 60 sur 100" \
  "select \"discrepancyReason\" from \"Payment\" where id = '$PID2'"
ck_db "l'écart motivé reste non validé" "ECARTE" \
  "select status from \"Payment\" where id = '$PID2'"

# 12.3 Chèque : la référence n'est pas décorative, elle est exigée — et son
#      absence ne doit pas coûter la livraison.
P=$(make_ready_package 1 150)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "LIVRAISON par chèque sans référence -> 400" "400" \
  POST "/colis/$P/deliver" "$T1" '{"collectedAmount":150,"paymentMethod":"CHEQUE"}'
# Le refus de la caisse ne doit pas avoir consumption le colis : livré, il ne
# serait plus livrable, et l'argent serait perdu sans que personne ne puisse
# le rattraper. C'est le point exact du test.
ck_db "un refus de la caisse laisse le colis livrable" "EN_COURS_LIVRAISON" \
  "select status from \"Package\" where id = '$P'"
ck_db "un refus de la caisse n'ouvre aucun encaissement" "0" \
  "select count(*) from \"Payment\" where \"packageId\" = '$P'"
ck_status "LIVRAISON par chèque référencé -> 200" "200" \
  POST "/colis/$P/deliver" "$T1" \
  '{"collectedAmount":150,"paymentMethod":"CHEQUE","transactionRef":"CHQ-4471"}'
PID3=$(q "select id from \"Payment\" where \"packageId\" = '$P'")
CHEQUE_PKG="$P"
ck_db "le moyen de paiement est conservé" "CHEQUE" \
  "select method from \"Payment\" where id = '$PID3'"
ck_db "la référence du chèque est conservée" "CHQ-4471" \
  "select \"transactionRef\" from \"Payment\" where id = '$PID3'"
ck_status "VALIDATION d'un chèque référencé -> 200" "200" \
  POST "/payments/$PID3/validate" "$ADMIN" '{}'
ck_db "la référence reportée à la validation ne remplace pas celle du dépôt" "CHQ-4471" \
  "select \"transactionRef\" from \"Payment\" where id = '$PID3'"
# Un colis ne porte qu'un encaissement : le compter deux fois ferait compter
# deux fois le même argent à la caisse.
ck_db "un colis ne porte qu'un encaissement" "1" \
  "select count(*) from \"Payment\" where \"packageId\" = '$CHEQUE_PKG'"

# Un moyen hors registre est refusé à la source, lui aussi sans casser le colis.
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "LIVRAISON avec un moyen inconnu -> 400" "400" \
  POST "/colis/$P/deliver" "$T1" '{"collectedAmount":60,"paymentMethod":"BITCOIN"}'
ck_db "un moyen inconnu laisse aussi le colis livrable" "EN_COURS_LIVRAISON" \
  "select status from \"Package\" where id = '$P'"

# Plus encore que le refus du moyen : encaisser plus que le dû. Le livreur
# ne peut pas se créer une dette favorable.
P=$(make_ready_package 1 60)
api POST "/colis/$P/start" "$T1" '{}' >/dev/null
ck_status "ENCAISSEMENT supérieur au dû -> 400" "400" \
  POST "/colis/$P/deliver" "$T1" '{"collectedAmount":75,"paymentMethod":"ESPECE"}'
ck_db "un encaissement excessif laisse le colis livrable" "EN_COURS_LIVRAISON" \
  "select status from \"Package\" where id = '$P'"
ck_db "un encaissement excessif n'ouvre aucun encaissement" "0" \
  "select count(*) from \"Payment\" where \"packageId\" = '$P'"

# 12.4 Les agrégats. Ils portent sur toute la caisse, pas sur les seuls colis
#      de ce script : la base contient déjà des encaissements. On ne compare
#      donc jamais à des valeurs absolues — on vérifie que le total se
#      décompose, et on le rapproche du SQL qui l'a produit.
ck_status "SOMMAIRE de la caisse -> 200" "200" GET /payments/summary "$ADMIN"
# L'identité qui doit tenir, dans l'ordre où la caisse la définit :
#   reliquat = attendu − encaissé − remboursé
# soit, à l'inverse, attendu = encaissé + remboursé + reliquat. Le terme
# « remboursé » n'est pas décoratif : l'omettre ferait passer pour juste un
# sommaire faux dès qu'une caisse a remboursé.
ck_value "attendu = encaissé + remboursé + reliquat" "true" \
  '(.data.totalCollected | tonumber) + (.data.totalRefunded | tonumber) + (.data.discrepancy | tonumber) == (.data.totalExpected | tonumber)' \
  GET /payments/summary "$ADMIN"
# Le même sommaire, restreint à une période qui exclut tout : il doit être vide.
# Sans le filtre de dates sur l'écart, celui-ci resterait celui de toute
# l'histoire et les chiffres ne se rejoigneraient plus.
ck_value "un sommaire sur une période vide est vide" "true" \
  '[.data.totalExpected, .data.totalCollected, .data.discrepancy, .data.pending, .data.validated]
   | map(tonumber) | add == 0' \
  GET "/payments/summary?from=1990-01-01&to=1990-01-02" "$ADMIN"
# Le décompte par statut doit retrouver le nombre de lignes de la table : le
# sommaire ne peut pas être un résumé partiel qui s'ignore.
DB_PAYMENT_COUNT=$(q "select count(*) from \"Payment\"")
ck_value "les statuts totalisent toutes les lignes" "$DB_PAYMENT_COUNT" \
  '[.data.byStatus[].count] | add' GET /payments/summary "$ADMIN"
# Rapproché en millimes, comme le cumul par livreur plus bas : comparer les
# chaînes rendrait l'échec dépendant des zéros de fin du montant.
DB_PAYMENT_SUM=$(q "select coalesce(round(sum(\"amountCollected\") * 1000), 0) from \"Payment\"")
ck_value "l'encaissé du sommaire égale la somme de la table" "$DB_PAYMENT_SUM" \
  '(.data.totalCollected | tonumber) * 1000 | round' GET /payments/summary "$ADMIN"
ck_status "CUMUL par expéditeur -> 200" "200" GET /payments/by-shipper "$ADMIN"
ck_status "CUMUL par livreur -> 200" "200" GET /payments/by-driver "$ADMIN"
ck_value "le cumul par livreur est indexé sur le livreur" "1" \
  '[.data[] | select(.driverId == "'"$DRIVER"'")] | length' GET /payments/by-driver "$ADMIN"
# Rapprochement du cumul par livreur avec le SQL, sur les seuls encaissements
# rattachés à un livreur — c'est la population que la vue agrège.
# Le rapprochement se fait en millimes, et non en comparant deux chaînes :
# PostgreSQL rend `1279.000` là où jq rend `1279`, et l'échec qui en découle
# dirait une divergence de montant alors que les deux sides disent la même chose.
# Le dinar se manipule en millimes de toute façon.
DB_DRIVER_SUM=$(q "select coalesce(round(sum(\"amountCollected\") * 1000), 0) from \"Payment\" where \"driverId\" is not null")
ck_value "le cumul par livreur égale le SQL des livreurs" "$DB_DRIVER_SUM" \
  '[.data[].totalCollected | tonumber] | add // 0 | (. * 1000) | round' GET /payments/by-driver "$ADMIN"
ck_value "le cumul par expéditeur porte le nom de l'expéditeur" "1" \
  "[.data[] | select(.shipperId == \"$SHIPPER_ID\")] | length" GET /payments/by-shipper "$ADMIN"

# Un expéditeur n'a pas à voir le cash global de la plateforme : il a ses
# bordereaux, pas le reliquat de chaque livreur.
ck_status "SOMMAIRE de la caisse vu par un expéditeur -> 403" "403" \
  GET /payments/summary "$SHIPPER"
ck_status "CUMUL par livreur vu par un expéditeur -> 403" "403" \
  GET /payments/by-driver "$SHIPPER"
ck_status "LISTE des encaissements vue par un livreur -> 403" "403" \
  GET /payments "$T1"
# En revanche ses bordereaux restent accessibles : c'est son propre suivi.
ck_status "BORDEREAUX vus par un expéditeur -> 200" "200" \
  GET /payments/vouchers "$SHIPPER"

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
cleanup
[ "$FAIL" -eq 0 ]
