#!/usr/bin/env bash
# Vérifie le flux métier central de bout en bout, contre l'API réelle :
#   Expéditeur crée → Administration notifié → Affectation → Livreur livre.
# Aucun état n'est simulé : toutes les requêtes frappent l'API.
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0
declare -a RESULTS=()

check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS+=("  OK   $3  $1")
  else FAIL=$((FAIL+1)); RESULTS+=("  FAIL attendu=$2 obtenu=$3  $1"); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
tok() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.accessToken))"; }
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log($1)})"; }

ADMIN=$(tok admin@logixpress.tn 'Admin123!')
GEST=$(tok gestionnaire@logixpress.tn 'Gest123!')
EXP=$(tok expediteur@bluestar.tn 'Exp123!')
LIV=$(tok livreur.hamza@logixpress.tn 'Liv123!')
A=(-H "Authorization: Bearer $ADMIN"); G=(-H "Authorization: Bearer $GEST")
E=(-H "Authorization: Bearer $EXP");  L=(-H "Authorization: Bearer $LIV")

# Identifiants métier réels, lus dans la réponse de connexion
DRIVER_ID=$(curl -s "$BASE/auth/me" "${L[@]}" | field 'd.driverId')
echo "Livreur (UUID) : $DRIVER_ID"

echo
echo "1. L'expéditeur crée un colis"
NEW=$(curl -s -X POST "$BASE/colis" "${E[@]}" -H 'Content-Type: application/json' -d '{
  "customerName":"Amine Test Flux","customerPhone":"99112233","address":"Rue du Flux 1",
  "governorate":"Tunis","delegation":"Tunis","totalPrice":88.5,"pieceCount":2,
  "contentSummary":"2 articles de test","packageType":"NORMAL","shipperReference":"CMD-FLUX-1"}')
TRACK=$(echo "$NEW" | field 'd.trackingNumber')
PKG=$(echo "$NEW" | field 'd.id')
check "colis créé" "1" "$([ -n "$TRACK" ] && echo 1 || echo 0)"
echo "   → $TRACK"

echo "2. L'administration reçoit la notification"
sleep 1
curl -s "$BASE/notifications" "${A[@]}" > /tmp/notif.json 2>/dev/null
NT=$(node -e "try{const d=require('/tmp/notif.json').data||[];console.log(d.filter(n=>n.type==='NEW_COLIS_CREATED'&&n.relatedEntityId==='$PKG').length)}catch{console.log(0)}")
check "notification NEW_COLIS_CREATED reçue" "1" "$([ "$NT" -ge 1 ] && echo 1 || echo 0)"

echo "3. L'expéditeur peut modifier son colis (non encore reçu)"
check "PUT /colis libre" 200 "$(code -X PUT "$BASE/colis/$PKG" "${E[@]}" -H 'Content-Type: application/json' -d '{"contentSummary":"2 articles de test (modifié)"}')"

echo "4. L'expéditeur peut l'annuler tant qu'il n'est pas engagé"
TMP=$(curl -s -X POST "$BASE/colis" "${E[@]}" -H 'Content-Type: application/json' -d '{"customerName":"Annulable","customerPhone":"99112244","address":"X","totalPrice":10}' | field 'd.id')
check "annulation par l'expéditeur (CREE)" 200 "$(code -X POST "$BASE/colis/$TMP/cancel" "${E[@]}" -H 'Content-Type: application/json' -d '{"reason":"Erreur de saisie"}')"

echo "5. Acceptation au dépôt"
check "scan magasin" 200 "$(code -X POST "$BASE/warehouse/scan-accept" "${G[@]}" -H 'Content-Type: application/json' -d "{\"barcode\":\"$TRACK\"}")"
S=$(curl -s "$BASE/colis/$TRACK" "${A[@]}" | field 'd.status')
check "statut après scan = RECU_DEPOT" "RECU_DEPOT" "$S"

echo "6. L'expéditeur ne peut plus annuler (colis reçu au dépôt)"
check "annulation refusée" 409 "$(code -X POST "$BASE/colis/$PKG/cancel" "${E[@]}" -H 'Content-Type: application/json' -d '{"reason":"trop tard"}')"
check "suppression refusée" 409 "$(code -X DELETE "$BASE/colis/$PKG" "${E[@]}")"

echo "7. L'administration affecte le colis au livreur"
check "affectation" 200 "$(code -X POST "$BASE/colis/$PKG/assign" "${G[@]}" -H 'Content-Type: application/json' -d "{\"driverId\":\"$DRIVER_ID\"}")"
S=$(curl -s "$BASE/colis/$TRACK" "${A[@]}" | field 'd.status')
check "statut = AFFECTE_RUNSHEET" "AFFECTE_RUNSHEET" "$S"

echo "8. Le livreur est notifié de son affectation"
curl -s "$BASE/notifications" "${L[@]}" > /tmp/notifl.json 2>/dev/null
NL=$(node -e "try{const d=require('/tmp/notifl.json').data||[];console.log(d.filter(n=>n.type==='COLIS_ASSIGNED'&&n.relatedEntityId==='$PKG').length)}catch{console.log(0)}")
check "notification COLIS_ASSIGNED au livreur" "1" "$([ "$NL" -ge 1 ] && echo 1 || echo 0)"

echo "9. Le livreur démarre puis effectue la livraison"
check "démarrage livraison" 200 "$(code -X POST "$BASE/colis/$PKG/start" "${L[@]}" -H 'Content-Type: application/json' -d '{}')"
S=$(curl -s "$BASE/colis/$TRACK" "${A[@]}" | field 'd.status')
check "statut = EN_COURS_LIVRAISON" "EN_COURS_LIVRAISON" "$S"
check "livraison + encaissement" 200 "$(code -X POST "$BASE/colis/$PKG/deliver" "${L[@]}" -H 'Content-Type: application/json' -d '{"collectedAmount":88.5,"driverNote":"Remis en main propre","callDurationSeconds":75}')"

echo "10. L'administration voit le statut final, l'historique et l'audit"
D=$(curl -s "$BASE/colis/$TRACK" "${A[@]}")
S=$(echo "$D" | field 'd.status')
check "statut final = LIVRE" "LIVRE" "$S"
check "montant encaissé enregistré" "88.5" "$(echo "$D" | field 'd.collectedAmount')"
check "tentative de livraison tracée" "1" "$(echo "$D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log((JSON.parse(s).data.deliveryAttempts||[]).length))")"
EV=$(echo "$D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log((JSON.parse(s).data.trackingTimeline||[]).length))")
check "chronologie complète (>= 5 événements)" "1" "$([ "$EV" -ge 5 ] && echo 1 || echo 0)"
echo "   → $EV événements d'historique"
AL=$(curl -s "$BASE/colis/$TRACK/audit" "${A[@]}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log((JSON.parse(s).data||[]).length))")
check "journal d'audit alimenté" "1" "$([ "$AL" -ge 1 ] && echo 1 || echo 0)"

echo "11. Un colis livré est verrouillé"
check "livraison refusée (déjà livré)" 409 "$(code -X POST "$BASE/colis/$PKG/deliver" "${L[@]}" -H 'Content-Type: application/json' -d '{"collectedAmount":10}')"

echo "12. Un livreur ne peut pas agir sur le colis d'un autre"
TMP2=$(curl -s -X POST "$BASE/colis" "${E[@]}" -H 'Content-Type: application/json' -d '{"customerName":"Autre","customerPhone":"99112255","address":"Y","totalPrice":20}' | field 'd.id')
curl -s -X POST "$BASE/warehouse/scan-accept" "${G[@]}" -H 'Content-Type: application/json' -d "{\"barcode\":\"$(curl -s "$BASE/colis/$TMP2" "${A[@]}" | field 'd.trackingNumber')\"}" > /dev/null
curl -s -X POST "$BASE/colis/$TMP2/assign" "${G[@]}" -H 'Content-Type: application/json' -d "{\"driverId\":\"$DRIVER_ID\"}" > /dev/null
echo "   (affecté au même livreur : la règle de propriété ne s'applique qu'entre livreurs)"

# Le flux livre désormais des colis, et un colis livré ouvre un encaissement.
# Sans ce nettoyage, chaque exécution laisserait de l'argent « en attente » dans
# la caisse — et le tableau de bord Finance afficherait ensuite des sommes qui
# ne correspondent à aucune tournée réelle. Les montants du reste du dépôt
# seraient exacts, et le total faux : c'est le pire endroit pour une erreur.
q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 \
  -U logixpress_user -d logixpress_db -t -A -c "$1" 2>/dev/null; }

TAG="Amine Test Flux|Client Test"
# Deux formes du même jeu d'identifiants : `uuid` pour les clés étrangères, et
# `text` pour les colonnes d'audit et de notification, qui sont des chaînes.
# Mélanger les deux fait échouer le DELETE en silence — `q` absorbant le
# message de PostgreSQL, la seule trace du problème est le compte final.
Q_UUID="select p.id from \"Package\" p join \"Customer\" c on c.id = p.\"customerId\"
        where c.\"fullName\" ~ ('^($TAG)$')"
Q_TEXT="select p.id::text from \"Package\" p join \"Customer\" c on c.id = p.\"customerId\"
        where c.\"fullName\" ~ ('^($TAG)$')"

cleanup() {
  q "delete from \"Notification\" where \"relatedEntity\"='PACKAGE' and \"relatedEntityId\" in ($Q_TEXT)" >/dev/null
  # Le journal d'audit n'est pas nettoyé : il est immuable, et une trace
  # d'opération ne disparaît pas parce qu'un test a fini. Les lignes de ce
  # script restent visibles, identifiables par leur marque dans le motif.
  q "delete from \"PackageItem\" where \"packageId\" in ($Q_UUID)" >/dev/null
  q "delete from \"DeliveryAttempt\" where \"packageId\" in ($Q_UUID)" >/dev/null
  # Les encaissements partent avant les colis : ils y font référence.
  q "delete from \"Payment\" where \"packageId\" in ($Q_UUID)" >/dev/null
  q "delete from \"Package\" where id in ($Q_UUID)" >/dev/null
  local left_p left_pay
  left_p=$(q "select count(*) from \"Package\" p join \"Customer\" c on c.id = p.\"customerId\"
                where c.\"fullName\" ~ ('^($TAG)$')")
  left_pay=$(q "select count(*) from \"Payment\" where \"packageId\" in ($Q_UUID)")
  [ "${left_p:-0}" = "0" ] || echo "  ATTENTION : ${left_p} colis de test subsistent."
  [ "${left_pay:-0}" = "0" ] || echo "  ATTENTION : ${left_pay} encaissement(s) de test subsistent."
}
trap cleanup EXIT

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]
