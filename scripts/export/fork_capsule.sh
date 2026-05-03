#!/usr/bin/env bash
#
# scripts/export/fork_capsule.sh
#
# Phase 2C — fork a capsule. Usage:
#
#   ./scripts/export/fork_capsule.sh <source_capsule.lxp> [--name NEW_NAME]
#                                     [--dest PATH]
#
# Forking copies every subtree EXCEPT provenance/, then creates a fresh
# provenance/ that records the parent's source-aggregate hash. See plan §7
# and ADR-0002 §"Capsule lifecycle".
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

if [[ $# -lt 1 ]]; then
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

SOURCE="$1"
shift

NEW_NAME=""
DEST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NEW_NAME="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --help|-h) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT"
exec "$PY" -c "
from simworkbench.serialization import fork_capsule
dst = '$DEST' or None
new_name = '$NEW_NAME' or None
out = fork_capsule('$SOURCE', dst=dst, new_name=new_name)
print(f'[fork] new capsule = {out}')
"
