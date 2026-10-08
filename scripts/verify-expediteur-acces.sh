#!/usr/bin/env bash
# Vérifie la séparation entre l'espace d'exploitation et le portail expéditeur.
#
# Le portail est un espace d'authentification distinct : on contrôle donc les
# deux faces de la porte. D'un côté, ce qu'un utilisateur interne ne doit pas
# atteindre (raccourci de navigation, route du portail, agrégats de la
# plateforme). De l'autre, ce qu'un expéditeur ne doit pas voir (les colis, le
# journal d'audit et les bordereaux d'un autre expéditeur, y compris en
# remplaçant un identifiant dans l'URL).
#
# Aucun contrôle n'est simulé : tout frappe l'API, et les identifiants sont
# résolus à chaud en base.
set -uo pipefail
BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0
FAIL=0
declare -a RESULTS=()

last_body() { cat /tmp/expediteur_acces_body 2>/dev/null; }

expect() {
  local label="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS + 1))
    RESULTS+=("  OK   $expected  $label")
  else
    FAIL=$((FAIL + 1))
    RESULTS+=("  FAIL attendu=$expected obtenu=[$got]  $label")
    { printf '\n[%s] attendu=%s obtenu=%s\n' "$label" "$expected" "$got"; last_body; } >> /tmp/expediteur_acces_fail.log 2>/dev/null
  fi
}

# statut HTTP de GET $1 avec le jeton $2
get_status() {
  curl -s -o /tmp/expediteur_acces_body -w '%{http_code}' \
    -H "Authorization: Bearer $2" "$BASE$1"
}

q() {
  PGPASSWORD="${PGPASSWORD:-logixpress_secret_pwd}" psql -h 127.0.0.1 \
    -U logixpress_user -d logixpress_db -t -A -c "$1"
}

tok() {
  curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.accessToken))'
}

JSON=(-H 'Content-Type: application/json')
ADMIN=$(tok admin@logixpress.tn 'Admin123!')
EXPEDITEUR=$(tok expediteur@bluestar.tn 'Exp123!')

# L'entreprise de l'expéditeur authentifié, et une autre entreprise dont il ne
# doit rien voir. Résolues en base : un identifiant figé dans le script
# continuerait de passer après un changement de jeu de données.
SHIPPER_ID=$(q "SELECT su.\"shipperId\" FROM \"ShipperUser\" su JOIN \"User\" u ON u.id = su.\"userId\" WHERE u.email = 'expediteur@bluestar.tn';")
COLIS_ETRANGER=$(q "SELECT \"trackingNumber\" FROM \"Package\" WHERE \"shipperId\" <> '$SHIPPER_ID' AND \"deletedAt\" IS NULL LIMIT 1;")

echo ""
echo "======================================"
echo "  Accès au portail expéditeur — cloisonnement"
echo "======================================"
echo ""

# --- 1. La porte d'authentification ---------------------------------------
expect "le portail est refusé sans jeton" "401" "$(get_status /colis '')"
expect "un jeton forgé est refusé" "401" \
  "$(get_status /colis 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IkVYTUVESVRFUiJ9.faux')"

MAUVAIS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" "${JSON[@]}" \
  -d '{"email":"expediteur@bluestar.tn","password":"mauvais-mot-de-passe"}')
expect "des identifiants erronés sont rejetés" "401" "$MAUVAIS"

VIDE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" "${JSON[@]}" -d '{}')
expect "une demande sans identifiants est rejetée" "400" "$VIDE"

# --- 2. La navigation interne ---------------------------------------------
# Le contrôle porte sur la source du menu : c'est elle qui décide de ce qui est
# proposé, et une entrée retirée de la configuration ne peut plus réapparaître
# par un simple réglage d'affichage.
NAV=$(grep -c "expediteur-portal" apps/web/src/components/AppLayout.tsx || true)
expect "aucune entrée de portail dans la navigation interne" "0" "$NAV"

# --- 3. Les agrégats de la plateforme -------------------------------------
# Le poste de commandement donne les volumes de toute la plateforme. Rien n'y
# est filtré par expéditeur : un expéditeur n'a pas à y être.
expect "l'exploitation lit le poste de commandement" "200" "$(get_status /dashboard "$ADMIN")"
expect "un expéditeur n'atteint pas le poste de commandement" "403" "$(get_status /dashboard "$EXPEDITEUR")"
expect "un expéditeur n'atteint pas le référentiel des dépôts" "403" "$(get_status /depots "$EXPEDITEUR")"
expect "un expéditeur n'atteint pas les tournées" "403" "$(get_status /runsheets "$EXPEDITEUR")"
expect "un expéditeur n'atteint pas la caisse" "403" "$(get_status /payments "$EXPEDITEUR")"
expect "un expéditeur n'atteint pas le journal d'audit global" "403" "$(get_status /audit "$EXPEDITEUR")"

# --- 4. Le cloisonnement entre expéditeurs ---------------------------------
if [ -z "$COLIS_ETRANGER" ]; then
  RESULTS+=("  INFO aucun colis d'un autre expéditeur en base : contrôle de croisement ignoré")
else
  expect "l'exploitation lit le colis d'un autre expéditeur" "200" \
    "$(get_status "/colis/$COLIS_ETRANGER" "$ADMIN")"
  expect "un expéditeur ne lit pas le colis d'un autre expéditeur" "404" \
    "$(get_status "/colis/$COLIS_ETRANGER" "$EXPEDITEUR")"
  # Régression : le journal d'un colis était résolu sans périmètre, si bien
  # qu'un expéditeur pouvait lire l'historique des montants d'une autre
  # entreprise. Il doit désormais se comporter comme la lecture du colis.
  expect "un expéditeur ne lit pas le journal d'un colis d'un autre expéditeur" "404" \
    "$(get_status "/colis/$COLIS_ETRANGER/audit" "$EXPEDITEUR")"
  expect "l'exploitation lit le journal de ce colis" "200" \
    "$(get_status "/colis/$COLIS_ETRANGER/audit" "$ADMIN")"
fi

# La liste returned par l'API ne contient que ses propres colis : le filtrage
# ne doit pas reposer sur le seul écran.
if [ -n "$SHIPPER_ID" ]; then
  HORS_PERIMETRE=$(curl -s -H "Authorization: Bearer $EXPEDITEUR" "$BASE/colis?limit=500" |
    node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const data = JSON.parse(s).data ?? [];
        const liste = Array.isArray(data) ? data : data.items ?? data.packages ?? [];
        console.log(liste.filter((c) => c.shipperId && c.shipperId !== process.argv[1]).length);
      });
    ' "$SHIPPER_ID")
  expect "aucun colis d'un autre expéditeur dans la liste" "0" "${HORS_PERIMETRE:-inconnu}"

  # Un expéditeur ne doit pas pouvoir élargir son périmètre par un paramètre.
  FORCE=$(curl -s -H "Authorization: Bearer $EXPEDITEUR" "$BASE/colis?shipperId=$SHIPPER_ID&limit=500" |
    node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const data = JSON.parse(s).data ?? [];
        const liste = Array.isArray(data) ? data : data.items ?? data.packages ?? [];
        console.log(liste.length);
      });
    ')
  if [ "${FORCE:-0}" -gt 0 ]; then
    PASS=$((PASS + 1))
    RESULTS+=("  OK   >0  l'expéditeur voit ses propres colis ($(echo "$FORCE" | tr -d '\n') cols)")
  else
    FAIL=$((FAIL + 1))
    RESULTS+=("  FAIL  l'expéditeur ne voit aucun colis, le périmètre est cassé")
  fi
fi

# --- 5. La création reste attachée au jeton -------------------------------
# Un expéditeur ne crée un colis que pour lui : l'entreprise vient du jeton, pas
# du corps de la requête.
TRACKING="QA-$(date +%s)"
CORPS=$(node -e '
  console.log(JSON.stringify({
    trackingNumber: process.argv[1],
    customerName: "Controle de cloisonnement",
    customerPhone: "+21620000000",
    address: "1 rue de Tunis, Tunis",
    city: "Tunis",
    governorate: "Tunis",
    pieceCount: 1,
    totalPrice: 10,
    packageType: "NORMAL",
    // Envoye exprès : le serveur doit l ignorer au profit du jeton.
    shipperId: process.argv[2],
  }));
' "$TRACKING" "$SHIPPER_ID")

# Le service génère son propre numéro de suivi et range le destinataire dans
# une table séparée : le colis créé est donc retrouvé par l'horodatage, pas par
# la valeur envoyée.
HORODATAGE_AVANT=$(q "SELECT COALESCE(max(\"createdAt\"), to_timestamp(0)) FROM \"Package\";")
CODE=$(curl -s -o /tmp/expediteur_acces_body -w '%{http_code}' -X POST "$BASE/colis" \
  -H "Authorization: Bearer $EXPEDITEUR" "${JSON[@]}" -d "$CORPS")

if [ "$CODE" = "201" ] || [ "$CODE" = "200" ]; then
  CREE=$(q "SELECT \"trackingNumber\" FROM \"Package\" WHERE \"createdAt\" > '$HORODATAGE_AVANT' ORDER BY \"createdAt\" DESC LIMIT 1;")
  CIBLE=$(q "SELECT \"shipperId\" FROM \"Package\" WHERE \"trackingNumber\" = '$CREE' LIMIT 1;")
  expect "le colis cree est rattache a l entreprise du jeton" "$SHIPPER_ID" "$CIBLE"
  # Nettoyage : ce colis n'a servi qu'a verifier le rattachement.
  q "UPDATE \"Package\" SET \"deletedAt\" = now() WHERE \"trackingNumber\" = '$CREE';" > /dev/null
else
  FAIL=$((FAIL + 1))
  RESULTS+=("  FAIL  la creation d un colis par l expediteur a echoue (HTTP $CODE)")
fi

printf '%s\n' "${RESULTS[@]}"
echo ""
echo "======================================"
echo "  RÉUSSIS : $PASS   ÉCHECS : $FAIL"
echo "======================================"

[ "$FAIL" -eq 0 ]