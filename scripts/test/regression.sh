#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

"$REPO_ROOT/scripts/dev/check_repo_conventions.sh"
if find "$REPO_ROOT/tests/regression" -type f \( -name "test_*.py" -o -name "*.test.ts" \) | grep -q .; then
  python -m pytest "$REPO_ROOT/tests/regression"
else
  echo "No Phase 0 regression test files yet; convention checker is the active regression guard."
fi
