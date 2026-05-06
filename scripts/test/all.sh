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
"$SCRIPT_DIR/secure_core.sh"
