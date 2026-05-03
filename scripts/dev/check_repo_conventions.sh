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
#   --verbose                    print every check, not just failures
#   --quiet                      print only the final summary
#   --include-open-workstreams   include intentionally failing TODO checks for
#                                open workstreams
#   --help                       show this message
#
# Default mode checks hard repository invariants and completed deliverables.
# Open-workstream TODOs are opt-in so documented test commands remain runnable
# while unfinished work stays visible.

set -uo pipefail

VERBOSE=0
QUIET=0
INCLUDE_OPEN_WORKSTREAMS=0

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=1 ;;
    --quiet)   QUIET=1 ;;
    --include-open-workstreams|--workstream-todos) INCLUDE_OPEN_WORKSTREAMS=1 ;;
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

check_grep_absent_in_file() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  if [[ ! -f "$file" ]]; then
    FAIL=$((FAIL+1))
    fail "$label: file missing ($file)"
    return
  fi
  if grep -qE "$pattern" "$file"; then
    FAIL=$((FAIL+1))
    fail "$label: forbidden pattern found in $file ($pattern)"
  else
    PASS=$((PASS+1))
    note "$label"
  fi
}

check_path_is_ignored() {
  # Asserts a probe path IS matched by a .gitignore rule. Used to verify build-
  # output ignore tiers (root, per-app, per-package) per the
  # `bugs_and_fixes/agent_error_patterns.md` "Bare gitignore globs" pattern.
  local probe="$1"
  local label="${2:-$1}"
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return
  fi
  if git check-ignore -q "$probe" 2>/dev/null; then
    PASS=$((PASS+1))
    note "$label gitignore-matched"
  else
    FAIL=$((FAIL+1))
    fail "$label NOT gitignore-matched (probe: $probe)"
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

# build/ output ignore tiers — see bugs_and_fixes/bugfixes.md 2026-05-02
# *Per-app and per-package `build/` outputs were not gitignored*. The pattern
# requires /build/ AND apps/*/build/ AND packages/*/build/; root-anchored alone
# left per-app outputs exposed. The probes below assert each tier; the
# scripts/build source paths must remain trackable (covered by the source-paths
# regression below).
check_grep_in_file '^/build/' .gitignore "/build/ root-anchored ignore"
check_grep_in_file '^apps/\*/build/' .gitignore "apps/*/build/ per-app ignore"
check_grep_in_file '^packages/\*/build/' .gitignore "packages/*/build/ per-package ignore"
check_path_is_ignored "build/foo.tmp" "root build/ output"
check_path_is_ignored "apps/workbench-ui/build/foo.js" "apps/workbench-ui/build/ output"
check_path_is_ignored "packages/core/build/foo.py" "packages/core/build/ output"

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
# Phase 1A (Workstream 1A / ADR-0003) — ModelSpec IR.
check_file_exists packages/core/src/simworkbench/model_spec/__init__.py
check_file_exists packages/core/src/simworkbench/model_spec/types.py
check_file_exists packages/core/src/simworkbench/model_spec/loader.py
check_file_exists packages/core/src/simworkbench/model_spec/schema.py
check_file_exists packages/core/src/simworkbench/experiment/__init__.py
check_file_exists packages/core/src/simworkbench/experiment/types.py
check_file_exists packages/core/src/simworkbench/serialization/__init__.py
check_file_exists packages/core/src/simworkbench/serialization/experiment.py
check_file_exists examples/simple_rate_equations/model.yaml
check_file_exists tests/unit/test_modelspec.py
check_file_exists tests/unit/test_units.py
check_file_exists tests/unit/test_experiment.py
check_file_exists tests/integration/test_experiment_save_load.py
check_dir_exists packages/agent_orchestration
check_dir_exists packages/physics_modules
check_dir_exists packages/solver_backends
check_dir_exists packages/visualization
check_dir_exists packages/internal_tools

# ---------------------------------------------------------------------------
# Phase 1 closed deliverables — promoted from the opt-in branch on 2026-05-02
# per `agent_error_patterns.md` "Closing a workstream without promoting its
# assertions from opt-in to default". Every entity below is part of the hard
# default gate: a regression that removes any of these breaks the build.
# ---------------------------------------------------------------------------
section "Phase 1C — Simulation runtime"
check_file_exists packages/core/src/simworkbench/runtime/__init__.py
check_file_exists packages/core/src/simworkbench/runtime/runner.py
check_file_exists packages/core/src/simworkbench/runtime/checkpoint.py
check_file_exists packages/core/src/simworkbench/runtime/seeds.py
check_file_exists packages/core/src/simworkbench/runtime/events.py
check_file_exists packages/core/src/simworkbench/runtime/progress.py
check_file_exists packages/core/src/simworkbench/paths/__init__.py
check_file_exists tests/unit/test_runtime_runner.py
check_file_exists tests/unit/test_runtime_checkpoint.py
check_file_exists tests/unit/test_runtime_seeds.py
check_file_exists tests/unit/test_runtime_events.py
check_file_exists tests/unit/test_runtime_progress.py
check_file_exists tests/unit/test_paths.py
check_file_exists tests/integration/test_runtime_pause_resume.py
check_file_exists tests/regression/test_runtime_writes_only_to_temp_runs.py
check_grep_absent_in_file 'Backend runtime is scheduled for Phase 1A-1C' scripts/dev/run_backend.sh "scripts/dev/run_backend.sh is no longer the Phase-0 stub"
check_file_exists examples/simple_rate_equations/run.py

# ---------------------------------------------------------------------------
section "Phase 1D — Basic physics modules"
check_file_exists packages/physics_modules/templates/module_template/module.yaml
check_file_exists packages/physics_modules/templates/module_template/src/__init__.py
check_file_exists packages/physics_modules/templates/module_template/tests/test_template.py
check_file_exists packages/physics_modules/templates/module_template/README.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/module.yaml
check_file_exists packages/physics_modules/laser/gaussian_pulse/README.md
check_file_exists tests/unit/test_gaussian_pulse.py
check_file_exists packages/physics_modules/species/basic/module.yaml
check_file_exists packages/physics_modules/species/basic/README.md
check_file_exists tests/unit/test_basic_species.py
check_file_exists packages/physics_modules/species/rate_equation_0d/module.yaml
check_file_exists packages/physics_modules/species/rate_equation_0d/README.md
check_file_exists tests/unit/test_rate_equation_0d.py
check_file_exists packages/physics_modules/laser/simple_absorption/module.yaml
check_file_exists packages/physics_modules/laser/simple_absorption/README.md
check_file_exists tests/unit/test_simple_absorption.py
check_file_exists packages/physics_modules/laser/simple_emission/module.yaml
check_file_exists packages/physics_modules/laser/simple_emission/README.md
check_file_exists tests/unit/test_simple_emission.py
check_file_exists packages/physics_modules/molecular_dynamics/lennard_jones/module.yaml
check_file_exists packages/physics_modules/molecular_dynamics/lennard_jones/README.md
check_file_exists tests/unit/test_lennard_jones.py
check_file_exists packages/physics_modules/phase_transition/ising_2d/module.yaml
check_file_exists packages/physics_modules/phase_transition/ising_2d/README.md
check_file_exists tests/unit/test_ising_2d.py
check_file_exists examples/molecular_dynamics/run.py
check_file_exists examples/ising_phase_transition/run.py
check_file_exists tests/validation/test_rate_equation_conservation.py
check_file_exists tests/validation/test_lennard_jones_energy_drift.py
check_file_exists tests/validation/test_ising_2d_critical_temperature.py

# ---------------------------------------------------------------------------
section "Phase 1E — Diagnostics + plotters"
check_file_exists packages/core/src/simworkbench/diagnostics/__init__.py
check_file_exists packages/core/src/simworkbench/diagnostics/api.py
check_file_exists packages/core/src/simworkbench/diagnostics/statistics.py
check_file_exists packages/core/src/simworkbench/diagnostics/streams.py
check_file_exists packages/core/src/simworkbench/diagnostics/plotters/__init__.py
check_file_exists packages/core/src/simworkbench/diagnostics/plotters/line.py
check_file_exists packages/core/src/simworkbench/diagnostics/plotters/heatmap.py
check_file_exists packages/core/src/simworkbench/diagnostics/plotters/particle_scatter.py
check_file_exists tests/unit/test_diagnostics_api.py
check_file_exists tests/unit/test_diagnostics_statistics.py
check_file_exists tests/unit/test_plotters.py
check_file_exists tests/integration/test_diagnostics_streaming.py
check_grep_in_file '"matplotlib' packages/core/pyproject.toml "packages/core/pyproject.toml depends on matplotlib (Phase 1E)"

# ---------------------------------------------------------------------------
section "Phase 1F — UI workbench + backend API"
check_file_exists program_development/architectural_decisions/ADR-0005-ui-framework.md
check_file_exists packages/core/src/simworkbench/api/__init__.py
check_file_exists packages/core/src/simworkbench/api/server.py
check_file_exists tests/integration/test_api_server.py
check_file_exists apps/workbench-ui/index.html
check_file_exists apps/workbench-ui/vite.config.ts
check_file_exists apps/workbench-ui/src/main.tsx
check_file_exists apps/workbench-ui/src/App.tsx
check_file_exists apps/workbench-ui/src/components/SimulationList.tsx
check_file_exists apps/workbench-ui/src/components/RunControls.tsx
check_file_exists apps/workbench-ui/src/components/CodeViewer.tsx
check_file_exists apps/workbench-ui/src/components/DocsViewer.tsx
check_file_exists apps/workbench-ui/src/components/DiagnosticsPanel.tsx
check_file_exists apps/workbench-ui/src/components/PlotPanel.tsx
check_file_exists apps/workbench-ui/src/components/CapsuleExplorer.tsx
check_file_exists apps/workbench-ui/src/api/client.ts
check_file_exists apps/workbench-ui/src/__tests__/App.test.tsx
check_file_exists apps/workbench-ui/src/__tests__/SimulationList.test.tsx
check_file_exists apps/workbench-ui/src/__tests__/RunControls.test.tsx
check_file_exists apps/workbench-ui/src/__tests__/DocsViewer.test.tsx
check_grep_absent_in_file 'placeholder package for the Scientific Simulation Workbench UI' apps/workbench-ui/package.json "apps/workbench-ui/package.json no longer Phase-0 placeholder"
check_grep_absent_in_file 'Workbench UI shell is scheduled for Phase 1F' scripts/dev/run_ui.sh "scripts/dev/run_ui.sh is no longer the Phase-0 stub"
check_grep_absent_in_file 'UI build is scheduled for Phase 1F' scripts/build/ui.sh "scripts/build/ui.sh is no longer the Phase-0 stub"
check_grep_in_file 'docs_site' apps/workbench-ui/src/components/DocsViewer.tsx "DocsViewer.tsx loads from docs_site/ canonical source"

# ---------------------------------------------------------------------------
# Phase 1 Gate items 4-5 — capsule save/reload (plan §Phase 1 Gate, §7).
# Phase 1 ships a minimal real format; Phase 2 finalizes HDF5/Zarr per ADR-0002.
section "Phase 1 — Capsule save/reload"
check_file_exists packages/core/src/simworkbench/serialization/capsule.py
check_file_exists tests/integration/test_capsule_save_load.py
check_grep_in_file 'CAPSULE_FORMAT_VERSION' packages/core/src/simworkbench/serialization/__init__.py "serialization re-exports capsule API"

# ---------------------------------------------------------------------------
# Phase 1 status sync — every status-bearing file mentions "Phase 1" and
# agrees with the milestone status. Honors `agent_error_patterns.md` "Status-
# sync that misses CLAUDE.md and per-workstream subsections".
section "Phase 1 status sync"
check_grep_absent_in_file 'Phase 1 has not started' CLAUDE.md "CLAUDE.md does not say Phase 1 has not started"

# ---------------------------------------------------------------------------
# Lint enforcement — AGENTS.md "Code Style and Module Boundaries" requires
# ruff clean. The lint script lives at scripts/test/lint.sh and is wired
# into scripts/test/all.sh.
section "Lint enforcement"
check_file_executable scripts/test/lint.sh "scripts/test/lint.sh"
check_grep_in_file 'lint\.sh' scripts/test/all.sh "scripts/test/all.sh runs lint"
check_file_exists ruff.toml

# ---------------------------------------------------------------------------
# Phase 2 — Simulation Capsule System (Closed 2026-05-02). Every entity below
# was ratcheted from the opt-in `--include-open-workstreams` block into the
# default hard gate at the Phase 2 close commit. Honors agent_error_patterns
# .md "Closing a workstream without promoting its assertions from opt-in to
# default".

# Phase 2A — Capsule Format & Validator.
section "Phase 2A — Capsule format & validator"
check_grep_in_file '^Accepted$' program_development/architectural_decisions/ADR-0002-simulation-capsule-format.md "ADR-0002 status Accepted (HDF5/Zarr lock-in)"
check_file_exists packages/core/src/simworkbench/serialization/manifest.py
check_file_exists packages/core/src/simworkbench/serialization/validator.py
check_file_exists packages/core/src/simworkbench/serialization/migrations/__init__.py
check_file_exists packages/core/src/simworkbench/serialization/migrations/v0_1.py
check_file_exists packages/core/src/simworkbench/serialization/bulk_data.py
check_grep_in_file '"h5py' packages/core/pyproject.toml "packages/core/pyproject.toml depends on h5py (Phase 2A bulk data)"
check_file_exists tests/unit/test_capsule_manifest.py
check_file_exists tests/unit/test_capsule_validator.py
check_file_exists tests/unit/test_capsule_bulk_data.py
check_file_exists tests/unit/test_capsule_migrations.py
check_file_exists tests/integration/test_capsule_roundtrip.py

# Phase 2B — Provenance system.
section "Phase 2B — Provenance"
check_file_exists packages/core/src/simworkbench/provenance/__init__.py
check_file_exists packages/core/src/simworkbench/provenance/lock.py
check_file_exists packages/core/src/simworkbench/provenance/environment.py
check_file_exists packages/core/src/simworkbench/provenance/agent_trace.py
check_file_exists packages/core/src/simworkbench/provenance/sources.py
check_file_exists tests/unit/test_provenance_lock.py
check_file_exists tests/unit/test_provenance_environment.py
check_file_exists tests/unit/test_provenance_agent_trace.py
check_file_exists tests/unit/test_provenance_sources.py

# Phase 2C — Export system.
section "Phase 2C — Export system"
check_file_exists packages/core/src/simworkbench/serialization/export.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/__init__.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/code.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/data.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/plots.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/notebook.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/report.py
check_file_exists packages/core/src/simworkbench/serialization/exporters/archive.py
check_file_exists packages/core/src/simworkbench/serialization/fork.py
check_grep_absent_in_file 'capsule export is scheduled for Phase 2' scripts/export/capsule.sh "scripts/export/capsule.sh is no longer the Phase-0 stub"
check_file_executable scripts/export/fork_capsule.sh "scripts/export/fork_capsule.sh executable"
check_file_exists tests/unit/test_export_code.py
check_file_exists tests/unit/test_export_data.py
check_file_exists tests/unit/test_export_plots.py
check_file_exists tests/unit/test_export_notebook.py
check_file_exists tests/unit/test_export_report.py
check_file_exists tests/unit/test_export_archive.py
check_file_exists tests/integration/test_export_capsule_roundtrip.py
check_file_exists tests/integration/test_capsule_fork.py
check_file_exists tests/regression/test_user_edits_not_overwritten.py

# Phase 2D — Capsule UI.
section "Phase 2D — Capsule UI"
check_file_exists apps/workbench-ui/src/components/capsule/ManifestView.tsx
check_file_exists apps/workbench-ui/src/components/capsule/ModelSpecView.tsx
check_file_exists apps/workbench-ui/src/components/capsule/CapsuleCodeView.tsx
check_file_exists apps/workbench-ui/src/components/capsule/ResultsView.tsx
check_file_exists apps/workbench-ui/src/components/capsule/ValidationView.tsx
check_file_exists apps/workbench-ui/src/components/capsule/ProvenanceView.tsx
check_file_exists apps/workbench-ui/src/__tests__/CapsuleExplorer.test.tsx
check_grep_in_file '/api/capsules/\{name\}' packages/core/src/simworkbench/api/server.py "API exposes /api/capsules/{name} (Phase 2D)"
check_grep_in_file '/api/capsules/\{name\}/validate' packages/core/src/simworkbench/api/server.py "API exposes /api/capsules/{name}/validate (Phase 2D)"

# Cross-cutting Phase 2 deliverables.
section "Phase 2 — Cross-cutting"
check_grep_in_file 'v0\.1' docs_site/src/content/simulation_capsules.tsx "docs_site simulation_capsules page references the v0.1 schema"

# ---------------------------------------------------------------------------
# Open-workstream TODO branch. Currently empty — Phase 2 closed 2026-05-02
# and Phase 3 has not yet opened. The next phase opens by adding a section
# here; the closing commit ratchets it into the default flow above.
if [[ $INCLUDE_OPEN_WORKSTREAMS -eq 1 ]]; then
  section "Open Workstream TODOs"
  echo "  no open workstreams — Phase 2 closed 2026-05-02; Phase 3 not yet opened."
elif [[ $QUIET -eq 0 && $VERBOSE -eq 1 ]]; then
  section "Open Workstream TODOs"
  echo "  skipped (pass --include-open-workstreams to inspect open TODO backlog)"
fi

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
for f in unit integration regression validation performance; do
  check_grep_in_file '\.venv/bin/python' "scripts/test/$f.sh" "scripts/test/$f.sh prefers repo venv"
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
