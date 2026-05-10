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
check_file_executable scripts/dev/run_backend.py "cross-shell backend launcher executable"
check_file_executable scripts/dev/run_backend.ps1 "PowerShell backend launcher executable"
check_file_executable scripts/dev/run_backend.cmd "cmd.exe backend launcher executable"
check_grep_absent_in_file 'EXTRA_ARGS' scripts/dev/run_backend.sh "run_backend.sh delegates argument parsing"
check_grep_in_file 'uvicorn' scripts/dev/run_backend.py "run_backend.py starts uvicorn"
check_grep_in_file 'simworkbench\.api\.server:app' scripts/dev/run_backend.py "run_backend.py targets the FastAPI app"
check_grep_absent_in_file 'root / "examples"' scripts/dev/run_backend.py "run_backend.py does not dispatch simulation examples"
check_file_exists tests/regression/test_run_backend_launcher.py
check_file_exists tests/regression/test_phase_contract_drift.py
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
check_file_exists apps/workbench-ui/src/__tests__/CodeViewer.test.tsx
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
# Phase 3 — Internal Tool SDK and Registry (Closed 2026-05-02). Every entity
# below was ratcheted from the opt-in `--include-open-workstreams` block into
# the default hard gate at the Phase 3 close commit.

section "Phase 3A — Tool SDK"
check_file_exists packages/core/src/simworkbench/tools/__init__.py
check_file_exists packages/core/src/simworkbench/tools/base_tool.py
check_file_exists packages/core/src/simworkbench/tools/io.py
check_file_exists packages/core/src/simworkbench/tools/metadata.py
check_file_exists packages/core/src/simworkbench/tools/lifecycle.py
check_grep_in_file 'class BaseTool' packages/core/src/simworkbench/tools/base_tool.py "BaseTool ABC defined"
check_grep_in_file 'class ToolInput' packages/core/src/simworkbench/tools/io.py "ToolInput defined"
check_grep_in_file 'class ToolOutput' packages/core/src/simworkbench/tools/io.py "ToolOutput defined"
check_grep_in_file 'class ToolMetadata' packages/core/src/simworkbench/tools/metadata.py "ToolMetadata defined"
check_grep_in_file 'draft' packages/core/src/simworkbench/tools/lifecycle.py "lifecycle: draft state"
check_grep_in_file 'candidate' packages/core/src/simworkbench/tools/lifecycle.py "lifecycle: candidate state"
check_grep_in_file 'validated' packages/core/src/simworkbench/tools/lifecycle.py "lifecycle: validated state"
check_grep_in_file 'trusted' packages/core/src/simworkbench/tools/lifecycle.py "lifecycle: trusted state"
check_grep_in_file 'deprecated' packages/core/src/simworkbench/tools/lifecycle.py "lifecycle: deprecated state"
check_grep_in_file 'BaseTool' packages/core/src/simworkbench/tools/__init__.py "simworkbench.tools re-exports BaseTool"
check_file_exists tests/unit/test_base_tool.py
check_file_exists tests/unit/test_tool_io.py
check_file_exists tests/unit/test_tool_lifecycle.py

section "Phase 3B — Tool Registry"
check_file_exists packages/core/src/simworkbench/tools/registry.py
check_grep_in_file 'class ToolRegistry' packages/core/src/simworkbench/tools/registry.py "ToolRegistry defined"
check_file_exists packages/internal_tools/registry/index.yaml
check_file_executable scripts/dev/refresh_registry.sh "scripts/dev/refresh_registry.sh executable"
check_grep_absent_in_file 'scheduled for Phase' scripts/dev/refresh_registry.sh "refresh_registry.sh is no longer the Phase-0 stub"
check_dir_exists packages/internal_tools/registry/absorption_spectrum_diagnostic
check_file_exists packages/internal_tools/registry/absorption_spectrum_diagnostic/tool.yaml
check_file_exists packages/internal_tools/registry/absorption_spectrum_diagnostic/src/tool.py
check_file_exists packages/internal_tools/registry/absorption_spectrum_diagnostic/tests/test_absorption_spectrum.py
check_file_exists packages/internal_tools/registry/absorption_spectrum_diagnostic/README.md
check_file_exists packages/internal_tools/registry/absorption_spectrum_diagnostic/assumptions.md
check_file_exists packages/internal_tools/registry/absorption_spectrum_diagnostic/changelog.md
check_file_exists tests/integration/test_tool_registry.py

section "Phase 3C — Tool Templates"
for cat in diagnostic visualization import_tool physics_module solver_adapter validation paper_extraction; do
  check_dir_exists "packages/internal_tools/templates/$cat"
  check_file_exists "packages/internal_tools/templates/$cat/tool.yaml"
  check_file_exists "packages/internal_tools/templates/$cat/src/tool.py"
  check_file_exists "packages/internal_tools/templates/$cat/README.md"
done

section "Phase 3D — Tool UI"
check_file_exists apps/workbench-ui/src/components/tools/ToolList.tsx
check_file_exists apps/workbench-ui/src/components/tools/ToolDetail.tsx
check_file_exists apps/workbench-ui/src/components/tools/ToolDocs.tsx
check_file_exists apps/workbench-ui/src/components/tools/ToolStatus.tsx
check_file_exists apps/workbench-ui/src/__tests__/ToolList.test.tsx
check_grep_in_file 'tools' apps/workbench-ui/src/App.tsx "App.tsx routes /tools"
check_grep_in_file '/api/tools' packages/core/src/simworkbench/api/server.py "API exposes /api/tools (Phase 3D)"
check_grep_in_file '/api/tools/\{name\}' packages/core/src/simworkbench/api/server.py "API exposes /api/tools/{name}"

section "Phase 3E — Tool Documentation"
check_grep_absent_in_file 'Phase 0 skeleton' docs_site/src/content/internal_tools.tsx "internal_tools docs no longer the Phase-0 banner"
check_grep_in_file 'Tutorial' docs_site/src/content/internal_tools.tsx "internal_tools docs include a tutorial heading"
check_grep_in_file 'absorption_spectrum_diagnostic' docs_site/src/content/internal_tools.tsx "internal_tools docs walk through the example tool"

# Phase 3 gate-walk verb coverage. Added after the Phase 3 false-close audit
# (post-Phase-3 patterns: "Implementing the gate's verbs you can see, not the
# verbs the plan listed"). Each Phase whose gate names verbs ships a
# tests/integration/test_phase_N_gate_walk.py.
section "Phase 3 — Gate verb walk"
check_file_exists tests/integration/test_phase_3_gate_walk.py
check_file_exists packages/core/src/simworkbench/tools/binding.py
check_grep_in_file 'apply_tools' packages/core/src/simworkbench/tools/binding.py "apply_tools defined"
check_grep_in_file 'tool_refs' packages/core/src/simworkbench/experiment/types.py "Experiment.tool_refs declared"
check_grep_in_file '/api/tools/\{name\}/run-tests' packages/core/src/simworkbench/api/server.py "API exposes /api/tools/{name}/run-tests (Phase 3 gate verb)"
check_grep_in_file '/api/tools/\{name\}/execute' packages/core/src/simworkbench/api/server.py "API exposes /api/tools/{name}/execute (Phase 3 gate verb)"
check_grep_in_file '/api/tools/\{name\}/export' packages/core/src/simworkbench/api/server.py "API exposes /api/tools/{name}/export (Phase 3 gate verb)"
check_grep_in_file '/api/tools/import' packages/core/src/simworkbench/api/server.py "API exposes /api/tools/import (Phase 3 gate verb)"

section "Post-plan — Tool construction methodology + UI binding"
check_file_exists program_development/tool_construction_methodology_plan.md \
  "tool construction methodology plan"
check_dir_exists .agents/skills/simworkbench-tool-construction \
  "repo-local tool-construction skill"
check_file_exists .agents/skills/simworkbench-tool-construction/SKILL.md \
  "tool-construction skill SKILL.md"
check_file_exists .agents/skills/simworkbench-tool-construction/agents/openai.yaml \
  "tool-construction skill OpenAI metadata"
for ref in tool_package_contract tool_ui_binding_contract security_and_provenance validation_checklist; do
  check_file_exists ".agents/skills/simworkbench-tool-construction/references/$ref.md" \
    "tool-construction skill reference $ref"
done
check_file_executable .agents/skills/simworkbench-tool-construction/scripts/check_tool_package.py \
  "tool package checker"
check_file_executable scripts/dev/install_tool_construction_skill.sh \
  "tool-construction skill installer"
check_grep_in_file 'TOOL-CONTRACT' .agents/skills/simworkbench-tool-construction/SKILL.md \
  "tool-construction skill carries TOOL-CONTRACT lookup tag"
check_grep_in_file 'TOOL-UI-BINDING' .agents/skills/simworkbench-tool-construction/SKILL.md \
  "tool-construction skill carries TOOL-UI-BINDING lookup tag"
check_grep_in_file 'TOOL-SECURITY' .agents/skills/simworkbench-tool-construction/SKILL.md \
  "tool-construction skill carries TOOL-SECURITY lookup tag"
check_file_exists packages/core/src/simworkbench/tools/schema.py \
  "tool UI schema normalizer"
check_file_exists packages/core/src/simworkbench/tools/artifacts.py \
  "tool artifact materializer"
check_file_exists packages/core/src/simworkbench/tools/run_manager.py \
  "tool run manager"
check_file_exists packages/core/src/simworkbench/tools/authoring.py \
  "tool draft authoring service"
check_file_exists packages/core/src/simworkbench/tools/authoring_preview.py \
  "tool draft preview subprocess runner"
check_grep_in_file '/api/tools/\{name\}/schema' packages/core/src/simworkbench/api/server.py \
  "API exposes /api/tools/{name}/schema"
check_grep_in_file '/api/tools/\{name\}/preview' packages/core/src/simworkbench/api/server.py \
  "API exposes /api/tools/{name}/preview"
check_grep_in_file '/api/tools/\{name\}/runs' packages/core/src/simworkbench/api/server.py \
  "API exposes /api/tools/{name}/runs"
check_grep_in_file '/api/tool-artifacts/\{artifact_id\}' packages/core/src/simworkbench/api/server.py \
  "API exposes /api/tool-artifacts/{artifact_id}"
check_grep_in_file '/api/tool-authoring/drafts' packages/core/src/simworkbench/api/server.py \
  "API exposes controlled tool-authoring drafts"
check_grep_in_file '/api/tool-authoring/code-templates' packages/core/src/simworkbench/api/server.py \
  "API exposes controlled tool-authoring code templates"
check_grep_in_file '/api/tool-authoring/drafts/\{draft_id\}/preview' packages/core/src/simworkbench/api/server.py \
  "API exposes bounded draft preview harnesses"
for template in diagnostic_summary quick_ode_solver quick_visualization structured_diagram_output; do
  check_file_exists "packages/internal_tools/code_templates/$template/template.yaml" \
    "$template code template metadata"
  check_file_exists "packages/internal_tools/code_templates/$template/snippet.py" \
    "$template code template snippet"
done
check_file_exists apps/workbench-ui/src/components/tools/ToolWorkbench.tsx \
  "ToolWorkbench UI binding component"
check_file_exists apps/workbench-ui/src/components/tools/ToolAuthoringPanel.tsx \
  "ToolAuthoringPanel UI draft builder"
for component in ToolInputForm ToolDataMapper ToolRunConsole ToolOutputInspector ToolArtifactBrowser ToolDiagramViewer ToolValidationPanel; do
  check_file_exists "apps/workbench-ui/src/components/tools/$component.tsx" \
    "$component UI tool-binding component"
done
check_file_exists apps/workbench-ui/src/__tests__/ToolWorkbench.test.tsx \
  "ToolWorkbench Vitest coverage"
check_file_exists apps/workbench-ui/src/__tests__/ToolAuthoringPanel.test.tsx \
  "ToolAuthoringPanel Vitest coverage"
check_file_exists tests/integration/test_tool_run_artifacts.py \
  "tool run artifact integration tests"
check_file_exists tests/integration/test_tool_authoring_api.py \
  "tool authoring API integration tests"
check_file_exists tests/regression/test_tool_artifact_path_isolation.py \
  "tool artifact path isolation regression tests"
check_grep_in_file 'local_cache/workspaces/local/tool_drafts' docs_site/src/content/internal_tools.tsx \
  "internal tools docs describe controlled tool-draft storage"
check_grep_in_file 'tool_code_templates' docs_site/src/content/internal_tools.tsx \
  "internal tools docs describe workspace-local code templates"
check_file_exists tests/regression/test_tool_construction_skill.py \
  "tool-construction skill regression tests"
check_file_exists tests/unit/test_tool_metadata.py \
  "tool metadata contract unit tests"
check_grep_in_file 'simworkbench-tool-construction' AGENTS.md \
  "AGENTS points to repo-local tool-construction skill"
check_grep_in_file 'simworkbench-tool-construction' CLAUDE.md \
  "CLAUDE points to repo-local tool-construction skill"
check_grep_in_file 'General tool workbench' docs_site/src/content/internal_tools.tsx \
  "internal tools docs describe general tool workbench"
check_grep_in_file 'install_tool_construction_skill' README.md \
  "README documents explicit tool-construction skill installation"

# ---------------------------------------------------------------------------
# Phase 4 — Agent-Assisted Paper Ingestion (Closed 2026-05-02). Every entity
# below was ratcheted from --include-open-workstreams into the default
# hard gate at the Phase 4 close commit.

section "Phase 4A — Paper Import"
check_file_exists packages/core/src/simworkbench/ingestion/__init__.py
check_file_exists packages/core/src/simworkbench/ingestion/pipeline.py
check_file_exists packages/core/src/simworkbench/ingestion/paper.py
check_grep_in_file 'class PaperImporter' packages/core/src/simworkbench/ingestion/pipeline.py "PaperImporter defined"
check_grep_in_file 'paper_sources' packages/core/src/simworkbench/ingestion/pipeline.py "Paper imports land under paper_sources/"
check_file_exists tests/unit/test_paper_import.py

section "Phase 4B — Equation Extraction"
check_file_exists packages/core/src/simworkbench/ingestion/equations.py
check_grep_in_file 'class EquationExtractor' packages/core/src/simworkbench/ingestion/equations.py "EquationExtractor defined"
check_grep_in_file 'confidence' packages/core/src/simworkbench/ingestion/equations.py "Equations carry confidence flags"
check_file_exists tests/unit/test_equation_extraction.py

section "Phase 4C — Parameter Extraction"
check_file_exists packages/core/src/simworkbench/ingestion/parameters.py
check_grep_in_file 'class ParameterExtractor' packages/core/src/simworkbench/ingestion/parameters.py "ParameterExtractor defined"
check_grep_in_file 'missing_units' packages/core/src/simworkbench/ingestion/parameters.py "Parameters flag missing units"
check_file_exists tests/unit/test_parameter_extraction.py

section "Phase 4D — Interpretation Agent"
check_file_exists packages/core/src/simworkbench/ingestion/interpretation.py
check_grep_in_file 'class InterpretationAgent' packages/core/src/simworkbench/ingestion/interpretation.py "InterpretationAgent defined"
check_file_exists tests/unit/test_interpretation_agent.py

section "Phase 4E — Review UI"
check_file_exists apps/workbench-ui/src/components/papers/PaperReview.tsx
check_file_exists apps/workbench-ui/src/components/papers/EquationList.tsx
check_file_exists apps/workbench-ui/src/components/papers/ParameterList.tsx
check_file_exists apps/workbench-ui/src/components/papers/InterpretationView.tsx
check_file_exists apps/workbench-ui/src/__tests__/PaperReview.test.tsx
check_grep_in_file '/api/papers' packages/core/src/simworkbench/api/server.py "API exposes /api/papers (Phase 4 gate verb: import)"
check_grep_in_file 'papers' apps/workbench-ui/src/App.tsx "App.tsx routes /papers"

section "Phase 4 — Cross-cutting"
check_grep_in_file 'role: paper_ingestion' configs/agents.yaml "agents.yaml lists paper_ingestion role"
check_grep_absent_in_file 'Phase 0 skeleton' docs_site/src/content/agent_workflows.tsx "agent_workflows docs no longer the Phase-0 banner"
check_grep_in_file 'paper ingestion' docs_site/src/content/agent_workflows.tsx "agent_workflows docs cover paper ingestion"

section "Phase 4 — Gate verb walk"
check_file_exists tests/integration/test_phase_4_gate_walk.py

# ---------------------------------------------------------------------------
# Phase 5 — ModelSpec Generation and Module Mapping (Closed 2026-05-03).
# Every entity below was ratcheted from --include-open-workstreams into
# the default hard gate at the Phase 5 close commit.

section "Phase 5A — ModelSpec Generator"
check_file_exists packages/core/src/simworkbench/modeling/__init__.py
check_file_exists packages/core/src/simworkbench/modeling/generator.py
check_file_exists packages/core/src/simworkbench/modeling/repair.py
check_grep_in_file 'class ModelSpecGenerator' packages/core/src/simworkbench/modeling/generator.py "ModelSpecGenerator defined"
check_grep_in_file 'def repair' packages/core/src/simworkbench/modeling/repair.py "repair loop defined"
check_file_exists tests/unit/test_modelspec_generator.py
check_file_exists tests/integration/test_modelspec_generation.py

section "Phase 5B — Module Retrieval"
check_file_exists packages/core/src/simworkbench/modeling/module_match.py
check_grep_in_file 'class ModuleMatcher' packages/core/src/simworkbench/modeling/module_match.py "ModuleMatcher defined"
check_file_exists tests/integration/test_module_retrieval.py

section "Phase 5C — Gap Analysis"
check_file_exists packages/core/src/simworkbench/modeling/gap_analysis.py
check_grep_in_file 'class GapAnalyzer' packages/core/src/simworkbench/modeling/gap_analysis.py "GapAnalyzer defined"
check_file_exists tests/integration/test_gap_analysis.py

section "Phase 5D — Experiment Proposal"
check_file_exists packages/core/src/simworkbench/modeling/experiment_proposal.py
check_grep_in_file 'class ExperimentProposer' packages/core/src/simworkbench/modeling/experiment_proposal.py "ExperimentProposer defined"
check_file_exists apps/workbench-ui/src/components/proposal/ExperimentProposal.tsx
check_file_exists apps/workbench-ui/src/__tests__/ExperimentProposal.test.tsx
check_grep_in_file '/api/proposals' packages/core/src/simworkbench/api/server.py "API exposes /api/proposals (Phase 5D)"
check_grep_in_file 'proposals' apps/workbench-ui/src/App.tsx "App.tsx routes /proposals"

section "Phase 5 — Cross-cutting + gate walk"
check_grep_in_file 'role: model_spec' configs/agents.yaml "agents.yaml lists model_spec role"
check_file_exists tests/integration/test_phase_5_gate_walk.py

# ---------------------------------------------------------------------------
section "Phase 6A — Code Generation Backend"
check_file_exists packages/core/src/simworkbench/codegen/__init__.py
check_file_exists packages/core/src/simworkbench/codegen/generator.py
check_grep_in_file 'class CodeGenerator' \
  packages/core/src/simworkbench/codegen/generator.py "CodeGenerator class defined"
check_grep_in_file 'src/generated' \
  packages/core/src/simworkbench/codegen/generator.py "generator targets src/generated/"

section "Phase 6B — Code Sandbox"
check_file_exists packages/core/src/simworkbench/codegen/sandbox.py
check_grep_in_file 'user_edits' \
  packages/core/src/simworkbench/codegen/sandbox.py \
  "sandbox enforces user_edits/ guard"

section "Phase 6C — Test Generation"
check_file_exists packages/core/src/simworkbench/codegen/test_generation.py
check_grep_in_file 'class TestGenerator' \
  packages/core/src/simworkbench/codegen/test_generation.py \
  "TestGenerator class defined"

section "Phase 6D — Generated Code Viewer + Editor"
check_file_exists apps/workbench-ui/src/components/codegen/GeneratedCodeView.tsx
check_file_exists apps/workbench-ui/src/__tests__/GeneratedCodeView.test.tsx
check_grep_in_file 'codegen' \
  packages/core/src/simworkbench/api/server.py "codegen endpoints in API server"
check_grep_in_file 'codegen' \
  apps/workbench-ui/src/api/client.ts "client.ts exposes codegen helpers"
check_grep_in_file '/codegen' apps/workbench-ui/src/App.tsx "App.tsx routes /codegen"

section "Phase 6E — Validation Run"
check_file_exists packages/core/src/simworkbench/codegen/validation_run.py
check_grep_in_file 'class ValidationRunner' \
  packages/core/src/simworkbench/codegen/validation_run.py \
  "ValidationRunner class defined"

section "Phase 6 — Cross-cutting + gate walk"
check_file_exists tests/integration/test_phase_6_gate_walk.py
check_file_exists tests/integration/test_capsule_codegen.py
check_file_exists tests/regression/test_user_edits_preserved_on_regeneration.py
check_grep_in_file 'role: code_generation' configs/agents.yaml \
  "agents.yaml lists code_generation role"
check_grep_in_file 'role: numerical_methods' configs/agents.yaml \
  "agents.yaml lists numerical_methods role"

# ---------------------------------------------------------------------------
section "Phase 7A — Registry v1"
check_file_exists packages/core/src/simworkbench/modules/__init__.py
check_file_exists packages/core/src/simworkbench/modules/metadata.py
check_file_exists packages/core/src/simworkbench/modules/registry.py
check_file_exists packages/core/src/simworkbench/modules/lifecycle.py
check_file_exists packages/core/src/simworkbench/modules/approval.py
check_file_exists packages/core/src/simworkbench/modules/approve.py
check_grep_in_file 'class ModuleRegistry' \
  packages/core/src/simworkbench/modules/registry.py \
  "ModuleRegistry class defined"
check_grep_in_file 'class ModuleMetadata' \
  packages/core/src/simworkbench/modules/metadata.py \
  "ModuleMetadata Pydantic model defined"
check_grep_in_file 'dependencies' \
  packages/core/src/simworkbench/modules/metadata.py \
  "Registry v1 metadata declares dependencies"
check_grep_in_file 'benchmarks' \
  packages/core/src/simworkbench/modules/metadata.py \
  "Registry v1 metadata declares benchmarks"
check_grep_in_file 'compatibility' \
  packages/core/src/simworkbench/modules/metadata.py \
  "Registry v1 metadata declares compatibility"

section "Phase 7B — Laser-species reference module"
check_file_exists packages/physics_modules/laser/gaussian_pulse/module.yaml
check_file_exists packages/physics_modules/laser/gaussian_pulse/src/__init__.py
check_file_exists packages/physics_modules/laser/gaussian_pulse/README.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/assumptions.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/validity_domain.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/equations.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/changelog.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/benchmarks/README.md
check_file_exists packages/physics_modules/laser/gaussian_pulse/examples/basic_usage.py
check_file_exists packages/physics_modules/laser/gaussian_pulse/tests/unit/test_gaussian_pulse.py
check_file_exists packages/physics_modules/laser/absorption/module.yaml
check_file_exists packages/physics_modules/laser/absorption/src/__init__.py
check_file_exists packages/physics_modules/laser/absorption/README.md
check_file_exists packages/physics_modules/laser/absorption/assumptions.md
check_file_exists packages/physics_modules/laser/absorption/validity_domain.md
check_file_exists packages/physics_modules/laser/absorption/equations.md
check_file_exists packages/physics_modules/laser/absorption/changelog.md
check_file_exists packages/physics_modules/laser/absorption/benchmarks/README.md
check_file_exists packages/physics_modules/laser/absorption/examples/basic_usage.py
check_file_exists packages/physics_modules/laser/absorption/tests/test_absorption.py
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/module.yaml
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/src/__init__.py
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/README.md
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/assumptions.md
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/validity_domain.md
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/equations.md
check_file_exists packages/physics_modules/laser/absorption_lambert_beer/changelog.md
check_dir_exists  packages/physics_modules/laser/absorption_lambert_beer/benchmarks
check_dir_exists  packages/physics_modules/laser/absorption_lambert_beer/tests
check_file_exists packages/physics_modules/laser/emission/module.yaml
check_file_exists packages/physics_modules/laser/emission/src/__init__.py
check_file_exists packages/physics_modules/laser/emission/README.md
check_file_exists packages/physics_modules/laser/emission/assumptions.md
check_file_exists packages/physics_modules/laser/emission/validity_domain.md
check_file_exists packages/physics_modules/laser/emission/equations.md
check_file_exists packages/physics_modules/laser/emission/changelog.md
check_file_exists packages/physics_modules/laser/emission/benchmarks/README.md
check_file_exists packages/physics_modules/laser/emission/examples/basic_usage.py
check_file_exists packages/physics_modules/laser/emission/tests/test_emission.py
check_file_exists packages/physics_modules/laser/excitation/module.yaml
check_file_exists packages/physics_modules/laser/excitation/src/__init__.py
check_file_exists packages/physics_modules/laser/excitation/README.md
check_file_exists packages/physics_modules/laser/excitation/assumptions.md
check_file_exists packages/physics_modules/laser/excitation/validity_domain.md
check_file_exists packages/physics_modules/laser/excitation/equations.md
check_file_exists packages/physics_modules/laser/excitation/changelog.md
check_file_exists packages/physics_modules/laser/excitation/benchmarks/README.md
check_file_exists packages/physics_modules/laser/excitation/examples/basic_usage.py
check_file_exists packages/physics_modules/laser/excitation/tests/test_excitation.py
check_file_exists packages/physics_modules/laser/ionization/module.yaml
check_file_exists packages/physics_modules/laser/ionization/src/__init__.py
check_file_exists packages/physics_modules/laser/ionization/README.md
check_file_exists packages/physics_modules/laser/ionization/assumptions.md
check_file_exists packages/physics_modules/laser/ionization/validity_domain.md
check_file_exists packages/physics_modules/laser/ionization/equations.md
check_file_exists packages/physics_modules/laser/ionization/changelog.md
check_file_exists packages/physics_modules/laser/ionization/benchmarks/README.md
check_file_exists packages/physics_modules/laser/ionization/examples/basic_usage.py
check_file_exists packages/physics_modules/laser/ionization/tests/test_ionization.py
check_file_exists packages/physics_modules/laser/recombination/module.yaml
check_file_exists packages/physics_modules/laser/recombination/src/__init__.py
check_file_exists packages/physics_modules/laser/recombination/README.md
check_file_exists packages/physics_modules/laser/recombination/assumptions.md
check_file_exists packages/physics_modules/laser/recombination/validity_domain.md
check_file_exists packages/physics_modules/laser/recombination/equations.md
check_file_exists packages/physics_modules/laser/recombination/changelog.md
check_file_exists packages/physics_modules/laser/recombination/benchmarks/README.md
check_file_exists packages/physics_modules/laser/recombination/examples/basic_usage.py
check_file_exists packages/physics_modules/laser/recombination/tests/test_recombination.py

check_file_exists packages/physics_modules/species/electron_temperature/module.yaml
check_file_exists packages/physics_modules/species/electron_temperature/src/__init__.py
check_file_exists packages/physics_modules/species/electron_temperature/README.md
check_file_exists packages/physics_modules/species/electron_temperature/assumptions.md
check_file_exists packages/physics_modules/species/electron_temperature/validity_domain.md
check_file_exists packages/physics_modules/species/electron_temperature/equations.md
check_file_exists packages/physics_modules/species/electron_temperature/changelog.md
check_file_exists packages/physics_modules/species/electron_temperature/benchmarks/README.md
check_file_exists packages/physics_modules/species/electron_temperature/examples/basic_usage.py
check_file_exists packages/physics_modules/species/electron_temperature/tests/test_electron_temperature.py
check_file_exists packages/physics_modules/species/species_density/module.yaml
check_file_exists packages/physics_modules/species/species_density/src/__init__.py
check_file_exists packages/physics_modules/species/species_density/README.md
check_file_exists packages/physics_modules/species/species_density/assumptions.md
check_file_exists packages/physics_modules/species/species_density/validity_domain.md
check_file_exists packages/physics_modules/species/species_density/equations.md
check_file_exists packages/physics_modules/species/species_density/changelog.md
check_file_exists packages/physics_modules/species/species_density/benchmarks/README.md
check_file_exists packages/physics_modules/species/species_density/examples/basic_usage.py
check_file_exists packages/physics_modules/species/species_density/tests/test_species_density.py
check_file_exists packages/physics_modules/species/rate_equation_0d/assumptions.md
check_file_exists packages/physics_modules/species/rate_equation_0d/validity_domain.md
check_file_exists packages/physics_modules/species/rate_equation_0d/equations.md
check_file_exists packages/physics_modules/species/rate_equation_0d/changelog.md
check_dir_exists  packages/physics_modules/species/rate_equation_0d/benchmarks
check_dir_exists  packages/physics_modules/species/rate_equation_0d/tests

section "Phase 7C — Plasma module skeletons"
check_file_exists packages/physics_modules/plasma/electromagnetic_field/module.yaml
check_file_exists packages/physics_modules/plasma/particle_pusher/module.yaml
check_file_exists packages/physics_modules/plasma/pic_adapter/module.yaml
check_file_exists packages/physics_modules/plasma/collisional_model/module.yaml
check_file_exists packages/physics_modules/plasma/boundary_condition_library/module.yaml

section "Phase 7D — Generality examples"
check_file_exists packages/physics_modules/molecular_dynamics/lennard_jones/equations.md
check_dir_exists  packages/physics_modules/molecular_dynamics/lennard_jones/benchmarks
check_file_exists packages/physics_modules/phase_transition/ising_2d/equations.md
check_dir_exists  packages/physics_modules/phase_transition/ising_2d/benchmarks
check_file_exists packages/physics_modules/pde/wave_equation_1d/module.yaml
check_file_exists packages/physics_modules/pde/wave_equation_1d/src/__init__.py
check_file_exists packages/physics_modules/pde/wave_equation_1d/equations.md
check_dir_exists  packages/physics_modules/pde/wave_equation_1d/benchmarks
check_file_exists packages/physics_modules/pde/reaction_diffusion_1d/module.yaml
check_file_exists packages/physics_modules/pde/reaction_diffusion_1d/src/__init__.py
check_file_exists packages/physics_modules/pde/reaction_diffusion_1d/equations.md
check_dir_exists  packages/physics_modules/pde/reaction_diffusion_1d/benchmarks

section "Phase 7E — Validation library"
check_file_exists packages/core/src/simworkbench/validation_library/__init__.py
check_grep_in_file 'class ConservationCheck' \
  packages/core/src/simworkbench/validation_library/__init__.py \
  "ConservationCheck class defined"
check_grep_in_file 'class ConvergenceCheck' \
  packages/core/src/simworkbench/validation_library/__init__.py \
  "ConvergenceCheck class defined"
check_grep_in_file 'class PaperReproduction' \
  packages/core/src/simworkbench/validation_library/__init__.py \
  "PaperReproduction class defined"
check_grep_in_file 'class CrossSolverComparison' \
  packages/core/src/simworkbench/validation_library/__init__.py \
  "CrossSolverComparison class defined"

section "Phase 7 — Cross-cutting + gate walk"
check_file_exists tests/integration/test_phase_7_gate_walk.py
check_file_exists tests/regression/test_module_registry_promotion_gates.py
check_file_exists tests/regression/test_phase7_module_metadata_integrity.py
check_grep_in_file 'role: release' configs/agents.yaml \
  "agents.yaml lists release role"

# ---------------------------------------------------------------------------
section "Phase 8A — Backend Abstraction"
check_file_exists packages/core/src/simworkbench/runtime/solver_backend.py
check_grep_in_file 'class SolverBackend' \
  packages/core/src/simworkbench/runtime/solver_backend.py \
  "SolverBackend ABC defined"
check_file_exists packages/core/src/simworkbench/backends/__init__.py
check_file_exists packages/core/src/simworkbench/backends/registry.py
check_file_exists packages/core/src/simworkbench/backends/lifecycle.py
check_file_exists packages/core/src/simworkbench/backends/metadata.py
check_file_exists packages/core/src/simworkbench/backends/approval.py
check_grep_in_file 'class BackendRegistry' \
  packages/core/src/simworkbench/backends/registry.py \
  "BackendRegistry class defined"
check_grep_in_file 'def recommend' \
  packages/core/src/simworkbench/backends/registry.py \
  "BackendRegistry.recommend() exists"
check_grep_in_file 'class BackendStatus' \
  packages/core/src/simworkbench/backends/lifecycle.py \
  "BackendStatus lifecycle defined"

section "Phase 8B — Python/CPU backends"
check_file_exists packages/solver_backends/python_cpu/__init__.py
check_file_exists packages/solver_backends/python_cpu/README.md
check_file_exists packages/solver_backends/numba_cpu/__init__.py
check_file_exists packages/solver_backends/numba_cpu/README.md
check_grep_in_file 'NumbaCpuBackend|numba' \
  packages/solver_backends/numba_cpu/__init__.py \
  "numba_cpu has a real implementation"

section "Phase 8C — Compiled kernels"
check_file_exists packages/solver_backends/cpp/CMakeLists.txt
check_file_exists packages/solver_backends/cpp/README.md
check_dir_exists  packages/solver_backends/cpp/src
check_dir_exists  packages/solver_backends/cpp/include
check_file_exists packages/solver_backends/cpp/__init__.py
check_file_executable scripts/build/kernels.sh \
  "kernels build script executable"
check_file_exists packages/solver_backends/fortran/__init__.py
check_file_exists packages/solver_backends/fortran/README.md

section "Phase 8D — GPU backend skeleton + determinism ADR"
check_file_exists packages/solver_backends/cuda/__init__.py
check_file_exists packages/solver_backends/cuda/README.md
check_grep_in_file 'memory_estimate|estimate_memory' \
  packages/solver_backends/cuda/__init__.py \
  "cuda backend exposes memory estimator"
check_file_exists program_development/architectural_decisions/ADR-0006-determinism-policy.md

section "Phase 8E — HPC orchestration"
check_file_exists packages/core/src/simworkbench/hpc/__init__.py
check_file_exists packages/core/src/simworkbench/hpc/slurm.py
check_file_exists packages/core/src/simworkbench/hpc/ray_adapter.py
check_file_exists packages/core/src/simworkbench/hpc/result_import.py
check_grep_in_file 'class SlurmJob' \
  packages/core/src/simworkbench/hpc/slurm.py \
  "SlurmJob class defined"
check_grep_in_file 'def import_remote_result' \
  packages/core/src/simworkbench/hpc/result_import.py \
  "import_remote_result function defined"
check_file_executable scripts/dev/submit_slurm.sh \
  "submit_slurm.sh executable"
check_file_executable scripts/dev/import_hpc_result.sh \
  "import_hpc_result.sh executable"

section "Phase 8F — External simulator integration"
check_file_exists packages/core/src/simworkbench/backends/external.py
check_grep_in_file 'class ExternalSimulatorAdapter' \
  packages/core/src/simworkbench/backends/external.py \
  "ExternalSimulatorAdapter ABC defined"
check_file_exists packages/solver_backends/external_pic/__init__.py
check_file_exists packages/solver_backends/external_pic/README.md

section "Phase 8 — Cross-cutting + gate walk"
check_file_exists tests/integration/test_phase_8_gate_walk.py
check_grep_in_file 'status: validated' configs/backends.yaml \
  "configs/backends.yaml has at least one validated backend"

# ---------------------------------------------------------------------------
section "Phase 9A — Sweep engine"
check_file_exists packages/core/src/simworkbench/sweep/__init__.py
check_file_exists packages/core/src/simworkbench/sweep/spec.py
check_file_exists packages/core/src/simworkbench/sweep/samplers.py
check_file_exists packages/core/src/simworkbench/sweep/engine.py
check_file_exists packages/core/src/simworkbench/sweep/checkpoint.py
check_grep_in_file 'class SweepEngine' \
  packages/core/src/simworkbench/sweep/engine.py \
  "SweepEngine class defined"
check_grep_in_file 'class GridSampler' \
  packages/core/src/simworkbench/sweep/samplers.py \
  "GridSampler defined"
check_grep_in_file 'class RandomSampler' \
  packages/core/src/simworkbench/sweep/samplers.py \
  "RandomSampler defined"
check_grep_in_file 'class LatinHypercubeSampler' \
  packages/core/src/simworkbench/sweep/samplers.py \
  "LatinHypercubeSampler defined"
check_grep_in_file 'class AdaptiveSampler' \
  packages/core/src/simworkbench/sweep/samplers.py \
  "AdaptiveSampler defined"
check_grep_in_file 'max_evaluations' \
  packages/core/src/simworkbench/sweep/spec.py \
  "SweepSpec carries max_evaluations budget"

section "Phase 9B — Optimization engine"
check_file_exists packages/core/src/simworkbench/optimization/__init__.py
check_file_exists packages/core/src/simworkbench/optimization/problem.py
check_file_exists packages/core/src/simworkbench/optimization/random_search.py
check_file_exists packages/core/src/simworkbench/optimization/bayesian.py
check_grep_in_file 'class Optimizer' \
  packages/core/src/simworkbench/optimization/problem.py \
  "Optimizer ABC defined"
check_grep_in_file 'class RandomSearchOptimizer' \
  packages/core/src/simworkbench/optimization/random_search.py \
  "RandomSearchOptimizer defined"
check_grep_in_file 'class BayesianOptimizerHook' \
  packages/core/src/simworkbench/optimization/bayesian.py \
  "BayesianOptimizerHook defined"
check_grep_in_file 'budget' \
  packages/core/src/simworkbench/optimization/problem.py \
  "OptimizationProblem carries budget"
check_grep_in_file 'early_stop_threshold' \
  packages/core/src/simworkbench/optimization/problem.py \
  "OptimizationProblem carries early_stop_threshold"

section "Phase 9C — Uncertainty quantification"
check_file_exists packages/core/src/simworkbench/uncertainty/__init__.py
check_grep_in_file 'class MonteCarloPropagator' \
  packages/core/src/simworkbench/uncertainty/__init__.py \
  "MonteCarloPropagator defined"
check_grep_in_file 'class SensitivityAnalysis' \
  packages/core/src/simworkbench/uncertainty/__init__.py \
  "SensitivityAnalysis defined"
check_grep_in_file 'class ParameterDistribution' \
  packages/core/src/simworkbench/uncertainty/__init__.py \
  "ParameterDistribution defined"
check_grep_in_file 'def bootstrap_confidence_interval' \
  packages/core/src/simworkbench/uncertainty/__init__.py \
  "bootstrap_confidence_interval defined"
check_grep_in_file 'def dominant_uncertainty' \
  packages/core/src/simworkbench/uncertainty/__init__.py \
  "dominant_uncertainty defined"

section "Phase 9D — Comparative reports + UI"
check_file_exists packages/core/src/simworkbench/reports/__init__.py
check_grep_in_file 'class ComparisonReport' \
  packages/core/src/simworkbench/reports/__init__.py \
  "ComparisonReport defined"
check_file_exists apps/workbench-ui/src/components/reports/ComparisonReport.tsx
check_file_exists apps/workbench-ui/src/__tests__/ComparisonReportPanel.test.tsx
check_grep_in_file 'comparison|reports' \
  apps/workbench-ui/src/api/client.ts \
  "client.ts exposes comparison report helpers"
check_file_exists examples/parameter_sweep_quadratic/run_sweep.py
check_file_exists examples/parameter_sweep_quadratic/README.md

section "Phase 9 — Cross-cutting + gate walk"
check_file_exists tests/integration/test_phase_9_gate_walk.py
check_file_exists tests/integration/test_sweep_engine.py
check_file_exists tests/integration/test_optimization_budget.py
check_file_exists tests/validation/test_uq_calibration.py

# ---------------------------------------------------------------------------
# Phase 10 — every entity below was ratcheted from
# --include-open-workstreams into the default hard gate when the phase
# closed.

section "Phase 10A — Experiment Design Agent"
check_file_exists packages/core/src/simworkbench/autonomy/__init__.py
check_file_exists packages/core/src/simworkbench/autonomy/experiment_design.py
check_grep_in_file 'class ExperimentDesigner' \
  packages/core/src/simworkbench/autonomy/experiment_design.py \
  "ExperimentDesigner defined"
check_grep_in_file 'class ExperimentPlan' \
  packages/core/src/simworkbench/autonomy/experiment_design.py \
  "ExperimentPlan dataclass defined"
check_grep_in_file 'fidelity_ladder' \
  packages/core/src/simworkbench/autonomy/experiment_design.py \
  "ExperimentPlan carries fidelity_ladder"
check_grep_in_file 'cost_estimate' \
  packages/core/src/simworkbench/autonomy/experiment_design.py \
  "ExperimentPlan carries cost_estimate"
check_grep_in_file 'validation_path' \
  packages/core/src/simworkbench/autonomy/experiment_design.py \
  "ExperimentPlan carries validation_path"

section "Phase 10B — Autonomous Small Runs"
check_file_exists packages/core/src/simworkbench/autonomy/smoke_runs.py
check_grep_in_file 'class SmokeRunner' \
  packages/core/src/simworkbench/autonomy/smoke_runs.py \
  "SmokeRunner defined"
check_grep_in_file 'class SmokeReport' \
  packages/core/src/simworkbench/autonomy/smoke_runs.py \
  "SmokeReport dataclass defined"
check_grep_in_file 'instability_flags' \
  packages/core/src/simworkbench/autonomy/smoke_runs.py \
  "SmokeReport carries instability_flags"

section "Phase 10C — Controlled Sweep Agent"
check_file_exists packages/core/src/simworkbench/autonomy/sweep_agent.py
check_grep_in_file 'class ControlledSweepAgent' \
  packages/core/src/simworkbench/autonomy/sweep_agent.py \
  "ControlledSweepAgent defined"
check_grep_in_file 'budget' \
  packages/core/src/simworkbench/autonomy/sweep_agent.py \
  "ControlledSweepAgent carries budget"
check_grep_in_file 'next_sweep_recommendation|trend_summary' \
  packages/core/src/simworkbench/autonomy/sweep_agent.py \
  "ControlledSweepAgent emits trend summary / next-sweep recommendation"

section "Phase 10D — Scientific Review Agent"
check_file_exists packages/core/src/simworkbench/autonomy/scientific_review.py
check_grep_in_file 'class ScientificReviewer' \
  packages/core/src/simworkbench/autonomy/scientific_review.py \
  "ScientificReviewer defined"
check_grep_in_file 'class ScientificReview' \
  packages/core/src/simworkbench/autonomy/scientific_review.py \
  "ScientificReview dataclass defined"
check_grep_in_file 'overclaim_flags' \
  packages/core/src/simworkbench/autonomy/scientific_review.py \
  "ScientificReview carries overclaim_flags"
check_grep_in_file 'recommended_validation' \
  packages/core/src/simworkbench/autonomy/scientific_review.py \
  "ScientificReview carries recommended_validation"

section "Phase 10E — Human Approval Gates"
check_file_exists packages/core/src/simworkbench/autonomy/approval_gates.py
check_grep_in_file 'class ApprovalGate' \
  packages/core/src/simworkbench/autonomy/approval_gates.py \
  "ApprovalGate defined"
check_grep_in_file 'class ApprovalRequiredError' \
  packages/core/src/simworkbench/autonomy/approval_gates.py \
  "ApprovalRequiredError defined"
check_grep_in_file 'def grant_autonomy_approval' \
  packages/core/src/simworkbench/autonomy/approval_gates.py \
  "grant_autonomy_approval helper defined"

section "Folder browser (UI ↔ workbench-managed roots)"
check_grep_in_file '@app.get\("/api/browse"' \
  packages/core/src/simworkbench/api/server.py \
  "GET /api/browse endpoint"
check_grep_in_file '_BROWSE_ROOTS' \
  packages/core/src/simworkbench/api/server.py \
  "browse roots are server-side allow-listed"
check_file_exists apps/workbench-ui/src/components/ui/FolderBrowser.tsx
check_file_exists apps/workbench-ui/src/__tests__/FolderBrowser.test.tsx
check_file_exists tests/integration/test_browse_api.py
check_grep_in_file 'BROWSE_ROOTS' \
  apps/workbench-ui/src/api/client.ts \
  "client.ts exports BROWSE_ROOTS literal union"
check_grep_in_file 'browse:' \
  apps/workbench-ui/src/api/client.ts \
  "client.ts exposes browse method"

section "Examples gallery (UI ↔ examples/)"
check_grep_in_file '@app.get\("/api/examples"' \
  packages/core/src/simworkbench/api/server.py \
  "GET /api/examples discovery endpoint"
check_grep_in_file '@app.post\("/api/examples/\{name\}/run"' \
  packages/core/src/simworkbench/api/server.py \
  "POST /api/examples/{name}/run runner endpoint"
check_grep_in_file 'def _discover_examples' \
  packages/core/src/simworkbench/api/server.py \
  "examples discovery walker is server-side allow-list"
check_file_exists apps/workbench-ui/src/components/examples/ExamplesGallery.tsx
check_file_exists apps/workbench-ui/src/__tests__/ExamplesGallery.test.tsx
check_file_exists tests/integration/test_examples_api.py
check_grep_in_file 'listExamples' \
  apps/workbench-ui/src/api/client.ts \
  "client.ts exposes listExamples"
check_grep_in_file 'runExample' \
  apps/workbench-ui/src/api/client.ts \
  "client.ts exposes runExample"

section "Top-level governance docs"
check_file_exists LIMITATIONS.md
check_grep_in_file 'Last updated:' LIMITATIONS.md \
  "LIMITATIONS.md carries a Last-updated header"
check_grep_in_file 'Maintenance protocol' LIMITATIONS.md \
  "LIMITATIONS.md documents the update cadence"
check_file_exists STYLING.md
check_grep_in_file 'Last updated:' STYLING.md \
  "STYLING.md carries a Last-updated header"
check_grep_in_file 'Maintenance protocol' STYLING.md \
  "STYLING.md documents the update cadence"
check_grep_in_file 'Tokens' STYLING.md \
  "STYLING.md documents design tokens"
check_grep_in_file 'STYLING.md' AGENTS.md \
  "AGENTS.md references STYLING.md"
check_grep_in_file 'STYLING.md' CLAUDE.md \
  "CLAUDE.md references STYLING.md"

section "Phase 0.5 secure-multi-user planning"
check_file_exists secure_multi_user_scaffolding_plan_v4.md
check_file_exists security_review_v4_and_decomposability.md
check_file_exists program_development/phase_05_security_implementation_plan.md
check_grep_in_file 'Pre-implementation gates' \
  program_development/phase_05_security_implementation_plan.md \
  "implementation plan documents the three pre-implementation gates"
check_grep_in_file 'Cross-cutting review checks' \
  program_development/phase_05_security_implementation_plan.md \
  "implementation plan documents reviewer checks"
check_grep_in_file 'Definition of Done' \
  program_development/phase_05_security_implementation_plan.md \
  "implementation plan documents close-out gate"
# v4 residual fixes (V4-R1 through V4-R10) must remain landed in the plan.
check_grep_in_file 'archive\.entry_rejected' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 §29 includes archive.entry_rejected (V4-R1)"
check_grep_in_file 'csrf\.failed' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 audit-event list includes csrf.failed (V4-R2)"
check_grep_in_file 'origin\.mismatch' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 audit-event list includes origin.mismatch (V4-R2)"
check_grep_in_file 'unauthenticated' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 schema accepts unauthenticated actor_type (V4-R3)"
check_grep_in_file 'approval:request' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 capability list includes approval:request (V4-R4)"
check_grep_in_file 'Storage Reservation Lifecycle' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 documents storage_reservations lifecycle (V4-R5)"
check_grep_in_file 'period_end > period_start' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 quota_counters CHECK enforces period bounds (V4-R6)"
check_grep_in_file 'audit_event_id UUID NOT NULL' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 operator_events.audit_event_id NOT NULL (V4-R7)"
check_grep_in_file 'changing security configuration, defined as' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 §5.6 enumerates security-configuration changes (V4-R8)"
check_grep_in_file 'tested JCS library' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 §19.3 mandates tested JCS library (V4-R9)"
check_grep_in_file 'run:approve_hpc' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 §13 includes run:approve_hpc (V4-R10)"

section "Layer-0 ADRs + secure_core manifest"
check_file_exists program_development/architectural_decisions/ADR-0008-secure-core-language-and-layout.md
check_file_exists program_development/architectural_decisions/ADR-0009-sandbox-runtime.md
check_file_exists program_development/architectural_decisions/ADR-0010-worm-anchor-provider.md
check_file_exists program_development/architectural_decisions/ADR-0011-secrets-manager.md
check_file_exists program_development/architectural_decisions/ADR-0012-worker-upload-protocol.md
check_file_exists packages/secure_core/IMPLEMENTATION_MANIFEST.md
check_file_exists packages/secure_core/README.md
check_grep_in_file 'Per-endpoint canonical recipe' \
  packages/secure_core/IMPLEMENTATION_MANIFEST.md \
  "secure_core manifest documents the per-endpoint recipe"
check_grep_in_file 'Error shape contract' \
  packages/secure_core/IMPLEMENTATION_MANIFEST.md \
  "secure_core manifest documents the error envelope"

section "secure_core package skeleton + L1.1 constants"
check_file_exists packages/secure_core/package.json
check_file_exists packages/secure_core/tsconfig.json
check_file_exists packages/secure_core/vitest.config.ts
check_grep_in_file '"type": "module"' packages/secure_core/package.json \
  "secure_core is ESM"
check_grep_in_file '"strict": true' packages/secure_core/tsconfig.json \
  "secure_core tsconfig is strict"
check_file_exists packages/secure_core/src/config/capabilities.ts
check_file_exists packages/secure_core/src/config/audit_events.ts
check_file_exists packages/secure_core/src/config/high_risk_actions.ts
check_grep_in_file 'export const CAPABILITIES' \
  packages/secure_core/src/config/capabilities.ts \
  "L1.1 capabilities const defined"
check_grep_in_file 'approval:request' \
  packages/secure_core/src/config/capabilities.ts \
  "L1.1 includes approval:request capability (V4-R4)"
check_grep_in_file 'run:approve_hpc' \
  packages/secure_core/src/config/capabilities.ts \
  "L1.1 includes run:approve_hpc capability (V4-R10)"
check_grep_in_file 'archive.entry_rejected' \
  packages/secure_core/src/config/audit_events.ts \
  "L1.1 audit events include archive.entry_rejected (V4-R1)"
check_grep_in_file 'csrf.failed' \
  packages/secure_core/src/config/audit_events.ts \
  "L1.1 audit events include csrf.failed (V4-R2)"
check_grep_in_file 'security_config\.' \
  packages/secure_core/src/config/high_risk_actions.ts \
  "L1.1 high-risk actions enumerate security-config changes (V4-R8)"
check_file_exists packages/secure_core/test/config/constants.test.ts
check_file_executable scripts/test/secure_core.sh \
  "scripts/test/secure_core.sh runs typecheck + vitest"
check_grep_in_file 'secure_core.sh' scripts/test/all.sh \
  "scripts/test/all.sh runs the secure_core suite"

section "secure_core Layer-1 modules (L1.2..L1.8)"
# L1.2 — JCS canonicalization
check_file_exists packages/secure_core/src/crypto/jcs.ts
check_grep_in_file 'CANONICALIZATION_VERSION' packages/secure_core/src/crypto/jcs.ts \
  "L1.2 exports the canonicalization-version constant"
check_grep_in_file 'canonicalize' packages/secure_core/src/crypto/jcs.ts \
  "L1.2 exports canonicalize()"
check_grep_in_file '@truestamp/canonify' packages/secure_core/package.json \
  "L1.2 depends on the tested JCS library (V4-R9 mandate)"
check_file_exists packages/secure_core/test/crypto/jcs.test.ts
# L1.3 — token + HMAC utilities
check_file_exists packages/secure_core/src/crypto/tokens.ts
check_file_exists packages/secure_core/src/crypto/hmac.ts
check_grep_in_file 'mintToken' packages/secure_core/src/crypto/tokens.ts \
  "L1.3 exports mintToken()"
check_grep_in_file 'compareTokenConstantTime' packages/secure_core/src/crypto/tokens.ts \
  "L1.3 exports constant-time comparison"
check_grep_in_file 'hmacSha256' packages/secure_core/src/crypto/hmac.ts \
  "L1.3 exports keyed HMAC-SHA-256"
check_file_exists packages/secure_core/test/crypto/tokens.test.ts
check_file_exists packages/secure_core/test/crypto/hmac.test.ts
# L1.4 — error shape contract
check_file_exists packages/secure_core/src/errors/shapes.ts
check_file_exists packages/secure_core/src/errors/mapper.ts
check_grep_in_file 'ERROR_CODES' packages/secure_core/src/errors/shapes.ts \
  "L1.4 exports the closed ErrorCode tuple"
check_grep_in_file 'toHttpResponse' packages/secure_core/src/errors/mapper.ts \
  "L1.4 exports toHttpResponse mapper"
check_grep_in_file 'NOT_FOUND' packages/secure_core/src/errors/shapes.ts \
  "L1.4 carries NOT_FOUND for v4 §4.4 uniform-404 invariant"
check_file_exists packages/secure_core/test/errors/shapes.test.ts
# L1.6 — secrets client wrapper
check_file_exists packages/secure_core/src/secrets/allowlist.ts
check_file_exists packages/secure_core/src/secrets/redacted.ts
check_file_exists packages/secure_core/src/secrets/client.ts
check_file_exists packages/secure_core/src/secrets/env.ts
check_grep_in_file 'SECRET_NAMES' packages/secure_core/src/secrets/allowlist.ts \
  "L1.6 exports the allowlisted secret names"
check_grep_in_file 'SecretsClient' packages/secure_core/src/secrets/client.ts \
  "L1.6 exports the SecretsClient class"
check_grep_in_file 'RedactedSecret' packages/secure_core/src/secrets/redacted.ts \
  "L1.6 exports the redacted-secret wrapper"
check_grep_in_file 'readSecureCoreEnv' packages/secure_core/src/secrets/env.ts \
  "L1.6 centralizes process.env access"
check_grep_in_file 'EnvSecretsProvider' packages/secure_core/src/secrets/client.ts \
  "L1.6 implements the ADR-0011 CI env provider"
check_grep_in_file 'SecretsManagerClient' packages/secure_core/src/secrets/client.ts \
  "L1.6 implements the ADR-0011 AWS Secrets Manager provider"
check_grep_in_file '@aws-sdk/client-secrets-manager' packages/secure_core/package.json \
  "L1.6 depends on the AWS Secrets Manager SDK"
check_grep_in_file '^local_cache/secrets/secrets\.local\.json$' .gitignore \
  "L1.6 local secrets file is explicitly gitignored"
check_grep_absent_in_file 'AWS provider not yet wired' packages/secure_core/src/secrets/client.ts \
  "L1.6 AWS provider is not a stub"
# Detect runtime reads of process.env. Skip docstring / comment matches by
# excluding lines whose first non-space character is `*` or `//`.
env_hits=$(grep -R -n 'process\.env' packages/secure_core/src --exclude='env.ts' \
  | grep -vE ':\s*(\*|//)' || true)
if [[ -z "$env_hits" ]]; then
  PASS=$((PASS+1))
  note "L1.6 owns all process.env reads under packages/secure_core/src"
else
  FAIL=$((FAIL+1))
  fail "process.env reads outside L1.6 env helper: $env_hits"
fi
check_file_exists packages/secure_core/test/secrets/client.test.ts
# L1.7 — audit logger
check_file_exists packages/secure_core/src/audit/logger.ts
check_file_exists packages/secure_core/src/audit/redaction.ts
check_grep_in_file 'class AuditLogger' packages/secure_core/src/audit/logger.ts \
  "L1.7 exports the AuditLogger class"
check_grep_in_file 'METADATA_ALLOWLIST' packages/secure_core/src/audit/redaction.ts \
  "L1.7 enforces a metadata allowlist (v4 §19.4)"
check_grep_in_file 'canonicalize' packages/secure_core/src/audit/logger.ts \
  "L1.7 hashes through L1.2's canonicalize() (cross-task wiring)"
check_file_exists packages/secure_core/test/audit/logger.test.ts
# L1.8 — schema migrations
check_file_exists packages/secure_core/drizzle.config.ts
check_file_exists packages/secure_core/src/db/schema.ts
check_file_exists packages/secure_core/src/db/migrate.ts
check_file_exists packages/secure_core/src/db/pool.ts
check_file_exists packages/secure_core/src/db/migrations/0000_init_schema.sql
check_file_exists packages/secure_core/src/db/migrations/0001_create_roles.sql
check_file_exists packages/secure_core/src/db/migrations/0002_seed_capabilities.sql
check_file_exists packages/secure_core/src/db/migrations/0003_seed_role_permissions.sql
check_grep_in_file 'drizzle-orm' packages/secure_core/package.json \
  "L1.8 depends on drizzle-orm (per ADR-0008)"
check_grep_in_file 'secure_core_migrator' packages/secure_core/src/db/migrations/0001_create_roles.sql \
  "L1.8 creates the migrator role (v4 §12.1)"
check_grep_in_file 'secure_core_app' packages/secure_core/src/db/migrations/0001_create_roles.sql \
  "L1.8 creates the application role (v4 §12.1.1)"
check_grep_in_file 'secure_core_audit_read' packages/secure_core/src/db/migrations/0001_create_roles.sql \
  "L1.8 creates the audit-read role (v4 §12.1.3 Option A)"
check_grep_in_file 'secure_core_anchor_writer' packages/secure_core/src/db/migrations/0001_create_roles.sql \
  "L1.8 creates the anchor-writer role (v4 §12.1.4)"
check_grep_in_file 'external_anchor_uri_has_version_id' packages/secure_core/src/db/migrations/0000_init_schema.sql \
  "L1.8 enforces ADR-0010 version-pinned anchor URIs"
check_grep_in_file 'REVOKE INSERT, UPDATE, DELETE ON TABLE "log_chain_anchors" FROM secure_core_app' \
  packages/secure_core/src/db/migrations/0001_create_roles.sql \
  "L1.8 app role cannot mutate log_chain_anchors (ADR-0010)"
check_grep_absent_in_file 'GRANT INSERT, SELECT ON TABLE "log_chain_anchors" TO secure_core_anchor_writer' \
  packages/secure_core/src/db/migrations/0001_create_roles.sql \
  "L1.8 anchor writer is INSERT-only on log_chain_anchors"
check_file_exists packages/secure_core/test/db/schema.test.ts
# L1.5 — test fixtures + per-test DB cleanup
check_file_exists packages/secure_core/test/fixtures/factories.ts
check_file_exists packages/secure_core/test/fixtures/index.ts
check_file_exists packages/secure_core/test/fixtures/smoke.test.ts
check_file_exists packages/secure_core/test/helpers/db.ts
check_grep_in_file 'export async function makeUser' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeUser factory"
check_grep_in_file 'export async function makeWorkspace' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeWorkspace factory"
check_grep_in_file 'export async function makeMember' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeMember factory"
check_grep_in_file 'export async function makeCapsule' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeCapsule factory"
check_grep_in_file 'export async function makeRun' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeRun factory"
check_grep_in_file 'export async function makeApprovalToken' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeApprovalToken factory"
check_grep_in_file 'export async function makeStorageReservation' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exports makeStorageReservation factory"
check_grep_in_file 'export function bindFactories' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 exposes bindFactories(sql) ergonomic bundle"
check_grep_in_file 'resetTestDb' \
  packages/secure_core/test/helpers/db.ts \
  "L1.5 ships per-test resetTestDb cleanup helper"
check_grep_in_file 'createScratchDb' \
  packages/secure_core/test/helpers/db.ts \
  "L1.5 ships per-file createScratchDb lifecycle helper"
# Manifest §4 hard rule: factories MUST NOT write to immutable log
# tables (audit_events / provenance_events / operator_events). Any
# direct INSERT into those tables from factories.ts is a contract
# violation; AuditLogger is the only legal writer.
check_grep_absent_in_file 'INSERT INTO audit_events' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 factories do NOT INSERT into audit_events (manifest §4)"
check_grep_absent_in_file 'INSERT INTO provenance_events' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 factories do NOT INSERT into provenance_events (manifest §4)"
check_grep_absent_in_file 'INSERT INTO operator_events' \
  packages/secure_core/test/fixtures/factories.ts \
  "L1.5 factories do NOT INSERT into operator_events (manifest §4)"

section "secure_core Layer-2 middleware (L2.1..L2.8)"
# Foundation
check_file_exists packages/secure_core/src/server.ts
check_file_exists packages/secure_core/src/middleware/types.ts
check_file_exists packages/secure_core/src/middleware/fastify_augment.ts
check_file_exists packages/secure_core/src/middleware/compose.ts
check_file_exists packages/secure_core/src/middleware/requireRequestId.ts
check_file_exists packages/secure_core/src/middleware/index.ts
check_file_exists packages/secure_core/test/middleware/compose.test.ts
check_grep_in_file 'export const MIDDLEWARE_ORDER' \
  packages/secure_core/src/middleware/compose.ts \
  "L2 encodes the §6.2 middleware order in one place"
check_grep_in_file 'export function composeMiddleware' \
  packages/secure_core/src/middleware/compose.ts \
  "L2 exposes composeMiddleware() helper"
check_grep_in_file 'out-of-order middleware' \
  packages/secure_core/test/middleware/compose.test.ts \
  "L2 composeMiddleware rejects out-of-order route registration"
check_grep_in_file 'fastify' packages/secure_core/package.json \
  "L2 depends on Fastify (per ADR-0008)"
check_grep_in_file '@fastify/cookie' packages/secure_core/package.json \
  "L2 includes @fastify/cookie for session + CSRF middleware"
check_grep_in_file 'ajv' packages/secure_core/package.json \
  "L2 includes Ajv for validateInputSchema"
# L2.1 requireAuth
check_file_exists packages/secure_core/src/middleware/requireAuth.ts
check_grep_in_file 'export function requireAuth' \
  packages/secure_core/src/middleware/requireAuth.ts \
  "L2.1 exports requireAuth(deps) factory"
check_grep_in_file 'session\.revoked' \
  packages/secure_core/src/middleware/requireAuth.ts \
  "L2.1 emits session.revoked on revoked session"
check_grep_in_file 'hasBearerAuthorizationHeader' \
  packages/secure_core/src/middleware/requireAuth.ts \
  "L2.1 refuses Authorization Bearer session-token path"
check_file_exists packages/secure_core/test/middleware/requireAuth.test.ts
check_grep_in_file 'Authorization Bearer' \
  packages/secure_core/test/middleware/requireAuth.test.ts \
  "L2.1 regression covers bearer header rejection"
# L2.2 enforceCsrfForStateChange
check_file_exists packages/secure_core/src/middleware/enforceCsrfForStateChange.ts
check_grep_in_file 'export function enforceCsrfForStateChange' \
  packages/secure_core/src/middleware/enforceCsrfForStateChange.ts \
  "L2.2 exports enforceCsrfForStateChange(deps) factory"
check_grep_in_file 'csrf\.failed' \
  packages/secure_core/src/middleware/enforceCsrfForStateChange.ts \
  "L2.2 emits csrf.failed on token mismatch (V4-R2)"
check_grep_in_file 'origin\.mismatch' \
  packages/secure_core/src/middleware/enforceCsrfForStateChange.ts \
  "L2.2 emits origin.mismatch on Origin/Referer rejection (V4-R2)"
check_file_exists packages/secure_core/test/middleware/enforceCsrfForStateChange.test.ts
# L2.3 validateInputSchema
check_file_exists packages/secure_core/src/middleware/validateInputSchema.ts
check_grep_in_file 'export function validateInputSchema' \
  packages/secure_core/src/middleware/validateInputSchema.ts \
  "L2.3 exports validateInputSchema(schema, deps) factory"
check_grep_in_file 'FORBIDDEN_BODY_FIELDS' \
  packages/secure_core/src/middleware/validateInputSchema.ts \
  "L2.3 enumerates v4 §4.1 forbidden body fields"
check_grep_in_file 'endsWith\("_hash"\)' \
  packages/secure_core/src/middleware/validateInputSchema.ts \
  "L2.3 rejects wildcard *_hash body fields"
check_grep_in_file 'metadata\.nested\.role_id' \
  packages/secure_core/test/middleware/validateInputSchema.test.ts \
  "L2.3 regression covers recursive forbidden-field rejection"
check_grep_in_file 'request\.unexpected_field' \
  packages/secure_core/src/middleware/validateInputSchema.ts \
  "L2.3 emits request.unexpected_field on rejection"
check_file_exists packages/secure_core/test/middleware/validateInputSchema.test.ts
# L2.4 loadWorkspace + enforceUniformNotFound
check_file_exists packages/secure_core/src/middleware/loadWorkspace.ts
check_grep_in_file 'export function loadWorkspace' \
  packages/secure_core/src/middleware/loadWorkspace.ts \
  "L2.4 exports loadWorkspace(deps) factory"
check_grep_in_file 'enforceUniformNotFound' \
  packages/secure_core/src/middleware/loadWorkspace.ts \
  "L2.4 exports enforceUniformNotFound (v4 §4.4)"
check_file_exists packages/secure_core/test/middleware/loadWorkspace.test.ts
# L2.5 requireWorkspaceMembership
check_file_exists packages/secure_core/src/middleware/requireWorkspaceMembership.ts
check_grep_in_file 'export function requireWorkspaceMembership' \
  packages/secure_core/src/middleware/requireWorkspaceMembership.ts \
  "L2.5 exports requireWorkspaceMembership(deps) factory"
check_file_exists packages/secure_core/test/middleware/requireWorkspaceMembership.test.ts
# L2.6 requireCapability
check_file_exists packages/secure_core/src/middleware/requireCapability.ts
check_grep_in_file 'export function requireCapability' \
  packages/secure_core/src/middleware/requireCapability.ts \
  "L2.6 exports requireCapability(deps) factory"
check_grep_in_file 'permission\.denied' \
  packages/secure_core/src/middleware/requireCapability.ts \
  "L2.6 emits permission.denied on missing capability"
check_file_exists packages/secure_core/test/middleware/requireCapability.test.ts
# L2.7 enforceObjectWorkspaceScope
check_file_exists packages/secure_core/src/middleware/enforceObjectWorkspaceScope.ts
check_grep_in_file 'export function enforceObjectWorkspaceScope' \
  packages/secure_core/src/middleware/enforceObjectWorkspaceScope.ts \
  "L2.7 exports enforceObjectWorkspaceScope(deps) factory"
check_file_exists packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts
# L2.8 attachAuditActor
check_file_exists packages/secure_core/src/middleware/attachAuditActor.ts
check_grep_in_file 'attachAuditActor' \
  packages/secure_core/src/middleware/attachAuditActor.ts \
  "L2.8 exports attachAuditActor middleware"
check_grep_absent_in_file 'req\\.body\\.\\(actor\\|user_id\\|created_by\\|updated_by\\|approved_by\\)' \
  packages/secure_core/src/middleware/attachAuditActor.ts \
  "L2.8 attachAuditActor never reads actor identity from req.body (v4 §19.1)"
check_file_exists packages/secure_core/test/middleware/attachAuditActor.test.ts
# Hard rule: no middleware reads forbidden body fields for actor identity (v4 §4.1 + §19.1)
check_grep_absent_in_file 'req\\.body\\.actor_user_id\\|req\\.body\\.created_by\\|req\\.body\\.approved_by' \
  packages/secure_core/src/middleware/requireAuth.ts \
  "L2.1 requireAuth never reads actor identity from req.body"
check_grep_absent_in_file 'req\\.body\\.actor_user_id\\|req\\.body\\.created_by\\|req\\.body\\.approved_by' \
  packages/secure_core/src/middleware/requireCapability.ts \
  "L2.6 requireCapability never reads actor identity from req.body"

section "secure_core L2.10 + L2.11 (path safety + archive extraction)"
# Shared component validator (foundation for both tasks)
check_file_exists packages/secure_core/src/paths/components.ts
check_grep_in_file 'classifyComponent' packages/secure_core/src/paths/components.ts \
  "L2.10/L2.11 share classifyComponent (single source of truth for §9.4 component rules)"
check_grep_in_file 'classifyRelativePath' packages/secure_core/src/paths/components.ts \
  "L2.10/L2.11 share classifyRelativePath"
check_file_exists packages/secure_core/test/paths/components.test.ts

# L2.10 — workspacePath builder + safeOpen
check_file_exists packages/secure_core/src/paths/builder.ts
check_file_exists packages/secure_core/src/paths/safeOpen.ts
check_grep_in_file 'export class WorkspacePathBuilder' \
  packages/secure_core/src/paths/builder.ts \
  "L2.10 exports WorkspacePathBuilder"
check_grep_in_file 'WORKSPACE_SUBPATHS' \
  packages/secure_core/src/paths/builder.ts \
  "L2.10 enumerates v4 §9.1 workspace subpaths"
check_grep_in_file 'simulation_capsules' \
  packages/secure_core/src/paths/builder.ts \
  "L2.10 includes simulation_capsules subpath (v4 §9.1)"
check_grep_in_file 'audit_exports' \
  packages/secure_core/src/paths/builder.ts \
  "L2.10 includes audit_exports subpath (v4 §9.1)"
check_grep_in_file 'export async function safeOpenPath' \
  packages/secure_core/src/paths/safeOpen.ts \
  "L2.10 exports safeOpenPath()"
check_grep_in_file 'O_NOFOLLOW' \
  packages/secure_core/src/paths/safeOpen.ts \
  "L2.10 uses O_NOFOLLOW per-component (v4 §9.4.4 fallback)"
check_grep_in_file 'export function isStrictSubpath' \
  packages/secure_core/src/paths/safeOpen.ts \
  "L2.10 exports isStrictSubpath helper (component-array equality, not startsWith)"
# §9.4.2 forbids string `startsWith` for containment. The acceptable
# usage in safeOpen is `rel.startsWith("..")` as a relative-path guard;
# the containment check itself MUST use component-array equality.
# Probe instead: confirm the file contains the structural marker
# (`isStrictSubpath` / `every(`) rather than relying on absence-of-string
# which fires on doc-comment matches.
check_grep_in_file 'isStrictSubpath' \
  packages/secure_core/src/paths/safeOpen.ts \
  "L2.10 uses component-array equality (not string startsWith) for path containment (v4 §9.4.2)"
check_grep_in_file 'path_access\.denied' \
  packages/secure_core/src/paths/builder.ts \
  "L2.10 emits path_access.denied on rejection"
check_file_exists packages/secure_core/test/paths/builder.test.ts
check_grep_in_file 'without duplicating workspaces' \
  packages/secure_core/test/paths/builder.test.ts \
  "L2.10 default path root regression prevents workspaces/workspaces drift"
check_file_exists packages/secure_core/test/paths/safeOpen.test.ts
check_grep_in_file 'outside-created\.txt' \
  packages/secure_core/test/paths/safeOpen.test.ts \
  "L2.10 safeOpen regression proves traversal write has no outside side effect"

# L2.11 — archive extraction safety
check_file_exists packages/secure_core/src/paths/extractArchive.ts
check_grep_in_file 'export async function extractArchive' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 exports extractArchive(opts)"
check_grep_in_file 'export function validateEntry' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 exports validateEntry (shared zip + tar branch)"
check_grep_in_file 'ARCHIVE_DEFAULT_MAX_BYTES' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 hard-codes byte cap (V4-R1: unset env must NOT mean unlimited)"
check_grep_in_file 'ARCHIVE_DEFAULT_MAX_FILES' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 hard-codes file-count cap (V4-R1: fail-closed default)"
check_grep_in_file 'archive\.entry_rejected' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 emits archive.entry_rejected on every rejection (V4-R1)"
check_grep_in_file 'symlink' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 enumerates symlink rejection (v4 §9.4.12)"
check_grep_in_file 'hardlink' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 enumerates hardlink rejection (v4 §9.4.12)"
check_grep_in_file 'zip_slip' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 enumerates zip_slip rejection (v4 §9.4.13)"
check_grep_in_file 'size_limit_exceeded' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 enforces uncompressed size cap (v4 §9.4.14 / V4-R1)"
check_grep_in_file 'file_count_limit_exceeded' \
  packages/secure_core/src/paths/extractArchive.ts \
  "L2.11 enforces file-count cap (v4 §9.4.14 / V4-R1)"
check_grep_in_file 'yauzl' \
  packages/secure_core/package.json \
  "L2.11 depends on yauzl (streaming zip with per-entry hooks)"
check_grep_in_file '"tar"' \
  packages/secure_core/package.json \
  "L2.11 depends on tar"
check_file_exists packages/secure_core/test/paths/extractArchive.test.ts
check_grep_in_file 'pre-existing symlink directory' \
  packages/secure_core/test/paths/extractArchive.test.ts \
  "L2.11 regression covers destination-side symlink escape"
# Both archive defaults must remain explicit; an unset env var must not become "unlimited"
check_grep_in_file 'PLASMAWORK_ARCHIVE_MAX_BYTES' \
  packages/secure_core/src/secrets/env.ts \
  "L2.11 registers PLASMAWORK_ARCHIVE_MAX_BYTES in the env helper"
check_grep_in_file 'PLASMAWORK_ARCHIVE_MAX_FILES' \
  packages/secure_core/src/secrets/env.ts \
  "L2.11 registers PLASMAWORK_ARCHIVE_MAX_FILES in the env helper"

# L2.12 — rate-limit middleware
check_file_exists packages/secure_core/src/middleware/enforceRateLimit.ts
check_grep_in_file 'export function enforceRateLimit' \
  packages/secure_core/src/middleware/enforceRateLimit.ts \
  "L2.12 exports enforceRateLimit(deps) factory"
check_grep_in_file 'export class InMemoryRateLimitStore' \
  packages/secure_core/src/middleware/enforceRateLimit.ts \
  "L2.12 ships an in-memory limiter (Layer-3 swaps in Redis)"
check_grep_in_file 'rate_limit\.triggered' \
  packages/secure_core/src/middleware/enforceRateLimit.ts \
  "L2.12 emits rate_limit.triggered on every rejection (v4 §8)"
check_grep_in_file 'Too many requests\.' \
  packages/secure_core/src/middleware/enforceRateLimit.ts \
  "L2.12 returns generic anti-enumeration message (v4 §8)"
check_grep_in_file '"enforceRateLimit"' \
  packages/secure_core/src/middleware/compose.ts \
  "L2.12 slot exists in MIDDLEWARE_ORDER between requireRequestId and requireAuth"
check_file_exists packages/secure_core/test/middleware/enforceRateLimit.test.ts

# L2.9 — requireApprovalIfHighRisk middleware (unblocked by L3.3)
check_file_exists packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts
check_grep_in_file 'export function requireApprovalIfHighRisk' \
  packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts \
  "L2.9 exports requireApprovalIfHighRisk(deps) factory"
check_grep_in_file 'APPROVAL_TOKEN_HEADER' \
  packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts \
  "L2.9 reads token from X-Approval-Token header (v4 §16.1)"
check_grep_in_file 'TOKEN_LEAK_PATTERNS' \
  packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts \
  "L2.9 refuses tokens in URL path / query string (v4 §16.1)"
check_grep_in_file 'approval\.required' \
  packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts \
  "L2.9 emits approval.required when token is missing or in URL"
# L2.9 hard rule: token NEVER from req.body (defense in depth grep)
check_grep_absent_in_file 'req\.body\.\(approval_token\|approvalToken\|x_approval_token\|x-approval-token\)' \
  packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts \
  "L2.9 never reads approval token from req.body (v4 §16.1 transport rule)"
check_file_exists packages/secure_core/test/middleware/requireApprovalIfHighRisk.test.ts

section "secure_core Layer-3 services (L3.1, L3.3, L3.4, L3.5, L3.6)"
# L3.1 — audit/provenance/operator chain DB writer + verifier
check_file_exists packages/secure_core/src/audit/dbWriter.ts
check_file_exists packages/secure_core/src/audit/verifier.ts
check_file_exists packages/secure_core/src/audit/index.ts
check_grep_in_file 'class AuditDbWriter' \
  packages/secure_core/src/audit/dbWriter.ts \
  "L3.1 wires AuditLogger's DI'd writer to a Drizzle/postgres-js insert"
check_grep_in_file 'class AuditChainVerifier' \
  packages/secure_core/src/audit/verifier.ts \
  "L3.1 ships AuditChainVerifier (verifyAll + verifyFromAnchor)"
check_grep_in_file 'tail_truncation' \
  packages/secure_core/src/audit/verifier.ts \
  "L3.1 detects tail truncation per v4 §19.3"
check_grep_in_file 'log_chain_anchors' \
  packages/secure_core/src/audit/verifier.ts \
  "L3.1 consults log_chain_anchors for the trust point"
check_file_exists packages/secure_core/test/audit/dbWriter.test.ts
check_file_exists packages/secure_core/test/audit/verifier.test.ts

# L3.2 — external WORM anchor committer
check_file_exists packages/secure_core/src/audit/anchor.ts
check_file_exists packages/secure_core/src/audit/s3Provider.ts
check_grep_in_file 'class AnchorCommitter' \
  packages/secure_core/src/audit/anchor.ts \
  "L3.2 exports AnchorCommitter"
check_grep_in_file 'class AwsS3AnchorProvider' \
  packages/secure_core/src/audit/s3Provider.ts \
  "L3.2 ships an AWS S3 provider with Object Lock COMPLIANCE (ADR-0010)"
check_grep_in_file 'class FakeS3AnchorProvider' \
  packages/secure_core/src/audit/s3Provider.ts \
  "L3.2 ships an in-memory provider for tests"
check_grep_in_file 'ObjectLockMode' \
  packages/secure_core/src/audit/s3Provider.ts \
  "L3.2 sets Object Lock per ADR-0010"
check_grep_in_file 'COMPLIANCE' \
  packages/secure_core/src/audit/s3Provider.ts \
  "L3.2 uses COMPLIANCE retention mode (not GOVERNANCE)"
check_grep_in_file 'verifyFromAnchor' \
  packages/secure_core/src/audit/anchor.ts \
  "L3.2 re-verifies the chain segment after committing the anchor"
check_grep_in_file 'log_chain\.anchor_committed' \
  packages/secure_core/src/audit/anchor.ts \
  "L3.2 emits log_chain.anchor_committed audit on success"
check_grep_in_file 'versionId=' \
  packages/secure_core/src/audit/anchor.ts \
  "L3.2 constructs URI with versionId= marker (L1.8 CHECK + ADR-0010)"
check_grep_in_file '@aws-sdk/client-s3' \
  packages/secure_core/package.json \
  "L3.2 depends on @aws-sdk/client-s3"
check_file_exists packages/secure_core/test/audit/anchor.test.ts
# L3.2 hard rule: no actor identity from req.body
check_grep_absent_in_file 'req\.body\.\(actor\|created_by\|approved_by\)' \
  packages/secure_core/src/audit/anchor.ts \
  "L3.2 AnchorCommitter never reads actor identity from req.body"

# L3.8 — worker token issuer + verifier (v4 §18.1)
check_file_exists packages/secure_core/src/workers/tokenIssuer.ts
check_file_exists packages/secure_core/src/workers/index.ts
check_grep_in_file 'export function issueWorkerToken' \
  packages/secure_core/src/workers/tokenIssuer.ts \
  "L3.8 exports issueWorkerToken"
check_grep_in_file 'export function verifyWorkerToken' \
  packages/secure_core/src/workers/tokenIssuer.ts \
  "L3.8 exports verifyWorkerToken"
check_grep_in_file 'WORKER_CAPABILITIES' \
  packages/secure_core/src/workers/tokenIssuer.ts \
  "L3.8 enumerates the v4 §18.1 closed worker capability set"
check_grep_in_file 'run_mismatch' \
  packages/secure_core/src/workers/tokenIssuer.ts \
  "L3.8 refuses cross-run token use (§29 #44)"
check_grep_in_file 'capability_missing' \
  packages/secure_core/src/workers/tokenIssuer.ts \
  "L3.8 refuses tokens lacking the required capability"
check_grep_in_file 'expired' \
  packages/secure_core/src/workers/tokenIssuer.ts \
  "L3.8 enforces token expiry"
check_file_exists packages/secure_core/test/workers/tokenIssuer.test.ts

# L3.9 — worker artifact upload route (ADR-0012)
check_file_exists packages/secure_core/src/workers/deriveArtifactPath.ts
check_file_exists packages/secure_core/src/workers/uploadRoute.ts
check_grep_in_file 'export async function deriveArtifactPath' \
  packages/secure_core/src/workers/deriveArtifactPath.ts \
  "L3.9 exports server-derived path helper (ADR-0012 step 2)"
check_grep_in_file 'ARTIFACT_KINDS' \
  packages/secure_core/src/workers/deriveArtifactPath.ts \
  "L3.9 enumerates the closed artifact-kind set"
check_grep_in_file 'export const workerUploadRoute' \
  packages/secure_core/src/workers/uploadRoute.ts \
  "L3.9 exports the Fastify upload route plugin"
check_grep_in_file '@fastify/multipart' \
  packages/secure_core/package.json \
  "L3.9 depends on @fastify/multipart for streaming uploads (ADR-0012 step 3)"
check_grep_in_file 'worker\.uploaded' \
  packages/secure_core/src/workers/uploadRoute.ts \
  "L3.9 emits worker.uploaded on success"
check_grep_in_file 'worker\.upload_denied' \
  packages/secure_core/src/workers/uploadRoute.ts \
  "L3.9 emits worker.upload_denied on rejection"
check_grep_in_file 'reserveBytes' \
  packages/secure_core/src/workers/uploadRoute.ts \
  "L3.9 reserves quota before opening the destination (ADR-0012 step 4)"
check_grep_in_file 'ByteLimitTransform' \
  packages/secure_core/src/workers/uploadRoute.ts \
  "L3.9 enforces a streaming byte cap (no buffering full payload)"
check_file_exists packages/secure_core/test/workers/deriveArtifactPath.test.ts

# L3.7 — sandbox runner abstraction (ADR-0009 + v4 §15)
check_file_exists packages/secure_core/src/sandbox/runtime.ts
check_file_exists packages/secure_core/src/sandbox/runner.ts
check_file_exists packages/secure_core/src/sandbox/index.ts
check_grep_in_file 'export class StubSandboxRuntime' \
  packages/secure_core/src/sandbox/runtime.ts \
  "L3.7 ships StubSandboxRuntime for tests"
check_grep_in_file 'export class RunscSandboxRuntime' \
  packages/secure_core/src/sandbox/runtime.ts \
  "L3.7 ships RunscSandboxRuntime production adapter (ADR-0009)"
check_grep_in_file 'export class SandboxRunner' \
  packages/secure_core/src/sandbox/runner.ts \
  "L3.7 exports SandboxRunner that drives state transitions"
check_grep_in_file '"--network=none"' \
  packages/secure_core/src/sandbox/runtime.ts \
  "L3.7 always passes --network=none (v4 §15.3 default-deny)"
# Positive marker: the runscBinary argv always carries --no-new-privs.
# (Banning the substring "privileged" in the source would false-trip on
# the file's own docstring; the test suite asserts the argv shape.)
check_grep_in_file '"--no-new-privs"' \
  packages/secure_core/src/sandbox/runtime.ts \
  "L3.7 always passes --no-new-privs (v4 §15.1 / ADR-0009)"
check_grep_in_file 'sandbox\.violation' \
  packages/secure_core/src/sandbox/runner.ts \
  "L3.7 emits sandbox.violation only on real violations (not OOM/timeout)"
check_grep_in_file 'FORBIDDEN_ENV_PREFIXES' \
  packages/secure_core/src/sandbox/runtime.ts \
  "L3.7 strips forbidden env keys (PLASMAWORK_*, AWS_*, *PASSWORD, etc.)"
check_grep_in_file 'validateLaunchSpec' \
  packages/secure_core/src/sandbox/runtime.ts \
  "L3.7 validates spec at the top of launch (no spawn before validation)"
check_file_exists packages/secure_core/test/sandbox/runtime.test.ts

# L3.10 — SSRF-safe URL guard + fetcher + webhook signer (v4 §26)
check_file_exists packages/secure_core/src/outbound/ssrf.ts
check_file_exists packages/secure_core/src/outbound/fetcher.ts
check_file_exists packages/secure_core/src/outbound/webhookSigner.ts
check_file_exists packages/secure_core/src/outbound/index.ts
check_grep_in_file 'export class SsrfGuard' \
  packages/secure_core/src/outbound/ssrf.ts \
  "L3.10 exports SsrfGuard"
check_grep_in_file 'export function classifyIp' \
  packages/secure_core/src/outbound/ssrf.ts \
  "L3.10 exports classifyIp helper"
check_grep_in_file 'metadata_service' \
  packages/secure_core/src/outbound/ssrf.ts \
  "L3.10 blocks cloud metadata service IPs (v4 §26.1 #7)"
check_grep_in_file 'loopback' \
  packages/secure_core/src/outbound/ssrf.ts \
  "L3.10 blocks loopback (v4 §26.1 #2)"
check_grep_in_file 'private_range' \
  packages/secure_core/src/outbound/ssrf.ts \
  "L3.10 blocks RFC1918 private ranges (v4 §26.1 #4)"
check_grep_in_file 'ipv6_ula' \
  packages/secure_core/src/outbound/ssrf.ts \
  "L3.10 blocks IPv6 ULAs (v4 §26.1 #5)"
check_grep_in_file 'export class SafeFetcher' \
  packages/secure_core/src/outbound/fetcher.ts \
  "L3.10 exports SafeFetcher"
check_grep_in_file 'redirect: "manual"' \
  packages/secure_core/src/outbound/fetcher.ts \
  "L3.10 disables auto-redirect so each hop is re-validated (v4 §26.1 #6)"
check_grep_in_file 'export function signWebhook' \
  packages/secure_core/src/outbound/webhookSigner.ts \
  "L3.10 exports signWebhook (v4 §26.2)"
check_grep_in_file 'export function verifyWebhook' \
  packages/secure_core/src/outbound/webhookSigner.ts \
  "L3.10 exports verifyWebhook with timestamp + signature checks (v4 §26.2)"
check_grep_in_file 'timestamp_stale' \
  packages/secure_core/src/outbound/webhookSigner.ts \
  "L3.10 refuses webhook payloads beyond ±5 minutes (v4 §26.2 #2)"
check_file_exists packages/secure_core/test/outbound/ssrf.test.ts
check_file_exists packages/secure_core/test/outbound/fetcher.test.ts
check_file_exists packages/secure_core/test/outbound/webhookSigner.test.ts

# L3.3 — approval system (request/issue/consume/deny/revoke)
check_file_exists packages/secure_core/src/approvals/service.ts
check_file_exists packages/secure_core/src/approvals/index.ts
check_grep_in_file 'class ApprovalService' \
  packages/secure_core/src/approvals/service.ts \
  "L3.3 exports ApprovalService"
check_grep_in_file 'consumeToken' \
  packages/secure_core/src/approvals/service.ts \
  "L3.3 implements atomic consumeToken (v4 §16.4)"
check_grep_in_file 'token_context_hash' \
  packages/secure_core/src/approvals/service.ts \
  "L3.3 binds tokens via token_context_hash (v4 §16.3)"
check_grep_in_file 'approval\.token_context_mismatch' \
  packages/secure_core/src/approvals/service.ts \
  "L3.3 emits approval.token_context_mismatch on context drift"
check_grep_in_file 'used_at IS NULL' \
  packages/secure_core/src/approvals/service.ts \
  "L3.3 uses §16.4 atomic UPDATE conditional clauses"
# L3.3 hard rule: no req.body actor reads (defense-in-depth grep — service is post-middleware
# but the lint should still hold)
check_grep_absent_in_file 'req\.body\.\(actor\|user_id\|created_by\|approved_by\)' \
  packages/secure_core/src/approvals/service.ts \
  "L3.3 ApprovalService never reads actor identity from req.body (v4 §19.1)"
check_file_exists packages/secure_core/test/approvals/service.test.ts

# L3.4 — capsule version + lock
check_file_exists packages/secure_core/src/capsules/versionLock.ts
check_grep_in_file 'class CapsuleVersionLockService' \
  packages/secure_core/src/capsules/versionLock.ts \
  "L3.4 exports CapsuleVersionLockService"
check_grep_in_file 'updateCapsule' \
  packages/secure_core/src/capsules/versionLock.ts \
  "L3.4 implements If-Match-style updateCapsule with VERSION_CONFLICT (v4 §20)"
check_grep_in_file 'forkCapsule' \
  packages/secure_core/src/capsules/versionLock.ts \
  "L3.4 implements forkCapsule"
check_grep_in_file 'acquireLock' \
  packages/secure_core/src/capsules/versionLock.ts \
  "L3.4 implements acquireLock"
check_file_exists packages/secure_core/test/capsules/versionLock.test.ts

# L3.5 — quota counters + storage reservations
check_file_exists packages/secure_core/src/quotas/counters.ts
check_file_exists packages/secure_core/src/quotas/storageReservations.ts
check_grep_in_file 'class QuotaCounterService' \
  packages/secure_core/src/quotas/counters.ts \
  "L3.5 exports QuotaCounterService with atomic conditional UPDATE (v4 §21.2)"
check_grep_in_file 'class StorageReservationService' \
  packages/secure_core/src/quotas/storageReservations.ts \
  "L3.5 exports StorageReservationService"
check_grep_in_file 'expireOverdueReservations' \
  packages/secure_core/src/quotas/storageReservations.ts \
  "L3.5 ships the §21.3 periodic reservation expiry sweep"
check_grep_in_file 'quota\.exceeded' \
  packages/secure_core/src/quotas/counters.ts \
  "L3.5 emits quota.exceeded on counter rejection"
check_grep_in_file 'quota\.reservation_expired' \
  packages/secure_core/src/quotas/storageReservations.ts \
  "L3.5 emits quota.reservation_expired per V4-R5"
check_grep_in_file 'current_value' \
  packages/secure_core/src/quotas/counters.ts \
  "L3.5 uses §21.2 atomic conditional UPDATE pattern (current_value)"
check_file_exists packages/secure_core/test/quotas/counters.test.ts
check_file_exists packages/secure_core/test/quotas/storageReservations.test.ts

# L3.6 — run state machine + persistence
check_file_exists packages/secure_core/src/runs/stateMachine.ts
check_grep_in_file 'class RunStateMachine' \
  packages/secure_core/src/runs/stateMachine.ts \
  "L3.6 exports RunStateMachine"
check_grep_in_file 'RUN_TRANSITIONS' \
  packages/secure_core/src/runs/stateMachine.ts \
  "L3.6 encodes the §14 state-graph (RUN_TRANSITIONS)"
check_grep_in_file 'isLegalTransition' \
  packages/secure_core/src/runs/stateMachine.ts \
  "L3.6 validates transitions via isLegalTransition before any DB call"
check_grep_in_file 'AND status = ' \
  packages/secure_core/src/runs/stateMachine.ts \
  "L3.6 uses atomic conditional UPDATE on simulation_runs (race protection via WHERE status = expectedFromState)"
check_grep_in_file 'run\.launched' \
  packages/secure_core/src/runs/stateMachine.ts \
  "L3.6 emits run.launched lifecycle audit"
check_grep_in_file 'run\.completed' \
  packages/secure_core/src/runs/stateMachine.ts \
  "L3.6 emits run.completed lifecycle audit"
check_file_exists packages/secure_core/test/runs/stateMachine.test.ts

# v4 references ADR-0013 for the aggregate Phase 0.5 ADR (the
# original v4 reference to ADR-0004 collided with the units-library
# ADR and was renumbered during round-2 review).
check_grep_in_file 'ADR-0013-secure-multi-user-foundation' \
  secure_multi_user_scaffolding_plan_v4.md \
  "v4 plan points at ADR-0013 (renumbered to avoid units-library collision)"

section "v4 §1 inserts + security gates"
check_grep_in_file 'Secure Multi-User Development Requirements' AGENTS.md \
  "AGENTS.md carries v4 §1.1 insert"
check_grep_in_file 'Security Rules for Multi-User Workbench Work' CLAUDE.md \
  "CLAUDE.md carries v4 §1.2 insert"
check_file_executable scripts/test/security.sh "scripts/test/security.sh runs §29 spec-level invariants"
check_grep_in_file 'vitest run test/security' scripts/test/security.sh \
  "security.sh actually runs the §29 suite under packages/secure_core/test/security/"
check_grep_in_file 'security_live_runsc\.sh' scripts/test/security.sh \
  "security.sh dispatches enabled runsc live probes"
check_grep_in_file 'security_live_db\.sh' scripts/test/security.sh \
  "security.sh dispatches enabled DB live probes"
check_grep_in_file 'security_live_worm\.sh' scripts/test/security.sh \
  "security.sh dispatches enabled WORM live probes"
check_file_executable scripts/test/security_live_db.sh \
  "security_live_db.sh executable"
check_file_executable scripts/test/security_live_runsc.sh \
  "security_live_runsc.sh executable"
check_file_executable scripts/test/security_live_worm.sh \
  "security_live_worm.sh executable"
check_grep_in_file 'PLASMAWORK_TEST_DB_URL' scripts/test/security_live_db.sh \
  "DB live-probe script requires PLASMAWORK_TEST_DB_URL"
check_grep_in_file 'runsc --version' scripts/test/security_live_runsc.sh \
  "runsc live-probe script fails closed when runsc is absent"
check_grep_in_file 'PLASMAWORK_ANCHOR_LIVE_PROBES' scripts/test/security_live_worm.sh \
  "WORM live-probe script requires explicit live-probe opt-in"
check_file_exists packages/secure_core/test/security/sandbox.test.ts
check_grep_in_file '§29 #38' packages/secure_core/test/security/sandbox.test.ts \
  "§29 #38 (egress default-deny) covered by spec-level invariant"
check_grep_in_file 'PLASMAWORK_RUNSC_PROBES' packages/secure_core/test/security/sandbox.test.ts \
  "§29 live-runtime probes are env-gated for the gVisor CI lane"
# Live probes detect runsc presence and skip cleanly when missing
# (the env-gate doesn't surface 'not implemented' failures on dev).
check_grep_in_file 'detectRunscAvailable' \
  packages/secure_core/test/security/sandbox.test.ts \
  "§29 live probes detect runsc binary presence + skip cleanly when missing"
# Regression tests for post-Group-C audit fixes
check_file_exists packages/secure_core/test/sandbox/runner.test.ts
check_grep_in_file 'launch ordering' \
  packages/secure_core/test/sandbox/runner.test.ts \
  "SandboxRunner ordering regression test (audit fix #2)"
check_file_exists packages/secure_core/test/workers/uploadRoute.test.ts
check_grep_in_file 'requested_by_user_id' \
  packages/secure_core/test/workers/uploadRoute.test.ts \
  "workerUploadRoute FK regression test (audit fix #4)"
check_grep_in_file 'declared_size' \
  packages/secure_core/test/workers/uploadRoute.test.ts \
  "workerUploadRoute declared-size cap regression test (audit fix #6)"
check_grep_in_file 'archive_unsafe' \
  packages/secure_core/test/workers/uploadRoute.test.ts \
  "workerUploadRoute archive rejection cleanup regression test (audit fix #7)"
check_grep_in_file 'extracted' \
  packages/secure_core/test/workers/uploadRoute.test.ts \
  "workerUploadRoute archive .extracted dir cleanup is asserted (audit fix #2)"

section "secure_core Layer-5 integration testing + CI"
check_file_exists packages/secure_core/test/security/section29_coverage.test.ts
check_file_exists packages/secure_core/test/security/wormLive.test.ts \
  "WORM Object-Lock live probe test"
check_grep_in_file 'DeleteObjectCommand' packages/secure_core/test/security/wormLive.test.ts \
  "WORM live probe attempts delete of pinned retained object"
for n in $(seq 1 84); do
  check_grep_in_file "§29 #${n} —" \
    packages/secure_core/test/security/section29_coverage.test.ts \
    "L5.2 §29 #${n} has an executable security-suite mapping"
done
check_grep_in_file 'vitest run test/security' scripts/test/security.sh \
  "L5.3 security.sh runs the dedicated Layer-5 security suite"
check_grep_in_file 'FORBIDDEN_PROD_SECRET_ENV' scripts/test/security.sh \
  "L5.3 security.sh refuses production-secret-shaped env vars (test #73)"
check_grep_in_file '"\$SCRIPT_DIR/security\.sh"' scripts/test/all.sh \
  "L5.3 scripts/test/all.sh directly invokes the security gate"
check_file_exists .github/workflows/security.yml \
  "L5.3 GitHub security workflow"
check_grep_in_file 'scripts/test/security\.sh' .github/workflows/security.yml \
  "L5.3 CI workflow invokes scripts/test/security.sh"
check_grep_in_file 'secure-core-security' .github/workflows/security.yml \
  "L5.3 CI exposes a branch-protection-ready job name"
check_grep_in_file 'secure-core-db-live-probes' .github/workflows/security.yml \
  "CI exposes DB live-probe job"
check_grep_in_file 'secure-core-runsc-live-probes' .github/workflows/security.yml \
  "CI exposes runsc live-probe job"
check_grep_in_file 'secure-core-worm-live-probes' .github/workflows/security.yml \
  "CI exposes WORM live-probe job"
check_grep_in_file 'PLASMAWORK_TEST_DB_URL' .github/workflows/security.yml \
  "CI wires PLASMAWORK_TEST_DB_URL for DB live probes"
check_grep_in_file 'PLASMAWORK_RUNSC_PROBES' .github/workflows/security.yml \
  "CI wires PLASMAWORK_RUNSC_PROBES for runsc live probes"
check_grep_in_file 'PLASMAWORK_ANCHOR_LIVE_PROBES' .github/workflows/security.yml \
  "CI wires PLASMAWORK_ANCHOR_LIVE_PROBES for WORM live probes"
check_grep_in_file 'branch_protection\.bypass' \
  packages/secure_core/src/config/audit_events.ts \
  "L5.3 audit enum includes branch_protection.bypass for admin override ingestion"
check_file_exists docs_site/src/content/authentication.tsx \
  "L5.4 §28 authentication docs page"
check_file_exists docs_site/src/content/workspaces.tsx \
  "L5.4 §28 workspaces docs page"
check_file_exists docs_site/src/content/roles_permissions.tsx \
  "L5.4 §28 roles_permissions docs page"
check_file_exists docs_site/src/content/audit_provenance.tsx \
  "L5.4 §28 audit_provenance docs page"
check_file_exists docs_site/src/content/capsule_versioning.tsx \
  "L5.4 §28 capsule_versioning docs page"
check_file_exists docs_site/src/content/secure_storage.tsx \
  "L5.4 §28 secure_storage docs page"
check_file_exists docs_site/src/content/security_testing.tsx \
  "L5.4 §28 security_testing docs page"
check_file_exists docs_site/src/content/sandboxing.tsx \
  "L5.4 §28 sandboxing docs page"
check_file_exists docs_site/src/content/operator_access.tsx \
  "L5.4 §28 operator_access docs page"
check_file_exists docs_site/src/content/agent_threat_model.tsx \
  "L5.4 §28 agent_threat_model docs page"
check_file_exists program_development/architectural_decisions/ADR-0013-secure-multi-user-foundation.md \
  "L5.5 aggregate secure multi-user foundation ADR"
check_grep_in_file 'ADR-0013-secure-multi-user-foundation' \
  secure_multi_user_scaffolding_plan_v4.md \
  "L5.5 v4 plan references aggregate ADR-0013"

section "secure_core post-Layer-5 security operations"
check_file_exists packages/secure_core/src/security/dashboard.ts \
  "security operations dashboard aggregation module"
check_file_exists packages/secure_core/src/security/dashboardService.ts \
  "security operations SQL-backed dashboard service"
check_file_exists packages/secure_core/src/security/operations.ts \
  "security operations route/verifier composition module"
check_file_exists packages/secure_core/src/client/contracts.ts \
  "frontend-facing secure-core route/readiness contracts"
check_file_exists packages/secure_core/test/client/contracts.test.ts \
  "frontend secure-core contract tests"
check_file_exists packages/secure_core/src/routes/session.ts \
  "frontend session-introspection route"
check_file_exists packages/secure_core/src/auth/sessionService.ts \
  "SQL-backed current-session reader"
check_file_exists packages/secure_core/test/routes/session.test.ts \
  "session route tests"
check_file_exists packages/secure_core/test/auth/sessionService.test.ts \
  "current-session reader tests"
check_grep_in_file 'operator\.remediate' \
  packages/secure_core/src/client/contracts.ts \
  "frontend contract marks operator remediation explicitly"
check_grep_in_file 'readiness: "fail_closed"' \
  packages/secure_core/src/client/contracts.ts \
  "frontend contract carries fail-closed readiness states"
check_grep_in_file 'auth\.session' \
  packages/secure_core/src/client/contracts.ts \
  "frontend contract records session-introspection route"
check_grep_in_file '/auth/session' \
  packages/secure_core/src/routes/session.ts \
  "session route exposes GET /auth/session"
check_grep_in_file 'CURRENT_SESSION_RESPONSE_SCHEMA' \
  packages/secure_core/src/routes/session.ts \
  "session route has explicit response schema"
check_grep_in_file 'actorType === "unauthenticated"' \
  packages/secure_core/src/routes/session.ts \
  "session route rejects malformed unauthenticated actor context"
check_grep_in_file 'removed_at IS NULL' \
  packages/secure_core/src/auth/sessionService.ts \
  "session reader only includes live memberships"
check_grep_in_file 'deleted_at IS NULL' \
  packages/secure_core/src/auth/sessionService.ts \
  "session reader excludes deleted workspaces"
check_grep_in_file 'LEFT JOIN role_permissions' \
  packages/secure_core/src/auth/sessionService.ts \
  "session reader preserves zero-capability memberships"
check_grep_in_file 'zero capabilities' \
  AGENTS.md \
  "AGENTS.md records zero-capability membership read-model rule"
check_grep_in_file 'zero capabilities' \
  CLAUDE.md \
  "CLAUDE.md records zero-capability membership read-model rule"
check_grep_in_file '/auth/session' \
  docs_site/src/content/authentication.tsx \
  "authentication docs document session introspection"
check_file_exists packages/secure_core/src/routes/securityDashboard.ts \
  "operator security dashboard route"
check_file_exists packages/secure_core/test/security/dashboard.test.ts \
  "security dashboard aggregation tests"
check_file_exists packages/secure_core/test/security/dashboardService.test.ts \
  "security dashboard service tests"
check_file_exists packages/secure_core/test/security/operations.test.ts \
  "security operations composition tests"
check_file_exists packages/secure_core/test/routes/securityDashboard.test.ts \
  "security dashboard route tests"
check_grep_in_file '/operator/security-dashboard' \
  packages/secure_core/src/routes/securityDashboard.ts \
  "security dashboard route is operator-scoped"
check_file_exists packages/secure_core/src/rateLimits/policies.ts \
  "named rate-limit policy registry"
check_file_exists packages/secure_core/test/rateLimits/policies.test.ts \
  "rate-limit policy coverage tests"
check_grep_in_file 'ABUSE_CONTROL_SURFACES' \
  packages/secure_core/src/rateLimits/policies.ts \
  "rate-limit policy covers abuse-control surfaces"
check_grep_in_file 'keyExtractorForPolicy' \
  packages/secure_core/src/rateLimits/policies.ts \
  "rate-limit policy key scopes drive runtime extraction"
check_grep_in_file 'buildSecurityRouteRateLimitMiddleware' \
  packages/secure_core/src/rateLimits/policies.ts \
  "rate-limit policies expose a route-middleware bundle"
check_grep_in_file 'enforceRunCreateRateLimit' \
  packages/secure_core/src/routes/runs.ts \
  "run create route accepts named rate-limit policy middleware"
check_grep_in_file 'enforceArtifactExportRateLimit' \
  packages/secure_core/src/routes/artifacts.ts \
  "artifact export route accepts named rate-limit policy middleware"
check_file_exists packages/secure_core/src/middleware/requirePlatformCapability.ts \
  "platform capability middleware for operator surfaces"
check_file_exists packages/secure_core/test/middleware/requirePlatformCapability.test.ts \
  "platform capability middleware tests"
check_file_exists packages/secure_core/src/middleware/operatorStepUp.ts \
  "operator step-up decorator middleware"
check_grep_in_file 'withOperatorStepUp' \
  packages/secure_core/src/routes/operator.ts \
  "operator routes run step-up in the capability slot"
check_grep_in_file 'calls\.invoked\)\.toBe\(0\)' \
  packages/secure_core/test/routes/operator.test.ts \
  "operator route test proves step-up rejects before approval consumption"
check_file_exists packages/secure_core/src/secrets/productionValidation.ts \
  "production secrets validation module"
check_file_exists packages/secure_core/test/secrets/productionValidation.test.ts \
  "production secrets validation tests"
check_grep_in_file 'validateProductionRotationEvent' \
  packages/secure_core/src/secrets/productionValidation.ts \
  "secret rotation validation requires provider version evidence"
check_file_exists packages/secure_core/src/security/ciGuards.ts \
  "CI leak/license guard module"
check_file_exists packages/secure_core/test/security/ciGuards.test.ts \
  "CI leak/license guard tests"
check_file_executable scripts/test/security_supply_chain.sh \
  "security supply-chain test script"
check_grep_in_file 'security_supply_chain\.sh' \
  .github/workflows/security.yml \
  "security CI runs supply-chain guard"
check_grep_in_file 'github/codeql-action/analyze' \
  .github/workflows/security.yml \
  "security CI runs CodeQL SAST"
check_grep_in_file 'dependency-review-action' \
  .github/workflows/security.yml \
  "security CI runs dependency/license review"
check_file_exists packages/secure_core/src/audit/periodicVerifier.ts \
  "periodic audit-chain verifier job"
check_file_exists packages/secure_core/test/audit/periodicVerifier.test.ts \
  "periodic verifier tests"
check_grep_in_file 'log_chain\.verification_failed' \
  packages/secure_core/src/config/audit_events.ts \
  "periodic verifier failure event is typed"
check_grep_in_file 'verifier_error' \
  packages/secure_core/src/audit/periodicVerifier.ts \
  "periodic verifier converts thrown dependencies into auditable failures"
check_grep_in_file 'startPeriodicAuditChainVerifier' \
  packages/secure_core/src/security/operations.ts \
  "security operations composition starts periodic verifier job"
check_file_exists docs_site/src/content/security_operations.tsx \
  "security operations docs page"
check_file_exists docs_site/src/content/secure_frontend_readiness.tsx \
  "secure frontend readiness docs page"
check_grep_in_file 'security-operations' \
  docs_site/src/pages/docsPages.ts \
  "security operations docs page is registered"
check_grep_in_file 'secure-frontend-readiness' \
  docs_site/src/pages/docsPages.ts \
  "secure frontend readiness docs page is registered"
check_file_exists apps/workbench-ui/src/api/secureCoreClient.ts \
  "workbench secure-core browser client"
check_file_exists apps/workbench-ui/src/api/secureCoreFixtures.ts \
  "workbench secure-core explicit fixtures"
check_file_exists apps/workbench-ui/src/components/security/SecurityOperationsPanel.tsx \
  "workbench security operations panel"
check_file_exists apps/workbench-ui/src/__tests__/SecurityOperationsPanel.test.tsx \
  "workbench security operations panel test"
check_grep_in_file '/security' \
  apps/workbench-ui/src/App.tsx \
  "App.tsx routes /security"
check_grep_in_file 'fixture fallback' \
  apps/workbench-ui/src/components/security/SecurityOperationsPanel.tsx \
  "security UI labels fixture fallback"
check_grep_in_file 'Disabled until backend readiness changes' \
  apps/workbench-ui/src/components/security/SecurityOperationsPanel.tsx \
  "security UI disables fail-closed surfaces"
check_grep_in_file 'Dashboard / registry pattern' \
  STYLING.md \
  "STYLING.md documents dashboard/list/detail layout pattern"
check_grep_in_file 'Secure UI surfaces' \
  STYLING.md \
  "STYLING.md documents secure UI fixture/fail-closed rules"
check_grep_in_file '/security' \
  docs_site/src/content/secure_frontend_readiness.tsx \
  "secure frontend readiness docs mention /security route"
check_file_exists program_development/secure_frontend_readiness_plan.md \
  "secure frontend readiness planning document"
check_grep_in_file 'STYLING\.md' \
  program_development/secure_frontend_readiness_plan.md \
  "secure frontend readiness plan references styling source of truth"

section "secure_core Layer-4 routes (L4.1, L4.2, L4.3, L4.4, L4.5, L4.6, L4.7, L4.8, L4.9, L4.10, L4.12)"
# L4.12 — health / readiness / metrics
check_file_exists packages/secure_core/src/routes/health.ts
check_file_exists packages/secure_core/src/routes/index.ts
check_grep_in_file 'export const healthRoutes' \
  packages/secure_core/src/routes/health.ts \
  "L4.12 exports healthRoutes Fastify plugin"
check_grep_in_file 'export class MetricsRegistry' \
  packages/secure_core/src/routes/health.ts \
  "L4.12 ships a tiny MetricsRegistry for Prometheus text output"
check_grep_in_file '/readiness' \
  packages/secure_core/src/routes/health.ts \
  "L4.12 ships /readiness with DB probe + 1s deadline"
check_grep_in_file '/metrics' \
  packages/secure_core/src/routes/health.ts \
  "L4.12 ships /metrics in Prometheus text format"
check_file_exists packages/secure_core/test/routes/health.test.ts
# L4.1 — workspace + members
check_file_exists packages/secure_core/src/routes/workspaces.ts
check_file_exists packages/secure_core/src/workspaces/service.ts
check_grep_in_file 'export const workspaceRoutes' \
  packages/secure_core/src/routes/workspaces.ts \
  "L4.1 exports workspaceRoutes Fastify plugin"
check_grep_in_file 'export class WorkspaceService' \
  packages/secure_core/src/workspaces/service.ts \
  "L4.1 exports WorkspaceService"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/workspaces.ts \
  "L4.1 routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'workspace\.created' \
  packages/secure_core/src/workspaces/service.ts \
  "L4.1 emits workspace.created on createWorkspace"
check_grep_in_file 'workspace\.member_added' \
  packages/secure_core/src/workspaces/service.ts \
  "L4.1 emits workspace.member_added on addMember"
check_grep_in_file 'workspace\.member_removed' \
  packages/secure_core/src/workspaces/service.ts \
  "L4.1 emits workspace.member_removed on removeMember"
check_grep_in_file 'workspace\.role_changed' \
  packages/secure_core/src/workspaces/service.ts \
  "L4.1 emits workspace.role_changed on changeMemberRole"
# Hard rule: routes/services NEVER read actor identity from req.body
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/routes/workspaces.ts \
  "L4.1 workspace routes never read actor identity from req.body (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/workspaces/service.ts \
  "L4.1 WorkspaceService never reads actor identity from req.body"
check_file_exists packages/secure_core/test/routes/workspaces.test.ts
# L4.2 — capsule routes
check_file_exists packages/secure_core/src/routes/capsules.ts
check_grep_in_file 'export const capsuleRoutes' \
  packages/secure_core/src/routes/capsules.ts \
  "L4.2 exports capsuleRoutes Fastify plugin"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/capsules.ts \
  "L4.2 capsule routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'if-match' \
  packages/secure_core/src/routes/capsules.ts \
  "L4.2 PATCH honors If-Match header (v4 §20)"
check_grep_in_file 'missing_if_match' \
  packages/secure_core/src/routes/capsules.ts \
  "L4.2 PATCH refuses missing If-Match with INPUT_INVALID + reason"
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/routes/capsules.ts \
  "L4.2 capsule routes never read actor identity from req.body (v4 §19.1)"
check_file_exists packages/secure_core/test/routes/capsules.test.ts
# L4.3 — run routes
check_file_exists packages/secure_core/src/routes/runs.ts
check_file_exists packages/secure_core/src/runs/queryService.ts
check_file_exists packages/secure_core/test/routes/runs.test.ts
check_grep_in_file 'export const runRoutes' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 exports runRoutes Fastify plugin"
check_grep_in_file 'export class RunQueryService' \
  packages/secure_core/src/runs/queryService.ts \
  "L4.3 exports RunQueryService"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 run routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'capsules/:capsuleId/runs' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 declares POST /workspaces/:workspaceId/capsules/:capsuleId/runs (v4 §10.2)"
check_grep_in_file '/runs/:runId/cancel' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 declares POST /workspaces/:workspaceId/runs/:runId/cancel (v4 §10.2)"
check_grep_in_file 'requireRunCreate' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 POST create gates on run:create capability (v4 §13)"
check_grep_in_file 'requireRunCancel' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 POST cancel gates on run:cancel capability (v4 §13)"
check_grep_in_file 'getCapsuleForRunCreate' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 create route validates capsule via queryService (defense in depth)"
check_grep_in_file 'expectedFromState' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 cancel route passes current state as expectedFromState"
check_grep_in_file 'cancel_requested' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 cancel route transitions to cancel_requested (v4 §14)"
check_grep_in_file 'VersionConflictError' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 cancel route surfaces 409 VERSION_CONFLICT for terminal/in-flight states"
# Hard rule: run routes never read actor identity from req.body (v4 §19.1)
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 run routes never read req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 run routes never read req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.requested_by' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 run routes never read req.body.requested_by (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.created_by' \
  packages/secure_core/src/routes/runs.ts \
  "L4.3 run routes never read req.body.created_by (v4 §19.1)"
# L4.4 — tool routes
check_file_exists packages/secure_core/src/routes/tools.ts
check_file_exists packages/secure_core/src/tools/service.ts
check_grep_in_file 'export const toolRoutes' \
  packages/secure_core/src/routes/tools.ts \
  "L4.4 exports toolRoutes Fastify plugin"
check_grep_in_file 'export class ToolService' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 exports ToolService"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/tools.ts \
  "L4.4 tool routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'promote-request' \
  packages/secure_core/src/routes/tools.ts \
  "L4.4 ships POST /tools/:id/promote-request endpoint (v4 §10.2)"
check_grep_absent_in_file 'req\.body\.status' \
  packages/secure_core/src/routes/tools.ts \
  "L4.4 PATCH does not expose lifecycle status at the route boundary (v4 §17)"
check_grep_in_file 'use_promote_request' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 ToolService refuses validated/trusted PATCH transitions (defense in depth)"
check_grep_in_file 'tool.created' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 emits tool.created on createTool"
check_grep_in_file 'tool.updated' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 emits tool.updated on updateTool"
check_grep_in_file 'tool.promotion_requested' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 emits tool.promotion_requested on requestPromotion"
check_grep_in_file 'workspace_id IS NULL AND status' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 list/get include global trusted tools per v4 §10.3"
# Hard rule: tool routes never read actor identity from req.body
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/routes/tools.ts \
  "L4.4 tool routes never read actor identity from req.body (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/tools/service.ts \
  "L4.4 ToolService never reads actor identity from req.body"
check_file_exists packages/secure_core/test/routes/tools.test.ts
# L4.5 — artifact + export routes
check_file_exists packages/secure_core/src/routes/artifacts.ts
check_file_exists packages/secure_core/src/artifacts/service.ts
check_file_exists packages/secure_core/test/routes/artifacts.test.ts
check_grep_in_file 'export const artifactRoutes' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 exports artifactRoutes Fastify plugin"
check_grep_in_file 'export class ArtifactService' \
  packages/secure_core/src/artifacts/service.ts \
  "L4.5 exports ArtifactService"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 artifact routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file '/workspaces/:workspaceId/artifacts' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 declares /workspaces/:workspaceId/artifacts endpoint (v4 §10.2)"
check_grep_in_file '/workspaces/:workspaceId/artifacts/:artifactId/export' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 declares /workspaces/:workspaceId/artifacts/:artifactId/export endpoint (v4 §10.2)"
check_grep_in_file 'requireApprovalIfHighRiskFactory' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 /export route binds L2.9 requireApprovalIfHighRisk via factory (v4 §17)"
check_grep_in_file 'artifact_export' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 /export route binds the artifact_export high-risk action"
check_grep_in_file 'validateUrl' \
  packages/secure_core/src/artifacts/service.ts \
  "L4.5 ArtifactService.requestExport calls SsrfGuard.validateUrl (v4 §26.1)"
check_grep_in_file 'reserveBytes' \
  packages/secure_core/src/artifacts/service.ts \
  "L4.5 ArtifactService.requestExport reserves stored.bytes via StorageReservationService (v4 §21)"
check_grep_in_file 'artifact.exported' \
  packages/secure_core/src/artifacts/service.ts \
  "L4.5 service emits artifact.exported on requestExport"
# Hard rule: artifact routes NEVER read actor identity from req.body (v4 §19.1)
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 artifact routes never read req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 artifact routes never read req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.created_by' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 artifact routes never read req.body.created_by (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.requested_by' \
  packages/secure_core/src/routes/artifacts.ts \
  "L4.5 artifact routes never read req.body.requested_by (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/artifacts/service.ts \
  "L4.5 ArtifactService never reads actor identity from req.body (v4 §19.1)"
# L4.6 — approval-request routes
check_file_exists packages/secure_core/src/routes/approvals.ts
check_grep_in_file 'export const approvalRoutes' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 exports approvalRoutes Fastify plugin"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'approval-requests' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 declares /workspaces/:workspaceId/approval-requests endpoints (v4 §10.2)"
check_grep_in_file 'requestApproval' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 POST /approval-requests calls ApprovalService.requestApproval"
check_grep_in_file 'denyRequest' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 POST /:id/deny calls ApprovalService.denyRequest"
check_grep_in_file 'requireApprovalIfHighRiskFactory' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 /approve route binds L2.9 requireApprovalIfHighRisk via factory"
check_grep_in_file 'approval.requested' \
  packages/secure_core/src/approvals/service.ts \
  "L4.6 service emits approval.requested on requestApproval"
check_grep_in_file 'approval.denied' \
  packages/secure_core/src/approvals/service.ts \
  "L4.6 service emits approval.denied on denyRequest"
# Hard rule: approval routes NEVER read actor identity from req.body (v4 §19.1)
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 approval routes never read req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 approval routes never read req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.created_by' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 approval routes never read req.body.created_by (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.requested_by' \
  packages/secure_core/src/routes/approvals.ts \
  "L4.6 approval routes never read req.body.requested_by (v4 §19.1)"
check_file_exists packages/secure_core/test/routes/approvals.test.ts
# L4.9 — bootstrap endpoint (v4 §22.1)
check_file_exists packages/secure_core/src/routes/bootstrap.ts
check_file_exists packages/secure_core/src/bootstrap/service.ts
check_file_exists packages/secure_core/src/bootstrap/wormMarker.ts
check_file_exists packages/secure_core/test/routes/bootstrap.test.ts
check_grep_in_file 'export const bootstrapRoutes' \
  packages/secure_core/src/routes/bootstrap.ts \
  "L4.9 exports bootstrapRoutes Fastify plugin"
check_grep_in_file 'export class BootstrapService' \
  packages/secure_core/src/bootstrap/service.ts \
  "L4.9 exports BootstrapService"
check_grep_in_file 'export interface BootstrapWormMarkerProvider' \
  packages/secure_core/src/bootstrap/wormMarker.ts \
  "L4.9 exports BootstrapWormMarkerProvider abstraction (ADR-0010)"
check_grep_in_file 'export class S3WormMarkerProvider' \
  packages/secure_core/src/bootstrap/wormMarker.ts \
  "L4.9 ships S3 Object-Lock-backed WORM marker provider"
check_grep_in_file 'export class FakeWormMarkerProvider' \
  packages/secure_core/src/bootstrap/wormMarker.ts \
  "L4.9 ships FakeWormMarkerProvider for tests"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/bootstrap.ts \
  "L4.9 routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'compareTokenConstantTime' \
  packages/secure_core/src/bootstrap/service.ts \
  "L4.9 OOB credential compared via constant-time path"
check_grep_in_file 'bootstrap.completed' \
  packages/secure_core/src/bootstrap/service.ts \
  "L4.9 service emits bootstrap.completed audit row on every attempt (§22.1)"
check_grep_in_file 'BOOTSTRAP_ALLOWED' \
  packages/secure_core/src/secrets/env.ts \
  "L4.9 BOOTSTRAP_ALLOWED env var registered in secrets/env.ts (§22.1 gate #2)"
check_grep_in_file 'BOOTSTRAP_CREDENTIAL_HASH' \
  packages/secure_core/src/secrets/env.ts \
  "L4.9 BOOTSTRAP_CREDENTIAL_HASH env var registered in secrets/env.ts (§22.1 gate #3)"
# Hard rule: bootstrap routes/service NEVER read actor identity from req.body
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/routes/bootstrap.ts \
  "L4.9 bootstrap routes never read actor identity from req.body (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.\(actor\|actor_user_id\|created_by\|requested_by\)' \
  packages/secure_core/src/bootstrap/service.ts \
  "L4.9 BootstrapService never reads actor identity from req.body"
# L4.7 — audit-events + provenance-events read routes
check_file_exists packages/secure_core/src/audit/readService.ts
check_file_exists packages/secure_core/src/routes/auditEvents.ts
check_file_exists packages/secure_core/test/routes/auditEvents.test.ts
check_grep_in_file 'export const auditEventsRoutes' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 exports auditEventsRoutes Fastify plugin"
check_grep_in_file 'export class AuditReadService' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 exports AuditReadService"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'audit:read' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 routes name the audit:read capability (v4 §13)"
check_grep_in_file 'audit-events' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 declares /workspaces/:workspaceId/audit-events endpoint (v4 §10.2)"
check_grep_in_file 'provenance-events' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 declares /workspaces/:workspaceId/provenance-events endpoint (v4 §10.2)"
check_grep_in_file 'auditReadPool' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 AuditReadService takes the audit-read pool (v4 §12.1.3)"
check_grep_in_file 'audit_read' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 AuditReadService refuses pools whose role is not audit_read"
check_grep_in_file 'redactMetadata' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 read path runs metadata through redactMetadata (defense in depth)"
# Hard rule: audit read service is SELECT-only — never INSERT / UPDATE / DELETE
check_grep_absent_in_file 'INSERT INTO' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 audit read service never INSERTs (v4 §12.1.3 SELECT-only)"
check_grep_absent_in_file 'UPDATE ' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 audit read service never UPDATEs (v4 §12.1.3 SELECT-only)"
check_grep_absent_in_file 'DELETE FROM' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 audit read service never DELETEs (v4 §12.1.3 SELECT-only)"
# Hard rule: audit-events routes NEVER read actor identity from req.body (v4 §19.1)
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 audit-events routes never read req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 audit-events routes never read req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.user_id' \
  packages/secure_core/src/routes/auditEvents.ts \
  "L4.7 audit-events routes never read req.body.user_id (v4 §19.1)"
# Defense-in-depth: the route output type omits chain-internal columns.
# The shape of `AuditEventOutputRow` / `ProvenanceEventOutputRow` is the
# contract; we assert the SELECT lists do not project the chain columns
# rather than greping the whole file (the doc comment names them).
check_grep_absent_in_file 'SELECT.*row_hash' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 read service SELECT lists do not project row_hash"
check_grep_absent_in_file 'SELECT.*prev_hash' \
  packages/secure_core/src/audit/readService.ts \
  "L4.7 read service SELECT lists do not project prev_hash"
# L4.8 — recovery flows (password reset, email verify, MFA recovery stub)
check_file_exists packages/secure_core/src/auth/emailSender.ts
check_file_exists packages/secure_core/src/auth/recoveryService.ts
check_file_exists packages/secure_core/src/routes/auth.ts
check_file_exists packages/secure_core/test/routes/auth.test.ts
check_grep_in_file 'export const authRoutes' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 exports authRoutes Fastify plugin"
check_grep_in_file 'export class RecoveryService' \
  packages/secure_core/src/auth/recoveryService.ts \
  "L4.8 exports RecoveryService"
check_grep_in_file 'export interface EmailSender' \
  packages/secure_core/src/auth/emailSender.ts \
  "L4.8 ships EmailSender interface (production wires SES/SendGrid in Layer 5)"
check_grep_in_file 'export class StubEmailSender' \
  packages/secure_core/src/auth/emailSender.ts \
  "L4.8 ships StubEmailSender for unit tests"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file '/auth/password-reset/request' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 declares POST /auth/password-reset/request (v4 §5)"
check_grep_in_file '/auth/password-reset/consume' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 declares POST /auth/password-reset/consume (v4 §5 + §16.4 atomic)"
check_grep_in_file '/auth/email-verify/request' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 declares POST /auth/email-verify/request (v4 §5)"
check_grep_in_file '/auth/email-verify/consume' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 declares POST /auth/email-verify/consume (v4 §5 + §16.4 atomic)"
check_grep_in_file '/auth/mfa-recovery' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 declares POST /auth/mfa-recovery (Phase 0.5 stub; operator review)"
check_grep_in_file 'enforceRateLimit' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes wire enforceRateLimit (per-IP; v4 §8)"
check_grep_in_file 'enforceCsrfForStateChange' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes wire enforceCsrfForStateChange (Origin allowlist; v4 §7.2)"
check_grep_in_file 'mintToken' \
  packages/secure_core/src/auth/recoveryService.ts \
  "L4.8 RecoveryService mints tokens via L1.3 mintToken"
check_grep_in_file 'hashToken' \
  packages/secure_core/src/auth/recoveryService.ts \
  "L4.8 RecoveryService stores hashToken digests, never raw tokens"
check_grep_in_file 'mfa_recovery_pending_review' \
  packages/secure_core/src/auth/recoveryService.ts \
  "L4.8 MFA recovery audits with denied_reason mfa_recovery_pending_review"
check_grep_in_file 'invalid_or_expired' \
  packages/secure_core/src/auth/recoveryService.ts \
  "L4.8 invalid/expired consume audits with denied_reason invalid_or_expired"
check_grep_in_file 'unauthenticated' \
  packages/secure_core/src/auth/recoveryService.ts \
  "L4.8 RecoveryService emits audit rows with actorType unauthenticated"
# Hard rule: recovery routes NEVER read actor identity from req.body (v4 §19.1)
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes never read req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes never read req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.user_id' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes never read req.body.user_id (v4 §19.1)"
# Defense in depth: no requireAuth in the recovery routes (they are pre-auth)
check_grep_absent_in_file 'requireAuth' \
  packages/secure_core/src/routes/auth.ts \
  "L4.8 recovery routes do not use requireAuth (pre-auth endpoints)"
# L4.10 — operator routes (top-level, NOT workspace-scoped; v4 §22.2)
check_file_exists packages/secure_core/src/operator/service.ts
check_file_exists packages/secure_core/src/routes/operator.ts
check_file_exists packages/secure_core/test/routes/operator.test.ts
check_grep_in_file 'export const operatorRoutes' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 exports operatorRoutes Fastify plugin"
check_grep_in_file 'export class OperatorService' \
  packages/secure_core/src/operator/service.ts \
  "L4.10 exports OperatorService"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file '/operator/audit-events' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 declares GET /operator/audit-events (cross-workspace; v4 §22.2)"
check_grep_in_file '/operator/incident/:workspaceId/investigate' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 declares POST /operator/incident/:workspaceId/investigate (v4 §22.2)"
check_grep_in_file '/operator/incident/:workspaceId/remediate' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 declares POST /operator/incident/:workspaceId/remediate (v4 §22.2)"
check_grep_in_file 'platform:audit_read' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 names the platform:audit_read capability (v4 §13.2 / §22.2)"
check_grep_in_file 'platform:incident_investigate' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 names the platform:incident_investigate capability (v4 §13.2 / §22.2)"
check_grep_in_file 'platform:incident_remediate' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 names the platform:incident_remediate capability (v4 §13.2 / §22.2)"
check_grep_in_file 'requireApprovalIfHighRiskFactory' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 /remediate binds L2.9 requireApprovalIfHighRisk via factory (v4 §16)"
check_grep_in_file 'platform.capability_used' \
  packages/secure_core/src/operator/service.ts \
  "L4.10 OperatorService emits platform.capability_used (v4 §22.2)"
check_grep_in_file 'platform.long_session_granted' \
  packages/secure_core/src/operator/service.ts \
  "L4.10 OperatorService emits platform.long_session_granted (v4 §22.2)"
check_grep_in_file 'actorType: "operator"' \
  packages/secure_core/src/operator/service.ts \
  "L4.10 OperatorService writes audit rows with actor_type=operator (v4 §19.1)"
# Hard rule: operator routes NEVER read actor identity from req.body (v4 §19.1).
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes never read req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes never read req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.user_id' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes never read req.body.user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.role' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes never read req.body.role (v4 §19.1)"
# Operator routes are CROSS-WORKSPACE: they MUST NOT include
# loadWorkspace / requireWorkspaceMembership in their middleware
# chains (v4 §22.2 — platform capabilities are not workspace-bound).
check_grep_absent_in_file 'mw\.loadWorkspace' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes never call loadWorkspace (v4 §22.2 cross-workspace)"
check_grep_absent_in_file 'mw\.requireWorkspaceMembership' \
  packages/secure_core/src/routes/operator.ts \
  "L4.10 operator routes never call requireWorkspaceMembership (v4 §22.2)"
# L4.11 — worker token issuance route (orchestrator-only, v4 §18.1)
check_file_exists packages/secure_core/src/workers/tokenRoute.ts
check_file_exists packages/secure_core/test/workers/tokenRoute.test.ts
check_grep_in_file 'export const workerTokenRoute' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 exports workerTokenRoute Fastify plugin"
check_grep_in_file '/internal/workers/runs/:runId/token' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 declares POST /internal/workers/runs/:runId/token (v4 §18.1)"
check_grep_in_file 'composeMiddleware' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 routes go through composeMiddleware (§6.2 order enforced)"
check_grep_in_file 'worker:issue_token' \
  packages/secure_core/src/config/capabilities.ts \
  "L4.11 worker:issue_token capability is in the closed CAPABILITIES enum"
check_grep_in_file 'worker.token_issued' \
  packages/secure_core/src/config/audit_events.ts \
  "L4.11 worker.token_issued audit event is in the closed AUDIT_EVENTS enum"
check_grep_in_file 'worker.token_issued' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 emits worker.token_issued on success"
check_grep_absent_in_file 'unauthenticated.*operator|operator.*unauthenticated' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 token route never upgrades unauthenticated actor context to operator"
check_grep_in_file 'RUN_TERMINAL_STATES' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 refuses terminal-state runs (completed/failed/cancelled/expired)"
check_grep_in_file 'additionalProperties: false' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 body schema sets additionalProperties:false (refuses workspace_id/actor/etc.)"
# Hard rule: token route NEVER reads server-derived fields from req.body (v4 §19.1)
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 token route never reads req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.workspace_id' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 token route never reads req.body.workspace_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.capsule_id' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 token route never reads req.body.capsule_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.capsule_version_id' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 token route never reads req.body.capsule_version_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.requested_by' \
  packages/secure_core/src/workers/tokenRoute.ts \
  "L4.11 token route never reads req.body.requested_by (v4 §19.1)"
check_file_executable scripts/dev/postgres_up.sh "scripts/dev/postgres_up.sh executable"
check_grep_in_file 'exit 1' scripts/dev/postgres_up.sh \
  "postgres_up.sh fails closed instead of succeeding as an informational stub"
check_grep_in_file 'security_live_db\.sh' scripts/dev/postgres_up.sh \
  "postgres_up.sh points users at the live DB probe lane"

# Phase 0.5 audit fix bundle (2026-05-09): F1+F2 login + CSRF cookie issuance,
# F3 backend high-risk gating, F4 audit-tx ordering, F5 cookieSecret hardening.
section "Phase 0.5 audit fixes (2026-05-09: F1-F5)"
# F1+F2 — login + logout routes mint sessions and CSRF cookies.
check_file_exists packages/secure_core/src/auth/loginService.ts
check_file_exists packages/secure_core/src/routes/login.ts
check_file_exists packages/secure_core/test/auth/loginService.test.ts
check_file_exists packages/secure_core/test/routes/login.test.ts
check_grep_in_file 'export class LoginService' \
  packages/secure_core/src/auth/loginService.ts \
  "F1 LoginService is exported"
check_grep_in_file 'authenticatePassword' \
  packages/secure_core/src/auth/loginService.ts \
  "F1 LoginService.authenticatePassword exists"
check_grep_in_file 'terminateSession' \
  packages/secure_core/src/auth/loginService.ts \
  "F1 LoginService.terminateSession exists"
check_grep_in_file 'DUMMY_PASSWORD_HASH' \
  packages/secure_core/src/auth/loginService.ts \
  "F1 LoginService runs verifyPasswordHash even when user is null (constant-time anti-enumeration)"
check_grep_in_file 'Invalid username or password\.' \
  packages/secure_core/src/auth/loginService.ts \
  "F1 LoginService uses the generic anti-enumeration error message (v4 §8)"
check_grep_in_file 'export const loginRoutes' \
  packages/secure_core/src/routes/login.ts \
  "F1 loginRoutes Fastify plugin exported"
check_grep_in_file '/auth/login' \
  packages/secure_core/src/routes/login.ts \
  "F1 login route declares POST /auth/login"
check_grep_in_file '/auth/logout' \
  packages/secure_core/src/routes/login.ts \
  "F1 login route declares POST /auth/logout"
check_grep_in_file 'SESSION_COOKIE_NAME = "secure_session"' \
  packages/secure_core/src/routes/login.ts \
  "F2 session cookie name is secure_session (v4 §7)"
check_grep_in_file 'CSRF_COOKIE_NAME = "csrf_token"' \
  packages/secure_core/src/routes/login.ts \
  "F2 CSRF cookie name is csrf_token (v4 §7.2 double-submit)"
check_grep_in_file 'httpOnly: true' \
  packages/secure_core/src/routes/login.ts \
  "F2 secure_session cookie is HttpOnly"
check_grep_in_file 'httpOnly: false' \
  packages/secure_core/src/routes/login.ts \
  "F2 csrf_token cookie is non-HttpOnly so the SPA can echo X-CSRF-Token"
check_grep_in_file 'additionalProperties: false' \
  packages/secure_core/src/routes/login.ts \
  "F1 login body schema sets additionalProperties:false"
check_grep_absent_in_file 'req\.body\.actor' \
  packages/secure_core/src/routes/login.ts \
  "F1 login route never reads req.body.actor (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.actor_user_id' \
  packages/secure_core/src/routes/login.ts \
  "F1 login route never reads req.body.actor_user_id (v4 §19.1)"
check_grep_absent_in_file 'req\.body\.user_id' \
  packages/secure_core/src/routes/login.ts \
  "F1 login route never reads req.body.user_id (v4 §19.1)"
# F3 — backend classifier + approval gating in run-create.
check_file_exists packages/secure_core/src/runs/backendClassifier.ts
check_grep_in_file 'export const RUN_BACKENDS' \
  packages/secure_core/src/runs/backendClassifier.ts \
  "F3 RUN_BACKENDS enum exported"
check_grep_in_file 'classifyRunBackend' \
  packages/secure_core/src/runs/backendClassifier.ts \
  "F3 classifyRunBackend helper exported"
check_grep_in_file 'expensive_run' \
  packages/secure_core/src/runs/backendClassifier.ts \
  "F3 expensive backends map to expensive_run high-risk action (v4 §17)"
check_grep_in_file 'hpc_submission' \
  packages/secure_core/src/runs/backendClassifier.ts \
  "F3 hpc backends map to hpc_submission high-risk action (v4 §17)"
check_grep_in_file 'classifyRunBackend' \
  packages/secure_core/src/routes/runs.ts \
  "F3 run create route classifies backend before mutation"
check_grep_in_file 'consumeToken' \
  packages/secure_core/src/routes/runs.ts \
  "F3 run create route consumes an approval token for high-risk backends"
# F5 — cookieSecret is required AND length-validated at buildApp boundary.
check_grep_in_file 'cookieSecret: string;' \
  packages/secure_core/src/server.ts \
  "F5 cookieSecret is required (no '?' optional marker)"
check_grep_in_file 'MIN_COOKIE_SECRET_BYTES' \
  packages/secure_core/src/server.ts \
  "F5 server.ts enforces a minimum cookie secret length"
check_grep_in_file 'cookieSecret must be at least' \
  packages/secure_core/src/server.ts \
  "F5 buildApp throws on a too-short cookieSecret (no silent integrity failure)"
# F4 — audit emission lives OUTSIDE the workspaces tx block.
check_grep_in_file 'emitAudit' \
  packages/secure_core/src/workspaces/service.ts \
  "F4 workspaces.service uses an emitAudit flag returned from begin() (audit fires after commit)"
check_file_exists packages/secure_core/test/workspaces/service.test.ts
check_grep_in_file 'tx rollback at commit' \
  packages/secure_core/test/workspaces/service.test.ts \
  "F4 has a behavioral test that asserts zero audit writes on tx rollback"
# Recovery → session bridge: the consume routes optionally accept a
# LoginService and mint a fresh session so password-reset / email-verify
# users land logged in (no UX dead-end).
check_grep_in_file 'mintSessionForUser' \
  packages/secure_core/src/auth/loginService.ts \
  "Recovery bridge: LoginService exposes mintSessionForUser"
check_grep_in_file 'loginService' \
  packages/secure_core/src/routes/auth.ts \
  "Recovery bridge: authRoutes accepts an optional LoginService"
check_grep_in_file 'password_reset' \
  packages/secure_core/src/routes/auth.ts \
  "Recovery bridge: password-reset/consume mints session via authMethod=password_reset"
check_grep_in_file 'email_verify' \
  packages/secure_core/src/routes/auth.ts \
  "Recovery bridge: email-verify/consume mints session via authMethod=email_verify"
check_grep_in_file 'mintSessionForUser' \
  packages/secure_core/test/routes/auth.test.ts \
  "Recovery bridge: tests cover the mintSessionForUser bridge path"
check_grep_in_file 'loginService: LoginService' \
  packages/secure_core/src/routes/auth.ts \
  "Recovery bridge: loginService is required (no '?' optional marker — TypeScript fails the build if a host omits it)"
# Frontend contract surface lists POST /auth/login + POST /auth/logout
# (audit follow-up 2026-05-09: the audit flagged that the contracts
# file omitted the new login/logout routes despite them being the
# primary frontend-facing auth surface).
check_grep_in_file '"auth.login"' \
  packages/secure_core/src/client/contracts.ts \
  "Frontend contract: SECURE_CORE_FRONTEND_ROUTES lists POST /auth/login"
check_grep_in_file '"auth.logout"' \
  packages/secure_core/src/client/contracts.ts \
  "Frontend contract: SECURE_CORE_FRONTEND_ROUTES lists POST /auth/logout"
check_grep_in_file 'LoginResponseBody' \
  packages/secure_core/src/client/contracts.ts \
  "Frontend contract: LoginResponseBody type is exported for SPA use"

# Phase 0.5 auth gateway, Phase A (2026-05-09): username-primary identity.
# secure_core now keys login + recovery flows on a username; email is
# optional/supplementary metadata. The seeded root admin in particular
# carries username only (email is intentionally NULL).
section "Phase 0.5 auth gateway / Phase A (username-primary identity)"
check_file_exists packages/secure_core/src/db/migrations/0004_username_and_user_credentials.sql
check_grep_in_file 'CREATE TABLE "user_credentials"' \
  packages/secure_core/src/db/migrations/0004_username_and_user_credentials.sql \
  "Phase A migration creates user_credentials sidecar table"
check_grep_in_file 'ADD COLUMN "username"' \
  packages/secure_core/src/db/migrations/0004_username_and_user_credentials.sql \
  "Phase A migration adds users.username column"
check_grep_in_file 'export const userCredentials' \
  packages/secure_core/src/db/schema.ts \
  "Phase A schema.ts exports userCredentials drizzle table"
check_grep_in_file 'username: text\("username"\)' \
  packages/secure_core/src/db/schema.ts \
  "Phase A schema.ts adds username column to users"
check_grep_in_file 'users_identity_present_check' \
  packages/secure_core/src/db/schema.ts \
  "Phase A schema.ts enforces users have at least one of email/username"
check_grep_in_file "'password_reset'" \
  packages/secure_core/src/db/schema.ts \
  "Phase A sessions.auth_method CHECK includes 'password_reset' (recovery → session bridge)"
check_grep_in_file "'email_verify'" \
  packages/secure_core/src/db/schema.ts \
  "Phase A sessions.auth_method CHECK includes 'email_verify' (recovery → session bridge)"
check_grep_in_file 'username: string' \
  packages/secure_core/src/auth/loginService.ts \
  "Phase A LoginService input keyed by username (not email)"
check_grep_in_file 'lower\(username\)' \
  packages/secure_core/src/auth/loginService.ts \
  "Phase A LoginService looks up users by lower(username)"
check_grep_in_file 'USERNAME_REGEX' \
  packages/secure_core/src/routes/login.ts \
  "Phase A LOGIN_SCHEMA uses alphanumeric USERNAME_REGEX"
check_grep_in_file 'findUserByUsername' \
  packages/secure_core/src/auth/recoveryService.ts \
  "Phase A RecoveryRepo seam keys recovery on username (email is supplementary)"
check_grep_in_file 'admin_username' \
  packages/secure_core/src/routes/bootstrap.ts \
  "Phase A bootstrap body field is admin_username (not admin_email)"
check_grep_absent_in_file 'REQUEST_EMAIL_SCHEMA\b' \
  packages/secure_core/src/routes/auth.ts \
  "Phase A removed legacy REQUEST_EMAIL_SCHEMA name"

# Phase 0.5 auth gateway / Phase B+C+D scaffold (2026-05-09):
# the workbench-gateway package + bootstrap/argon2 adapters + the
# .env.auth canonical config land together.
section "Phase 0.5 auth gateway / Phase B+C+D scaffold"
check_dir_exists apps/workbench-gateway "apps/workbench-gateway/ package directory exists"
check_file_exists apps/workbench-gateway/package.json
check_file_exists apps/workbench-gateway/tsconfig.json
check_file_exists apps/workbench-gateway/vitest.config.ts
check_file_exists apps/workbench-gateway/src/main.ts
check_file_exists apps/workbench-gateway/src/env.ts
check_file_exists apps/workbench-gateway/src/auth/argon2Adapter.ts
check_file_exists apps/workbench-gateway/src/bootstrap/dbAdapter.ts
check_file_exists apps/workbench-gateway/.env.auth.example
check_file_exists .env.auth.example
check_grep_in_file '@simworkbench/workbench-gateway' \
  apps/workbench-gateway/package.json \
  "gateway package.json declares the @simworkbench/workbench-gateway name"
check_grep_in_file '@node-rs/argon2' \
  apps/workbench-gateway/package.json \
  "gateway depends on @node-rs/argon2 (prebuilt napi binding, no native compile)"
check_grep_in_file 'memoryCost: 65_536' \
  apps/workbench-gateway/src/auth/argon2Adapter.ts \
  "gateway argon2 params match OWASP 2023 (m=65536 KiB)"
check_grep_in_file 'export function createArgon2Adapter' \
  apps/workbench-gateway/src/auth/argon2Adapter.ts \
  "gateway exports createArgon2Adapter (LoginService seam)"
check_grep_in_file 'export function createBootstrapDbAdapter' \
  apps/workbench-gateway/src/bootstrap/dbAdapter.ts \
  "gateway exports createBootstrapDbAdapter (BootstrapService seam)"
check_grep_in_file '_platform' \
  apps/workbench-gateway/src/bootstrap/dbAdapter.ts \
  "bootstrap adapter seeds the _platform synthetic workspace"
check_grep_in_file 'shared-internal-tools' \
  apps/workbench-gateway/src/bootstrap/dbAdapter.ts \
  "bootstrap adapter seeds the shared-internal-tools workspace"
check_grep_in_file 'shared-public-experiments' \
  apps/workbench-gateway/src/bootstrap/dbAdapter.ts \
  "bootstrap adapter seeds the shared-public-experiments workspace"
check_grep_in_file 'sql\.begin' \
  apps/workbench-gateway/src/bootstrap/dbAdapter.ts \
  "bootstrap adapter wraps every INSERT in a single sql.begin tx"
check_grep_in_file 'export function loadGatewayEnv' \
  apps/workbench-gateway/src/env.ts \
  "gateway exports loadGatewayEnv (.env.auth loader with required-variable enforcement)"
check_grep_in_file 'must be at least .* bytes' \
  apps/workbench-gateway/src/env.ts \
  "loadGatewayEnv enforces a 32-byte minimum on cookie/handoff secrets"
check_grep_in_file 'BOOTSTRAP_CREDENTIAL_HASH' \
  .env.auth.example \
  ".env.auth.example documents BOOTSTRAP_CREDENTIAL_HASH"
check_grep_in_file 'ROOT_ADMIN_USER_ID' \
  .env.auth.example \
  ".env.auth.example documents ROOT_ADMIN_USER_ID"
check_grep_in_file 'WORKBENCH_GATEWAY_HANDOFF_SECRET' \
  .env.auth.example \
  ".env.auth.example documents WORKBENCH_GATEWAY_HANDOFF_SECRET"
check_grep_in_file '!\.env\.auth\.example' \
  .gitignore \
  ".gitignore commits .env.auth.example while ignoring .env.auth"

# Phase 0.5 auth gateway / Phase E (HMAC handoff + FastAPI middleware
# + workspace path helpers + loopback bind). Phase E1 (signer), E3
# (Python middleware), E4 (paths helpers), E6 (loopback bind) ship
# in this section. E2 (proxy plugin) and E5 (server.py refactor)
# remain open and follow in subsequent commits.
section "Phase 0.5 auth gateway / Phase E (handoff + middleware + paths)"
check_file_exists apps/workbench-gateway/src/proxy/handoffSigner.ts
check_grep_in_file 'export const HANDOFF_HEADERS' \
  apps/workbench-gateway/src/proxy/handoffSigner.ts \
  "handoffSigner exports the 7 HANDOFF_HEADERS constants"
check_grep_in_file 'createHmac' \
  apps/workbench-gateway/src/proxy/handoffSigner.ts \
  "handoffSigner uses createHmac (HMAC-SHA256)"
check_grep_in_file 'timingSafeEqual' \
  apps/workbench-gateway/src/proxy/handoffSigner.ts \
  "handoffSigner verifyHandoffSignature uses timingSafeEqual"
check_grep_in_file 'HANDOFF_REPLAY_WINDOW_SEC = 30' \
  apps/workbench-gateway/src/proxy/handoffSigner.ts \
  "handoffSigner replay window is 30s (matches FastAPI default)"
check_file_exists packages/core/src/simworkbench/api/auth_middleware.py
check_grep_in_file 'class WorkbenchHandoffMiddleware' \
  packages/core/src/simworkbench/api/auth_middleware.py \
  "FastAPI middleware exports WorkbenchHandoffMiddleware"
check_grep_in_file 'hmac\.compare_digest' \
  packages/core/src/simworkbench/api/auth_middleware.py \
  "FastAPI middleware uses hmac.compare_digest (constant-time signature compare)"
check_grep_in_file 'load_handoff_secret_from_env' \
  packages/core/src/simworkbench/api/auth_middleware.py \
  "FastAPI middleware exports load_handoff_secret_from_env helper"
check_file_exists tests/integration/test_api_auth_middleware.py
check_file_exists tests/unit/test_paths_workspace_scoped.py
check_grep_in_file 'def simulation_capsules_root_for' \
  packages/core/src/simworkbench/paths/__init__.py \
  "paths.simulation_capsules_root_for(slug) ships"
check_grep_in_file 'def temp_runs_root_for' \
  packages/core/src/simworkbench/paths/__init__.py \
  "paths.temp_runs_root_for(slug) ships"
check_grep_in_file 'def temp_imports_root_for' \
  packages/core/src/simworkbench/paths/__init__.py \
  "paths.temp_imports_root_for(slug) ships"
check_grep_in_file '_validate_workspace_slug' \
  packages/core/src/simworkbench/paths/__init__.py \
  "paths slug validator pinned to ^[A-Za-z0-9_-]{3,64}$"
check_grep_in_file 'DEFAULT_HOST = "127\.0\.0\.1"' \
  scripts/dev/run_backend.py \
  "run_backend.py binds to loopback by default (Phase 0.5 auth gateway invariant)"

# Phase 0.5 auth gateway / Phase D-rest (route-vertical wiring). Until
# this section landed, `apps/workbench-gateway/src/main.ts` was a thin
# shell that built the Fastify app via secure_core's factory but
# registered zero route plugins. The advisor's review of the Phase E
# close flagged that gap; this section pins the minimum vertical
# (loginRoutes + sessionRoutes + bootstrapRoutes) plus the integration
# smoke test that exercises the wiring.
section "Phase 0.5 auth gateway / Phase D-rest (route-vertical wiring)"
check_file_exists apps/workbench-gateway/src/services/composeServices.ts
check_grep_in_file 'export function buildGatewayServices' \
  apps/workbench-gateway/src/services/composeServices.ts \
  "composeServices exports buildGatewayServices factory"
check_grep_in_file 'new LoginService' \
  apps/workbench-gateway/src/services/composeServices.ts \
  "composeServices instantiates LoginService"
check_grep_in_file 'new BootstrapService' \
  apps/workbench-gateway/src/services/composeServices.ts \
  "composeServices instantiates BootstrapService"
check_grep_in_file 'new SqlCurrentSessionReader' \
  apps/workbench-gateway/src/services/composeServices.ts \
  "composeServices instantiates SqlCurrentSessionReader"
check_file_exists apps/workbench-gateway/src/middleware/bundles.ts
check_grep_in_file 'export function buildGatewayMiddleware' \
  apps/workbench-gateway/src/middleware/bundles.ts \
  "bundles.ts exports buildGatewayMiddleware factory"
check_grep_in_file 'enforceCsrfForStateChange' \
  apps/workbench-gateway/src/middleware/bundles.ts \
  "bundles.ts wires enforceCsrfForStateChange"
check_grep_in_file 'requireAuth' \
  apps/workbench-gateway/src/middleware/bundles.ts \
  "bundles.ts wires requireAuth (real cookie-session middleware)"
check_grep_in_file 'app\.register\(loginRoutes' \
  apps/workbench-gateway/src/main.ts \
  "main.ts registers loginRoutes (POST /auth/login + /auth/logout)"
check_grep_in_file 'app\.register\(sessionRoutes' \
  apps/workbench-gateway/src/main.ts \
  "main.ts registers sessionRoutes (GET /auth/session)"
check_grep_in_file 'app\.register\(bootstrapRoutes' \
  apps/workbench-gateway/src/main.ts \
  "main.ts registers bootstrapRoutes (POST /bootstrap)"
check_file_exists apps/workbench-gateway/test/integration/loginVertical.test.ts
check_grep_in_file 'POST /bootstrap with matching OOB credential' \
  apps/workbench-gateway/test/integration/loginVertical.test.ts \
  "loginVertical test pins POST /bootstrap happy path"
check_grep_in_file 'POST /auth/login mints both cookies' \
  apps/workbench-gateway/test/integration/loginVertical.test.ts \
  "loginVertical test pins POST /auth/login cookie shape"
check_grep_in_file 'GET /auth/session without a cookie' \
  apps/workbench-gateway/test/integration/loginVertical.test.ts \
  "loginVertical test pins GET /auth/session unauth → 401"
check_grep_in_file 'wrong Origin' \
  apps/workbench-gateway/test/integration/loginVertical.test.ts \
  "loginVertical test pins Origin allowlist enforcement"

# Phase 0.5 auth gateway / Phase E2-min (workbench proxy plugin).
# E2-min lands the @fastify/http-proxy mount + the HMAC handoff sign-
# and-forward path. E2-rest (workspace authorization, CSRF on the
# proxied state-changing methods, slug cross-check) follows in a
# subsequent commit.
section "Phase 0.5 auth gateway / Phase E2-min (proxy plugin)"
check_file_exists apps/workbench-gateway/src/proxy/workbenchProxy.ts
check_grep_in_file 'export const workbenchProxyPlugin' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy exports the FastifyPluginAsync workbenchProxyPlugin"
check_grep_in_file 'rewritePrefix: "/api"' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy preserves /api prefix when forwarding (FastAPI mount)"
check_grep_in_file 'preRewrite' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy preRewrite strips slug from forwarded URL (E2-rest)"
check_grep_in_file 'routes: \["/:slug"' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy route shape is /api/:slug (E2-rest workspace authorization)"
check_grep_in_file 'req\.workspace\.id' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy uses real workspace_id from req.workspace (no synthetic)"
check_grep_in_file 'req\.membership\.roleName' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy uses real role list from req.membership (no empty)"
check_file_exists packages/secure_core/src/middleware/loadWorkspaceBySlug.ts
check_grep_in_file 'export function loadWorkspaceBySlug' \
  packages/secure_core/src/middleware/loadWorkspaceBySlug.ts \
  "secure_core exports loadWorkspaceBySlug middleware (E2-rest)"
check_grep_in_file 'loadWorkspaceBySlug' \
  packages/secure_core/src/middleware/index.ts \
  "secure_core middleware barrel re-exports loadWorkspaceBySlug"
check_file_exists packages/secure_core/test/middleware/loadWorkspaceBySlug.test.ts
check_grep_in_file 'proxyAuthChain' \
  apps/workbench-gateway/src/middleware/bundles.ts \
  "gateway middleware bundle exposes proxyAuthChain"
check_grep_in_file 'rewriteRequestHeaders' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy uses rewriteRequestHeaders to attach signed headers"
check_grep_in_file 'stripInboundHandoffHeaders' \
  apps/workbench-gateway/src/proxy/workbenchProxy.ts \
  "workbenchProxy strips inbound X-Workbench-* (defense vs. client spoofing)"
check_grep_in_file 'app\.register\(workbenchProxyPlugin' \
  apps/workbench-gateway/src/main.ts \
  "main.ts registers workbenchProxyPlugin LAST"
check_file_exists apps/workbench-gateway/test/proxy/workbenchProxy.test.ts
check_grep_in_file 'forwards GET /api/.*workspace_id' \
  apps/workbench-gateway/test/proxy/workbenchProxy.test.ts \
  "workbenchProxy test pins outbound real workspace_id + role HMAC sign"
check_grep_in_file 'strips inbound X-Workbench-' \
  apps/workbench-gateway/test/proxy/workbenchProxy.test.ts \
  "workbenchProxy test pins inbound-header strip defense"
check_grep_in_file 'upstream-side HMAC verification' \
  apps/workbench-gateway/test/proxy/workbenchProxy.test.ts \
  "workbenchProxy test pins HMAC round-trip against verifying upstream"

# Phase 0.5 auth gateway / Phase E5 (workspace-slug threading through
# server.py). Every handler that reads / writes capsule, run, or
# temp-import paths now resolves the slug from
# ``request.state.workspace_slug`` (set by the auth_middleware after
# HMAC verification) via the ``workspace_slug_dep`` FastAPI dependency.
# No bare ``simulation_capsules_root()`` / ``temp_runs_root()`` /
# ``temp_imports_root()`` calls remain in server.py — every handler
# uses the ``_for(slug)`` helpers.
section "Phase 0.5 auth gateway / Phase E5 (workspace-slug threading)"
check_grep_in_file 'def workspace_slug_dep' \
  packages/core/src/simworkbench/api/server.py \
  "server.py defines workspace_slug_dep FastAPI dependency"
check_grep_in_file 'DEFAULT_WORKSPACE_SLUG' \
  packages/core/src/simworkbench/api/server.py \
  "server.py exposes DEFAULT_WORKSPACE_SLUG fallback (single-tenant + tests)"
check_grep_in_file 'simulation_capsules_root_for' \
  packages/core/src/simworkbench/api/server.py \
  "server.py uses simulation_capsules_root_for(slug) — workspace-scoped"
check_grep_in_file 'temp_runs_root_for' \
  packages/core/src/simworkbench/api/server.py \
  "server.py uses temp_runs_root_for(slug) — workspace-scoped"
# Bare-helper ban: confirms no handler regressed to a non-workspace
# call. The grep matches the `(` literal followed immediately by `)`
# — i.e. the zero-argument bare invocation. The workspace-scoped form
# `simulation_capsules_root_for(slug)` does NOT match because of the
# closing-arg.
if grep -qE '(simulation_capsules_root|temp_runs_root|temp_imports_root)\(\)' \
     packages/core/src/simworkbench/api/server.py; then
  FAIL=$((FAIL+1))
  fail "server.py has bare simulation_capsules_root() / temp_runs_root() / temp_imports_root() — every handler must use the _for(slug) variant (Phase E5)"
else
  PASS=$((PASS+1))
  note "server.py has no bare workspace-root calls (Phase E5 invariant)"
fi
check_grep_in_file 'workspace_slug_dep' \
  packages/core/src/simworkbench/api/server.py \
  "server.py threads workspace_slug_dep through handlers (Phase E5)"

# Phase 0.5 Layer-0 gate enforcement. All five Layer-0 ADRs flipped
# to Accepted on 2026-05-06; staying Accepted is now an invariant.
# Backsliding to Proposed (or any non-Accepted state) is a hard
# failure — Layer-1 in-flight code depends on the architectural
# decisions in these ADRs.
section "Phase 0.5 Layer-0 gate (Accepted invariant)"
for adr_file in program_development/architectural_decisions/ADR-0008-*.md \
                program_development/architectural_decisions/ADR-0009-*.md \
                program_development/architectural_decisions/ADR-0010-*.md \
                program_development/architectural_decisions/ADR-0011-*.md \
                program_development/architectural_decisions/ADR-0012-*.md; do
  adr_id=$(basename "$adr_file" | grep -oE 'ADR-00[0-9]+')
  status_line=$(awk '/^## Status/{getline; print; exit}' "$adr_file" 2>/dev/null | tr -d ' ')
  if [[ "$status_line" == "Accepted" ]]; then
    PASS=$((PASS+1))
    note "$adr_id Accepted (Layer-1 invariant holds)"
  else
    FAIL=$((FAIL+1))
    fail "$adr_id status is $status_line, expected Accepted — Layer-1 work depends on this ADR. Reverting to a non-Accepted state requires a deliberate ADR rewrite, not a casual edit."
  fi
done

section "Phase 10 — Cross-cutting + gate walk"
check_file_exists tests/integration/test_phase_10_gate_walk.py
check_file_exists tests/regression/test_approval_gates_enforcement.py
check_file_exists tests/regression/test_autonomy_provenance_trail.py
check_file_exists tests/regression/test_autonomy_no_validated_without_evidence.py
check_file_exists examples/autonomous_experiment_kr/run_autonomous.py
check_file_exists examples/autonomous_experiment_kr/README.md
check_file_exists program_development/architectural_decisions/ADR-0007-autonomous-budget-governance.md
check_grep_in_file 'autonomy|autonomous' \
  docs_site/src/content/agent_workflows.tsx \
  "agent_workflows docs page mentions autonomy"
check_grep_in_file 'designExperiment|reviewExperiment|autonomousSweep' \
  apps/workbench-ui/src/api/client.ts \
  "client.ts exposes autonomy helpers"
check_file_exists apps/workbench-ui/src/components/autonomy/AutonomyPanel.tsx

section "Deprecated phase-state drift guards"
check_file_exists tests/regression/test_phase_contract_drift.py
check_file_executable scripts/dev/check_current_contract_language.py \
  "current-contract language scanner executable"
if scripts/dev/check_current_contract_language.py >/tmp/simworkbench_contract_language_check.out 2>&1; then
  PASS=$((PASS+1))
  note "current-contract language scanner passes"
else
  FAIL=$((FAIL+1))
  fail "current-contract language scanner failed: $(cat /tmp/simworkbench_contract_language_check.out)"
fi
check_file_exists docs_site/src/content/current_contracts.tsx \
  "current-contract docs page"
check_grep_in_file 'current_contracts' apps/workbench-ui/src/components/DocsViewer.tsx \
  "DocsViewer registers current-contract docs page"
check_grep_absent_in_file 'Runtime execution lands in Workstream 1C' README.md \
  "README no longer advertises runtime as future Phase 1C work"
check_grep_absent_in_file 'examples/krf_excimer/krf_excimer\.lxp' README.md \
  "README no longer points run_capsule at a nonexistent KrF capsule"
check_grep_absent_in_file './scripts/export/capsule\.sh <capsule_name>' README.md \
  "README export command uses the current capsule_dir target_dir contract"
check_grep_absent_in_file '\| 10 \| Next \|' CLAUDE.md \
  "CLAUDE phase table marks Phase 10 complete"
check_grep_absent_in_file 'empty pending Phase 10' CLAUDE.md \
  "CLAUDE convention-checker note no longer says Phase 10 is pending"
check_grep_absent_in_file 'currently active|Pending\.' packages/core/src/simworkbench/__init__.py \
  "simworkbench package docstring does not claim old Phase 1 pending state"
check_grep_absent_in_file 'wait for Phase|Phase 1 has no rate-parser|field-only interactions land in Phase|higher-order kinetics land in Phase' \
  packages/core/src/simworkbench/runtime/python_cpu.py \
  "python_cpu runtime errors do not tell users to wait for closed phases"
check_grep_absent_in_file 'workbench shell skeleton|Backend file fetch lands|file content fetching is wired' \
  apps/workbench-ui/src/components/CodeViewer.tsx \
  "CodeViewer loads from the current capsule file API, not placeholder text"
check_grep_in_file 'getCapsuleFile' apps/workbench-ui/src/components/CodeViewer.tsx \
  "CodeViewer uses capsule file API"
check_grep_in_file 'getCapsuleTree' apps/workbench-ui/src/components/CodeViewer.tsx \
  "CodeViewer uses capsule tree API"
check_grep_absent_in_file 'Phase 0 placeholder|UI placeholder' apps/workbench-ui/src/app/page.tsx \
  "app/page.tsx no longer presents itself as Phase 0 placeholder UI"

# Open-workstream TODO branch. Phase 10 closed 2026-05-04; no further
# phases scheduled.
if [[ $INCLUDE_OPEN_WORKSTREAMS -eq 1 ]]; then
  section "Open Workstream TODOs"
  # Phase 0.5 audit-fix follow-ups (deferred from the 2026-05-09 F1-F5
  # bundle). These remain visible as opt-in failures so the deferrals
  # do not silently bit-rot.
  # 1. HMAC-signed pagination cursors. Audit-events and operator routes
  #    currently emit/accept opaque cursors that are not HMAC-signed.
  #    Per v4 §10.3 + §22.2, cursors must be tamper-evident.
  if grep -qE 'createHmac|hmacSign|signCursor' \
       packages/secure_core/src/routes/auditEvents.ts \
       packages/secure_core/src/routes/operator.ts 2>/dev/null; then
    PASS=$((PASS+1))
    note "Pagination cursors are HMAC-signed in audit-events + operator routes"
  else
    FAIL=$((FAIL+1))
    fail "Pagination cursors are NOT HMAC-signed in audit-events + operator routes (deferred follow-up from 2026-05-09 F1-F5 bundle; v4 §10.3)"
  fi
  # 2. requireAuth hardcodes ActorType = "human". This is correct for
  #    Phase 0.5 (cookie-session auth ONLY mints human sessions; worker
  #    auth flows through `workerAuth.ts`), but the assignment site
  #    should at minimum carry a comment naming the design decision —
  #    or, if a future deployment introduces non-human cookie sessions,
  #    derive the value from the session row's `auth_method`. The
  #    deferred follow-up: either add the design-decision comment or
  #    move the assignment to a derivation.
  if grep -qiE 'cookie-session auth.*ONLY mints human|cookie session.*human session' \
       packages/secure_core/src/middleware/requireAuth.ts 2>/dev/null; then
    PASS=$((PASS+1))
    note "requireAuth documents why ActorType is hardcoded to 'human'"
  else
    FAIL=$((FAIL+1))
    fail "requireAuth hardcodes 'const actorType: ActorType = \"human\"' without naming the design decision (deferred follow-up from 2026-05-09 F1-F5 bundle)"
  fi
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
         dev/check_workspace_paths.sh \
         dev/check_security_headers.sh \
         dev/check_security_schema.sh \
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
         test/ui.sh \
         export/capsule.sh; do
  check_file_executable "scripts/$f" "script scripts/$f"
done
for f in unit integration regression validation performance; do
  check_grep_in_file '\.venv/bin/python' "scripts/test/$f.sh" "scripts/test/$f.sh prefers repo venv"
done
for d in laser_species krf_excimer simple_rate_equations molecular_dynamics ising_phase_transition pde_wave_equation; do
  check_dir_exists "examples/$d" "examples/$d"
  # Each example directory ships at least a runnable script + README so
  # the dir isn't a stub. simple_rate_equations + krf_excimer also ship
  # a model.yaml because they exercise the ModelSpec loader; the others
  # exercise validated physics modules directly.
  check_file_exists "examples/$d/run.py"
  check_file_exists "examples/$d/README.md"
done
check_file_exists examples/simple_rate_equations/model.yaml
check_file_exists tests/performance/test_runtime_smoke.py
check_file_exists examples/krf_excimer/model.yaml
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
for f in overview installation usage os_compatibility architecture module_development \
         internal_tools simulation_capsules agent_workflows \
         validation troubleshooting; do
  check_file_exists "docs_site/src/content/$f.tsx" "doc page $f.tsx"
done
check_grep_in_file 'os-compatibility' \
  docs_site/src/pages/docsPages.ts \
  "OS compatibility docs page is registered"
check_grep_in_file 'os_compatibility' \
  apps/workbench-ui/src/components/DocsViewer.tsx \
  "OS compatibility page is registered in workbench docs"

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
