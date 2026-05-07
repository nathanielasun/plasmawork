#!/usr/bin/env bash
#
# Live gVisor/runsc probe entrypoint.
#
# The caller must provide a runner with a working runsc binary. This script
# fails closed when PLASMAWORK_RUNSC_PROBES is not explicitly enabled or when
# runsc is absent, so a live-probe CI lane cannot silently downgrade to skips.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/secure_core"

if [[ "${PLASMAWORK_RUNSC_PROBES:-}" != "1" ]]; then
  echo "[security:runsc] set PLASMAWORK_RUNSC_PROBES=1 to run live runsc probes." >&2
  exit 1
fi

if ! command -v runsc >/dev/null 2>&1; then
  echo "[security:runsc] runsc binary not found on PATH." >&2
  exit 1
fi

runsc --version

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "[security:runsc] $PKG_DIR/node_modules missing — run npm ci first." >&2
  exit 1
fi

cd "$PKG_DIR"

echo "[security:runsc] running sandbox security probes..."
npx vitest run test/security/sandbox.test.ts
