#!/usr/bin/env bash
#
# scripts/dev/run_backend.sh
#
# Phase 1C — drive a 0D rate-equation experiment end-to-end against the
# built-in python_cpu backend. Default: runs the simple-rate-equations
# example. Pass --example <name> to run another example under examples/.
#
# This is a real implementation, not a Phase-0 stub. It delegates argument
# parsing to scripts/dev/run_backend.py so Unix and Windows wrappers share one
# backend launcher path.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

LAUNCHER_PY="${SIMWORKBENCH_LAUNCHER_PYTHON:-}"
if [[ -z "$LAUNCHER_PY" ]] && [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  LAUNCHER_PY="$REPO_ROOT/.venv/bin/python"
fi
if [[ -z "$LAUNCHER_PY" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    LAUNCHER_PY="python3"
  else
    LAUNCHER_PY="python"
  fi
fi

cd "$REPO_ROOT"
exec "$LAUNCHER_PY" "$REPO_ROOT/scripts/dev/run_backend.py" "$@"
