#!/usr/bin/env bash
#
# scripts/dev/run_backend.sh
#
# Start the Python FastAPI backend/API server used by the workbench UI.
# Simulation examples are launched separately via examples/<name>/run.py.
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
