#!/usr/bin/env bash
#
# scripts/test/cross_process_e2e.sh — Layer 5 (Playwright proxy-wiring E2E).
#
# Boots vite-dev + a stub gateway (apps/workbench-ui/e2e/stubGateway.mjs)
# and drives Chromium via Playwright to prove the Vite proxy forwards
# every UI-facing prefix to the gateway instead of falling back to SPA
# HTML. Layer 5 specifically catches the original regression's failure
# mode: vite-dev returning a 200 + text/html for a proxied path.
#
# Gated by PLASMAWORK_E2E=1. Default ``scripts/test/all.sh`` calls
# this script and the env-off branch exits 0 immediately.
#
# Local invocation:
#   PLASMAWORK_E2E=1 bash scripts/test/cross_process_e2e.sh
#
# Pre-reqs handled by the script:
#   - apps/workbench-ui/node_modules (npm --prefix apps/workbench-ui ci)
#   - Chromium binary (npx playwright install chromium)

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

if [[ "${PLASMAWORK_E2E:-}" != "1" ]]; then
  echo "cross_process_e2e: PLASMAWORK_E2E != 1 — skipping (informational)."
  exit 0
fi

if [[ ! -d "$REPO_ROOT/apps/workbench-ui/node_modules" ]]; then
  echo "cross_process_e2e: workbench-ui node_modules missing — run npm --prefix apps/workbench-ui ci" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "cross_process_e2e: node not on PATH" >&2
  exit 1
fi

cd "$REPO_ROOT/apps/workbench-ui"
# Install Chromium if it's missing. The cache is shared across runs.
if ! npx --no-install playwright --version >/dev/null 2>&1; then
  echo "cross_process_e2e: @playwright/test missing in workbench-ui — run npm install" >&2
  exit 1
fi
# Best-effort install; idempotent. The --with-deps flag handles
# system libraries on Linux CI; on macOS it's a no-op.
if [[ "${CI:-}" == "true" || "${PLAYWRIGHT_INSTALL_BROWSERS:-}" == "1" ]]; then
  npx playwright install --with-deps chromium >/dev/null
fi

exec npm run test:e2e
