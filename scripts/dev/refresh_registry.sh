#!/usr/bin/env bash
#
# scripts/dev/refresh_registry.sh
#
# Re-walks `packages/internal_tools/registry/` (and the user-imported tool
# cache under `local_cache/imported_tools/`), validates each `tool.yaml`,
# and rewrites `packages/internal_tools/registry/index.yaml` with the
# fresh tool listing.
#
# Usage:
#   ./scripts/dev/refresh_registry.sh
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

cd "$REPO_ROOT"
exec "$PY" -m simworkbench.tools.refresh_registry
