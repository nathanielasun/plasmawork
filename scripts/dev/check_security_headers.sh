#!/usr/bin/env bash
#
# Focused secure-core header, CSRF, approval-token, and redaction checks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/secure_core"

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "[security-headers] $PKG_DIR/node_modules missing — run npm install in packages/secure_core." >&2
  exit 1
fi

cd "$PKG_DIR"
exec npx vitest run \
  test/middleware/requireAuth.test.ts \
  test/middleware/enforceCsrfForStateChange.test.ts \
  test/middleware/requireApprovalIfHighRisk.test.ts \
  test/outbound/webhookSigner.test.ts \
  test/audit/logger.test.ts
