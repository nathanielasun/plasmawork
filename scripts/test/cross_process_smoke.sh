#!/usr/bin/env bash
#
# scripts/test/cross_process_smoke.sh — Layer 4 (cross-process HMAC handoff)
#
# Spawns the real FastAPI workbench as a subprocess and POSTs handoff-signed
# requests from a TypeScript test, proving the HMAC byte contract between
# the gateway's TS signer and FastAPI's Python verifier.
#
# Gated by PLASMAWORK_CROSS_PROCESS_SMOKE=1. Default ``scripts/test/all.sh``
# does NOT call this. Operators set the env var explicitly for local runs;
# CI runs it via a dedicated workflow_dispatch / scheduled job.
#
# Requirements:
#   - .venv/bin/python with the workbench installed (run scripts/dev/install.sh)
#   - node + npm for the gateway test package
#
# Exit codes:
#   0  test passed (or gate off — informational)
#   1  test failed or environment is missing required pieces

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

if [[ "${PLASMAWORK_CROSS_PROCESS_SMOKE:-}" != "1" ]]; then
  echo "cross_process_smoke: PLASMAWORK_CROSS_PROCESS_SMOKE != 1 — skipping (informational)."
  exit 0
fi

if [[ ! -x "$REPO_ROOT/.venv/bin/python" ]]; then
  echo "cross_process_smoke: .venv/bin/python missing — run scripts/dev/install.sh first." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "cross_process_smoke: node not on PATH" >&2
  exit 1
fi

if [[ ! -d "$REPO_ROOT/apps/workbench-gateway/node_modules" ]]; then
  echo "cross_process_smoke: gateway node_modules missing — run npm --prefix apps/workbench-gateway install" >&2
  exit 1
fi

cd "$REPO_ROOT"
PLASMAWORK_CROSS_PROCESS_SMOKE=1 \
  exec npm --prefix apps/workbench-gateway test -- --run test/integration/proxyToFastApi.test.ts
