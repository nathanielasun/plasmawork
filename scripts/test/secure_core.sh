#!/usr/bin/env bash
#
# scripts/test/secure_core.sh
#
# Runs `packages/secure_core`'s TypeScript typecheck + Vitest suite.
# Wired into scripts/test/all.sh so every PR exercises the security
# substrate's tests.
#
# `scripts/test/security.sh` runs the §29 spec-level invariants
# under `packages/secure_core/test/security/` plus env-gated
# live-runtime probes (PLASMAWORK_RUNSC_PROBES, PLASMAWORK_TEST_DB_URL,
# anchor S3 vars). This script is the per-package unit + typecheck
# pass that runs unconditionally.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
PKG_DIR="$REPO_ROOT/packages/secure_core"

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "secure_core.sh: $PKG_DIR/node_modules missing — run \`npm --prefix $PKG_DIR install\` first."
  exit 1
fi

cd "$PKG_DIR"

echo "secure_core.sh: tsc --noEmit"
npm run typecheck

echo "secure_core.sh: vitest run"
npm test
