#!/usr/bin/env bash
#
# scripts/dev/check_repo_conventions.sh
#
# Verifies that the Scientific Simulation Workbench repository conforms to the
# structural conventions defined in:
#   - AGENTS.md
#   - CLAUDE.md
#   - scientific_simulation_workbench_agent_plan.md (§3, §4, §5, §6)
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed
#
# Flags:
#   --verbose  print every check, not just failures
#   --quiet    print only the final summary
#   --help     show this message
#
# This script is part of the Phase 0 gate. It is the cheapest possible
# regression test against accidental destruction of project structure.

set -uo pipefail

VERBOSE=0
QUIET=0

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=1 ;;
    --quiet)   QUIET=1 ;;
    --help|-h) usage ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "See --help" >&2
      exit 2
      ;;
  esac
done

# Resolve the repository root from this script's location.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
cd "$REPO_ROOT"

PASS=0
FAIL=0
FAILS=()

note() {
  if [[ $QUIET -eq 0 && $VERBOSE -eq 1 ]]; then
    echo "  ok   $1"
  fi
}

fail() {
  if [[ $QUIET -eq 0 ]]; then
    echo "  FAIL $1"
  fi
  FAILS+=("$1")
}

check_file_exists() {
  local path="$1"
  local label="${2:-$1}"
  if [[ -f "$path" ]]; then
    PASS=$((PASS+1))
    note "$label exists"
  else
    FAIL=$((FAIL+1))
    fail "$label missing: $path"
  fi
}

check_file_executable() {
  local path="$1"
  local label="${2:-$1}"
  if [[ -f "$path" && -x "$path" ]]; then
    PASS=$((PASS+1))
    note "$label executable"
  elif [[ -f "$path" ]]; then
    FAIL=$((FAIL+1))
    fail "$label not executable: $path"
  else
    FAIL=$((FAIL+1))
    fail "$label missing: $path"
  fi
}

check_dir_exists() {
  local path="$1"
  local label="${2:-$1}"
  if [[ -d "$path" ]]; then
    PASS=$((PASS+1))
    note "$label exists"
  else
    FAIL=$((FAIL+1))
    fail "$label missing: $path"
  fi
}

check_grep_in_file() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  if [[ ! -f "$file" ]]; then
    FAIL=$((FAIL+1))
    fail "$label: file missing ($file)"
    return
  fi
  if grep -qE "$pattern" "$file"; then
    PASS=$((PASS+1))
    note "$label"
  else
    FAIL=$((FAIL+1))
    fail "$label: pattern not found in $file ($pattern)"
  fi
}

section() {
  if [[ $QUIET -eq 0 ]]; then
    echo
    echo "== $1 =="
  fi
}

# ---------------------------------------------------------------------------
section "Root governance files"
check_file_exists AGENTS.md
check_file_exists CLAUDE.md
check_file_exists README.md
check_file_exists .gitignore

# ---------------------------------------------------------------------------
section "Required .gitignore entries"
# Local cache directories must be ignored, and their .gitkeep markers preserved.
check_grep_in_file '^local_cache/\*'        .gitignore "local_cache/* ignored"
check_grep_in_file '^temp_imports/\*'       .gitignore "temp_imports/* ignored"
check_grep_in_file '^temp_runs/\*'          .gitignore "temp_runs/* ignored"
check_grep_in_file '^simulation_capsules/\*' .gitignore "simulation_capsules/* ignored"
check_grep_in_file '^!local_cache/\.gitkeep'        .gitignore "local_cache/.gitkeep preserved"
check_grep_in_file '^!temp_imports/\.gitkeep'       .gitignore "temp_imports/.gitkeep preserved"
check_grep_in_file '^!temp_runs/\.gitkeep'          .gitignore "temp_runs/.gitkeep preserved"
check_grep_in_file '^!simulation_capsules/\.gitkeep' .gitignore "simulation_capsules/.gitkeep preserved"
check_grep_in_file '^\*\.log$' .gitignore "*.log ignored"
check_grep_in_file '^__pycache__/' .gitignore "__pycache__ ignored"
check_grep_in_file '^node_modules/' .gitignore "node_modules ignored"

# ---------------------------------------------------------------------------
section "Local-only directories (with .gitkeep markers)"
check_dir_exists  simulation_capsules
check_file_exists simulation_capsules/.gitkeep
check_dir_exists  local_cache
check_file_exists local_cache/.gitkeep
check_dir_exists  temp_imports
check_file_exists temp_imports/.gitkeep
check_dir_exists  temp_runs
check_file_exists temp_runs/.gitkeep

# ---------------------------------------------------------------------------
section "Top-level package directories"
check_dir_exists apps/workbench-ui
check_file_exists apps/workbench-ui/package.json
check_file_exists apps/workbench-ui/tsconfig.json
check_file_exists apps/workbench-ui/src/app/page.tsx
check_dir_exists docs_site
check_dir_exists packages/core
check_file_exists packages/core/pyproject.toml
check_file_exists packages/core/src/simworkbench/__init__.py
# Phase 1B (Workstream 1B / ADR-0004) — units subsystem.
check_file_exists packages/core/src/simworkbench/units/__init__.py
check_file_exists packages/core/src/simworkbench/units/registry.py
check_file_exists packages/core/src/simworkbench/units/quantity.py
check_file_exists packages/core/src/simworkbench/units/validators.py
check_grep_in_file '"pint' packages/core/pyproject.toml "packages/core/pyproject.toml depends on pint"
check_grep_in_file '"pydantic' packages/core/pyproject.toml "packages/core/pyproject.toml depends on pydantic"
check_grep_in_file '"pyyaml' packages/core/pyproject.toml "packages/core/pyproject.toml depends on pyyaml"
check_dir_exists packages/agent_orchestration
check_dir_exists packages/physics_modules
check_dir_exists packages/solver_backends
check_dir_exists packages/visualization
check_dir_exists packages/internal_tools

# ---------------------------------------------------------------------------
section "Tests, scripts, examples, configs"
check_file_exists tests/README.md
for d in unit integration regression validation performance; do
  check_dir_exists "tests/$d" "tests/$d"
done
for d in dev build test docs clean export; do
  check_dir_exists "scripts/$d" "scripts/$d"
done
for f in dev/install.sh \
         dev/run_ui.sh \
         dev/run_backend.sh \
         dev/run_capsule.sh \
         build/ui.sh \
         build/kernels.sh \
         docs/dev.sh \
         docs/build.sh \
         test/all.sh \
         test/unit.sh \
         test/integration.sh \
         test/regression.sh \
         test/validation.sh \
         test/performance.sh \
         export/capsule.sh; do
  check_file_executable "scripts/$f" "script scripts/$f"
done
for d in laser_species krf_excimer simple_rate_equations molecular_dynamics ising_phase_transition pde_wave_equation; do
  check_dir_exists "examples/$d" "examples/$d"
done
check_file_exists configs/default.yaml
check_file_exists configs/local.yaml.example
check_file_exists configs/backends.yaml
check_file_exists configs/agents.yaml

# ---------------------------------------------------------------------------
section "bugs_and_fixes/"
check_dir_exists  bugs_and_fixes
check_file_exists bugs_and_fixes/README.md
check_file_exists bugs_and_fixes/bugfixes.md
check_file_exists bugs_and_fixes/known_failures.md
check_file_exists bugs_and_fixes/regression_tests.md
check_file_exists bugs_and_fixes/agent_error_patterns.md
check_file_exists bugs_and_fixes/program.log.example

# ---------------------------------------------------------------------------
section "program_development/"
check_dir_exists  program_development
check_file_exists program_development/README.md
check_file_exists program_development/timeline.md
check_dir_exists  program_development/architectural_decisions
check_file_exists program_development/architectural_decisions/_template.md
check_file_exists program_development/architectural_decisions/ADR-0001-project-scope.md
check_file_exists program_development/architectural_decisions/ADR-0002-simulation-capsule-format.md
check_file_exists program_development/architectural_decisions/ADR-0003-model-spec-ir.md
check_file_exists program_development/architectural_decisions/ADR-0004-units-library.md
check_dir_exists  program_development/milestones
for f in phase_00_repository_bootstrap.md \
         phase_01_manual_workbench.md \
         phase_02_simulation_capsule_system.md \
         phase_03_internal_tool_sdk_and_registry.md \
         phase_04_agent_assisted_paper_ingestion.md \
         phase_05_modelspec_generation_and_module_mapping.md \
         phase_06_agentic_code_generation_in_sandboxed_capsules.md \
         phase_07_validated_physics_module_registry.md \
         phase_08_hpc_and_hardware_backends.md \
         phase_09_parameter_sweeps_optimization_uncertainty.md \
         phase_10_autonomous_computational_experiment_design.md; do
  check_file_exists "program_development/milestones/$f" "milestone $f"
done

# ---------------------------------------------------------------------------
section "Documentation site skeleton"
check_dir_exists  docs_site
check_file_exists docs_site/package.json
check_file_exists docs_site/tsconfig.json
check_dir_exists  docs_site/src/content
for f in overview installation usage architecture module_development \
         internal_tools simulation_capsules agent_workflows \
         validation troubleshooting; do
  check_file_exists "docs_site/src/content/$f.tsx" "doc page $f.tsx"
done

# ---------------------------------------------------------------------------
section "Project source directories must not be gitignored"
# Regression guard for: 2026-05-02 — Bare `build/` swallowed `scripts/build/`.
# A future overly-broad ignore rule could silently hide work in our source
# tree. We probe a representative file inside each project-owned directory.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  probes=(
    "scripts/build/ui.sh"
    "scripts/dev/install.sh"
    "scripts/test/all.sh"
    "scripts/docs/dev.sh"
    "packages/physics_modules/laser/src/__init__.py"
    "apps/workbench-ui/src/app/page.tsx"
    "docs_site/src/content/overview.tsx"
  )
  collisions=0
  for probe in "${probes[@]}"; do
    if git check-ignore -q "$probe" 2>/dev/null; then
      FAIL=$((FAIL+1))
      fail "gitignore collision: $probe is matched by an ignore rule"
      collisions=1
    fi
  done
  if [[ $collisions -eq 0 ]]; then
    PASS=$((PASS+1))
    note "no gitignore collisions on project paths"
  fi
else
  if [[ $QUIET -eq 0 ]]; then
    echo "  skipped (not in a git work tree)"
  fi
fi

# ---------------------------------------------------------------------------
section "Forbidden temp/generated artifacts not staged"
# Files matching these patterns must not be staged for commit. We check whether
# they are tracked by git. (If we are not in a git repo, skip this section.)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  forbidden_globs=(
    'local_cache/[!.]*'
    'temp_imports/[!.]*'
    'temp_runs/[!.]*'
    'simulation_capsules/*[!gitkeep]'
    '*.log'
    '*.h5' '*.hdf5' '*.parquet' '*.npy' '*.npz'
  )
  staged_bad=0
  for glob in "${forbidden_globs[@]}"; do
    matches="$(git ls-files -- "$glob" 2>/dev/null || true)"
    if [[ -n "$matches" ]]; then
      while IFS= read -r m; do
        # Allow .gitkeep inside the local-only roots (defense in depth).
        case "$m" in
          local_cache/.gitkeep|temp_imports/.gitkeep|temp_runs/.gitkeep|simulation_capsules/.gitkeep)
            continue ;;
        esac
        FAIL=$((FAIL+1))
        fail "forbidden artifact tracked: $m"
        staged_bad=1
      done <<< "$matches"
    fi
  done
  if [[ $staged_bad -eq 0 ]]; then
    PASS=$((PASS+1))
    note "no forbidden artifacts tracked"
  fi
else
  if [[ $QUIET -eq 0 ]]; then
    echo "  skipped (not in a git work tree)"
  fi
fi

# ---------------------------------------------------------------------------
echo
if [[ $FAIL -eq 0 ]]; then
  echo "Convention check PASSED — $PASS check(s) ok."
  exit 0
else
  echo "Convention check FAILED — $FAIL failure(s), $PASS check(s) ok."
  if [[ $QUIET -eq 0 && $VERBOSE -eq 0 ]]; then
    echo "Failures:"
    for f in "${FAILS[@]}"; do
      echo "  - $f"
    done
  fi
  exit 1
fi
