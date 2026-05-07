#!/usr/bin/env bash
#
# Live DB role/security probes.
#
# This lane is intentionally separate from scripts/test/security.sh. The default
# PR security gate is secrets-free; this script is for a deployment or CI job
# that provisions an ephemeral PostgreSQL superuser URL in
# PLASMAWORK_TEST_DB_URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/secure_core"

if [[ -z "${PLASMAWORK_TEST_DB_URL:-}" ]]; then
  echo "[security:db] PLASMAWORK_TEST_DB_URL is required for DB live probes." >&2
  exit 1
fi

if [[ ! "$PLASMAWORK_TEST_DB_URL" =~ ^postgres:// ]]; then
  echo "[security:db] PLASMAWORK_TEST_DB_URL must be a PostgreSQL URL." >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "[security:db] $PKG_DIR/node_modules missing — run npm ci first." >&2
  exit 1
fi

cd "$PKG_DIR"

echo "[security:db] typechecking secure_core..."
npm run typecheck

echo "[security:db] running DB-enabled secure_core tests..."
npx vitest run \
  test/db/schema.test.ts \
  test/audit/dbWriter.test.ts \
  test/audit/verifier.test.ts \
  test/audit/anchor.test.ts \
  test/approvals/service.test.ts \
  test/capsules/versionLock.test.ts \
  test/fixtures/smoke.test.ts \
  test/quotas/counters.test.ts \
  test/quotas/storageReservations.test.ts \
  test/runs/stateMachine.test.ts
