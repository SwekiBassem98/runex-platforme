#!/usr/bin/env bash
# Le contrôle inter-dépôts a été réécrit pour le cycle actuel
# (CRE → PREPARE → EN_TRANSIT → RECU / ANNULE, conducteur obligatoire) :
# voir qa/qa-interdepot-26.mjs. Ce script reste comme point d'entrée.
set -euo pipefail
cd "$(dirname "$0")/.."
QA_BASE_URL="${BASE:-http://localhost:4000/api/v1}" exec node qa/qa-interdepot-26.mjs
