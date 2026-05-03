#!/usr/bin/env bash
#
# scripts/dev/run_capsule.sh
#
# Reload a capsule and re-run its Experiment with the original ModelSpec
# and configs. Phase 2 reload path — the README documents this as the
# canonical "rerun this capsule" entrypoint.
#
# Usage:
#   ./scripts/dev/run_capsule.sh <capsule.lxp>
#
# Output: prints the rerun's run_id, final state, final simulation time,
# elapsed wall-clock, and whether placeholder rates were used.
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

CAPSULE="$1"

cd "$REPO_ROOT"
exec "$PY" -c "
import sys
from simworkbench.runtime import Runner
from simworkbench.serialization import load_capsule

loaded = load_capsule('$CAPSULE')
print(f'[run_capsule] loaded {loaded.name} (format v{loaded.format_version})')
print(f'[run_capsule] backend = {loaded.experiment.backend_config.name}')
print(f'[run_capsule] re-running ...')
runner = Runner(loaded.experiment, base_seed=loaded.experiment.run_config.seed)
result = runner.run()
print(f'[run_capsule] run_id = {result.run_id}')
print(f'[run_capsule] state = {result.state.value}')
print(f'[run_capsule] final_simulation_time = {result.final_simulation_time:.6g} s')
print(f'[run_capsule] elapsed = {result.elapsed_seconds:.4f} s')
if result.placeholders:
    print(f'[run_capsule] placeholders used: {list(result.placeholders)}')
    print('[run_capsule] WARNING: this is an exploratory run, not validated.')
sys.exit(0)
"
