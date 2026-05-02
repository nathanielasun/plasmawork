#!/usr/bin/env bash
#
# scripts/dev/run_backend.sh
#
# Phase 1C — drive a 0D rate-equation experiment end-to-end against the
# built-in python_cpu backend. Default: runs the simple-rate-equations
# example. Pass --example <name> to run another example under examples/.
#
# This is a real implementation, not a Phase-0 stub. It resolves Python in
# the order SIMWORKBENCH_PYTHON -> .venv/bin/python -> bare python (matches
# scripts/test/*.sh).
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

PY="${SIMWORKBENCH_PYTHON:-}"
if [[ -z "$PY" ]] && [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PY="$REPO_ROOT/.venv/bin/python"
fi
if [[ -z "$PY" ]]; then
  PY="python"
fi

EXAMPLE="simple_rate_equations"
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --example) EXAMPLE="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

EXAMPLE_RUNNER="$REPO_ROOT/examples/$EXAMPLE/run.py"
if [[ ! -f "$EXAMPLE_RUNNER" ]]; then
  echo "No runnable example at $EXAMPLE_RUNNER" >&2
  echo "Available: $(ls $REPO_ROOT/examples)" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$PY" "$EXAMPLE_RUNNER" "${EXTRA_ARGS[@]}"
