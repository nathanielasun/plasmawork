#!/usr/bin/env bash
#
# scripts/test/secure_core.sh
#
# Runs `packages/secure_core`'s TypeScript typecheck + Vitest suite.
# Wired into scripts/test/all.sh so every PR exercises the security
# substrate's tests.
#
# Until Layer 1 finishes, the suite is small (constants + future
# Layer-1 modules). It grows with each Layer-1/2/3 task. The stub
# `scripts/test/security.sh` invokes the §29 regression suite once
# Layer 5 ships; this script is the per-package unit + typecheck
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
