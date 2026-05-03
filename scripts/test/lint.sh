#!/usr/bin/env bash
#
# scripts/test/lint.sh
#
# Phase 1F+ — runs ruff over the workbench source tree and fails on any
# violation. Required by AGENTS.md "Code Style and Module Boundaries"
# (ruff clean) and `bugs_and_fixes/agent_error_patterns.md` "Skipping the
# linter the repo rules require". Wired into scripts/test/all.sh so any
# `./scripts/test/all.sh` invocation enforces lint.
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
exec "$PY" -m ruff check \
  packages/core/src \
  packages/physics_modules \
  tests
