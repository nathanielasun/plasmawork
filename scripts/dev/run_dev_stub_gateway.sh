#!/usr/bin/env bash
#
# scripts/dev/run_dev_stub_gateway.sh — boot the dev-stub gateway.
#
# Companion to scripts/dev/run_ui.sh + scripts/dev/run_backend.sh for the
# zero-config dev model. Run this in a third terminal:
#
#   Terminal 1:  scripts/dev/run_backend.sh             # FastAPI on :8000
#   Terminal 2:  scripts/dev/run_dev_stub_gateway.sh    # stub on :4000
#   Terminal 3:  scripts/dev/run_ui.sh                  # vite on :5173
#
# The stub gateway has NO auth — it accepts any /auth/login credentials,
# returns a stub session, and reverse-proxies /api/* to FastAPI. Useful
# for UI/backend dev where you don't want to set up postgres + .env.auth.
#
# For full auth (real bootstrap, postgres-backed sessions, HMAC
# handoff), run scripts/dev/run_gateway.sh instead. NEVER use the stub
# against a real deployment.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if ! command -v node >/dev/null 2>&1; then
  echo "run_dev_stub_gateway.sh: node not on PATH" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/dev_stub_gateway.mjs"
