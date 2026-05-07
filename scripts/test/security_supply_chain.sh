#!/usr/bin/env bash
#
# Supply-chain security checks intended for CI. This lane is separate
# from scripts/test/all.sh because npm audit and dependency review are
# network-backed in CI, while the local hard gate remains deterministic.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

npm --prefix "$REPO_ROOT/packages/secure_core" audit --audit-level=high --omit=dev
npm --prefix "$REPO_ROOT/packages/secure_core" exec -- vitest run test/security/ciGuards.test.ts
