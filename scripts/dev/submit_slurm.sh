#!/usr/bin/env bash
#
# scripts/dev/submit_slurm.sh
#
# Phase 8 / 8E — Submit a workbench experiment to a Slurm cluster.
#
# Usage:
#   bash scripts/dev/submit_slurm.sh <experiment.yaml> <bundle-dir> [extra sbatch args]
#
# This script generates the Slurm bundle via simworkbench.hpc.SlurmJob,
# then invokes `sbatch` from the bundle directory. If sbatch is not on
# PATH, the bundle is generated and the script prints the submission
# command — so users on a login node without the workbench's Python
# can still hand-submit.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: submit_slurm.sh <experiment.yaml> <bundle-dir> [extra sbatch args]"
  exit 2
fi

EXPERIMENT_PATH="$1"
BUNDLE_DIR="$2"
shift 2

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
PYTHON="${SIMWORKBENCH_PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="python3"
fi

# Generate the bundle.
"$PYTHON" - <<PY "$EXPERIMENT_PATH" "$BUNDLE_DIR"
import sys
from simworkbench.experiment import Experiment
from simworkbench.hpc import SlurmJob

experiment_path, bundle_dir = sys.argv[1:3]
experiment = Experiment.load_yaml(experiment_path)
job = SlurmJob(
    experiment=experiment,
    partition="batch",
    time_limit="01:00:00",
    nodes=1, ntasks=1, cpus_per_task=2,
    job_name=experiment.name,
)
out = job.write(bundle_dir)
print(f"submit_slurm.sh: bundle written to {out}")
PY

if command -v sbatch >/dev/null 2>&1; then
  echo "submit_slurm.sh: sbatch found; submitting"
  cd "$BUNDLE_DIR"
  exec sbatch "$@" submit.sh
else
  echo "submit_slurm.sh: sbatch NOT found on PATH."
  echo "  Bundle is at: $BUNDLE_DIR"
  echo "  Submit it from a login node with:"
  echo "    cd $BUNDLE_DIR && sbatch $@ submit.sh"
fi
