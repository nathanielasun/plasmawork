#!/usr/bin/env bash
#
# scripts/dev/import_hpc_result.sh
#
# Phase 8 / 8E — Import an HPC remote run's result.json into the
# workbench. Reads result.json, reconstitutes a RunResult-shaped
# object, prints a summary. The capsule writer (Phase 2B) consumes
# this in a follow-up step.
#
# Usage:
#   bash scripts/dev/import_hpc_result.sh <bundle-dir-or-result.json>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: import_hpc_result.sh <bundle-dir-or-result.json>"
  exit 2
fi

TARGET="$1"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
PYTHON="${SIMWORKBENCH_PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="python3"
fi

if [[ -d "$TARGET" ]]; then
  RESULT_PATH="$TARGET/result.json"
else
  RESULT_PATH="$TARGET"
fi

if [[ ! -f "$RESULT_PATH" ]]; then
  echo "import_hpc_result.sh: $RESULT_PATH not found"
  exit 3
fi

"$PYTHON" - <<PY "$RESULT_PATH"
import sys
from simworkbench.hpc import import_remote_result

path = sys.argv[1]
result = import_remote_result(path)
print(f"import_hpc_result.sh: imported {path}")
print(f"  run_id: {result.run_id}")
print(f"  state: {result.state}")
print(f"  backend: {result.backend}")
print(f"  elapsed_seconds: {result.elapsed_seconds}")
print(f"  diagnostics keys: {sorted(result.diagnostics.keys())}")
PY
