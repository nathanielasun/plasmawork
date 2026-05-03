#!/usr/bin/env bash
#
# scripts/test/ui.sh
#
# Runs the workbench-ui's TypeScript typecheck AND Vitest suite. Wired
# into scripts/test/all.sh so every `./scripts/test/all.sh` invocation
# catches type drift between FastAPI body schemas and the TS API
# client (or any other type regression).
#
# Phase 6 audit lesson: vitest on its own does not typecheck — it
# transforms TS via esbuild/swc which strips types. A type error in
# `GeneratedCodeView.tsx` referencing a renamed field on `CodegenDiff`
# made it past `vitest run` and was caught only by an external
# `tsc --noEmit` invocation. Carries `agent_error_patterns.md`
# "Skipping the linter the repo rules require" — typecheck is part of
# the repo's enforced gate, not a developer-discretion step.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
UI_DIR="$REPO_ROOT/apps/workbench-ui"

if [[ ! -d "$UI_DIR/node_modules" ]]; then
  echo "ui.sh: $UI_DIR/node_modules missing — run scripts/dev/install.sh first."
  exit 1
fi

# Run from inside the UI package directory. Vitest's setupFiles are
# resolved relative to the config's basedir, but a few of its async
# matchers also probe paths through `process.cwd()` — running from
# the repo root with `--prefix` was producing intermittent
# "Invalid Chai property: toBeInTheDocument" failures.
cd "$UI_DIR"

echo "ui.sh: tsc --noEmit"
npm run typecheck

echo "ui.sh: vitest run"
npm test
