#!/bin/sh
# Fresh open data of the Territory Development Fund (реформажкх.рф/opendata):
# the registry of management companies and the houses of the capital repair
# programme (КР 1.1) of the regions in REGIONS. Downloaded with fetch-ru.sh —
# directly or through the tunnel — and loaded with the registry import.
#
#   scripts/update-registries.sh            # on the server, from /opt/smart-home
#   REGIONS="66 16" scripts/update-registries.sh
set -eu

cd "$(dirname "$0")/.."
data="${REGISTRY_DIR:-/opt/smart-home-data}"
base='https://xn--80adsazqn.xn--p1aee.xn--p1ai/opendata/export'
compose='docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml'
regions="${REGIONS:-66 74 54 16 59}"

# Export numbers on the portal: 1 is the registry of companies, the others
# are КР 1.1 by region. Look them up on the portal if a region is missing.
export_id() {
  case "$1" in
    companies) echo 1 ;;
    66) echo 190 ;;  # Свердловская область
    74) echo 188 ;;  # Челябинская область
    54) echo 202 ;;  # Новосибирская область
    16) echo 220 ;;  # Республика Татарстан
    59) echo 235 ;;  # Пермский край
    *) echo '' ;;
  esac
}

mkdir -p "$data"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

load() {
  kind="$1"; id="$2"; name="$3"
  zip="$work/$name.zip"
  scripts/fetch-ru.sh "$base/$id" "$zip"
  unzip -o -q "$zip" -d "$work/$name"
  csv=$(find "$work/$name" -name '*.csv' | head -1)
  [ -n "$csv" ] || { echo "no CSV in $name" >&2; return 1; }
  cp "$csv" "$data/"
  file=$(basename "$csv")
  echo "import $kind: $file"
  $compose run --rm -T -v "$data:/data:ro" backend node apps/backend/dist/registry/import.js "$kind" "/data/$file"
}

load companies "$(export_id companies)" companies
for region in $regions; do
  id=$(export_id "$region")
  if [ -z "$id" ]; then echo "skip region $region: unknown export number" >&2; continue; fi
  load houses "$id" "kr1_1-$region"
done
echo "Registries updated."
