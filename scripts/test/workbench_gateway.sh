#!/usr/bin/env bash
#
# scripts/test/workbench_gateway.sh
#
# Runs `apps/workbench-gateway`'s TypeScript typecheck + Vitest suite.
# Wired into scripts/test/all.sh + .github/workflows/security.yml so
# every PR exercises the auth gateway alongside secure_core.
#
# Audit fix (2026-05-10): the gateway package was previously
# excluded from the hard test gate. A typecheck regression
# (unused-var error in workbenchProxy.test.ts) shipped to main
# unnoticed because Vitest does not typecheck. This script closes
# that gap: tsc --noEmit MUST pass before vitest runs, and both
# are now part of all.sh.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
PKG_DIR="$REPO_ROOT/apps/workbench-gateway"

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "workbench_gateway.sh: $PKG_DIR/node_modules missing — run \`npm --prefix $PKG_DIR install\` first."
  exit 1
fi

cd "$PKG_DIR"

echo "workbench_gateway.sh: tsc --noEmit"
npm run typecheck

echo "workbench_gateway.sh: vitest run"
npm test
