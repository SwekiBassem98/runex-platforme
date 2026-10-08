#!/usr/bin/env bash
# Vérifie le cycle de vie des ramassages et les règles d'accès qui l'encadrent.
#
#   Expéditeur demande → exploitation confirme → livreur affecté → collecte →
#   clôture, avec rattachement effectif des colis.
#
# Les contrôles D1/D2/D4 sont des régressions : ils vérifient que les fuites
# constatées avant ce chantier sont bien fermées.
#
# `expect` compare une valeur, `check` exécute la commande à mesurer. Aucune
# n'est simulée : tout frappe l'API, et les identifiants sont résolus à chaud.
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0
declare -a RESULTS=()

expect() {
  local label="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS+1)); RESULTS+=("  OK   $expected  $label")
  else
    FAIL=$((FAIL+1))
    local detail=""
    detail=$(last_body | head -c 300 | tr '\n' ' ')
    { printf '\n[%s] attendu=%s obtenu=[%s]\n' "$label" "$expected" "$got"; last_body; } >> /tmp/ra_fail.log 2>/dev/null
    RESULTS+=("  FAIL attendu=$expected obtenu=[$got]  $label${detail:+  <- $detail}")
  fi
}

check() {
  local label="$1" expected="$2"; shift 2
  expect "$label" "$expected" "$("$@")"
}

# Chaque appel conserve sa dernière réponse brute : un échec affichant une
# valeur vide n'explique rien. Le corps est écrit dans un fichier propre à
# l'appel — les assertions s'exécutent dans une sous-commande `$(...)`, et un
# fichier partagé s'y fait écraser par un appel concurrent.
LAST_PATH=$(mktemp)
trap 'p=$(cat "$LAST_PATH" 2>/dev/null); [ -n "$p" ] && rm -f "$p"; rm -f "$LAST_PATH"' EXIT
remember() {
  # Chaque appel écrit dans son propre fichier : le précédent est supprimé
  # ici, faute de quoi la suite en laisse plusieurs milliers dans TMPDIR.
  local prev; prev=$(cat "$LAST_PATH" 2>/dev/null)
  [ -n "$prev" ] && [ -f "$prev" ] && rm -f "$prev"
  printf '%s' "$1" > "$LAST_PATH"
}
last_body() { local p; p=$(cat "$LAST_PATH" 2>/dev/null); [ -n "$p" ] && [ -s "$p" ] && cat "$p"; }

http() {
  local f; f=$(mktemp)
  { curl -s -w '\n%{http_code}' "$@" | tee "$f"; } | tail -1
  remember "$f"
}
call() { local f; f=$(mktemp); curl -s -w '\n%{http_code}' "$@" | tee "$f"; remember "$f"; }

pick() {
  local f; f=$(mktemp)
  tee "$f" >/dev/null
  remember "$f"
  node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const d=JSON.parse(s).data; console.log(eval(process.argv[1]))})" "$1" < "$f"
}
msg() { node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).message))"; }

tok() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.accessToken))"; }

q() { PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 \
  -U logixpress_user -d logixpress_db -t -A -c "$1"; }

JSON=(-H 'Content-Type: application/json')
ADMIN=$(tok admin@logixpress.tn 'Admin123!')
SHIPPER=$(tok expediteur@bluestar.tn 'Exp123!')

# Identifiants réels des deux livreurs : les affectations portent sur `Driver`,
# pas sur `User`, et la confusion des deux produirait un faux test.
D1=$(q "select id from \"Driver\" order by \"driverCode\" limit 1")
D2=$(q "select id from \"Driver\" order by \"driverCode\" offset 1 limit 1")
U1=$(q "select u.email from \"Driver\" d join \"User\" u on u.id=d.\"userId\" where d.id='$D1'")
U2=$(q "select u.email from \"Driver\" d join \"User\" u on u.id=d.\"userId\" where d.id='$D2'")
T1=$(tok "$U1" 'Liv123!')
T2=$(tok "$U2" 'Liv123!')
SHIPPERS=$(q "select string_agg(id::text, ',') from (select id from \"Shipper\" order by id) s")
# L'expéditeur de démonstration est rattaché à un expéditeur précis : c'est son
# périmètre « légitime ». Tout autre expéditeur sert de périmètre « étranger ».
OWN_SHIPPER_ID=$(q "select s.id from \"User\" u join \"ShipperUser\" su on su.\"userId\"=u.id join \"Shipper\" s on s.id=su.\"shipperId\" where u.email='expediteur@bluestar.tn' limit 1")
FOREIGN_SHIPPER_ID=$(echo "$SHIPPERS" | tr ',' '\n' | grep -v "^$OWN_SHIPPER_ID$" | head -1)
SHIPPER_ID=$OWN_SHIPPER_ID
echo "Expediteur légitime : $OWN_SHIPPER_ID"
echo "Expediteur étranger : $FOREIGN_SHIPPER_ID"

echo "Livreur 1 : $U1"
echo "Livreur 2 : $U2"
echo

# Une date distincte par scénario évite les collisions de créneau, qui sont
# volontairement refusées.
# macOS distingue `-v3d` (3 du mois) de `-v+3d` (+3 jours) : le signe est
# obligatoire, sinon les dates calculées tombent dans le passé.
DAY() {
  case "$1" in
    # GNU date (Linux/CI) puis BSD date (macOS).
    -*) date -d "$1 day" +%Y-%m-%d 2>/dev/null || date -v"$1"d +%Y-%m-%d ;;
    *)  date -d "+$1 day" +%Y-%m-%d 2>/dev/null || date -v"+$1d" +%Y-%m-%d ;;
  esac
}

# La suite consomme des créneaux et des colis : sans nettoyage, une seconde
# exécution tomberait sur les refus de chevauchement de la première et
# échouerait à tort. `cleanup` rend le suite relançable, comme les autres.
QA_TAG='QA Ramassage'

cleanup() {
  # `--keep` est passé par le trap : sans valeur par défaut, `set -u` ferait
  # échouer le script au moment précis où il faut menghapus.
  local keep="${1:-}" rdvs colis
  q "delete from \"Notification\" where \"relatedEntity\"='PICKUP' and \"relatedEntityId\" in (select id::text from \"PickupAppointment\" where \"contactPerson\"='$QA_TAG')" >/dev/null 2>&1
  # Le journal d'audit n'est pas nettoyé : il est immuable. Voir le commentaire
  # de `verify-business-flow.sh`.
  rdvs=$(q "delete from \"PickupAppointment\" where \"contactPerson\"='$QA_TAG'")
  q "delete from \"PackageTimeline\" where \"packageId\" in (select p.id from \"Package\" p join \"Customer\" c on c.id=p.\"customerId\" where c.\"fullName\"='$QA_TAG')" >/dev/null 2>&1
  # Le journal d'audit n'est pas nettoyé : il est immuable. Voir le commentaire
  # de `verify-business-flow.sh`.
  colis=$(q "delete from \"Package\" where \"customerId\" in (select id from \"Customer\" where \"fullName\"='$QA_TAG')")
  [ -n "$keep" ] || echo "Nettoyage effectué (${rdvs:-0} rendez-vous, ${colis:-0} colis)."
}
trap 'cleanup --keep' INT TERM

# Crée un ramassage et renvoie sa référence.
make_pickup() {
  local day="$1" start="$2" end="$3" shipper="${4:-$SHIPPER_ID}" token="${5:-$ADMIN}"
  curl -s -X POST "$BASE/ramassages" -H "Authorization: Bearer $token" "${JSON[@]}" \
    -d "{\"shipperId\":\"$shipper\",\"scheduledDate\":\"$day\",\"timeSlotStartHour\":$start,\"timeSlotEndHour\":$end,\"contactPerson\":\"$QA_TAG\",\"contactPhone\":\"99117788\"}" \
    | pick 'd.referenceNumber'
}

# Crée un colis CREE chez l'expéditeur et renvoie "id trackingNumber".
make_package() {
  local body id tr
  body=$(curl -s -X POST "$BASE/colis" -H "Authorization: Bearer $SHIPPER" "${JSON[@]}" \
    -d "{\"customerName\":\"$QA_TAG\",\"customerPhone\":\"991166$1\",\"address\":\"Route QA $1\",\"totalPrice\":$((10 + $1))}")
  id=$(echo "$body" | pick 'd.id')
  tr=$(echo "$body" | pick 'd.trackingNumber')
  echo "$id $tr"
}

# Les corps JSON sont construits ici, jamais en littéral `\"` à l'intérieur
# d'une substitution de commande. Dans `"$(f -d "{\"a\":1}")"`, bash perd
# l'équilibrage des guillemets : l'argument est coupé en un fragment par
# champ, la requête part autant de fois qu'il y a de champs, et l'API répond
# « Unexpected token ». Le symptôme imite une régression serveur ; il n'en
# est pas une. Passer le corps par variable supprime le piège.
pickup_body() { # expéditeur date début fin [téléphone]
  printf '{"shipperId":"%s","scheduledDate":"%s","timeSlotStartHour":%s,"timeSlotEndHour":%s,"contactPerson":"%s","contactPhone":"%s"}' \
    "$1" "$2" "$3" "$4" "$QA_TAG" "${5:-99117788}"
}
driver_body() { printf '{"driverId":"%s"}' "$1"; }
# `link_body attach|detach <id...>` : les colis sont rendus entre guillemets
# par la commande, jamais par la chaîne du script appelant.
link_body() {
  local verb="$1" out="" id
  shift
  for id in "$@"; do out="$out${out:+,}\"$id\""; done
  printf '{"%s":[%s]}' "$verb" "$out"
}

echo "1. Création et lecture"
P1=$(make_pickup "$(DAY 1)" 9 11)
expect "ramassage créé" "1" "$([ -n "$P1" ] && echo 1 || echo 0)"
echo "   → $P1"
ST=$(curl -s "$BASE/ramassages/$P1" -H "Authorization: Bearer $ADMIN" | pick 'd.status')
expect "statut initial = A_CONFIRMER" "A_CONFIRMER" "$ST"
expect "GET /:id câblé (auparavant code mort)" "200" \
  "$(http "$BASE/ramassages/$P1" -H "Authorization: Bearer $ADMIN")"
expect "GET /:id inconnu -> 404" "404" \
  "$(http "$BASE/ramassages/RDV-19700101-9999" -H "Authorization: Bearer $ADMIN")"

echo "2. Validation des entrées"
B_INVALIDE=$(pickup_body "$SHIPPER_ID" "pas-une-date" 9 11 99)
B_PASSEE=$(pickup_body "$SHIPPER_ID" "$(DAY -2)" 9 11 99)
B_INVERSE=$(pickup_body "$SHIPPER_ID" "$(DAY 2)" 15 10 99)
B_HORS_BORNES=$(pickup_body "$SHIPPER_ID" "$(DAY 2)" 7 99 99)
expect "date invalide -> 400" "400" \
  "$(http -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_INVALIDE")"
expect "date passée -> 400" "400" \
  "$(http -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_PASSEE")"
expect "créneau inversé -> 400" "400" \
  "$(http -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_INVERSE")"
expect "heures hors bornes -> 400" "400" \
  "$(http -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_HORS_BORNES")"

echo "3. Chevauchement et frontière de créneau"
D3=$(DAY 3)
B_O1=$(pickup_body "$SHIPPER_ID" "$D3" 9 12 99)
B_CHEVAUCHE=$(pickup_body "$SHIPPER_ID" "$D3" 10 13 99)
B_ADJACENT=$(pickup_body "$SHIPPER_ID" "$D3" 12 14 99)
O1=$(curl -s -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" \
  -d "$B_O1" | pick 'd.referenceNumber')
expect "créneau chevauchant -> 409" "409" \
  "$(http -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_CHEVAUCHE")"
expect "créneau adjacent (12→14) accepté -> 201" "201" \
  "$(http -X POST "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_ADJACENT")"

echo "4. Cycle de vie complet"
P2=$(make_pickup "$(DAY 4)" 8 10)
expect "confirmation" "EN_ATTENTE" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P2/confirm" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}' | pick 'd.status')"
expect "affectation d'un livreur inexistant -> 404" "404" \
  "$(http -X PATCH "$BASE/ramassages/$P2/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" \
    -d '{"driverId":"00000000-0000-4000-8000-000000000000"}')"
expect "affectation d'un UUID mal formé -> 400" "400" \
  "$(http -X PATCH "$BASE/ramassages/$P2/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" \
    -d '{"driverId":"pas-un-uuid"}')"
INACTIVE=$(q "select id from \"Driver\" where \"isActive\" = false limit 1")
if [ -n "$INACTIVE" ]; then
  B_INACTIF=$(driver_body "$INACTIVE")
  expect "affectation d'un livreur inactif -> 400" "400" \
    "$(http -X PATCH "$BASE/ramassages/$P2/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_INACTIF")"
else
  RESULTS+=("  N/A  aucun livreur inactif en base pour ce contrôle")
fi
B_D1=$(driver_body "$D1")
expect "affectation au livreur 1" "ASSIGNE" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P2/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" \
    -d "$B_D1" | pick 'd.status')"
expect "transition invalide (ASSIGNE → EN_ATTENTE) -> 409" "409" \
  "$(http -X PATCH "$BASE/ramassages/$P2/confirm" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}')"
expect "démarrage par le livreur titulaire" "EN_COURS" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P2/start" -H "Authorization: Bearer $T1" "${JSON[@]}" -d '{}' | pick 'd.status')"
expect "clôture par le livreur titulaire" "EFFECTUE" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P2/complete" -H "Authorization: Bearer $T1" "${JSON[@]}" -d '{}' | pick 'd.status')"
expect "clôture répétée -> 409" "409" \
  "$(http -X PATCH "$BASE/ramassages/$P2/complete" -H "Authorization: Bearer $T1" "${JSON[@]}" -d '{}')"
expect "colis non rattachés après clôture modifiables -> 409" "409" \
  "$(http -X PATCH "$BASE/ramassages/$P2/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" -d '{"attach":[]}')"

echo "5. D1 — un livreur ne peut pas piloter le ramassage d'un autre"
P3=$(make_pickup "$(DAY 5)" 8 10)
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P3/confirm" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}'
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P3/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_D1"
expect "livreur 2 ne démarre pas celui du livreur 1 -> 403" "403" \
  "$(http -X PATCH "$BASE/ramassages/$P3/start" -H "Authorization: Bearer $T2" "${JSON[@]}" -d '{}')"
expect "livreur 2 ne le clôt pas non plus -> 403" "403" \
  "$(http -X PATCH "$BASE/ramassages/$P3/complete" -H "Authorization: Bearer $T2" "${JSON[@]}" -d '{}')"
expect "livreur 2 ne rattache pas de colis -> 403" "403" \
  "$(http -X PATCH "$BASE/ramassages/$P3/packages" -H "Authorization: Bearer $T2" "${JSON[@]}" -d '{"attach":[]}')"
expect "le ramassage est resté ASSIGNE" "ASSIGNE" \
  "$(curl -s "$BASE/ramassages/$P3" -H "Authorization: Bearer $ADMIN" | pick 'd.status')"
expect "le livreur titulaire peut encore démarrer -> 200" "200" \
  "$(http -X PATCH "$BASE/ramassages/$P3/start" -H "Authorization: Bearer $T1" "${JSON[@]}" -d '{}')"

echo "6. D2 — périmètre de lecture"
N1=$(curl -s "$BASE/ramassages" -H "Authorization: Bearer $T1" | pick 'd.length')
N2=$(curl -s "$BASE/ramassages" -H "Authorization: Bearer $T2" | pick 'd.length')
A=$(curl -s "$BASE/ramassages" -H "Authorization: Bearer $ADMIN" | pick 'd.length')
echo "   livreur 1=$N1  livreur 2=$N2  administration=$A"
expect "le livreur 2 ne voit pas les rendez-vous du livreur 1" "1" \
  "$([ "$N2" -lt "$N1" ] && echo 1 || echo 0)"
expect "aucun rendez-vous n'est partagé entre les deux livreurs" "1" \
  "$(node -e "
    const a=JSON.parse(process.argv[1]).data.map(p=>p.id);
    const b=JSON.parse(process.argv[2]).data.map(p=>p.id);
    console.log(a.some(x=>b.includes(x))?0:1)" \
    "$(curl -s "$BASE/ramassages" -H "Authorization: Bearer $T1")" \
    "$(curl -s "$BASE/ramassages" -H "Authorization: Bearer $T2")")"
expect "l'administration voit le parc complet" "1" \
  "$([ "$A" -ge "$N1" ] && [ "$A" -ge "$N2" ] && echo 1 || echo 0)"
expect "l'expéditeur ne voit que ses propres demandes" "1" \
  "$(curl -s "$BASE/ramassages" -H "Authorization: Bearer $SHIPPER" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const list=JSON.parse(s).data;
      const ids=new Set(list.map(p=>p.shipperId));
      console.log(ids.size<=1?1:0)})")"
expect "GET /ramassages/driver/active par un livreur -> 200" "200" \
  "$(http "$BASE/ramassages/driver/active" -H "Authorization: Bearer $T1")"
expect "GET /ramassages/driver/active par un admin -> 403" "403" \
  "$(http "$BASE/ramassages/driver/active" -H "Authorization: Bearer $ADMIN")"

echo "7. D4 — un expéditeur ne peut agir que sur son propre ramassage"
# Le rendez-vous appartient à un expéditeur tiers : l'utilisateur BlueStar ne
# doit ni l'annuler, ni le confirmer, ni même le lire.
PF=$(make_pickup "$(DAY 6)" 8 10 "$FOREIGN_SHIPPER_ID" "$ADMIN")
expect "lecture du ramassage d'un autre expéditeur -> 404" "404" \
  "$(http "$BASE/ramassages/$PF" -H "Authorization: Bearer $SHIPPER")"
expect "annulation du ramassage d'un autre expéditeur -> 403" "403" \
  "$(http -X PATCH "$BASE/ramassages/$PF/cancel" -H "Authorization: Bearer $SHIPPER" "${JSON[@]}" -d '{}')"
expect "confirmation du ramassage d'un autre expéditeur -> 403" "403" \
  "$(http -X PATCH "$BASE/ramassages/$PF/confirm" -H "Authorization: Bearer $SHIPPER" "${JSON[@]}" -d '{}')"
expect "annulation par l'exploitation (pouvoir administratif) -> 200" "200" \
  "$(http -X PATCH "$BASE/ramassages/$PF/cancel" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}')"
PS=$(make_pickup "$(DAY 7)" 8 10)
expect "l'expéditeur annule le sien -> 200" "200" \
  "$(http -X PATCH "$BASE/ramassages/$PS/cancel" -H "Authorization: Bearer $SHIPPER" "${JSON[@]}" -d '{}')"
# Le contrôleur force l'expéditeur de la requête à son propre périmètre : la
# propriété qui compte n'est pas le refus, c'est que le rendez-vous créé ne
# peut pas appartenir à un tiers.
D12=$(DAY 12)
B_PF2=$(pickup_body "$FOREIGN_SHIPPER_ID" "$D12" 8 10 99)
PF2=$(curl -s -X POST "$BASE/ramassages" -H "Authorization: Bearer $SHIPPER" "${JSON[@]}" \
  -d "$B_PF2" | pick 'd.referenceNumber')
expect "la demande reste rattachée à son propre expéditeur" "1" \
  "$([ -n "$PF2" ] && \
     [ "$(curl -s "$BASE/ramassages/$PF2" -H "Authorization: Bearer $ADMIN" | pick 'd.shipperId')" = "$OWN_SHIPPER_ID" ] && echo 1 || echo 0)"

echo "8. D3 — la quantité collectée découle des colis rattachés"
P6=$(make_pickup "$(DAY 8)" 8 10)
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P6/confirm" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}'
B_D1=$(driver_body "$D1")
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P6/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_D1"
read -r PKG1 TR1 <<< "$(make_package 1)"
read -r PKG2 TR2 <<< "$(make_package 2)"
read -r PKG3 TR3 <<< "$(make_package 3)"

B_2=$(link_body attach "$PKG1" "$PKG2")
B_3=$(link_body attach "$PKG3")
B_1=$(link_body attach "$PKG1")
B_DETACH=$(link_body detach "$PKG1")
expect "0 colis au départ" "0" \
  "$(curl -s "$BASE/ramassages/$P6" -H "Authorization: Bearer $ADMIN" | pick 'd.actualPickedCount')"
expect "rattachement de 2 colis" "2" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P6/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d "$B_2" | pick 'd.actualPickedCount')"
expect "rattachement du 3e colis" "3" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P6/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d "$B_3" | pick 'd.actualPickedCount')"
expect "le même colis rattaché deux fois reste compté une fois" "3" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P6/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d "$B_1" | pick 'd.actualPickedCount')"
expect "détachement d'un colis" "2" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P6/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d "$B_DETACH" | pick 'd.actualPickedCount')"
expect "colis inexistant -> 404" "404" \
  "$(http -X PATCH "$BASE/ramassages/$P6/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d '{"attach":["00000000-0000-4000-8000-000000000000"]}')"
expect "identifiant mal formé -> 400" "400" \
  "$(http -X PATCH "$BASE/ramassages/$P6/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d '{"attach":["pas-un-uuid"]}')"

# PKG3 est rattaché à P6 : le rattacher à un AUTRE ramassage ouvert doit être
# refusé. C'est P7 qui est en concurrence, pas P6 — demander 409 sur P6
# testerait un simple rejeu idempotent.
P7=$(make_pickup "$(DAY 9)" 8 10)
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P7/confirm" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}'
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P7/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_D1"
expect "colis déjà rattaché à un autre ramassage -> 409" "409" \
  "$(http -X PATCH "$BASE/ramassages/$P7/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" -d "$B_3")"

# P6 porte donc PKG2 et PKG3 : deux colis, pour une estimation d'un seul.
echo "   le client ne peut pas déclarer une quantité :"
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P6/start" -H "Authorization: Bearer $T1" "${JSON[@]}" -d '{}'
expect "clôture avec un nombre imposé (15) sans effet" "1" \
  "$(curl -s -X PATCH "$BASE/ramassages/$P6/complete" -H "Authorization: Bearer $T1" "${JSON[@]}" \
    -d '{"actualPickedCount":15}' | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const d=JSON.parse(s).data; console.log(d.actualPickedCount===2?1:0)})")"
expect "quantité réellement collectée = 2 (colis rattachés)" "2" \
  "$(curl -s "$BASE/ramassages/$P6" -H "Authorization: Bearer $ADMIN" | pick 'd.actualPickedCount')"
expect "l'estimation annoncée est préservée" "1" \
  "$(curl -s "$BASE/ramassages/$P6" -H "Authorization: Bearer $ADMIN" | pick 'd.packageEstimate')"
expect "l'écart estimation/réel est conservé tel quel (-1)" "-1" \
  "$(curl -s "$BASE/ramassages/$P6" -H "Authorization: Bearer $ADMIN" | pick 'd.quantityDiscrepancy')"
expect "les 2 colis rattachés sont listés dans le détail" "2" \
  "$(curl -s "$BASE/ramassages/$P6" -H "Authorization: Bearer $ADMIN" | pick 'd.packages.length')"
expect "un colis rattaché n'est pas marqué LIVRE" "1" \
  "$(curl -s "$BASE/colis/$PKG2" -H "Authorization: Bearer $ADMIN" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      console.log(JSON.parse(s).data.status!=='LIVRE'?1:0)})")"

echo "9. Annulation : les colis rattachés sont libérés"
P8=$(make_pickup "$(DAY 10)" 8 10)
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P8/confirm" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}'
B_D1=$(driver_body "$D1")
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P8/assign" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d "$B_D1"
read -r PKG4 TR4 <<< "$(make_package 4)"
B_PKG4=$(link_body attach "$PKG4")
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P8/packages" -H "Authorization: Bearer $T1" "${JSON[@]}" -d "$B_PKG4"
expect "1 colis rattaché" "1" \
  "$(curl -s "$BASE/ramassages/$P8" -H "Authorization: Bearer $ADMIN" | pick 'd.actualPickedCount')"
curl -s -o /dev/null -X PATCH "$BASE/ramassages/$P8/cancel" -H "Authorization: Bearer $ADMIN" "${JSON[@]}" -d '{}'
expect "plus aucun colis rattaché après annulation" "0" \
  "$(curl -s "$BASE/ramassages/$P8" -H "Authorization: Bearer $ADMIN" | pick 'd.actualPickedCount')"
expect "le colis libéré redevient CREE" "1" \
  "$(curl -s "$BASE/colis/$PKG4" -H "Authorization: Bearer $ADMIN" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      console.log(JSON.parse(s).data.status==='CREE'?1:0)})")"

echo "10. Notifications"
NOTIF=$(q "select count(*) from \"Notification\" n join \"PickupAppointment\" p on p.id::text = n.\"relatedEntityId\" where n.type='RAMASSAGE_DEMANDE'")
expect "notification RAMASSAGE_DEMANDE émise" "1" "$([ "$NOTIF" -gt 0 ] && echo 1 || echo 0)"

printf '%s\n' "${RESULTS[@]}"
echo
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"
cleanup
[ "$FAIL" -eq 0 ]
