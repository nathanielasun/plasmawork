#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
PYTHON="${SIMWORKBENCH_PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="python"
fi

"$REPO_ROOT/scripts/dev/check_repo_conventions.sh"
if find "$REPO_ROOT/tests/regression" -type f \( -name "test_*.py" -o -name "*.test.ts" \) | grep -q .; then
  "$PYTHON" -m pytest "$REPO_ROOT/tests/regression"
else
  echo "No regression test files yet; convention checker is the active regression guard."
fi
