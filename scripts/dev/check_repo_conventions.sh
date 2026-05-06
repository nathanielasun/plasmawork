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

section "v4 §1 inserts + security stub"
check_grep_in_file 'Secure Multi-User Development Requirements' AGENTS.md \
  "AGENTS.md carries v4 §1.1 insert"
check_grep_in_file 'Security Rules for Multi-User Workbench Work' CLAUDE.md \
  "CLAUDE.md carries v4 §1.2 insert"
check_file_executable scripts/test/security.sh "scripts/test/security.sh runs §29 spec-level invariants"
check_grep_in_file 'vitest run test/security' scripts/test/security.sh \
  "security.sh actually runs the §29 suite under packages/secure_core/test/security/"
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

section "secure_core Layer-4 routes (L4.1, L4.12)"
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
check_file_executable scripts/dev/postgres_up.sh "scripts/dev/postgres_up.sh stub"

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

# Open-workstream TODO branch. Phase 10 closed 2026-05-04; no further
# phases scheduled.
if [[ $INCLUDE_OPEN_WORKSTREAMS -eq 1 ]]; then
  section "Open Workstream TODOs"
  echo "  no open workstreams — Phase 10 closed 2026-05-04 (final phase)."
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
