#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

if find "$REPO_ROOT/tests/validation" -type f \( -name "test_*.py" -o -name "*.test.ts" \) | grep -q .; then
  python -m pytest "$REPO_ROOT/tests/validation"
else
  echo "No Phase 0 validation tests yet."
fi
