# Scientific Simulation Workbench

A modular workbench for laser physics, laser fusion, laser–species interaction, and adjacent computational-physics domains. Designed to turn a scientific paper into a structured, inspectable, testable, visualizable computational experiment — and to keep the resulting code, data, and provenance bundled in a portable simulation capsule.

> **Status: Phase 3 — Internal Tool SDK and Registry complete (2026-05-02; gate-walk fixes 2026-05-02).** All five workstreams 3A–3E shipped, plus the post-close gate-walk fixes: `BaseTool` ABC + `ToolInput`/`ToolOutput` contracts at `simworkbench.tools` with input AND output validation, `ToolMetadata` (Pydantic) backing `tool.yaml`, lifecycle state machine (`draft → candidate → validated → trusted → deprecated`) with agent/human gating AND scientific gating (validation tests must declare + pass before `→ validated`); `ToolRegistry` discovers `packages/internal_tools/registry/` + `local_cache/imported_tools/`, the `absorption_spectrum_diagnostic` reference tool from plan §9.4, and `scripts/dev/refresh_registry.sh`; seven category templates under `packages/internal_tools/templates/`; the Tools tab in the workbench UI wired to eight backend endpoints (`GET /api/tools{,/{name}{,/docs}}`, `POST /api/tools/{name}/{status,run-tests,execute,export}`, `POST /api/tools/import`); experiment binding via `Experiment.tool_refs` + `simworkbench.tools.apply_tools`; and `tests/integration/test_phase_3_gate_walk.py` exercising every plan-named gate verb (create / test / register / execute / use-in-experiment / export / import) end-to-end. Phase 2 (Simulation Capsule System), Phase 1 (Manual Scientific Workbench), and Phase 0 (Project Bootstrap) remain complete.

The full architectural plan is in [`scientific_simulation_workbench_agent_plan.md`](./scientific_simulation_workbench_agent_plan.md).

---

## Project Purpose

```text
Scientific paper
    ↓ extracted equations, parameters, regimes, diagnostics
ModelSpec (structured intermediate representation)
    ↓ mapped to validated reusable modules
Generated or composed experiment code
    ↓ run interactively, with diagnostics & visualization
Exportable reproducible simulation capsule (.lxp/)
```

Initial focus is laser–species interaction (KrF excimer, photoionization, rate-equation models). The internal abstractions are designed to extend to plasma kinetics, molecular dynamics, phase-transition analysis, Monte Carlo transport, PDE-based field simulations, and spectroscopy.

---

## Current Development Status

| Phase | Description | Status |
|---|---|---|
| 0 | Repository bootstrap, governance, docs skeleton, bug-memory and dev-history systems | **Complete** |
| 1 | Manual workbench: ModelSpec, units, runtime, basic modules, UI shell | **Complete** |
| 2 | Simulation capsule format & provenance | **Complete** |
| 3 | Internal tool SDK and registry | **Complete** |
| 4 | Agent-assisted paper ingestion | Pending |
| 5 | ModelSpec generation and module mapping | Pending |
| 6 | Sandboxed agentic code generation | Pending |
| 7 | Validated physics module registry | Pending |
| 8 | HPC and hardware backends | Pending |
| 9 | Parameter sweeps, optimization, uncertainty | Pending |
| 10 | Autonomous bounded experiment design | Pending |

See [`program_development/milestones/`](./program_development/milestones/) for per-phase notes and [`program_development/timeline.md`](./program_development/timeline.md) for chronology.

---

## Installation

> Phase 1 complete. The bootstrap script installs the full Python core (ModelSpec, units, experiment, runtime, diagnostics, api, capsule serialization) and the Node workspaces for both apps.

Prerequisites (planned):

- Python ≥ 3.11 (for `packages/core` and physics/solver modules)
- Node.js ≥ 20 (for `apps/workbench-ui` and `docs_site`)
- A C/C++ toolchain (for compiled kernels in Phase 8)

Bootstrap:

```bash
./scripts/dev/install.sh
```

This creates a Python virtualenv under `.venv/`, installs the Phase 1 core package in editable mode, and installs the UI/docs Node dependencies.

---

## Local Development Commands

```bash
# Run the workbench UI (Phase 1F)
./scripts/dev/run_ui.sh

# Run the Python backend / API server (Phase 1A–C)
./scripts/dev/run_backend.sh

# Run the documentation site (Phase 0B)
./scripts/docs/dev.sh

# Validate repository conventions
./scripts/dev/check_repo_conventions.sh

# Inspect open workstream TODO assertions (expected to fail until implemented)
./scripts/dev/check_repo_conventions.sh --include-open-workstreams
```

The UI, backend, capsule, kernel, and export scripts exist so documented commands do not point at missing files. Scripts for later phases print an explicit scheduled-phase message until their subsystem is implemented.

---

## Build Commands

```bash
# Build the docs site
./scripts/docs/build.sh

# Build the UI
./scripts/build/ui.sh   # Phase 1F

# Build compiled kernels
./scripts/build/kernels.sh   # Phase 8
```

---

## Testing Commands

```bash
./scripts/test/all.sh           # full suite
./scripts/test/unit.sh          # tests/unit
./scripts/test/integration.sh   # tests/integration
./scripts/test/regression.sh    # tests/regression
./scripts/test/validation.sh    # tests/validation (scientific properties)
./scripts/test/performance.sh   # tests/performance
```

`./scripts/test/all.sh` runs the hard repository conventions plus the current test suite. It intentionally does not include open-workstream TODO assertions; use `./scripts/dev/check_repo_conventions.sh --include-open-workstreams` when inspecting the active implementation backlog.

See `tests/README.md` for the testing strategy (also plan §20).

---

## Documentation Site Commands

```bash
./scripts/docs/dev.sh    # local dev server
./scripts/docs/build.sh  # static build
```

The documentation site is served at `http://localhost:3000` by default. The same source pages are loaded inside the workbench UI under the **Documentation** panel — there is one canonical doc source.

---

## Repository Structure

```text
scientific-simulation-workbench/
  AGENTS.md                  Durable rules for all dev agents
  CLAUDE.md                  Operational manual for Claude Code agents
  README.md                  This file
  .gitignore                 Excludes local caches, capsules, run artifacts
  LICENSE

  apps/
    workbench-ui/            TypeScript UI shell (Phase 1F)

  docs_site/                 TypeScript/MDX documentation (Phase 0B)

  packages/
    core/                    Python: ModelSpec, runtime, registry, units, validation
    agent_orchestration/     Python: paper ingestion, codegen, review agents (Phase 4+)
    physics_modules/         laser, plasma, species, spectroscopy, MD, phase-transition, PDE, MC
    solver_backends/         python_cpu, numba_cpu, cpp, fortran, cuda, kokkos, petsc, amrex, external_pic
    visualization/           plotters, viewers, dashboards, exporters
    internal_tools/          SDK, registry, examples, templates

  simulation_capsules/       Local-only: .lxp/ capsules (gitignored)
  local_cache/               Local-only: caches, imported tools (gitignored)
  temp_imports/              Local-only: staged imports (gitignored)
  temp_runs/                 Local-only: in-flight runs (gitignored)

  bugs_and_fixes/            Bug memory: bugfixes, known failures, regression notes, agent error patterns
  program_development/       Timeline, ADRs, milestone phase notes

  tests/                     unit, integration, regression, validation, performance

  scripts/                   dev, build, test, docs, clean, export

  examples/                  laser_species, krf_excimer, simple_rate_equations, MD, ising, wave PDE

  configs/                   default.yaml, local.yaml.example, backends.yaml, agents.yaml
```

---

## Simulation Capsule Overview

A simulation capsule is a portable, reproducible bundle:

```text
experiment_name.lxp/
  manifest.toml
  paper_sources/      original PDFs, extracted text & equations
  model/              ModelSpec, assumptions, validity domain, units report
  src/                generated/, user_edits/, kernels/
  configs/            run, backend, visualization
  data/               initial conditions, cached coefficients
  results/            diagnostics, plots, checkpoints
  validation/         dimensional, conservation, benchmark, convergence
  notebooks/          analysis
  provenance/         provenance.lock, environment.yaml, agent_trace.md
  README.md
```

Capsules support **save, load, fork, export code, export data, export report, rerun, inspect assumptions, inspect code, inspect validation status**. See plan §7 for the full capsule contract.

---

## How to Add a Physics Module

See [`CLAUDE.md → How to Add a Simulation Module`](./CLAUDE.md#how-to-add-a-simulation-module) and [`docs_site/src/content/module_development.tsx`](./docs_site/src/content/module_development.tsx).

---

## How to Add an Internal Tool

See [`CLAUDE.md → How to Add an Internal Tool`](./CLAUDE.md#how-to-add-an-internal-tool) and [`docs_site/src/content/internal_tools.tsx`](./docs_site/src/content/internal_tools.tsx).

---

## How to Run Example Simulations

The first Phase 1A example is a validated ModelSpec. Runtime execution lands in Workstream 1C:

```bash
# Validate and save/load the example experiment
source .venv/bin/activate
python - <<'PY'
from simworkbench import Experiment
from simworkbench.model_spec import load_yaml
from simworkbench.serialization import save_experiment

spec = load_yaml("examples/simple_rate_equations/model.yaml")
experiment = Experiment.from_model_spec(spec)
save_experiment(experiment, "temp_runs/simple_rate_equations_experiment.yaml")
PY

# Phase 2+
./scripts/dev/run_capsule.sh examples/krf_excimer/krf_excimer.lxp
```

---

## How to Export and Reload Experiments

```bash
# Export a capsule (data + code + provenance) to a portable archive
./scripts/export/capsule.sh <capsule_name>

# Reload a capsule into the workbench
./scripts/dev/run_capsule.sh path/to/capsule.lxp
```

---

## Agent Development Instructions

Coding agents working in this repository **must** read [`AGENTS.md`](./AGENTS.md) first. Claude Code agents must additionally read [`CLAUDE.md`](./CLAUDE.md). The shorthand:

- Update docs alongside code.
- Keep temp files inside `local_cache/`, `temp_imports/`, `temp_runs/`, `simulation_capsules/`.
- Check `bugs_and_fixes/` before modifying a subsystem.
- Use the units subsystem — no raw floats for physical quantities.
- Promote modules `draft → candidate → validated → trusted` only with tests, docs, and a human reviewer.
- Do not silently invent missing scientific data.

---

## Related Files

- [`AGENTS.md`](./AGENTS.md) — durable rules for all development agents
- [`CLAUDE.md`](./CLAUDE.md) — Claude-specific operating manual
- [`bugs_and_fixes/`](./bugs_and_fixes/) — bug memory and regression record
- [`program_development/`](./program_development/) — timeline, ADRs, milestones
- [`scientific_simulation_workbench_agent_plan.md`](./scientific_simulation_workbench_agent_plan.md) — full architectural plan
