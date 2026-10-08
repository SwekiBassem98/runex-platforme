#!/usr/bin/env bash
# Smoke test de l'API LogiXpress : vérifie chaque module exposé par app.router.ts
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0
declare -a RESULTS=()

check() { # check <libellé> <attendu> <obtenu>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS+1)); RESULTS+=("  OK   $3  $1")
  else
    FAIL=$((FAIL+1)); RESULTS+=("  FAIL attendu=$2 obtenu=$3  $1")
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { curl -s "$@"; }

# Les charges utiles contenant une variable sont construites à part.
# Les guillemets imbriqués dans « "$( … )" ne sont pas honorés par bash : le
# corps JSON serait découpé en plusieurs mots et la requête partirait
# malformée — un échec qui peut passer pour un succès si le code attendu est
# justement 4xx.

login() { # login <email> <mdp> -> accessToken
  json -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).data.accessToken)}catch{console.log('')}})"
}

echo "== Démarrage des tests sur $BASE =="

# ---------- Health ----------
check "GET /health" 200 "$(code "$BASE/health")"
H=$(json "$BASE/health")
echo "$H" | grep -q '"status":"ok"' && check "health: status ok" 1 1 || check "health: status ok" 1 0
echo "$H" | grep -q '"database":{"status":"up"' && check "health: PostgreSQL up" 1 1 || check "health: PostgreSQL up" 1 0
echo "$H" | grep -q '"redis":{"status":"up"' && check "health: Redis up" 1 1 || check "health: Redis up" 1 0

# ---------- Auth ----------
check "GET /auth/demo-users (désactivé hors démonstration) -> 404" 404 "$(code "$BASE/auth/demo-users")"
check "POST /auth/login sans corps -> 400" 400 "$(code -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{}')"
check "POST /auth/login mauvais mdp -> 401" 401 "$(code -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@logixpress.tn","password":"faux"}')"
check "POST /auth/refresh sans jeton -> 400" 400 "$(code -X POST "$BASE/auth/refresh" -H 'Content-Type: application/json' -d '{}')"
check "POST /auth/refresh jeton invalide -> 401" 401 "$(code -X POST "$BASE/auth/refresh" -H 'Content-Type: application/json' -d '{"refreshToken":"abc.def.ghi"}')"
check "GET /auth/me sans jeton -> 401" 401 "$(code "$BASE/auth/me")"

ADMIN=$(login admin@logixpress.tn 'Admin123!')
GEST=$(login gestionnaire@logixpress.tn 'Gest123!')
EXP=$(login expediteur@bluestar.tn 'Exp123!')
LIV=$(login livreur.hamza@logixpress.tn 'Liv123!')
MAG=$(login agent.magasin@logixpress.tn 'Agent123!')
FIN=$(login finance@logixpress.tn 'Fin123!')
[ -n "$ADMIN" ] && check "login admin -> jeton" 1 1 || check "login admin -> jeton" 1 0

AUTH_ADMIN=(-H "Authorization: Bearer $ADMIN")
AUTH_GEST=(-H "Authorization: Bearer $GEST")
AUTH_EXP=(-H "Authorization: Bearer $EXP")
AUTH_LIV=(-H "Authorization: Bearer $LIV")
AUTH_MAG=(-H "Authorization: Bearer $MAG")
AUTH_FIN=(-H "Authorization: Bearer $FIN")

check "GET /auth/me (admin)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/auth/me")"
check "GET /auth/me (jeton falsifié) -> 401" 401 \
  "$(code -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.mauvaise_signature' "$BASE/auth/me")"

RT=$(json -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@logixpress.tn","password":"Admin123!"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.refreshToken))")
REFRESH_BODY="{\"refreshToken\":\"$RT\"}"
check "POST /auth/refresh (rotation)" 200 \
  "$(code -X POST "$BASE/auth/refresh" -H 'Content-Type: application/json' -d "$REFRESH_BODY")"
check "POST /auth/refresh ancien jeton -> 401 (rotation)" 401 \
  "$(code -X POST "$BASE/auth/refresh" -H 'Content-Type: application/json' -d "$REFRESH_BODY")"

# ---------- Autorisation (RBAC/PBAC) ----------
check "GET /colis sans jeton -> 401" 401 "$(code "$BASE/colis")"
check "GET /payments/vouchers (livreur) -> 403" 403 "$(code "${AUTH_LIV[@]}" "$BASE/payments/vouchers")"
check "POST /ramassages (livreur) -> 403" 403 \
  "$(code -X POST "${AUTH_LIV[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/ramassages")"
check "POST /warehouse/scan-accept (livreur) -> 403" 403 \
  "$(code -X POST "${AUTH_LIV[@]}" -H 'Content-Type: application/json' -d '{"barcode":"X"}' "$BASE/warehouse/scan-accept")"

# ---------- Identifiants réels ----------
# La suite ne doit pas figer d'identifiants : le jeu de données vit en base
# et évolue au fil des exécutions. On interroge donc l'API pour obtenir un
# colis, un livreur et une tournée réellement existants.
FIRST_PKG=$(json "${AUTH_ADMIN[@]}" "$BASE/colis?limit=1" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data[0];console.log(d.trackingNumber+'|'+d.id)})")
FIRST_TRACK="${FIRST_PKG%%|*}"
FIRST_ID="${FIRST_PKG##*|}"

# Le livreur connecté sert de cible d'affectation : un UUID, jamais un
# identifiant d'invention, sinon PostgreSQL rejette la requête.
DRIVER_ID=$(json "${AUTH_LIV[@]}" "$BASE/auth/me" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.driverId||''))")

FIRST_RUN=$(json "${AUTH_ADMIN[@]}" "$BASE/runsheets?limit=1" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=(JSON.parse(s).data||[])[0];console.log(d?d.runsheetNumber:'')})")

# ---------- Colis ----------
check "GET /colis (admin)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/colis")"
check "GET /packages (alias historique)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/packages")"
check "GET /colis?search=<numéro réel> -> filtré" 1 \
  "$(json "${AUTH_ADMIN[@]}" "$BASE/colis?search=$FIRST_TRACK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.length))")"
check "GET /colis?limit=1 (pagination)" 1 \
  "$(json "${AUTH_ADMIN[@]}" "$BASE/colis?limit=1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.length))")"
check "GET /colis/{inconnu} -> 404" 404 "$(code "${AUTH_ADMIN[@]}" "$BASE/colis/inexistant-123")"
check "GET /colis/{tracking} -> 200" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/colis/$FIRST_TRACK")"
check "GET /colis/{uuid} -> 200" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/colis/$FIRST_ID")"
# Cloisonnement : l'expéditeur ne voit que ses propres colis (contrôle par shipperId,
# indépendant du nombre de colis déjà créés par les exécutions précédentes)
SHIPPER_ID=$(json "${AUTH_EXP[@]}" "$BASE/auth/me" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.shipperId))")
check "GET /colis (expéditeur) : aucun colis d'un autre expéditeur" 0 \
  "$(json "${AUTH_EXP[@]}" "$BASE/colis" | SHIPPER_ID="$SHIPPER_ID" node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.filter(p=>p.shipperId!==process.env.SHIPPER_ID).length))")"
check "POST /colis sans champs requis -> 400" 400 \
  "$(code -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/colis")"
check "POST /colis totalPrice invalide -> 400" 400 \
  "$(code -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' \
      -d '{"customerName":"A","customerPhone":"1","address":"X","totalPrice":"abc"}' "$BASE/colis")"
NEW=$(json -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' \
  -d '{"customerName":"Client Test","customerPhone":"20000000","address":"Tunis","totalPrice":42.5,"pieceCount":2}' \
  "$BASE/colis")
NID=$(echo "$NEW" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")
check "POST /colis valide -> 201" 201 \
  "$(code -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' \
      -d '{"customerName":"Autre Client","customerPhone":"20000001","address":"Sousse","totalPrice":10}' "$BASE/colis")"
ASSIGN_BODY="{\"driverId\":\"$DRIVER_ID\"}"
check "POST /colis/{id}/assign" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "$ASSIGN_BODY" "$BASE/colis/$NID/assign")"
# Un livreur peut reporter le colis qui lui est affecté : c'est un motif
# d'(écart connu) de l'ancienne API, plus un écart du tout aujourd'hui. Ce
# colis est consommé par l'essai, d'où un colis distinct pour la suite.
check "POST /colis/{id}/postpone (livreur, son colis)" 200 \
  "$(code -X POST "${AUTH_LIV[@]}" -H 'Content-Type: application/json' -d '{"reason":"Client absent"}' "$BASE/colis/$NID/postpone")"
# Un report est un état, pas une absence d'état : on ne peut pas reporter
# deux fois de suite le même colis.
check "POST /colis/{id}/postpone (gestionnaire, déjà reporté) -> 409" 409 \
  "$(code -X POST "${AUTH_GEST[@]}" -H 'Content-Type: application/json' -d '{"reason":"Client absent"}' "$BASE/colis/$NID/postpone")"
NEXT=$(json -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' \
  -d '{"customerName":"Client Test","customerPhone":"20000000","address":"Tunis","totalPrice":42.5,"pieceCount":2}' \
  "$BASE/colis" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")
check "POST /colis/{id}/assign (colis à livrer)" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "$ASSIGN_BODY" "$BASE/colis/$NEXT/assign")"
check "POST /colis/{id}/deliver (livreur, son colis)" 200 \
  "$(code -X POST "${AUTH_LIV[@]}" -H 'Content-Type: application/json' -d '{"collectedAmount":42.5}' "$BASE/colis/$NEXT/deliver")"
OTHER=$(json -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' \
  -d '{"customerName":"Colis Ghassan","customerPhone":"20000002","address":"Ariana","totalPrice":15}' "$BASE/colis" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")
# Le colis d'un autre livreur ne se livre pas, et l'exploit ne se contourne
# pas : 403 avant même que la machine à états ait à se prononcer.
check "POST /colis/{id}/deliver colis d'un autre chauffeur -> 403" 403 \
  "$(code -X POST "${AUTH_LIV[@]}" -H 'Content-Type: application/json' -d '{"collectedAmount":15}' "$BASE/colis/$OTHER/deliver")"
check "POST /colis/{id}/deliver non assigné (gestionnaire) -> 409" 409 \
  "$(code -X POST "${AUTH_GEST[@]}" -H 'Content-Type: application/json' -d '{"collectedAmount":15}' "$BASE/colis/$OTHER/deliver")"
check "POST /colis/{id}/cancel (déjà livré) -> 409" 409 \
  "$(code -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' -d '{"reason":"trop tard"}' "$BASE/colis/$NEXT/cancel")"
check "PUT /colis/{id} (verrouillé LIVRE) -> 409" 409 \
  "$(code -X PUT "${AUTH_EXP[@]}" -H 'Content-Type: application/json' -d '{"totalPrice":10}' "$BASE/colis/$NEXT")"
SCAN=$(json -X POST "${AUTH_MAG[@]}" -H 'Content-Type: application/json' -d '{"barcode":"SCAN-TEST-0001"}' "$BASE/warehouse/scan-accept")
check "scan code-barres inconnu conserve le code scanné" "SCAN-TEST-0001" \
  "$(echo "$SCAN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.barcode))")"

# ---------- Runsheets ----------
check "GET /runsheets (admin)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/runsheets")"
check "GET /runsheets/{id}" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/runsheets/$FIRST_RUN")"
check "GET /runsheets/{inconnu} -> 404" 404 "$(code "${AUTH_ADMIN[@]}" "$BASE/runsheets/RUN-999999")"
check "GET /runsheets/driver/active (livreur)" 200 \
  "$(code "${AUTH_LIV[@]}" "$BASE/runsheets/driver/active?driverId=$DRIVER_ID")"
check "GET /runsheets/driver/active (inconnu) -> 404" 404 \
  "$(code -H "Authorization: Bearer $ADMIN" "$BASE/runsheets/driver/active?driverId=drv-999")"
check "POST /runsheets incomplet -> 400" 400 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/runsheets")"
RUN_BAD_DATE="{\"driverId\":\"$DRIVER_ID\",\"tourDate\":\"29-09-2026\"}"
check "POST /runsheets tourDate malformé -> 400" 400 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' \
      -d "$RUN_BAD_DATE" "$BASE/runsheets")"
RUN_BODY="{\"driverId\":\"$DRIVER_ID\",\"tourDate\":\"2026-09-30\"}"
RUN=$(json -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' \
  -d "$RUN_BODY" "$BASE/runsheets")
RUNID=$(echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.runsheetNumber))")
RUN_BODY_2="{\"driverId\":\"$DRIVER_ID\",\"tourDate\":\"2026-10-02\"}"
check "POST /runsheets valide -> 201" 201 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' \
      -d "$RUN_BODY_2" "$BASE/runsheets")"
# Prompt 26 : un colis déjà livré ne peut plus entrer dans une tournée. La
# tournée de test reçoit donc un colis neuf, encore à livrer.
RS_PKG=$(json -X POST "${AUTH_EXP[@]}" -H 'Content-Type: application/json' \
  -d '{"customerName":"Client Tournee","customerPhone":"20000009","address":"Tunis","totalPrice":30,"pieceCount":1}' \
  "$BASE/colis" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")
PKG_BODY="{\"packageIdentifier\":\"$RS_PKG\"}"
check "POST /runsheets/{id}/add-package (colis déjà livré) -> 409" 409 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "{\"packageIdentifier\":\"$NEXT\"}" "$BASE/runsheets/$RUNID/add-package")"
check "POST /runsheets/{id}/add-package" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "$PKG_BODY" "$BASE/runsheets/$RUNID/add-package")"
check "POST /runsheets/{id}/add-package sans identifiant -> 400" 400 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/runsheets/$RUNID/add-package")"
check "POST /runsheets/{id}/remove-package" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "$PKG_BODY" "$BASE/runsheets/$RUNID/remove-package")"
check "POST /runsheets/{id}/status EN_COURS (tournée vide) -> 409" 409 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{"status":"EN_COURS"}' "$BASE/runsheets/$RUNID/status")"
check "POST /runsheets/{id}/add-package (remise en tournée)" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "$PKG_BODY" "$BASE/runsheets/$RUNID/add-package")"
check "POST /runsheets/{id}/status TERMINE sans caisse -> 409" 409 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{"status":"TERMINE"}' "$BASE/runsheets/$RUNID/status")"
check "POST /runsheets/{id}/status EN_COURS" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{"status":"EN_COURS"}' "$BASE/runsheets/$RUNID/status")"
check "POST /runsheets/{id}/status invalide -> 400" 400 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{"status":"N_IMPORTE_QUOI"}' "$BASE/runsheets/$RUNID/status")"
check "POST /runsheets/{id}/close sans collectedCash -> 400" 400 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/runsheets/$RUNID/close")"
check "POST /runsheets/{id}/close" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{"collectedCash":120.5,"notes":"OK"}' "$BASE/runsheets/$RUNID/close")"
check "POST /runsheets/{id}/validate" 200 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{"notes":"rapproché"}' "$BASE/runsheets/$RUNID/validate")"
check "POST /runsheets/{id}/validate (inconnu) -> 404" 404 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/runsheets/RUN-999999/validate")"

# ---------- Ramassages ----------
check "GET /ramassages" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/ramassages")"
check "GET /pickups (alias historique)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/pickups")"

# La confirmation est irréversible : une fois le créneau confirmé, la suite
# n'a plus rien à confirmer au tour suivant. On remet donc explicitement le
# jeu d'essai à zéro en annulant les demandes encore ouvertes de cet
# expéditeur, puis on en crée une neuve sur un créneau libre.
for REF in $(json "${AUTH_ADMIN[@]}" "$BASE/ramassages" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=(JSON.parse(s).data||[]).filter(x=>x.status==='A_CONFIRMER'||x.status==='EN_ATTENTE');console.log(p.map(x=>x.referenceNumber).join(' '))})"); do
  curl -s -o /dev/null -X PATCH "${AUTH_ADMIN[@]}" "$BASE/ramassages/$REF/cancel"
done

PICKUP_DATE=$(node -e "console.log(new Date(Date.now()+400*864e5).toISOString().slice(0,10))")
PICKUP_BODY="{\"shipperId\":\"$SHIPPER_ID\",\"scheduledDate\":\"$PICKUP_DATE\",\"timeSlotStartHour\":9,\"timeSlotEndHour\":11,\"contactPerson\":\"Test\",\"contactPhone\":\"20000000\",\"packageEstimate\":6}"
PK=$(json -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d "$PICKUP_BODY" "$BASE/ramassages")
PKREF=$(echo "$PK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.referenceNumber))")

check "POST /ramassages incomplet -> 400" 400 \
  "$(code -X POST "${AUTH_ADMIN[@]}" -H 'Content-Type: application/json' -d '{}' "$BASE/ramassages")"
check "PATCH /ramassages/{id}/confirm" 200 "$(code -X PATCH "${AUTH_ADMIN[@]}" "$BASE/ramassages/$PKREF/confirm")"
check "PATCH /ramassages/{inconnu}/confirm -> 404" 404 "$(code -X PATCH "${AUTH_ADMIN[@]}" "$BASE/ramassages/RDV-inexistant/confirm")"

# ---------- Paiements ----------
check "GET /payments/vouchers (finance)" 200 "$(code "${AUTH_FIN[@]}" "$BASE/payments/vouchers")"
PM=$(json "${AUTH_FIN[@]}" "$BASE/payments/vouchers" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).meta.total))")
check "meta.total cohérent avec data" "$PM" \
  "$(json "${AUTH_FIN[@]}" "$BASE/payments/vouchers" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.length))")"
check "POST /payments/vouchers/{inconnu}/validate -> 404" 404 \
  "$(code -X POST "${AUTH_FIN[@]}" -H 'Content-Type: application/json' -d '{"secretCode":"1234"}' "$BASE/payments/vouchers/000000/validate")"
# Sélection d'un bon en attente de paiement. L'endpoint GET /payments/vouchers
# n'expose pas de filtre : on retient donc le premier bon non payé de la liste.
UNPAID=$(json "${AUTH_FIN[@]}" "$BASE/payments/vouchers" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).data.find(x=>x.status!=='PAYE');console.log(v?v.voucherNumber:'')})")
if [ -n "$UNPAID" ]; then
  check "POST /payments/vouchers/{en attente}/validate code court -> 400" 400 \
    "$(code -X POST "${AUTH_FIN[@]}" -H 'Content-Type: application/json' -d '{"secretCode":"1"}' "$BASE/payments/vouchers/$UNPAID/validate")"
  check "POST /payments/vouchers/{en attente}/validate -> 200" 200 \
    "$(code -X POST "${AUTH_FIN[@]}" -H 'Content-Type: application/json' -d '{"secretCode":"1234","paymentMethod":"ESPECE"}' "$BASE/payments/vouchers/$UNPAID/validate")"
  check "POST /payments/vouchers/{déjà payé}/validate -> 409" 409 \
    "$(code -X POST "${AUTH_FIN[@]}" -H 'Content-Type: application/json' -d '{"secretCode":"1234"}' "$BASE/payments/vouchers/$UNPAID/validate")"
else
  RESULTS+=("  SKIP  bon en attente épuisé : chemin 400/200/409 non rejouable (relancer l'API)")
fi

# ---------- Inter-dépôts ----------
check "GET /inter-depots (admin)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/inter-depots")"
check "GET /inter-depot (alias historique)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/inter-depot")"
check "GET /inter-depots (expéditeur) -> 403" 403 "$(code "${AUTH_EXP[@]}" "$BASE/inter-depots")"

# ---------- Dashboard ----------
check "GET /dashboard (admin)" 200 "$(code "${AUTH_ADMIN[@]}" "$BASE/dashboard")"
D=$(json "${AUTH_ADMIN[@]}" "$BASE/dashboard")
echo "$D" | grep -q '"colis":{"total"' && check "dashboard: bloc colis" 1 1 || check "dashboard: bloc colis" 1 0
echo "$D" | grep -q '"livreurs"' && check "dashboard: bloc livreurs" 1 1 || check "dashboard: bloc livreurs" 1 0
echo "$D" | grep -q '"paiements"' && check "dashboard: bloc paiements" 1 1 || check "dashboard: bloc paiements" 1 0
check "GET /dashboard sans jeton -> 401" 401 "$(code "$BASE/dashboard")"

# ---------- Swagger ----------
check "GET /docs" 200 "$(code "$BASE/docs")"
check "GET /docs/json" 200 "$(code "$BASE/docs/json")"
check "spec OpenAPI valide" "3.0.3" \
  "$(json "$BASE/docs/json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).openapi))")"

# ---------- 404 & CORS ----------
check "GET /route/inconnue -> 404 JSON" 404 "$(code "$BASE/route/inconnue")"
check "GET /route/inconnue : corps JSON" "Ressource introuvable." \
  "$(json "$BASE/route/inconnue" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).message))")"
ACAO=$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:3000' "$BASE/health" | grep -i '^access-control-allow-origin' | tr -d '\r' | awk '{print $2}')
check "CORS: origine autorisée reflétée" "http://localhost:3000" "$ACAO"
ACAO2=$(curl -s -D - -o /dev/null -H 'Origin: http://evil.example' "$BASE/health" | grep -ci '^access-control-allow-origin' | tr -d '\r')
check "CORS: origine non autorisée sans ACAO" 0 "$ACAO2"
check "CORS: préflight OPTIONS -> 204" 204 \
  "$(code -X OPTIONS -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST' "$BASE/colis")"

echo
printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]
