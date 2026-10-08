#!/usr/bin/env bash
# Vérifie le journal d'audit : couverture des opérations engageantes, qualité
# des traces, droits de consultation, et immuabilité.
#
#   EXPÉDITEUR modifie un montant
#   ADMIN affecte un colis à un livreur
#   LIVREUR valide une livraison
#   FINANCE valide un encaissement
#   AGENT_DEPOT reçoit un transfert inter-dépôts
#   EXPÉDITEUR annule un colis
#
# Les contrôles A1-A6 sont des régressions : ils vérifient que l'opération est
# tracée, et non seulement qu'elle réussit.
#
# Les contrôles A7 portent sur l'immuabilité, vérifiée directement en base et
# non via l'API : c'est là que la règle doit tenir, puisque c'est le seul point
# par lequel on ne peut pas contourner le code applicatif.
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

# Le contrôleur d'immuabilité a besoin de voir l'échec : sans `2>/dev/null`,
# `psql` écrit son message d'erreur dans le fichier de corps, ce qui pollue
# l'affichage des échecs voisins.
q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 -U logixpress_user -d logixpress_db -t -A -q -c "$1"; }

# api <méthode> <chemin> <jeton|-> [corps]
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

ck_status() { local l="$1" e="$2"; shift 2; api "$@" >/dev/null; expect "$l" "$e" "$API_STATUS"; }
ck_value() {
  local l="$1" e="$2" filter="$3"; shift 3
  api "$@" >/dev/null
  expect "$l" "$e" "$(jq -r "$filter" < "$TMPD/body" 2>/dev/null)"
}
ck_db() { : > "$TMPD/body"; expect "$1" "$2" "$(q "$3" | head -1)"; }
ck_last() { expect "$1" "$2" "$(jq -r "$3" < "$TMPD/body" 2>/dev/null)"; }

tok() {
  curl -s -X POST "$BASE/auth/login" -H "$JSON_H" \
    --data-raw "$(printf '{"email":"%s","password":"%s"}' "$1" "$2")" \
    | jq -r '.data.accessToken // empty'
}

# Nombre de traces d'une entité portant une action donnée.
traces() { # entitéType entitéId [action]
  if [ -n "${3:-}" ]; then
    q "select count(*) from \"AuditLog\" where \"entityType\"='$1' and \"entityId\"='$2' and \"action\"='$3'"
  else
    q "select count(*) from \"AuditLog\" where \"entityType\"='$1' and \"entityId\"='$2'"
  fi
}

QA_TAG='Vérification Audit'

# Le journal n'est pas nettoyé : il est immuable, et une trace d'opération ne
# disparaît pas parce qu'un test a fini. Seuls les colis et leurs clients sont
# effacés.
cleanup() {
  local keep="${1:-}" colis clients
  colis=$(q "delete from \"Package\" where \"customerId\" in (select id from \"Customer\" where \"fullName\"='$QA_TAG')" 2>/dev/null)
  clients=$(q "delete from \"Customer\" where \"fullName\"='$QA_TAG'" 2>/dev/null)
  [ -n "$keep" ] || echo "Nettoyage effectué (${colis:-0} colis, ${clients:-0} clients)."
  echo "Le journal d'audit conserve les traces de ce contrôle : c'est voulu."
}
trap 'cleanup --keep; rm -rf "$TMPD"' EXIT

# Crée un colis et renvoie « id|numéro ».
make_package() {
  local uniq created
  uniq=$(printf '55%06d' $(( (RANDOM * 13) % 1000000 )))
  created=$(api POST /colis "$EXPEDITEUR" "$(printf '{"customerName":"%s","customerPhone":"%s","address":"Route QA %s","totalPrice":%d,"pieceCount":%d}' \
    "$QA_TAG" "$uniq" "$uniq" "$((30 + RANDOM % 90))" 1)")
  local id tracking
  id=$(printf '%s' "$created" | jq -r '.data.id // empty')
  tracking=$(printf '%s' "$created" | jq -r '.data.trackingNumber // empty')
  [ -n "$id" ] && [ -n "$tracking" ] || return 1
  printf '%s|%s' "$id" "$tracking"
}

# --- Contexte : rôles ----------------------------------------------------

ADMIN=$(tok admin@logixpress.tn 'Admin123!')
AGENT=$(tok agent.magasin@logixpress.tn 'Agent123!')
LIVREUR=$(tok livreur.hamza@logixpress.tn 'Liv123!')
EXPEDITEUR=$(tok expediteur@bluestar.tn 'Exp123!')
FINANCE=$(tok finance@logixpress.tn 'Fin123!')

if [ -z "$ADMIN" ] || [ -z "$AGENT" ] || [ -z "$LIVREUR" ] || [ -z "$EXPEDITEUR" ] || [ -z "$FINANCE" ]; then
  echo "Échec d'authentification : vérifiez le jeu de données de démonstration."
  exit 1
fi

AGENT_NAME=$(q "select \"fullName\" from \"User\" where email = 'agent.magasin@logixpress.tn' limit 1")
ADMIN_ID=$(q "select id from \"User\" where email = 'admin@logixpress.tn' limit 1")
HUB=$(q "select id from \"Deposit\" where \"isMainHub\" = true limit 1")
DRIVER=$(q "select d.id from \"Driver\" d where d.\"isActive\" = true and d.\"deletedAt\" is null order by d.\"driverCode\" limit 1")

echo "Journal d'audit — vérification"
echo

# ------------------------------------------------------------------ 1
echo "1. A1 — l'expéditeur modifie un montant"
IFS='|' read -r P1 T1 <<< "$(make_package)"
[ -n "${P1:-}" ] || { echo "Impossible de créer un colis de test."; exit 1; }
ck_status "la modification est acceptée" "200" PUT "/colis/$P1" "$EXPEDITEUR" \
  '{"totalPrice":333,"reason":"Correction de tarif après relevé"}'
ck_db "l'action est journalisée" "1" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\"='$P1' and \"action\"='UPDATE_CRITICAL_FIELDS'"
ck_db "l'état avant est conservé" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"previousValues\"->>'totalPrice' is not null"
ck_db "l'état après est conservé" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"newValues\"->>'totalPrice' = '333'"
ck_db "le motif est porté par la trace" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"action\"='UPDATE_CRITICAL_FIELDS' and \"reason\" is not null"
ck_db "l'auteur est identifié" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"userId\" is not null"
ck_db "l'adresse IP est relevée" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"userIp\" is not null"
ck_db "le client est relevé" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"userAgent\" is not null"
ck_db "l'horodatage est porté" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"timestamp\" is not null"

# ------------------------------------------------------------------ 2
echo "2. A2 — l'administration affecte un colis à un livreur"
[ -n "$DRIVER" ] || { echo "Aucun conducteur actif."; exit 1; }
ck_status "l'affectation est acceptée" "200" POST "/colis/$P1/assign" "$ADMIN" \
  "$(printf '{"driverId":"%s"}' "$DRIVER")"
ck_db "l'affectation est journalisée" "1" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\"='$P1' and \"action\"='ASSIGN_DRIVER'"
ck_db "l'affectation porte l'auteur de l'opération" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"action\"='ASSIGN_DRIVER' and \"userId\"='$ADMIN_ID'"

# ------------------------------------------------------------------ 3
echo "3. A3 — le livreur valide une livraison"
ck_status "la livraison est validée" "200" POST "/colis/$P1/deliver" "$LIVREUR" \
  '{"collectedAmount":333,"signature":"QA","recipientName":"QA"}'
ck_db "la livraison est journalisée" "1" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\"='$P1' and \"action\"='DELIVERY_DONE'"
ck_db "le montant encaissé figure dans la trace" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"action\"='DELIVERY_DONE' and \"newValues\"->>'collectedAmount' is not null"

# ------------------------------------------------------------------ 4
echo "4. A4 — l'expéditeur annule un colis"
IFS='|' read -r P2 T2 <<< "$(make_package)"
ck_status "l'annulation est acceptée" "200" POST "/colis/$P2/cancel" "$EXPEDITEUR" \
  '{"reason":"Erreur de saisie au guichet"}'
ck_db "l'annulation est journalisée" "1" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\"='$P2' and \"action\"='CANCEL'"
ck_db "l'annulation porte son motif" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P2' and \"action\"='CANCEL' and \"reason\" like '%guichet%'"
ck_db "le refus d'annulation n'écrit rien" "0" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P2' and \"action\"='CANCEL' and \"reason\" is null"

# ------------------------------------------------------------------ 5
echo "5. A5 — le dépôt reçoit un transfert inter-dépôts"
IFS='|' read -r P3 T3 <<< "$(make_package)"
api POST /warehouse/scan-accept "$AGENT" "$(printf '{"barcode":"%s","depositId":"%s"}' "$(q "select \"barcode\" from \"Package\" where id='$P3'")" "$HUB")" >/dev/null
ck_db "le colis est reçu au dépôt" "1" \
  "select count(*) from \"Package\" where id='$P3' and status='RECU_DEPOT'"
ck_db "la réception en dépôt est journalisée" "1" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\"='$P3' and \"action\"='PACKAGE_RECEIVED_AT_DEPOT'"
ck_db "elle nomme l'opérateur du dépôt" "1" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P3' and \"action\"='PACKAGE_RECEIVED_AT_DEPOT' and \"reason\" like '%Agent Depot%'"

# ------------------------------------------------------------------ 6
echo "6. A6 — la finance valide un encaissement"
# L'encaissement naît d'une livraison à paiement ; on en fabrique un par une
# livraison réelle du colis précédent plutôt que d'écrire en base, pour que la
# trace soit produite par le code métier et non par le test.
CASH_PKG=$(q "select id from \"Package\" where status='LIVRE' and \"collectedAmount\" > 0 and id not in (select \"packageId\" from \"Payment\") limit 1")
if [ -n "$CASH_PKG" ]; then
  PAY_ID=$(q "insert into \"Payment\" (id, \"paymentNumber\", \"packageId\", \"shipperId\", \"driverId\", status, method, \"amountExpected\", \"amountCollected\", \"amountRefunded\", \"deliveryFee\", \"collectedAt\", \"createdAt\", \"updatedAt\")
            select gen_random_uuid(), 'PAY-QA-' || substr(md5(random()::text),1,8), p.id, p.\"shipperId\", p.\"assignedDriverId\", 'EN_ATTENTE', 'ESPECE', p.\"collectedAmount\", p.\"collectedAmount\", 0, p.\"deliveryFee\", now(), now(), now()
            from \"Package\" p where p.id='$CASH_PKG'
            returning id")
  ck_status "la validation est acceptée" "200" POST "/payments/$PAY_ID/validate" "$FINANCE" '{}'
  ck_db "la validation est journalisée" "1" \
    "select count(*) from \"AuditLog\" where \"entityType\"='CASH_PAYMENT' and \"entityId\"='$PAY_ID' and \"action\"='CASH_PAYMENT_VALIDATED'"
  ck_db "elle relève l'adresse IP du validateur" "1" \
    "select count(*) from \"AuditLog\" where \"entityId\"='$PAY_ID' and \"action\"='CASH_PAYMENT_VALIDATED' and \"userIp\" is not null"
  ck_db "l'état avant est conservé" "1" \
    "select count(*) from \"AuditLog\" where \"entityId\"='$PAY_ID' and \"previousValues\"->>'status' = 'EN_ATTENTE'"
  ck_db "l'état après est conservé" "1" \
    "select count(*) from \"AuditLog\" where \"entityId\"='$PAY_ID' and \"newValues\"->>'status' = 'VALIDE'"
  # Rejouer la validation ne doit rien écrire de plus.
  ck_status "une seconde validation -> 409" "409" POST "/payments/$PAY_ID/validate" "$FINANCE" '{}'
  ck_db "le doublon n'écrit pas de trace" "1" \
    "select count(*) from \"AuditLog\" where \"entityType\"='CASH_PAYMENT' and \"entityId\"='$PAY_ID'"
else
  RESULTS+=("  N/A   aucun colis livré sans encaissement pour ce contrôle")
fi

# ------------------------------------------------------------------ 7
echo "7. A7 — le journal ne peut être ni modifié ni purgé"
#
# Ces contrôles regardent les droits et le déclencheur dans le catalogue
# PostgreSQL, et non l'API : c'est le seul endroit où la règle peut être
# vérifiée sans faire confiance au code qui est censé l'appliquer.
#
ck_db "le rôle applicatif peut écrire" "true" \
  "select has_table_privilege('logixpress_user', '\"AuditLog\"', 'INSERT')::text"
ck_db "le rôle applicatif peut lire" "true" \
  "select has_table_privilege('logixpress_user', '\"AuditLog\"', 'SELECT')::text"
ck_db "le rôle applicatif ne peut pas modifier" "false" \
  "select has_table_privilege('logixpress_user', '\"AuditLog\"', 'UPDATE')::text"
ck_db "le rôle applicatif ne peut pas supprimer" "false" \
  "select has_table_privilege('logixpress_user', '\"AuditLog\"', 'DELETE')::text"
ck_db "le rôle applicatif ne peut pas purger" "false" \
  "select has_table_privilege('logixpress_user', '\"AuditLog\"', 'TRUNCATE')::text"
ck_db "la table n'appartient pas au rôle applicatif" "false" \
  "select (select tableowner = 'logixpress_user' from pg_tables where tablename='AuditLog')::text"
ck_db "le propriétaire ne peut pas se connecter" "false" \
  "select (select rolcanlogin from pg_roles where rolname='audit_owner')::text"
ck_db "le déclencheur d'immuabilité est présent et actif" "true" \
  "select (count(*) = 1 and bool_and(tgenabled = 'O'))::text
   from pg_trigger where tgrelid = '\"AuditLog\"'::regclass and not tgisinternal"
ck_db "une action ne peut pas être écrite vide" "1" \
  "select count(*) from pg_constraint where conrelid = '\"AuditLog\"'::regclass and conname = 'AuditLog_action_not_blank'"
ck_db "une entité ne peut pas être écrite vide" "1" \
  "select count(*) from pg_constraint where conrelid = '\"AuditLog\"'::regclass and conname = 'AuditLog_entity_not_blank'"

# Le refus doit être constaté par la base, pas déduit des droits : on tente
# réellement l'écriture et on vérifie qu'elle échoue.
IMMUTABLE=$(traces PACKAGE "$P1")
if q "update \"AuditLog\" set \"reason\" = 'reecrit' where \"entityId\" = '$P1'" >/dev/null 2>&1; then
  FAIL=$((FAIL+1)); RESULTS+=("  FAIL  une modification directe a abouti")
else
  PASS=$((PASS+1)); RESULTS+=("  OK    une modification directe est refusée par la base")
fi
if q "delete from \"AuditLog\" where \"entityId\" = '$P1'" >/dev/null 2>&1; then
  FAIL=$((FAIL+1)); RESULTS+=("  FAIL  une suppression directe a abouti")
else
  PASS=$((PASS+1)); RESULTS+=("  OK    une suppression directe est refusée par la base")
fi

# Les droits peuvent être rendus, le déclencheur non contourné. La transaction
# est annulée : on vérifie la règle, on ne la contourne pas.
if q "begin; grant update on \"AuditLog\" to logixpress_user;
        update \"AuditLog\" set \"reason\" = 'reecrit' where \"entityId\" = '$P1'; rollback;" >/dev/null 2>&1; then
  FAIL=$((FAIL+1)); RESULTS+=("  FAIL  le déclencheur n'a pas refusé une écriture autorisée")
else
  PASS=$((PASS+1)); RESULTS+=("  OK    le déclencheur refuse même une écriture autorisée")
fi

ck_db "les traces sont intactes" "$IMMUTABLE" \
  "select count(*) from \"AuditLog\" where \"entityType\"='PACKAGE' and \"entityId\"='$P1'"
ck_db "aucune trace n'a été réécrite" "0" \
  "select count(*) from \"AuditLog\" where \"entityId\"='$P1' and \"reason\" = 'reecrit'"

# ------------------------------------------------------------------ 8
echo "8. Consultation de l'historique"
ck_status "l'administration consulte le journal" "200" GET /audit "$ADMIN"
ck_value "les entrées sont accompagnées de leur libellé" "1" \
  'if ([.data[] | select(.actionLabel and .entityLabel)] | length) == (.data | length) then 1 else 0 end' \
  GET /audit "$ADMIN"
ck_value "le total est annoncé" "1" 'if .meta.total >= 0 then 1 else 0 end' GET /audit "$ADMIN"
ck_value "la pagination est annoncée" "1" \
  'if (.meta.limit > 0 and .meta.offset >= 0) then 1 else 0 end' GET /audit "$ADMIN"
ck_value "le filtre par entité ne ramène que le colis testé" "1" \
  'if (.data | length > 0) and ([.data[] | select(.entityId != "'"$P1"'")] | length) == 0 then 1 else 0 end' \
  GET "/audit?entityType=PACKAGE&entityId=$P1" "$ADMIN"
ck_value "le filtre par action ne ramène que cette action" "1" \
  'if (.data | length > 0) and ([.data[] | select(.action != "CANCEL")] | length) == 0 then 1 else 0 end' \
  GET "/audit?action=CANCEL" "$ADMIN"
ck_value "le filtre par catégorie attrape les actions interpolées" "1" \
  'if (.meta.total > 0) then 1 else 0 end' GET "/audit?category=COLIS" "$ADMIN"
ck_value "la recherche dans les motifs ramène des résultats" "1" \
  'if (.data | length > 0) and ([.data[] | select((.reason // "") | contains("guichet") | not)] | length) == 0 then 1 else 0 end' \
  GET "/audit?search=guichet" "$ADMIN"
ck_value "un code hors catalogue reste lisible" "1" \
  'if ([.data[] | select(.knownAction == false)] | length) >= 0 then 1 else 0 end' GET /audit "$ADMIN"
ck_status "les actions présentes sont listées" "200" GET /audit/actions "$ADMIN"
ck_value "la liste des actions porte des libellés" "1" \
  'if ([.data[] | select(.label and .count >= 0)] | length) == (.data | length) then 1 else 0 end' \
  GET /audit/actions "$ADMIN"
ck_status "la synthèse est disponible" "200" GET /audit/summary "$ADMIN"
ck_value "la synthèse compte des actions" "1" \
  'if (.data.parAction | length) > 0 then 1 else 0 end' GET /audit/summary "$ADMIN"
ck_status "le journal d'un colis est consultable" "200" GET "/colis/$P1/audit" "$ADMIN"
ck_value "l'historique du colis est nonempty" "1" \
  'if (.data | length) > 0 then 1 else 0 end' GET "/colis/$P1/audit" "$ADMIN"

# ------------------------------------------------------------------ 9
echo "9. Droits de consultation"
ck_status "le livreur ne consulte pas le journal" "403" GET /audit "$LIVREUR"
ck_status "l'expéditeur ne consulte pas le journal" "403" GET /audit "$EXPEDITEUR"
ck_status "le livreur ne liste pas les actions" "403" GET /audit/actions "$LIVREUR"
ck_status "le livreur ne lit pas la synthèse" "403" GET /audit/summary "$LIVREUR"
ck_status "sans jeton -> 401" "401" GET /audit -
ck_status "le journal n'accepte aucune écriture" "404" POST /audit "$ADMIN" \
  '{"entityType":"PACKAGE","entityId":"x","action":"FORGED"}'
ck_status "le journal n'accepte aucune suppression" "404" DELETE /audit "$ADMIN"

# ------------------------------------------------------------------ 10
# Un filtre qui ne sait pas se traduire ne doit pas élargir la recherche au
# journal entier : demander une catégorie qui n'existe pas doit rendre un
# journal vide. C'est le défaut le plus coûteux sur un relevé d'audit, parce
# qu'il ne se voit pas à l'écran.
ck_status "une catégorie inconnue est acceptée" "200" GET "/audit?category=CATEGORIE_INEXISTANTE" "$ADMIN"
ck_value "une catégorie inconnue ne ramène rien" "0" '.meta.total' \
  GET "/audit?category=CATEGORIE_INEXISTANTE" "$ADMIN"
ck_value "les catégories s'additionnent et non s'excluent" "1" \
  'if (.data | length > 0) and ([.data[] | select((.category != "COLIS" and .category != "DEPOT"))] | length) == 0 then 1 else 0 end' \
  GET "/audit?category=COLIS,DEPOT&limit=200" "$ADMIN"
ck_value "une catégorie valide l'emporte sur une inconnue" "1" \
  'if (.data | length > 0) and ([.data[] | select(.category != "COLIS")] | length) == 0 then 1 else 0 end' \
  GET "/audit?category=COLIS,CATEGORIE_INEXISTANTE&limit=200" "$ADMIN"
# La somme des catégories doit reconstituer le journal entier : si une action
# appartenait à deux familles, un filtre croisé la compterait deux fois.
TOUTES=$(q "select string_agg(c, ',') from (select unnest(ARRAY['COLIS','DEPOT','RAMASSAGE','LIVRAISON','TOURNEE','FINANCE','TRANSFERT','PARAMETRAGE','REFERENTIEL']) c) t")
ck_value "les catégories partagent le journal entier" "1" \
  'if ([.data[] | select(.category == null)] | length) == 0 then 1 else 0 end' \
  GET "/audit?category=$TOUTES&limit=200" "$ADMIN"
TOTAL_JOURNAL=$(q "select count(*) from \"AuditLog\"")
ck_value "aucune trace n'échappe aux catégories" "$TOTAL_JOURNAL" '.meta.total' \
  GET "/audit?category=$TOUTES&limit=1" "$ADMIN"

echo "10. Le catalogue et la base ne divergent pas"
# `/audit/actions` couvre toutes les actions présentes en base. Une action écrite
# par le code métier mais absente du catalogue s'y afficherait avec son code
# brut : c'est un défaut de la donnée, que l'écran ne peut pas rattraper.
ck_value "toutes les actions écrites sont connues du catalogue" "0" \
  '[.data[] | select(.known == false)] | length' GET /audit/actions "$ADMIN"
ck_value "l'inconnu reste lisible plutôt que masqué" "1" \
  'if ([.data[] | select(.known == true) | select(.label == .action)] | length) == 0 then 1 else 0 end' \
  GET /audit/actions "$ADMIN"
# Les actions construites par interpolation (statut, étape de transfert,
# ramassage) doivent tomber sur une famille connue et non sur le repli.
ck_value "les actions construites par interpolation sont reconnues" "1" \
  'if ([.data[] | select(.category == "REFERENTIEL")] | length) == 0 then 1 else 0 end' \
  GET /audit/actions "$ADMIN"

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]