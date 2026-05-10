#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

"$REPO_ROOT/scripts/dev/check_repo_conventions.sh"
"$SCRIPT_DIR/lint.sh"
"$SCRIPT_DIR/unit.sh"
"$SCRIPT_DIR/integration.sh"
"$SCRIPT_DIR/regression.sh"
"$SCRIPT_DIR/validation.sh"
"$SCRIPT_DIR/performance.sh"
"$SCRIPT_DIR/ui.sh"
"$SCRIPT_DIR/security.sh"
"$SCRIPT_DIR/secure_core.sh"
"$SCRIPT_DIR/workbench_gateway.sh"

# Layer 4 cross-process smoke runs only when PLASMAWORK_CROSS_PROCESS_SMOKE=1.
# Default-CI invocation is a no-op (the script exits 0 with an informational
# message); the env-gated path requires .venv/bin/python with simworkbench
# installed and a free local port pair.
"$SCRIPT_DIR/cross_process_smoke.sh"

# Layer 5 Playwright E2E runs only when PLASMAWORK_E2E=1. Default-CI is a
# no-op; the env-gated path requires the workbench-ui node_modules and
# the Chromium browser binary (one-time install via npx playwright install).
"$SCRIPT_DIR/cross_process_e2e.sh"
