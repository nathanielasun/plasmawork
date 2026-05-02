#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

python3 -m venv "$REPO_ROOT/.venv"
"$REPO_ROOT/.venv/bin/python" -m pip install --upgrade pip
"$REPO_ROOT/.venv/bin/python" -m pip install -e "$REPO_ROOT/packages/core"

npm --prefix "$REPO_ROOT/docs_site" install
npm --prefix "$REPO_ROOT/apps/workbench-ui" install

echo "Installed Phase 0 Python package and Node workspaces."
