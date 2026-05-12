#!/usr/bin/env bash
#
# scripts/dev/run_gateway.sh — boot the REAL workbench-gateway.
#
# Companion to scripts/dev/run_backend.sh + scripts/dev/run_ui.sh for
# the three-process production-shape dev model. Requires a populated
# /.env.auth and a running Postgres with the secure_core roles +
# migrations applied. For zero-config UI/backend dev (no Postgres),
# use scripts/dev/run_dev_stub_gateway.sh instead.
#
# Pre-flight checks:
#   - /.env.auth exists at repo root (the loader fails closed if missing)
#   - apps/workbench-gateway/node_modules present
#
# All other startup failures (bad secrets, unreachable DB, WORM
# misconfig) surface from the gateway env loader at startup with
# specific error messages. We don't second-guess them here.
#
# Exit codes:
#   0  gateway exited cleanly (normally only on signal)
#   1  pre-flight failed (env or deps missing)

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

if [[ ! -f "$REPO_ROOT/.env.auth" ]]; then
  echo "run_gateway.sh: $REPO_ROOT/.env.auth missing." >&2
  echo "" >&2
  echo "Copy the committed example and fill the required values:" >&2
  echo "  cp .env.auth.example .env.auth" >&2
  echo "" >&2
  echo "The gateway loader requires (at minimum):" >&2
  echo "  WORKBENCH_GATEWAY_COOKIE_SECRET, WORKBENCH_GATEWAY_HANDOFF_SECRET," >&2
  echo "  WORKBENCH_INTERNAL_AUDIT_SECRET (each \\\$(openssl rand -base64 32))," >&2
  echo "  PLASMAWORK_DB_URL, PLASMAWORK_DB_AUDIT_URL," >&2
  echo "  ROOT_ADMIN_USER_ID, BOOTSTRAP_CREDENTIAL_HASH," >&2
  echo "  WORKBENCH_GATEWAY_FRONTEND_ORIGIN." >&2
  echo "" >&2
  echo "For zero-config UI/backend dev without Postgres, use:" >&2
  echo "  scripts/dev/run_dev_stub_gateway.sh" >&2
  exit 1
fi

if [[ ! -d "$REPO_ROOT/apps/workbench-gateway/node_modules" ]]; then
  echo "run_gateway.sh: gateway dependencies not installed." >&2
  echo "Run: npm --prefix apps/workbench-gateway install" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "run_gateway.sh: npm not on PATH" >&2
  exit 1
fi

exec npm --prefix "$REPO_ROOT/apps/workbench-gateway" run dev
