#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
PYTHON="${SIMWORKBENCH_PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="python"
fi

if find "$REPO_ROOT/tests/unit" -type f \( -name "test_*.py" -o -name "*.test.ts" \) | grep -q .; then
  "$PYTHON" -m pytest "$REPO_ROOT/tests/unit"
else
  echo "No unit tests yet."
fi
