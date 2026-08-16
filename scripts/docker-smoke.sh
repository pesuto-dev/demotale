#!/usr/bin/env bash
# Pack demotale and prove a one-package install works in a clean Linux container.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "demotale smoke: docker is not installed or not on PATH." >&2
  exit 1
fi

echo "demotale smoke: building package…"
npm run build

PACK_DIR="$ROOT/pack"
rm -rf "$PACK_DIR"
mkdir -p "$PACK_DIR"
# npm pack prints the tarball name on the last line.
TGZ="$(npm pack --pack-destination "$PACK_DIR" | tail -n 1)"
echo "demotale smoke: packed $TGZ"

echo "demotale smoke: building and running clean Node 22 container…"
docker build \
  -f "$ROOT/scripts/smoke-install.Dockerfile" \
  -t demotale-install-smoke \
  --build-arg "TGZ=$TGZ" \
  "$ROOT"

echo "demotale smoke: ok (doctor + init --agent + check on examples/basic)."
