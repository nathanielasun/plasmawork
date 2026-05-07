#!/usr/bin/env bash
#
# Live WORM/S3 Object-Lock probe entrypoint.
#
# This lane requires a dedicated deployment probe bucket with versioning and
# Object Lock enabled. It is intentionally separate from the default security
# gate because cloud identity is deployment-specific.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/secure_core"

required=(
  PLASMAWORK_ANCHOR_LIVE_PROBES
  PLASMAWORK_ANCHOR_S3_BUCKET
  PLASMAWORK_ANCHOR_S3_REGION
  PLASMAWORK_ANCHOR_RETENTION_DAYS
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[security:worm] ${name} is required for WORM live probes." >&2
    exit 1
  fi
done

if [[ "${PLASMAWORK_ANCHOR_LIVE_PROBES}" != "1" ]]; then
  echo "[security:worm] set PLASMAWORK_ANCHOR_LIVE_PROBES=1 to confirm intent." >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "[security:worm] $PKG_DIR/node_modules missing — run npm ci first." >&2
  exit 1
fi

cd "$PKG_DIR"

echo "[security:worm] running WORM/Object-Lock live probes..."
npx vitest run test/security/wormLive.test.ts
