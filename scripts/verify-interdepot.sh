#!/usr/bin/env bash
# Vérifie le transfert inter-dépôts de bout en bout : ouverture, expédition,
# réception conforme, puis réception en anomalie. Le compte administrateur
# n'ayant pas de dépôt d'origine, les colis sont créés par l'expéditeur puis
# acceptés au dépôt comme dans le flux réel.
#
# `check` exécute lui-même la commande à mesurer (check libellé attendu cmd…),
# et non une substitution de commande : une substitution imbriquée contenant des
# guillemets et des retours de ligne fait parfois exécuter la commande plusieurs
# fois à bash, ce qui produit des résultats faux sans aucun message d'erreur.
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0
declare -a RESULTS=()

expect() {
  local label="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS+1)); RESULTS+=("  OK   $expected  $label")
  else
    FAIL=$((FAIL+1)); RESULTS+=("  FAIL attendu=$expected obtenu=[$got]  $label")
  fi
}

# Variante qui exécute la commande à mesurer. Une substitution de commande
# imbriquée contenant des guillemets et des retours de ligne fait parfois
# exécuter la commande plusieurs fois à bash, ce qui produit des résultats
# faux sans aucun message d'erreur : ici c'est `check` qui exécute, une fois.
check() {
  local label="$1" expected="$2"; shift 2
  expect "$label" "$expected" "$("$@")"
}

note() { RESULTS+=("  N/A  $1"); }

http() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# Corps + code HTTP en une fois, séparés par un saut de ligne.
call() { curl -s -w '\n%{http_code}' "$@"; }

tok() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.accessToken))"; }

# Évalue une expression JavaScript sur le champ `data` d'une réponse JSON.
pick() { node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const d=JSON.parse(s).data; console.log($1)})"; }

# Aucun endpoint n'expose encore le référentiel des dépôts — que cette suite
# sert justement à valider — d'où l'accès direct à PostgreSQL.
psql_q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 \
  -U logixpress_user -d logixpress_db -t -A -c "$1"; }

A=(-H "Authorization: Bearer $(tok admin@logixpress.tn 'Admin123!')")
E=(-H "Authorization: Bearer $(tok expediteur@bluestar.tn 'Exp123!')")
JSON=(-H 'Content-Type: application/json')

HUB=$(psql_q "select id from \"Deposit\" where \"isMainHub\" = true")
SOU=$(psql_q "select id from \"Deposit\" where name ilike '%Sousse%' limit 1")
echo "Dépôt de départ : $HUB"
echo "Dépôt d'arrivée : $SOU"

# Un colis prêt à partir : créé par l'expéditeur puis scanné au dépôt.
make_package() {
  local label="$1" price="$2" body id tr
  body=$(curl -s -X POST "$BASE/colis" "${E[@]}" "${JSON[@]}" \
    -d "{\"customerName\":\"$label\",\"customerPhone\":\"9911000$3\",\"address\":\"Route $label\",\"totalPrice\":$price}")
  id=$(echo "$body" | pick 'd.id')
  tr=$(echo "$body" | pick 'd.trackingNumber')
  curl -s -o /dev/null -X POST "$BASE/warehouse/scan-accept" "${A[@]}" "${JSON[@]}" \
    -d "{\"barcode\":\"$tr\"}"
  echo "$id"
}

ID1=$(make_package "Transit A" 20 1)
ID2=$(make_package "Transit B" 40 2)
echo "Colis prêts au dépôt : $ID1 $ID2"

echo
echo "1. Ouverture du transfert"
TN=$(curl -s -X POST "$BASE/inter-depots" "${A[@]}" "${JSON[@]}" \
  -d "{\"sourceDepositId\":\"$HUB\",\"destinationDepositId\":\"$SOU\",\"packageIds\":[\"$ID1\",\"$ID2\"],\"sealNumber\":\"PLOMB-4471\"}" \
  | pick 'd.transferNumber')
if [ -n "$TN" ]; then expect "transfert créé" "1" "1"; else expect "transfert créé" "1" "0"; fi
echo "   → $TN"

echo "2. Les colis quittent le dépôt d'origine"
check "dépôt du colis 1 vidé" "aucun" \
  bash -c "curl -s '${A[0]}' '${A[1]}' '$BASE/colis/$ID1' | node -e \"
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(d.currentDepositId==null?'aucun':d.currentDepositId)})\""
check "localisation = en transfert" "1" \
  bash -c "curl -s '${A[0]}' '${A[1]}' '$BASE/colis/$ID1' | node -e \"
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(String(d.currentLocation).startsWith('En transfert')?1:0)})\""

echo "3. Garde-fous à l'ouverture"
check "même dépôt en source et destination refusé" 400 \
  http -X POST "$BASE/inter-depots" "${A[@]}" "${JSON[@]}" \
  -d "{\"sourceDepositId\":\"$HUB\",\"destinationDepositId\":\"$HUB\"}"

ASSIGNED=$(psql_q "select p.id from \"Package\" p join \"PackageTimeline\" t on t.\"packageId\"=p.id where t.title like '%affecté%' and p.\"currentDepositId\"='$HUB' limit 1")
if [ -n "$ASSIGNED" ]; then
  check "colis déjà en tournée refusé" 409 \
    http -X POST "$BASE/inter-depots" "${A[@]}" "${JSON[@]}" \
    -d "{\"sourceDepositId\":\"$HUB\",\"destinationDepositId\":\"$SOU\",\"packageIds\":[\"$ASSIGNED\"]}"
else
  note "aucun colis affecté au hub pour ce contrôle"
fi

echo "4. Expédition"
ST=$(curl -s -X POST "$BASE/inter-depots/$TN/dispatch" "${A[@]}" "${JSON[@]}" -d '{}' | pick 'd.status')
expect "statut = EN_TRANSIT" "EN_TRANSIT" "$ST"

echo "5. Réception conforme"
ST=$(curl -s -X POST "$BASE/inter-depots/$TN/receive" "${A[@]}" "${JSON[@]}" -d '{"receivedPackages":2}' | pick 'd.status')
expect "statut = RECEPTIONNE_CONFORME" "RECEPTIONNE_CONFORME" "$ST"
check "colis 1 arrivé au dépôt de destination" "1" \
  bash -c "curl -s '${A[0]}' '${A[1]}' '$BASE/colis/$ID1' | node -e \"
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(d.currentDepositId==='$SOU'?1:0)})\""
check "colis 2 n'est plus en transfert" "1" \
  bash -c "curl -s '${A[0]}' '${A[1]}' '$BASE/colis/$ID2' | node -e \"
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(String(d.currentLocation).includes('transfert')?0:1)})\""

echo "6. Un transfert terminé ne bouge plus"
check "seconde réception refusée" 409 \
  http -X POST "$BASE/inter-depots/$TN/receive" "${A[@]}" "${JSON[@]}" -d '{"receivedPackages":2}'
check "seconde expédition refusée" 409 \
  http -X POST "$BASE/inter-depots/$TN/dispatch" "${A[@]}" "${JSON[@]}" -d '{}'

echo "7. Réception partielle : l'écart est enregistré, pas bloqué"
ID3=$(make_package "Transit C" 50 3)
TN2=$(curl -s -X POST "$BASE/inter-depots" "${A[@]}" "${JSON[@]}" \
  -d "{\"sourceDepositId\":\"$HUB\",\"destinationDepositId\":\"$SOU\",\"packageIds\":[\"$ID3\"]}" \
  | pick 'd.transferNumber')
curl -s -o /dev/null -X POST "$BASE/inter-depots/$TN2/dispatch" "${A[@]}" "${JSON[@]}" -d '{}'
echo "   réception de 0 colis sur 1 expédié :"
OUT=$(call -X POST "$BASE/inter-depots/$TN2/receive" "${A[@]}" "${JSON[@]}" -d '{"receivedPackages":0}')
CODE_RECV=$(echo "$OUT" | tail -1)
RES=$(echo "$OUT" | sed '$d')
expect "la réception est enregistrée" "200" "$CODE_RECV"
ST=$(echo "$RES" | pick 'd.status')
expect "statut = RECEPTIONNE_ANOMALIE" "RECEPTIONNE_ANOMALIE" "$ST"
DISC=$(echo "$RES" | pick 'd.discrepancy')
expect "l'écart est de 1 colis" "1" "$DISC"
check "le colis manquant n'est pas installé à l'arrivée" "1" \
  bash -c "curl -s '${A[0]}' '${A[1]}' '$BASE/colis/$ID3' | node -e \"
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(d.currentDepositId==null?1:0)})\""
check "il reste rattaché au transfert, à investiguer" "1" \
  bash -c "curl -s '${A[0]}' '${A[1]}' '$BASE/colis/$ID3' | node -e \"
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(String(d.currentLocation).includes('transfert')?1:0)})\""
check "un transfert en anomalie ne se rejoue pas" 409 \
  http -X POST "$BASE/inter-depots/$TN2/receive" "${A[@]}" "${JSON[@]}" -d '{"receivedPackages":0}'

echo "8. Historique reconstruit"
STEPS=$(curl -s "${A[@]}" "$BASE/inter-depots/$TN" | pick 'd.timeline.length')
expect "3 étapes (préparation, expédition, réception)" "3" "$STEPS"

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]
