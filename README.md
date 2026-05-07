# Scientific Simulation Workbench

A modular workbench for laser physics, laser fusion, laser–species interaction, and adjacent computational-physics domains. Designed to turn a scientific paper into a structured, inspectable, testable, visualizable computational experiment — and to keep the resulting code, data, and provenance bundled in a portable simulation capsule.

> **Status: Phase 10 — Autonomous Computational Experiment Design complete (2026-05-04). The full ten-phase plan has shipped.** Phase 10's `simworkbench.autonomy` module ships five workstreams 10A–10E: `ExperimentDesigner.design(spec)` returns an `ExperimentPlan` with minimum viable model, ordered fidelity ladder, cost estimate, planned diagnostics, and validation path (refuses if no recommended solver is declared); `SmokeRunner.run(experiment)` returns a `SmokeReport` with diagnostics interpretation, instability flags (NaN / monotonic blow-up detection), and suggested parameter adjustments — never auto-applied; `ControlledSweepAgent(budget=N)` wraps Phase-9 `SweepEngine` with a hard budget cap (no `ignore_budget` / `unbounded` / `skip_budget` kwargs; signature regression locks the contract), monitors run-by-run, summarises trends, and emits next-sweep recommendations; `ScientificReviewer.write(capsule)` writes `<capsule>/review/scientific_review.md` covering assumption critique, missing physics, literature alignment, overclaim flags, and recommended validation (off-limits subtrees `src/user_edits/`, `paper_sources/`, `provenance/` are explicitly refused); `ApprovalGate` enforces single-use file-backed tokens for the four documented privileged actions (trusted-promotion, expensive-runs, external-export, destructive-edits) — the HTTP API never reads `actor` / `role` from the request body. Plan §22 (Scientific Accuracy Policy) is enforced by `capsule_status_for_plan(plan)`: any placeholder coefficient pins the capsule to `exploratory`, never `validated`. ADR-0007 documents the budget-governance contract. The "Autonomy" UI tab (`AutonomyPanel.tsx`) drives four endpoints (`POST /api/autonomy/{design,smoke,sweep,review}/{capsule}`). `tests/integration/test_phase_10_gate_walk.py` written BEFORE implementation; 18 gate-walk tests cover every plan verb plus signature-bypass guards. `examples/autonomous_experiment_kr/run_autonomous.py` demonstrates the full design → sweep → review pipeline end-to-end. Phases 0–9 remain complete.

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
| 4 | Agent-assisted paper ingestion | **Complete** |
| 5 | ModelSpec generation and module mapping | **Complete** |
| 6 | Sandboxed agentic code generation | **Complete** |
| 7 | Validated physics module registry | **Complete** |
| 8 | HPC and hardware backends | **Complete** |
| 9 | Parameter sweeps, optimization, uncertainty | **Complete** |
| 10 | Autonomous bounded experiment design | **Complete** |

See [`program_development/milestones/`](./program_development/milestones/) for per-phase notes and [`program_development/timeline.md`](./program_development/timeline.md) for chronology.

> **Reading the status table above as "production-ready" would be a mistake.** All ten phases ship as planned, but the convention checker verifies *structural* completeness, not scientific capability. Read [`LIMITATIONS.md`](./LIMITATIONS.md) for the honest, kept-current map of what works today (real numerical core, schemas, sweep / UQ / optimization, FastAPI + UI, approval gates) and what is heuristic / template / stub (the autonomy "agents", paper interpretation drafts, the C++/CUDA solver suite — `axpy` only —, real laser–plasma physics modules).

Secure multi-user scaffolding is implemented through the Phase 0.5 Layer-5 integration gate in `packages/secure_core/`: server-derived identity, workspace-scoped object access, approval middleware, append-only audit/provenance chains, WORM anchor verification, sandbox spec guards, security docs, and CI wiring are covered by `scripts/test/security.sh`, `scripts/test/all.sh`, and `packages/secure_core/test/security/section29_coverage.test.ts`. Deployment-specific live probes now have dedicated CI entrypoints: `scripts/test/security_live_db.sh` (`PLASMAWORK_TEST_DB_URL`), `scripts/test/security_live_runsc.sh` (`PLASMAWORK_RUNSC_PROBES=1` plus a runner with `runsc`), and `scripts/test/security_live_worm.sh` (`PLASMAWORK_ANCHOR_LIVE_PROBES=1` plus `PLASMAWORK_ANCHOR_S3_*`). These target-runtime lanes must pass before production multi-user operation.

Secure frontend readiness is tracked in [`program_development/secure_frontend_readiness_plan.md`](./program_development/secure_frontend_readiness_plan.md). Frontend-facing secure-core route metadata and response contracts live in `packages/secure_core/src/client/contracts.ts`; the current contract includes `GET /auth/session` for server-derived app-shell identity/capability gating and marks operator remediation as fail-closed until backend side effects exist. The workbench UI now includes a **Security Ops** route (`/security`) that binds to the secure-core session and security-dashboard read paths, labels fixture fallback when the secure backend is not mounted locally, and renders fail-closed/deployment-gated routes as disabled controls rather than hidden buttons.

---

## Feature: Operating System Compatibility

The workbench targets local development on macOS, Linux, and Windows for the
Python core, TypeScript UI, documentation site, local runs, and capsule
serialization. The canonical compatibility page is
[`docs_site/src/content/os_compatibility.tsx`](./docs_site/src/content/os_compatibility.tsx)
and is available inside the workbench Documentation panel under
**Features -> Operating System Compatibility**.

Current compatibility contract:

- Python core/runtime/tests: intended for macOS, Linux, and Windows with Python >= 3.11.
- UI and docs: intended for macOS, Linux, and Windows with Node.js >= 20.
- Backend launcher: provides Unix, PowerShell, cmd.exe, and shell-neutral Python entrypoints.
- POSIX-only scripts: use macOS/Linux/Git Bash/WSL unless a native `.ps1` or `.cmd` wrapper exists.
- Deployment-sensitive capabilities: gVisor/runsc probes, Postgres role probes, WORM/S3 anchors, GPU/compiled kernels, Slurm, and external simulators require their documented target runtimes.

Any change that affects platform support, shell wrappers, filesystem/path
behavior, compiler/runtime prerequisites, sandboxing, or deployment probes must
update the OS compatibility page and this README summary in the same change.

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

# Run the Python backend / API server on http://127.0.0.1:8000
./scripts/dev/run_backend.sh

# Windows PowerShell / cmd.exe equivalents
.\scripts\dev\run_backend.ps1
scripts\dev\run_backend.cmd

# Shell-neutral launcher, useful in CI or custom shells
python scripts/dev/run_backend.py

# Optional server flags
./scripts/dev/run_backend.sh --host 0.0.0.0 --port 8000 --reload

# Run a standalone simulation example instead of the API server
python examples/simple_rate_equations/run.py --max-steps 25 --no-capsule

# (Optional) Run the docs site as a standalone Vite app on port 3000.
# As of 2026-05-05 the workbench UI's "Documentation" tab bundles
# every page from `docs_site/src/content/*.tsx` directly into the
# UI bundle (one lazy chunk per page) — so this server is only
# needed if you want to host or preview the docs without the
# workbench UI running.
./scripts/docs/dev.sh

# Validate repository conventions
./scripts/dev/check_repo_conventions.sh

# Inspect open workstream TODO assertions. This passes after the Phase 10
# final close unless a new open workstream has intentionally added TODOs.
./scripts/dev/check_repo_conventions.sh --include-open-workstreams

# Scan current user-facing surfaces for stale phase-state contract language
./scripts/dev/check_current_contract_language.py
```

The UI, backend, capsule, kernel, security, and export scripts exist so documented commands do not point at missing files. Deployment-specific commands that cannot run in the local environment fail closed with an explicit explanation.

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
./scripts/test/security.sh      # secure_core §29 security gate
./scripts/test/security_supply_chain.sh  # CI supply-chain guard
```

`./scripts/test/all.sh` runs the hard repository conventions plus the current test suite, including the secure_core security gate. The supply-chain guard is CI-oriented because npm audit and dependency review are network-backed. `all.sh` intentionally does not include open-workstream TODO assertions; use `./scripts/dev/check_repo_conventions.sh --include-open-workstreams` when inspecting the active implementation backlog.

See `tests/README.md` for the testing strategy (also plan §20).

---

## Documentation Site Commands

```bash
./scripts/docs/dev.sh    # local dev server
./scripts/docs/build.sh  # static build
```

The documentation site is served at `http://localhost:3000` by default. The same source pages are loaded inside the workbench UI under the **Documentation** panel, where they are organized with a searchable, collapsible sidebar. There is one canonical doc source.

The current-vs-historical documentation policy is in
[`docs_site/src/content/current_contracts.tsx`](./docs_site/src/content/current_contracts.tsx).
It defines which files are current operating guidance, which files are
historical provenance, and how agent-facing documents stay concise and
grep-searchable.

---

## Repository Structure

```text
scientific-simulation-workbench/
  AGENTS.md                  Durable rules for all dev agents
  CLAUDE.md                  Operational manual for Claude Code agents
  README.md                  This file
  .gitignore                 Excludes local caches, capsules, run artifacts
  LICENSE
  .agents/                   Repo-local agent skills and workflow helpers

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

Standalone examples and capsule reruns are separate from the backend launcher:

```bash
# Validate and save/load the simple rate-equation experiment
source .venv/bin/activate
python - <<'PY'
from simworkbench import Experiment
from simworkbench.model_spec import load_yaml
from simworkbench.serialization import save_experiment

spec = load_yaml("examples/simple_rate_equations/model.yaml")
experiment = Experiment.from_model_spec(spec)
save_experiment(experiment, "temp_runs/simple_rate_equations_experiment.yaml")
PY

# Run a standalone example without creating a capsule
python examples/simple_rate_equations/run.py --max-steps 25 --no-capsule

# Create a KrF capsule, then rerun the generated capsule path printed by run.py
python examples/krf_excimer/run.py
./scripts/dev/run_capsule.sh simulation_capsules/<printed_capsule>.lxp
```

---

## How to Export and Reload Experiments

```bash
# Export a capsule (data + code + provenance) to a portable archive
./scripts/export/capsule.sh <capsule_dir> <target_dir> [--kinds code,data,plots,notebook,report,archive]

# Reload a capsule into the workbench
./scripts/dev/run_capsule.sh path/to/capsule.lxp
```

---

## Agent Development Instructions

Coding agents working in this repository **must** read [`AGENTS.md`](./AGENTS.md) first. Claude Code agents must additionally read [`CLAUDE.md`](./CLAUDE.md). The shorthand:

- Update docs alongside code.
- Keep temp files inside `local_cache/`, `temp_imports/`, `temp_runs/`, `simulation_capsules/`.
- Check `bugs_and_fixes/` before modifying a subsystem.
- Use `.agents/skills/simworkbench-tool-construction/SKILL.md` before creating or substantially changing an internal tool.
- Use the units subsystem — no raw floats for physical quantities.
- Promote modules `draft → candidate → validated → trusted` only with tests, docs, and a human reviewer.
- Do not silently invent missing scientific data.

Internal tool authors can install the repo-local tool-construction skill into a
local Codex skill directory with:

```bash
scripts/dev/install_tool_construction_skill.sh --dry-run
scripts/dev/install_tool_construction_skill.sh --symlink
```

The skill remains source-controlled in `.agents/skills/`; the installer only
copies or symlinks it into an agent runtime when explicitly invoked.

---

## Related Files

- [`AGENTS.md`](./AGENTS.md) — durable rules for all development agents
- [`CLAUDE.md`](./CLAUDE.md) — Claude-specific operating manual
- [`bugs_and_fixes/`](./bugs_and_fixes/) — bug memory and regression record
- [`program_development/`](./program_development/) — timeline, ADRs, milestones
- [`scientific_simulation_workbench_agent_plan.md`](./scientific_simulation_workbench_agent_plan.md) — full architectural plan
