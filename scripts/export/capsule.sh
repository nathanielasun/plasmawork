#!/usr/bin/env bash
#
# scripts/export/capsule.sh
#
# Phase 2C — export a capsule's artifacts. Usage:
#
#   ./scripts/export/capsule.sh <capsule_dir> <target_dir> [--kinds code,data,plots,...]
#
# Default kinds = code,data,plots,notebook,report,archive (all of them).
# Both <capsule_dir> and <target_dir> must lie under one of the four
# allowed workbench roots (local_cache, temp_imports, temp_runs,
# simulation_capsules) unless the user explicitly opts out via
# --allow-external. Honors agent_error_patterns.md "Writing program
# artifacts outside the project directory".
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

if [[ $# -lt 2 ]]; then
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

CAPSULE_DIR="$1"
TARGET_DIR="$2"
shift 2

KINDS="code,data,plots,notebook,report,archive"
ALLOW_EXTERNAL="False"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kinds) KINDS="$2"; shift 2 ;;
    --allow-external) ALLOW_EXTERNAL="True"; shift ;;
    --help|-h) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT"
exec "$PY" -c "
import sys
from simworkbench.serialization import export_capsule
kinds = '$KINDS'.split(',') if '$KINDS' else None
result = export_capsule(
    '$CAPSULE_DIR',
    '$TARGET_DIR',
    kinds=kinds,
    require_workbench_target=not $ALLOW_EXTERNAL,
)
print(f'[export] target = {result.target}')
for kind, paths in result.paths.items():
    for p in paths:
        print(f'[export]   {kind}: {p}')
"
