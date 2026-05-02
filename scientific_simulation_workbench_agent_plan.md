# Agent Planning Document: Scientific Simulation Workbench for Laser Physics, Laser Fusion, and Modular Computational Experimentation

> Repository governance begins before code. Otherwise the project will become the usual swamp: `simulation_final_v3_really_final.py`, undocumented sliders, and a “temporary” folder old enough to vote. Do not do that.

---

## 0. Required Agent Context Files: `AGENTS.md` and `CLAUDE.md`

Before implementing the platform, create two root-level coordination files:

```text
AGENTS.md
CLAUDE.md
```

These files must define the durable operating rules for all coding agents, review agents, documentation agents, and human contributors.

### 0.1 Purpose of `AGENTS.md`

`AGENTS.md` is the canonical instruction file for all autonomous or semi-autonomous development agents working in this repository.

It must include:

1. Repository architecture rules.
2. Required documentation practices.
3. Required testing practices.
4. Code-style and module-boundary constraints.
5. Bug-memory and regression-prevention rules.
6. Safety limits for generated scientific code.
7. Rules for adding new internal tools and simulation modules.
8. File-locality requirements for temporary files, cache files, and imported paper artifacts.
9. Requirements for maintaining the program development history.
10. Explicit warnings against reproducing already-fixed bugs.

### 0.2 Purpose of `CLAUDE.md`

`CLAUDE.md` is the specific operating manual for Claude Code / Claude-like coding agents.

It should duplicate the durable repository rules from `AGENTS.md`, but also include:

1. How to run the program locally.
2. How to run tests.
3. How to update documentation pages.
4. How to add a simulation module.
5. How to add an internal tool.
6. How to inspect the bugfix history before modifying related code.
7. How to avoid writing temporary files outside the program installation directory.
8. How to keep generated code readable and exportable.
9. How to maintain scientific provenance.
10. Which directories are off-limits for destructive edits.

`AGENTS.md` should be general. `CLAUDE.md` should be operationally explicit.

### 0.3 Required Opening Rules for Both Files

Both files should begin with the following rules, adapted as needed:

```markdown
# Mandatory Repository Rules for Development Agents

1. Keep documentation synchronized with code. If behavior, configuration, APIs, simulation modules, or build instructions change, update the appropriate documentation page and `README.md` before completing the task.

2. Maintain program documentation inside `docs_site/` as TypeScript/MDX-compatible documentation pages accessible from the program's TypeScript site.

3. Maintain a root-level `README.md` with build instructions, installation instructions, repository structure, development workflow, testing commands, and update procedures.

4. Maintain `.gitignore` so local cache directories, temporary simulation files, intermediate paper imports, generated run outputs, and local environment files are not committed.

5. Keep temporary files local to the program installation directory. Do not write program artifacts into arbitrary user directories unless the user explicitly exports them.

6. Maintain `bugs_and_fixes/` with:
   - `program.log` or equivalent log file target,
   - `bugfixes.md` or bugfix subdirectory,
   - regression notes,
   - known failure modes,
   - links to tests added to prevent recurrence.

7. Before modifying code related to an existing subsystem, inspect `bugs_and_fixes/` for relevant historical bugs. Do not reintroduce known errors.

8. Maintain `program_development/` with implementation timeline, development history, architectural decisions, milestones, and phase completion notes.

9. Generated scientific simulations must be inspectable, editable, modular, exportable, reloadable, and tied to explicit assumptions, units, parameters, and validation checks.

10. Prefer precise, validated scientific modules over broad, dirty approximations. Fast nonsense is still nonsense, only now with a progress bar.
```

---

## 1. Project Vision

The project is a **Scientific Simulation Workbench** centered on laser physics, laser fusion, laser-species interaction, and computational experimentation. The workbench should allow a physicist or research engineer to rapidly transform a scientific paper into a structured, inspectable, testable, visualizable computational experiment.

The long-term objective is not merely to create a simulation GUI. The objective is to create a **paper-to-experiment platform**:

```text
Scientific paper
    ↓
Extracted equations, assumptions, regimes, parameters, and diagnostics
    ↓
Structured model specification
    ↓
Reusable validated simulation modules
    ↓
Generated or composed experiment code
    ↓
Interactive simulation, visualization, diagnostics, and statistics
    ↓
Exportable reproducible simulation capsule
```

The platform should initially focus on laser physics and species interactions, but its internal tool interface must be general enough to support adjacent computational physics domains such as:

- phase-transition analysis,
- molecular dynamics,
- plasma kinetics,
- reduced-order fusion simulations,
- Monte Carlo transport,
- PDE-based field simulations,
- particle-field coupling,
- spectroscopy,
- rate-equation systems,
- scientific visualization and diagnostics.

La plateforme doit être étroite dans son objectif initial mais générale dans ses abstractions (the platform must be narrow in its initial goal but general in its abstractions). That is the difference between architecture and decorative chaos.

---

## 2. Non-Negotiable Design Principles

### 2.1 Scientific Inspectability

Every generated simulation must expose:

1. The equations used.
2. The assumptions made.
3. The units of every physical parameter.
4. The valid physical regime.
5. The source literature.
6. The numerical methods.
7. The diagnostics collected.
8. The validation checks performed.
9. The generated source code.
10. The run configuration and output data.

The program must never hide physics inside opaque “AI-generated” code. That is not a research tool; that is a confidence trick with syntax highlighting.

### 2.2 Modular Composition

The platform must not rewrite everything from scratch for each paper. It must compose reusable modules:

- species modules,
- laser modules,
- field modules,
- interaction modules,
- equation modules,
- solver modules,
- diagnostic modules,
- visualization modules,
- data-export modules,
- validation modules.

New generated code should be either:

1. A small adapter between validated modules,
2. A candidate module pending validation,
3. A temporary experiment script inside a simulation capsule,
4. A user-created internal tool following the tool SDK.

### 2.3 Hardware-Invariant Interface, Hardware-Specialized Backends

The program should offer a stable user-facing and agent-facing interface:

```python
experiment.run(backend="auto")
```

However, internal execution may use specialized implementations:

- NumPy/SciPy for small local CPU runs,
- Numba or Cython for accelerated local kernels,
- C++ or Fortran kernels for performance-critical numerics,
- CUDA/HIP/SYCL/Kokkos for GPU backends,
- MPI/PETSc/AMReX for HPC-scale PDE and mesh systems,
- Ray or Slurm integration for distributed sweeps.

“Hardware invariant” means that experiments are portable and reproducible across execution targets where physically and numerically reasonable. It does **not** mean that one naive kernel performs equally well everywhere. Le matériel n’est pas une abstraction innocente (hardware is not an innocent abstraction).

### 2.4 Reproducibility by Default

Every run must be reproducible from a saved capsule containing:

- model specification,
- run configuration,
- code,
- input data,
- generated data,
- random seeds,
- backend details,
- package versions,
- hardware/runtime metadata,
- paper provenance,
- validation results.

### 2.5 Agentic Assistance with Human Audit Gates

Agents may:

- read papers,
- extract equations,
- draft model specifications,
- propose experiments,
- generate code,
- run tests,
- run small simulations,
- generate documentation,
- suggest optimizations,
- create candidate modules.

Agents must not silently promote generated scientific modules into trusted modules without review. Candidate modules require validation and human approval before registry promotion.

---

## 3. Required Repository Structure

The repository should begin with the following structure:

```text
scientific-simulation-workbench/
  AGENTS.md
  CLAUDE.md
  README.md
  .gitignore

  apps/
    workbench-ui/
      package.json
      tsconfig.json
      src/
        app/
        components/
        docs/
        simulation/
        api/
      public/

  docs_site/
    package.json
    tsconfig.json
    src/
      pages/
      components/
      content/
        overview.tsx
        installation.tsx
        usage.tsx
        architecture.tsx
        module_development.tsx
        internal_tools.tsx
        simulation_capsules.tsx
        agent_workflows.tsx
        validation.tsx
        troubleshooting.tsx

  packages/
    core/
      pyproject.toml
      src/
        simworkbench/
          __init__.py
          model_spec/
          experiment/
          runtime/
          registry/
          provenance/
          units/
          validation/
          diagnostics/
          serialization/

    agent_orchestration/
      src/
        paper_ingestion/
        equation_extraction/
        model_spec_generation/
        code_generation/
        review_agents/
        experiment_planning/
        documentation_agents/

    physics_modules/
      laser/
      plasma/
      species/
      spectroscopy/
      molecular_dynamics/
      phase_transition/
      pde/
      monte_carlo/

    solver_backends/
      python_cpu/
      numba_cpu/
      cpp/
      fortran/
      cuda/
      kokkos/
      petsc/
      amrex/
      external_pic/

    visualization/
      src/
        plotters/
        viewers/
        dashboards/
        exporters/

    internal_tools/
      sdk/
      examples/
      registry/
      templates/

  simulation_capsules/
    .gitkeep

  local_cache/
    .gitkeep

  temp_imports/
    .gitkeep

  temp_runs/
    .gitkeep

  bugs_and_fixes/
    README.md
    program.log
    bugfixes.md
    known_failures.md
    regression_tests.md
    agent_error_patterns.md

  program_development/
    README.md
    timeline.md
    architectural_decisions/
      ADR-0001-project-scope.md
      ADR-0002-simulation-capsule-format.md
      ADR-0003-model-spec-ir.md
    milestones/
      phase_00_repository_bootstrap.md
      phase_01_manual_workbench.md
      phase_02_agent_assisted_generation.md
      phase_03_validated_module_registry.md
      phase_04_hpc_backends.md
      phase_05_autonomous_experiment_design.md

  tests/
    unit/
    integration/
    regression/
    validation/
    performance/

  scripts/
    dev/
    build/
    test/
    docs/
    clean/
    export/

  examples/
    laser_species/
    krf_excimer/
    simple_rate_equations/
    molecular_dynamics/
    ising_phase_transition/
    pde_wave_equation/

  configs/
    default.yaml
    local.yaml.example
    backends.yaml
    agents.yaml
```

### 3.1 Required Local-Only Directories

The following directories should exist locally but should not commit generated contents:

```text
simulation_capsules/
local_cache/
temp_imports/
temp_runs/
```

Use `.gitkeep` files only if the directory must exist in the repository.

### 3.2 Required `.gitignore` Entries

The `.gitignore` must include:

```gitignore
# Python
__pycache__/
*.py[cod]
*.pyo
*.pyd
.venv/
venv/
env/
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Node / TypeScript
node_modules/
dist/
build/
.next/
.turbo/
coverage/

# Local program files
local_cache/*
temp_imports/*
temp_runs/*
simulation_capsules/*
!local_cache/.gitkeep
!temp_imports/.gitkeep
!temp_runs/.gitkeep
!simulation_capsules/.gitkeep

# Simulation outputs
*.h5
*.hdf5
*.zarr/
*.openpmd/
*.vtk
*.vti
*.vtu
*.xdmf
*.bp
*.bp5
*.parquet
*.npy
*.npz

# Logs and temporary files
*.log
*.tmp
*.temp
*.cache
.DS_Store

# Keep canonical bug log templates if desired
!bugs_and_fixes/program.log

# Local config/secrets
.env
.env.*
*.local.yaml
*.local.json

# IDE/editor
.vscode/
.idea/
```

If `bugs_and_fixes/program.log` should be versioned only as a template, replace it with:

```text
bugs_and_fixes/program.log.example
```

and ignore real logs.

---

## 4. Documentation Requirements

### 4.1 Root `README.md`

The root `README.md` must contain:

1. Project purpose.
2. Current development status.
3. Installation instructions.
4. Local development commands.
5. Build commands.
6. Testing commands.
7. Documentation site commands.
8. Repository structure.
9. Simulation capsule overview.
10. How to add a physics module.
11. How to add an internal tool.
12. How to run example simulations.
13. How to export and reload experiments.
14. Agent development instructions.
15. Links to `AGENTS.md`, `CLAUDE.md`, `bugs_and_fixes/`, and `program_development/`.

### 4.2 TypeScript Documentation Site

Program documentation must be maintained in:

```text
docs_site/src/content/
```

or equivalent TypeScript/MDX documentation pages. The program UI should expose these documentation pages internally through a documentation section.

Minimum documentation pages:

| Page | Required content |
|---|---|
| `overview.tsx` | High-level program purpose and conceptual workflow |
| `installation.tsx` | Installation, environment setup, dependencies |
| `usage.tsx` | Basic workbench usage |
| `architecture.tsx` | System architecture and module layout |
| `module_development.tsx` | How to build physics modules |
| `internal_tools.tsx` | How users create and import internal tools |
| `simulation_capsules.tsx` | Capsule structure, save/load/export behavior |
| `agent_workflows.tsx` | Paper ingestion, code generation, review gates |
| `validation.tsx` | Testing, verification, uncertainty, benchmarks |
| `troubleshooting.tsx` | Common errors and fixes |

Agents changing functionality must update the relevant docs page. A code change without documentation is an unfinished change. Évidemment.

### 4.3 In-Program Documentation Access

The TypeScript UI should include:

```text
Documentation
  Overview
  Installation
  User Guide
  Scientific Modules
  Internal Tools
  Agent Workflows
  Validation
  Troubleshooting
```

Each section should load from the maintained docs source, not from stale duplicated strings manually copied into the UI.

---

## 5. Bugs and Fixes System

The repository must maintain:

```text
bugs_and_fixes/
  README.md
  program.log
  bugfixes.md
  known_failures.md
  regression_tests.md
  agent_error_patterns.md
```

### 5.1 `bugfixes.md`

Every meaningful bug fix should be logged as:

```markdown
## YYYY-MM-DD: Short bug title

### Affected subsystem
`packages/core/runtime/`

### Symptoms
Describe what failed.

### Root cause
Explain the actual cause, not just the error message.

### Fix
Describe what changed.

### Regression protection
List tests added or updated.

### Agent warning
Explain what future agents must not repeat.
```

### 5.2 `known_failures.md`

Use this for known unresolved limitations:

```markdown
## Unresolved: GPU backend numerical mismatch in stiff ODE coupling

### Status
Open

### Severity
High

### Current workaround
Use Python CPU backend for stiff rate-equation validation until backend discrepancy is resolved.

### Notes for agents
Do not optimize this path by changing tolerances without validating against benchmark cases.
```

### 5.3 `agent_error_patterns.md`

This file should track mistakes repeatedly made by agents:

```markdown
## Error Pattern: Replacing validated solver calls with naive generated loops

### Why it is bad
Naive loops lose stability, performance, and validation coverage.

### Required behavior
Use the registered solver interface unless explicitly creating a candidate solver module.

### Detection
Review generated code for direct timestep loops where solver modules already exist.
```

This is not bureaucratic excess. It is a memory prosthesis for agents with the attention span of brilliant goldfish.

---

## 6. Program Development History

Maintain:

```text
program_development/
  timeline.md
  architectural_decisions/
  milestones/
```

### 6.1 `timeline.md`

Every major implementation change should be summarized:

```markdown
## YYYY-MM-DD

### Completed
- Implemented ModelSpec schema v0.1.
- Added basic 0D rate-equation experiment runner.

### Changed
- Moved diagnostics registry into `packages/core`.

### Open questions
- Whether to use HDF5 or Zarr as the default capsule data format.

### Next steps
- Add unit validation.
- Add UI model graph viewer.
```

### 6.2 Architectural Decision Records

Use ADRs:

```markdown
# ADR-0003: Use ModelSpec as intermediate representation

## Status
Accepted

## Context
Agents must not generate simulation code directly from papers.

## Decision
All paper-derived simulations must pass through a structured ModelSpec.

## Consequences
This adds upfront schema work but enables validation, modularity, provenance, and cross-backend execution.
```

---

## 7. Core Concept: Simulation Capsules

A simulation capsule is a portable experiment bundle. It stores the simulation’s full scientific, computational, and provenance state.

### 7.1 Capsule Directory Format

```text
experiment_name.lxp/
  manifest.toml
  paper_sources/
    source.pdf
    extracted_text.md
    extracted_equations.json
    extracted_parameters.yaml
  model/
    model_spec.yaml
    assumptions.md
    validity_domain.md
    units_report.md
  src/
    generated/
    user_edits/
    kernels/
  configs/
    run_config.yaml
    backend_config.yaml
    visualization_config.yaml
  data/
    initial_conditions.h5
    cached_coefficients.zarr
  results/
    diagnostics.parquet
    plots/
    checkpoints/
  validation/
    dimensional_checks.json
    conservation_checks.json
    benchmark_results.json
    convergence_results.json
  notebooks/
    analysis.ipynb
  provenance/
    provenance.lock
    environment.yaml
    agent_trace.md
  README.md
```

### 7.2 Capsule Manifest

Example:

```toml
[capsule]
name = "krf_excimer_species_interaction"
version = "0.1.0"
created_at = "2026-05-02"
created_by = "agent-assisted-workbench"

[paper]
title = "Example KrF Excimer Laser Species Model"
doi = ""
source_path = "paper_sources/source.pdf"

[model]
model_spec = "model/model_spec.yaml"
validity_domain = "model/validity_domain.md"

[runtime]
default_backend = "python_cpu"
supports_pause_resume = true
supports_checkpointing = true

[provenance]
lockfile = "provenance/provenance.lock"
agent_trace = "provenance/agent_trace.md"
```

### 7.3 Capsule Requirements

Every capsule must support:

- save,
- load,
- fork,
- export code,
- export data,
- export report,
- rerun,
- inspect assumptions,
- inspect code,
- inspect validation status.

---

## 8. Model Specification Intermediate Representation

The ModelSpec is the structured bridge between scientific papers and executable experiments.

### 8.1 Required ModelSpec Fields

```yaml
model:
  name: string
  version: string
  domain: string
  description: string

sources:
  papers:
    - title: string
      doi: string | null
      local_path: string
      extracted_sections: list

geometry:
  dimensionality: 0 | 1 | 2 | 3
  coordinate_system: cartesian | cylindrical | spherical
  domain_bounds: object
  boundary_conditions: list

species:
  - name: string
    type: atom | ion | molecule | electron | photon | quasi_particle
    charge: number
    mass: quantity
    internal_states: list
    initial_density: quantity

fields:
  - name: string
    type: electric | magnetic | electromagnetic | scalar | laser
    initialization: object
    evolution_equation: string | null

interactions:
  - name: string
    participants: list
    equation_refs: list
    coefficient_sources: list
    valid_regime: object

equations:
  - id: string
    latex: string
    description: string
    assumptions: list
    units_checked: boolean

solvers:
  recommended:
    - name: string
      reason: string
      backend_compatibility: list

diagnostics:
  - name: string
    quantity: string
    output_format: string
    visualization: string

validation:
  expected_limits: list
  paper_figures_to_reproduce: list
  conservation_laws: list
  convergence_requirements: list
```

### 8.2 ModelSpec Validation

The ModelSpec validator must check:

1. Missing units.
2. Missing species definitions.
3. Unknown interaction participants.
4. Inconsistent dimensionality.
5. Invalid solver compatibility.
6. Missing boundary conditions.
7. Unsupported backend requirements.
8. Missing coefficient sources.
9. Unknown validity regimes.
10. Diagnostics referencing nonexistent quantities.

### 8.3 Units System

All physical quantities must be represented with units. The platform should include a units subsystem capable of:

- unit conversion,
- dimensional consistency checks,
- symbolic unit checks for equations,
- runtime validation of user input,
- display unit conversion for plots and UI.

No unitless physical constants except explicitly dimensionless quantities. Otherwise, someone will eventually simulate a laser pulse in “vibes per centimeter.” Magnifique catastrophe.

---

## 9. Internal Tool Development System

The platform must allow users to internally develop tools within the program. These tools may be diagnostic tools, data importers, visualization tools, solver adapters, parameter-sweep tools, paper parsers, or physics modules.

### 9.1 Internal Tool Categories

| Tool category | Examples |
|---|---|
| Import tools | PDF importer, CSV parser, HDF5 loader, cross-section table importer |
| Physics tools | photoionization module, collisional model, laser pulse model |
| Solver tools | stiff ODE wrapper, PIC adapter, finite-volume solver |
| Diagnostic tools | absorption spectrum plotter, energy budget, density histogram |
| Visualization tools | 2D particle viewer, field animation, phase-space viewer |
| Export tools | notebook exporter, report generator, openPMD exporter |
| Agent tools | paper summarizer, equation extractor, parameter matcher |
| Validation tools | conservation checker, convergence tester, benchmark comparator |

### 9.2 Tool Directory Structure

Each internal tool should live in:

```text
packages/internal_tools/registry/<tool_name>/
  tool.yaml
  README.md
  src/
  tests/
  docs/
  examples/
```

### 9.3 `tool.yaml`

Example:

```yaml
name: absorption_spectrum_diagnostic
version: 0.1.0
type: diagnostic
description: Computes and plots absorption intensity vs frequency.
author: local
entrypoint: src/tool.py:AbsorptionSpectrumDiagnostic

inputs:
  - name: frequency
    type: array
    units: Hz
  - name: intensity
    type: array
    units: arbitrary | W/m^2

outputs:
  - name: spectrum_plot
    type: figure
  - name: peak_table
    type: table

compatible_domains:
  - laser_species
  - spectroscopy
  - plasma

requires:
  python:
    - numpy
    - scipy
    - matplotlib

validation:
  tests:
    - tests/test_absorption_spectrum.py
  reference_cases:
    - examples/lorentzian_peak.yaml
```

### 9.4 Internal Tool Interface

Python example:

```python
from simworkbench.tools import BaseTool, ToolInput, ToolOutput

class AbsorptionSpectrumDiagnostic(BaseTool):
    name = "absorption_spectrum_diagnostic"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("frequency", units="Hz")
        inputs.require_array("intensity")

    def run(self, inputs: ToolInput) -> ToolOutput:
        frequency = inputs["frequency"]
        intensity = inputs["intensity"]

        peaks = self.find_peaks(frequency, intensity)
        figure = self.plot_spectrum(frequency, intensity, peaks)

        return ToolOutput({
            "peaks": peaks,
            "figure": figure,
        })
```

### 9.5 Tool Lifecycle

A tool should move through these states:

```text
draft → candidate → validated → trusted → deprecated
```

| State | Meaning |
|---|---|
| `draft` | User or agent is actively creating it |
| `candidate` | Runs but not fully validated |
| `validated` | Passes tests and benchmark cases |
| `trusted` | Approved for default agent use |
| `deprecated` | Replaced or no longer recommended |

Agents may create `draft` and `candidate` tools. Human approval should be required for `trusted`.

### 9.6 Tool Documentation Requirements

Every internal tool must include:

1. Purpose.
2. Inputs.
3. Outputs.
4. Units.
5. Example usage.
6. Valid domains.
7. Known limitations.
8. Tests.
9. Validation status.
10. Changelog.

### 9.7 Tool Import and Reload

The UI should allow users to:

- create tool from template,
- import external tool package,
- edit tool code,
- run tool tests,
- inspect tool documentation,
- register tool locally,
- export tool,
- reload tool into an experiment.

Tool import should not scatter files across the user’s system. Imported tool assets should be copied into the local installation directory, preferably:

```text
local_cache/imported_tools/
```

or into a project-local internal registry.

---

## 10. Agent Workflow: Paper to Experiment

The paper-to-experiment workflow must be staged.

### 10.1 Stage 1: Paper Ingestion

Inputs:

- PDF,
- arXiv link,
- DOI metadata,
- supplementary files,
- tables,
- code if available.

Outputs:

```text
extracted_text.md
extracted_equations.json
extracted_parameters.yaml
paper_summary.md
uncertainties.md
```

Agent responsibilities:

1. Extract title, authors, abstract, and sections.
2. Identify equations.
3. Identify parameters.
4. Identify species and interactions.
5. Identify numerical methods.
6. Identify figures/tables suitable for validation.
7. Identify missing information.
8. Flag ambiguous or unsupported physics.

### 10.2 Stage 2: Scientific Interpretation Report

Before code generation, the agent must produce:

```text
model/assumptions.md
model/validity_domain.md
model/implementation_plan.md
```

The report should answer:

1. What physical system is being modeled?
2. What are the governing equations?
3. What are the important species and fields?
4. What approximations are used?
5. What numerical methods are implied?
6. What can be simulated immediately?
7. What data is missing?
8. What validation targets exist?
9. Which existing modules can be reused?
10. Which new modules are required?

### 10.3 Stage 3: ModelSpec Generation

The agent generates `model_spec.yaml`. The ModelSpec validator runs automatically.

If validation fails, the agent must repair the ModelSpec before generating code.

### 10.4 Stage 4: Module Retrieval and Gap Analysis

The agent queries the module registry:

```text
Required interaction: photoionization
Available module: yes
Compatible regime: partially
Required coefficient data: missing high-intensity KrF table
Action: create candidate coefficient loader or request user data
```

The gap report should classify missing pieces:

| Gap type | Action |
|---|---|
| Missing parameter | Ask user or search source material |
| Missing module | Generate candidate module |
| Unsupported regime | Warn and restrict model |
| Backend unsupported | Choose different backend |
| Validation unavailable | Mark result as exploratory |

### 10.5 Stage 5: Experiment Design

The agent designs one or more computational experiments:

1. Minimal 0D model.
2. 1D propagation model.
3. 2D visualization model.
4. High-fidelity backend experiment.
5. Parameter sweep experiment.

Each experiment must specify:

- geometry,
- timestep,
- spatial resolution,
- solver,
- boundary conditions,
- initial conditions,
- diagnostics,
- expected output,
- validation criteria,
- estimated compute cost.

### 10.6 Stage 6: Code Generation

Generated code must be placed in a capsule sandbox:

```text
src/generated/
```

Generated code must be:

- formatted,
- typed where practical,
- documented,
- modular,
- tested,
- readable,
- exportable.

Agents must not overwrite user-edited code without creating a branch/fork or explicit diff.

### 10.7 Stage 7: Validation and Review

The agent runs:

1. Unit tests.
2. Dimensional checks.
3. Conservation checks.
4. Small smoke simulation.
5. Numerical stability checks.
6. Benchmark comparison if possible.
7. Plot generation.
8. Summary report.

The platform then displays:

```text
Validation status: exploratory / partially validated / validated / failed
```

### 10.8 Stage 8: Promotion or Rejection

Candidate modules may be:

- discarded,
- edited,
- retained inside the capsule,
- submitted for registry review,
- promoted to validated/trusted.

Promotion requires:

- passing tests,
- documentation,
- benchmark evidence,
- review notes,
- changelog entry.

---

## 11. Simulation Runtime Requirements

The runtime must support:

1. Start.
2. Pause.
3. Resume.
4. Stop.
5. Checkpoint.
6. Restore from checkpoint.
7. Branch from checkpoint.
8. Save run.
9. Load run.
10. Export run.
11. Stream diagnostics.
12. Display live plots.
13. Run headless.
14. Run interactively.
15. Run local.
16. Run remote/HPC.

### 11.1 Runtime State Model

The runtime should distinguish:

```text
Experiment definition
Runtime state
Checkpoint state
Diagnostic state
Visualization state
Result state
```

### 11.2 Checkpoint Format

Checkpoints should include:

- time,
- timestep index,
- field state,
- particle state if applicable,
- species densities,
- solver internal state,
- random number generator state,
- diagnostic accumulators,
- backend metadata.

### 11.3 Determinism

Where possible, simulations should support deterministic replay from:

- seed,
- initial state,
- backend,
- package versions,
- hardware metadata.

GPU simulations may not be bitwise deterministic across hardware. The platform must explicitly mark deterministic status rather than pretending otherwise. Très important.

---

## 12. Visualization and Statistics

The platform should include reusable diagnostic and visualization components.

### 12.1 Required Plot Types

| Plot type | Uses |
|---|---|
| Line plot | spectra, time traces, energy budgets |
| Heatmap | density fields, temperature maps, field magnitude |
| Scatter/particle plot | particle simulations, phase-space projections |
| Histogram | energy distributions, velocity distributions |
| Phase diagram | phase-transition and parameter studies |
| 3D volume/surface | advanced field visualization |
| Convergence plot | numerical validation |
| Sensitivity plot | uncertainty analysis |

### 12.2 Required Statistics

The diagnostics system should compute:

- means,
- variances,
- extrema,
- histograms,
- distribution fits,
- spectral peaks,
- energy conservation error,
- charge conservation error,
- convergence rates,
- confidence intervals,
- parameter sensitivity,
- numerical stability indicators.

### 12.3 Visualization Design

The UI should separate:

```text
Live visualization
Post-run analysis
Validation plots
Publication/export plots
```

A plot created for steering a simulation is not necessarily publication-quality. Confusing the two is how one gets beautiful plots of wrong things.

---

## 13. Validation System

Validation is the scientific spine of the workbench.

### 13.1 Validation Categories

| Category | Purpose |
|---|---|
| Dimensional validation | Ensure equations and parameters are unit-consistent |
| Conservation validation | Check energy, charge, particles, momentum where applicable |
| Analytical validation | Compare to closed-form solutions in limiting cases |
| Benchmark validation | Compare to known computational or experimental results |
| Paper reproduction | Reproduce figures/tables from source papers |
| Cross-solver validation | Compare reduced and high-fidelity solver outputs |
| Convergence validation | Check timestep/grid/particle-number convergence |
| Regression validation | Ensure previous bugs remain fixed |
| Sensitivity validation | Identify fragile parameter dependencies |

### 13.2 Validation Status

Every simulation and module should receive a validation label:

| Status | Meaning |
|---|---|
| `unvalidated` | Runs, but no meaningful validation completed |
| `exploratory` | Useful for conceptual exploration only |
| `partially_validated` | Some checks pass, but gaps remain |
| `validated` | Passes required tests for specified regime |
| `trusted` | Repeatedly validated and reviewed |
| `failed` | Known invalid or broken |

### 13.3 Validation Reports

Each run should produce:

```text
validation_report.md
validation_results.json
validation_plots/
```

The report should include:

- pass/fail summary,
- tolerance levels,
- numerical error,
- physical interpretation,
- limitations,
- recommended next validation steps.

---

## 14. Scientific Module Registry

The registry stores reusable physics and solver modules.

### 14.1 Registry Entry Structure

```text
physics_modules/plasma/photoionization/
  module.yaml
  README.md
  equations.md
  assumptions.md
  validity_domain.md
  src/
  tests/
  benchmarks/
  docs/
  examples/
  changelog.md
```

### 14.2 `module.yaml`

```yaml
name: photoionization
version: 0.1.0
domain: plasma
status: candidate

inputs:
  - name: photon_flux
    units: "1/(m^2 s)"
  - name: cross_section
    units: "m^2"

outputs:
  - name: ionization_rate
    units: "1/s"

validity_domain:
  density_range: null
  temperature_range: null
  field_strength_range: null
  notes:
    - Requires cross-section data appropriate to species and photon energy.

tests:
  unit:
    - tests/test_photoionization_units.py
  validation:
    - benchmarks/simple_constant_flux.yaml

references:
  - title: ""
    doi: ""
```

### 14.3 Module Promotion Criteria

A module may become `validated` only after:

1. Unit tests pass.
2. Documentation exists.
3. Inputs and outputs are unit-specified.
4. Validity domain is explicit.
5. At least one benchmark or limiting-case validation exists.
6. Known limitations are documented.
7. Bug history has been checked.
8. Regression tests exist for previous failures.

A module may become `trusted` only after repeated use and review.

---

## 15. Backend and Solver Architecture

### 15.1 Solver Interface

Every solver backend should implement a common interface:

```python
class SolverBackend:
    name: str
    version: str
    supported_domains: list[str]
    supported_geometries: list[int]

    def validate(self, model_spec): ...
    def initialize(self, experiment_config): ...
    def step(self, state, dt): ...
    def run(self, state, run_config): ...
    def checkpoint(self, state, path): ...
    def restore(self, path): ...
    def diagnostics(self, state): ...
```

### 15.2 Backend Selection

Backend selection should consider:

- problem size,
- dimensionality,
- stiffness,
- particle count,
- mesh size,
- GPU availability,
- memory requirements,
- required precision,
- supported modules,
- user preference,
- reproducibility requirements.

### 15.3 Backend Policy

The system may recommend a backend but should not silently change physics.

Example:

```text
Recommended backend: python_cpu
Reason: 0D stiff rate-equation model with small state vector.
GPU acceleration is unnecessary and may introduce nondeterministic differences.
```

Example:

```text
Recommended backend: external_pic_warpx
Reason: 2D electromagnetic particle-in-cell simulation with laser-plasma coupling.
Local Python backend is insufficient for this model.
```

---

## 16. Agent Roles and Parallelizable Workstreams

The platform should assume multiple specialized agents can work in parallel. Agent roles should be explicit.

### 16.1 Core Agent Roles

| Agent role | Responsibility |
|---|---|
| Orchestrator agent | Maintains global task graph and merges work |
| Repository steward | Enforces structure, docs, and conventions |
| Paper ingestion agent | Extracts paper content |
| Physics interpretation agent | Converts paper claims to model assumptions |
| ModelSpec agent | Creates and validates structured model spec |
| Module retrieval agent | Finds reusable modules |
| Code generation agent | Writes candidate implementation |
| Numerical methods agent | Reviews solver choices and stability |
| Backend optimization agent | Chooses and optimizes execution backend |
| Validation agent | Creates and runs validation tests |
| Visualization agent | Builds plots and UI panels |
| Documentation agent | Updates docs, README, and usage guides |
| Bug memory agent | Checks `bugs_and_fixes/` before modifications |
| Security/sandbox agent | Prevents unsafe file or execution behavior |
| Release agent | Packages stable builds and examples |

### 16.2 Parallelization Pattern

For each major feature:

```text
Planning
  ↓
Parallel implementation branches
  ↓
Independent tests
  ↓
Merge review
  ↓
Integration tests
  ↓
Documentation update
  ↓
Bugfix log update
  ↓
Milestone update
```

### 16.3 Agent Merge Checklist

Before merging agent-created work:

1. Does it follow repository structure?
2. Are docs updated?
3. Are tests added?
4. Are known bugs checked?
5. Are temporary files local and ignored?
6. Is generated code inspectable?
7. Is scientific provenance preserved?
8. Are units explicit?
9. Are validation gaps documented?
10. Is the feature listed in development history?

---

## 17. Development Phases

The phases below are explicitly designed for parallel work. Each phase may have multiple workstreams running simultaneously, but phase gates should prevent unstable architecture from contaminating later work.

---

# Phase 0: Repository Bootstrap and Governance

## Objective

Create the project structure, agent files, documentation rules, bug-memory system, and development-history system.

## Parallel Workstreams

### Workstream 0A: Repository Skeleton

Tasks:

- Create root files:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `README.md`
  - `.gitignore`
- Create directory structure.
- Add `.gitkeep` where needed.
- Add example config files.

Deliverables:

- Bootstrapped repository.
- Initial README.
- Initial agent instructions.

### Workstream 0B: Documentation Site Skeleton

Tasks:

- Create TypeScript docs site.
- Add required documentation pages.
- Create route structure.
- Add placeholder docs content.
- Ensure program UI can later link to docs.

Deliverables:

- `docs_site/`
- Documentation navigation.
- Initial content pages.

### Workstream 0C: Bugs and Fixes System

Tasks:

- Create `bugs_and_fixes/`.
- Add bugfix template.
- Add known-failure template.
- Add regression-test template.
- Add agent error pattern file.

Deliverables:

- Bug-memory infrastructure.
- Agent instructions requiring bug review.

### Workstream 0D: Development History System

Tasks:

- Create `program_development/`.
- Add timeline.
- Add ADR template.
- Add milestone files for all phases.

Deliverables:

- Timeline and ADR structure.
- Initial project-scope ADR.

## Phase Gate

Phase 0 is complete when:

- Repository structure exists.
- Agent files exist.
- README exists.
- Docs site skeleton exists.
- `.gitignore` protects local caches/temp files.
- Bugs and development folders exist.

---

# Phase 1: Manual Scientific Workbench

## Objective

Build a functioning non-agentic workbench that can define, run, pause, save, load, visualize, and export simple scientific simulations.

Do not start with agent autonomy. Build the laboratory bench before hiring the robot assistant. Incroyable, I know.

## Parallel Workstreams

### Workstream 1A: Core Experiment Model

Tasks:

- Implement `Experiment`.
- Implement `ModelSpec`.
- Implement `RunConfig`.
- Implement `DiagnosticConfig`.
- Implement `BackendConfig`.
- Implement serialization/deserialization.

Deliverables:

- Core Python API.
- ModelSpec schema v0.1.
- Experiment save/load.

### Workstream 1B: Units and Quantities

Tasks:

- Add units library integration or custom wrapper.
- Enforce units in ModelSpec.
- Add unit conversion utilities.
- Add dimensional validation.

Deliverables:

- Unit-aware parameter system.
- Dimensional validation tests.

### Workstream 1C: Simulation Runtime

Tasks:

- Implement start/stop/pause/resume.
- Implement checkpointing.
- Implement deterministic seed handling.
- Implement event/log system.
- Implement progress reporting.

Deliverables:

- Local simulation runner.
- Checkpoint and restore functionality.

### Workstream 1D: Basic Physics Modules

Initial modules:

- Gaussian laser pulse.
- Basic species definition.
- 0D rate-equation solver.
- Simple absorption model.
- Simple emission model.
- Lennard-Jones molecular dynamics example.
- 2D Ising model example.

Deliverables:

- Minimal validated modules.
- Example simulations.

### Workstream 1E: Visualization and Diagnostics

Tasks:

- Implement line plots.
- Implement heatmaps.
- Implement particle scatter plots.
- Implement statistics tables.
- Implement live diagnostic streaming.

Deliverables:

- Basic plotting system.
- Diagnostics API.

### Workstream 1F: UI Workbench

Tasks:

- Build TypeScript UI shell.
- Add simulation list.
- Add run controls.
- Add code viewer.
- Add docs viewer.
- Add diagnostics panel.
- Add plot panel.
- Add capsule explorer.

Deliverables:

- Usable local UI.
- Program documentation accessible inside UI.

## Phase Gate

Phase 1 is complete when a user can:

1. Create a simple experiment manually.
2. Run it locally.
3. Pause and resume it.
4. Save it as a capsule.
5. Reload it.
6. View code/configuration.
7. Plot diagnostics.
8. Read documentation from inside the UI.

---

# Phase 2: Simulation Capsule System

## Objective

Make reproducible simulation capsules the central project artifact.

## Parallel Workstreams

### Workstream 2A: Capsule Format

Tasks:

- Define `.lxp/` directory format.
- Define `manifest.toml`.
- Define internal paths.
- Define versioning rules.
- Add migration hooks.

Deliverables:

- Capsule schema v0.1.
- Capsule validator.

### Workstream 2B: Provenance System

Tasks:

- Track source files.
- Track generated code.
- Track agent actions.
- Track environment.
- Track runtime metadata.
- Track backend metadata.

Deliverables:

- `provenance.lock`.
- Agent trace format.
- Environment capture.

### Workstream 2C: Export System

Tasks:

- Export Python code.
- Export C++/Fortran kernels where applicable.
- Export data.
- Export plots.
- Export notebook.
- Export report.
- Export compressed capsule archive.

Deliverables:

- Export menu/API.
- Portable experiment artifacts.

### Workstream 2D: Capsule UI

Tasks:

- Build capsule explorer.
- Show manifest.
- Show ModelSpec.
- Show code.
- Show results.
- Show validation status.
- Show provenance.

Deliverables:

- Inspectable capsule UI.

## Phase Gate

Phase 2 is complete when capsules are portable, inspectable, reloadable, and exportable.

---

# Phase 3: Internal Tool SDK and Registry

## Objective

Allow users and agents to create, import, validate, document, and reuse internal tools.

## Parallel Workstreams

### Workstream 3A: Tool SDK

Tasks:

- Define `BaseTool`.
- Define tool input/output contracts.
- Define tool metadata.
- Define unit validation.
- Define tool runtime hooks.

Deliverables:

- Internal tool SDK.
- Example tools.

### Workstream 3B: Tool Registry

Tasks:

- Implement local registry.
- Add tool discovery.
- Add tool import.
- Add versioning.
- Add tool status lifecycle.
- Add deprecation mechanism.

Deliverables:

- Registry API.
- Tool metadata database.

### Workstream 3C: Tool Templates

Create templates for:

- diagnostic tool,
- visualization tool,
- import tool,
- physics module,
- solver adapter,
- validation tool,
- paper extraction tool.

Deliverables:

- `internal_tools/templates/`.

### Workstream 3D: Tool UI

Tasks:

- List installed tools.
- View tool docs.
- Edit tool code.
- Run tool tests.
- Import external tool.
- Export tool.
- Show validation status.

Deliverables:

- Internal tool manager UI.

### Workstream 3E: Tool Documentation

Tasks:

- Add docs page.
- Add tutorial.
- Add example tool walkthrough.
- Add validation requirements.

Deliverables:

- Internal tool developer guide.

## Phase Gate

Phase 3 is complete when a user can create a custom diagnostic tool, test it, document it, register it, use it in an experiment, and export it.

---

# Phase 4: Agent-Assisted Paper Ingestion

## Objective

Enable agents to read scientific papers and generate structured interpretation artifacts, without yet autonomously producing trusted simulations.

## Parallel Workstreams

### Workstream 4A: Paper Import System

Tasks:

- Import PDFs.
- Store papers locally inside capsule.
- Extract text.
- Extract tables where possible.
- Extract figures metadata where possible.
- Preserve source files.

Deliverables:

- Paper import pipeline.
- Local paper cache.

### Workstream 4B: Equation Extraction

Tasks:

- Extract equations.
- Store equations in JSON.
- Link equations to source sections.
- Flag OCR/extraction uncertainty.
- Allow human correction.

Deliverables:

- `extracted_equations.json`.
- Equation review UI.

### Workstream 4C: Parameter Extraction

Tasks:

- Extract physical constants.
- Extract simulation parameters.
- Extract units.
- Extract table values.
- Flag missing units.

Deliverables:

- `extracted_parameters.yaml`.
- Parameter review UI.

### Workstream 4D: Scientific Interpretation Agent

Tasks:

- Identify physical system.
- Identify species.
- Identify interactions.
- Identify approximations.
- Identify valid regimes.
- Identify diagnostics.
- Identify validation targets.

Deliverables:

- `paper_summary.md`.
- `assumptions.md`.
- `validity_domain.md`.
- `implementation_plan.md`.

### Workstream 4E: Review UI

Tasks:

- Show extracted equations.
- Show extracted parameters.
- Show assumptions.
- Allow edits.
- Track edits in provenance.

Deliverables:

- Paper interpretation review panel.

## Phase Gate

Phase 4 is complete when a paper can be imported and converted into human-reviewable scientific interpretation artifacts.

---

# Phase 5: ModelSpec Generation and Module Mapping

## Objective

Convert interpreted papers into validated ModelSpecs and map them to available modules.

## Parallel Workstreams

### Workstream 5A: ModelSpec Generator

Tasks:

- Convert paper interpretation into ModelSpec.
- Validate schema.
- Resolve species definitions.
- Resolve interactions.
- Resolve geometry and boundary conditions.
- Flag missing fields.

Deliverables:

- ModelSpec generation agent.
- ModelSpec repair loop.

### Workstream 5B: Module Retrieval

Tasks:

- Search registry by required physics.
- Match domains and regimes.
- Compare inputs/outputs.
- Check unit compatibility.
- Check solver compatibility.

Deliverables:

- Module match report.

### Workstream 5C: Gap Analysis

Tasks:

- Identify missing modules.
- Identify missing data.
- Identify unsupported regimes.
- Identify invalid solver choices.
- Identify validation gaps.

Deliverables:

- Gap analysis report.

### Workstream 5D: Experiment Proposal

Tasks:

- Propose minimal simulation.
- Propose higher-fidelity extensions.
- Estimate computational cost.
- Identify validation path.
- Recommend backend.

Deliverables:

- `experiment_proposal.md`.
- Experiment creation UI.

## Phase Gate

Phase 5 is complete when the system can transform a reviewed paper interpretation into a validated ModelSpec and proposed experiment plan.

---

# Phase 6: Agentic Code Generation in Sandboxed Capsules

## Objective

Allow agents to generate candidate experiment code inside simulation capsules, run tests, and produce reviewable results.

## Parallel Workstreams

### Workstream 6A: Code Generation Backend

Tasks:

- Generate Python experiment code from ModelSpec.
- Generate configuration files.
- Generate diagnostic code.
- Generate tests.
- Generate documentation.
- Preserve readable structure.

Deliverables:

- Generated experiment scaffold.

### Workstream 6B: Code Sandbox

Tasks:

- Isolate generated code.
- Restrict file writes to capsule/local directories.
- Prevent destructive edits.
- Track generated files.
- Provide diffs for regeneration.

Deliverables:

- Safe code-generation environment.

### Workstream 6C: Test Generation

Tasks:

- Generate unit tests.
- Generate dimensional tests.
- Generate smoke tests.
- Generate convergence tests if appropriate.
- Generate regression hooks.

Deliverables:

- Capsule-local tests.

### Workstream 6D: Generated Code Viewer and Editor

Tasks:

- Show generated code.
- Allow user edits.
- Track user edits separately.
- Prevent silent overwrites.
- Support export.

Deliverables:

- Code review UI.

### Workstream 6E: Validation Run

Tasks:

- Run small simulation.
- Collect diagnostics.
- Generate plots.
- Generate validation summary.
- Mark validation status.

Deliverables:

- First agent-generated exploratory simulation.

## Phase Gate

Phase 6 is complete when an agent can generate a runnable, reviewable, editable, exportable simulation from a ModelSpec inside a capsule.

---

# Phase 7: Validated Physics Module Registry

## Objective

Move from one-off generated simulations to reusable validated scientific modules.

## Parallel Workstreams

### Workstream 7A: Registry Maturation

Tasks:

- Add module status lifecycle.
- Add versioning.
- Add dependency metadata.
- Add benchmark references.
- Add compatibility metadata.

Deliverables:

- Registry v1.

### Workstream 7B: Laser-Species Modules

Implement and validate:

- laser pulse module,
- absorption module,
- emission module,
- excitation module,
- ionization module,
- recombination module,
- electron temperature model,
- species density model,
- stiff rate-equation solver adapter.

Deliverables:

- Laser-species module family.

### Workstream 7C: Plasma Modules

Implement or wrap:

- electromagnetic field module,
- particle pusher interface,
- PIC adapter,
- collisional model interface,
- boundary-condition library.

Deliverables:

- Plasma module family.

### Workstream 7D: General Physics Examples

Implement:

- molecular dynamics module,
- Ising/Potts phase-transition module,
- PDE wave equation module,
- reaction-diffusion module.

Deliverables:

- Generality proof examples.

### Workstream 7E: Validation Library

Tasks:

- Add analytic benchmark cases.
- Add paper reproduction cases.
- Add conservation checks.
- Add convergence tests.
- Add cross-solver comparison.

Deliverables:

- Validation test library.

## Phase Gate

Phase 7 is complete when core modules are reusable, documented, tested, and validated for explicit regimes.

---

# Phase 8: HPC and Hardware Backends

## Objective

Scale from local interactive experiments to high-performance parameter sweeps and large simulations.

## Parallel Workstreams

### Workstream 8A: Backend Abstraction

Tasks:

- Finalize backend interface.
- Implement backend registry.
- Implement backend capability detection.
- Implement backend recommendation.

Deliverables:

- Stable backend abstraction.

### Workstream 8B: Python/CPU Backends

Tasks:

- NumPy backend.
- SciPy solver wrappers.
- Numba acceleration where appropriate.
- Multiprocessing for small sweeps.

Deliverables:

- Robust local backend.

### Workstream 8C: Compiled Kernels

Tasks:

- C++ kernel support.
- Fortran kernel support.
- Build system integration.
- ABI/interface wrappers.

Deliverables:

- Compiled kernel pathway.

### Workstream 8D: GPU Backends

Tasks:

- CUDA adapter.
- HIP/SYCL/Kokkos exploration.
- Precision settings.
- Determinism warnings.
- GPU memory estimator.

Deliverables:

- GPU-capable backend pathway.

### Workstream 8E: HPC Orchestration

Tasks:

- Slurm integration.
- Ray integration.
- Batch job generation.
- Remote run tracking.
- Result import.

Deliverables:

- HPC job execution pipeline.

### Workstream 8F: External Simulator Integration

Wrap or interface with:

- PIC codes,
- plasma simulation tools,
- PDE solvers,
- visualization exporters.

Deliverables:

- External solver adapter interface.

## Phase Gate

Phase 8 is complete when experiments can run locally and on remote/HPC backends through the same experiment interface.

---

# Phase 9: Parameter Sweeps, Optimization, and Uncertainty

## Objective

Turn the workbench into a computational experiment factory.

## Parallel Workstreams

### Workstream 9A: Parameter Sweep Engine

Tasks:

- Grid sweeps.
- Random sweeps.
- Latin hypercube sampling.
- Adaptive sweeps.
- Sweep checkpointing.
- Sweep result aggregation.

Deliverables:

- Sweep engine.

### Workstream 9B: Optimization Engine

Tasks:

- Bayesian optimization hooks.
- Multi-objective optimization.
- Constraint handling.
- Compute-budget limits.
- Early stopping.

Deliverables:

- Optimization interface.

### Workstream 9C: Uncertainty Quantification

Tasks:

- Parameter uncertainty propagation.
- Numerical uncertainty.
- Sensitivity analysis.
- Confidence intervals.
- Dominant uncertainty attribution.

Deliverables:

- Uncertainty reports.

### Workstream 9D: Comparative Experiment Reports

Tasks:

- Compare model variants.
- Compare solver variants.
- Compare backend performance.
- Compare validation metrics.
- Produce ranked summaries.

Deliverables:

- Experiment comparison dashboard.

## Phase Gate

Phase 9 is complete when the system can run parameter sweeps, rank outputs, quantify uncertainty, and generate comparison reports.

---

# Phase 10: Autonomous Computational Experiment Design

## Objective

Allow agents to propose, execute, analyze, and refine computational experiments under strict validation and budget constraints.

## Parallel Workstreams

### Workstream 10A: Experiment Design Agent

Tasks:

- Generate experiment plans.
- Select minimal viable model.
- Select fidelity ladder.
- Estimate cost.
- Define diagnostics.
- Define validation path.

Deliverables:

- Agentic experiment planner.

### Workstream 10B: Autonomous Small Runs

Tasks:

- Run smoke simulations.
- Interpret diagnostics.
- Detect obvious numerical instability.
- Adjust safe parameters.
- Produce review report.

Deliverables:

- Autonomous exploratory runs.

### Workstream 10C: Controlled Sweep Agent

Tasks:

- Launch bounded sweeps.
- Monitor results.
- Stop failed runs.
- Summarize trends.
- Recommend next sweeps.

Deliverables:

- Budget-limited sweep automation.

### Workstream 10D: Scientific Review Agent

Tasks:

- Critique assumptions.
- Identify missing physics.
- Compare to literature.
- Flag overclaims.
- Recommend validation.

Deliverables:

- Agent-generated scientific review.

### Workstream 10E: Human Approval Gates

Tasks:

- Require approval for trusted module promotion.
- Require approval for expensive runs.
- Require approval for external file export.
- Require approval for destructive edits.

Deliverables:

- Safe autonomy framework.

## Phase Gate

Phase 10 is complete when the system can autonomously propose and run bounded computational experiments while preserving inspectability, validation, and human control.

---

## 18. User Workflow Examples

### 18.1 Example: KrF Excimer Paper

1. User imports paper.
2. Paper ingestion agent extracts equations and parameters.
3. Physics interpretation agent identifies Kr, F, KrF*, electrons, laser pulse, excitation, ionization, emission, and absorption.
4. ModelSpec agent creates 0D species kinetics model.
5. Module retrieval finds laser pulse, rate equation, absorption, and diagnostics modules.
6. Gap analysis flags missing cross-section data.
7. Agent proposes:
   - 0D exploratory model,
   - 1D propagation extension,
   - validation against paper figure.
8. User approves 0D model.
9. Agent generates code.
10. Validation agent runs unit/dimensional/smoke tests.
11. UI shows absorption spectrum, species densities, and uncertainty warnings.
12. User exports capsule.

### 18.2 Example: Phase Transition Analysis

1. User creates new experiment from template.
2. Selects 2D Ising module.
3. Sets lattice size, temperature sweep, boundary conditions.
4. Runs sweep.
5. Diagnostics compute magnetization, susceptibility, heat capacity.
6. Visualization shows phase behavior.
7. Result saved as capsule.

### 18.3 Example: Internal Tool Development

1. User opens Internal Tools panel.
2. Selects “New Diagnostic Tool.”
3. Tool template is created in `internal_tools/registry/`.
4. User edits code.
5. Agent writes tests.
6. Tool passes local validation.
7. Tool becomes `candidate`.
8. User applies tool to experiment.
9. After repeated validation, user promotes tool to `trusted`.

---

## 19. Development Commands

These commands should be implemented or approximated through scripts.

```bash
# Install dependencies
scripts/dev/install.sh

# Run workbench UI
scripts/dev/run_ui.sh

# Run Python backend
scripts/dev/run_backend.sh

# Run all tests
scripts/test/all.sh

# Run unit tests
scripts/test/unit.sh

# Run validation tests
scripts/test/validation.sh

# Run regression tests
scripts/test/regression.sh

# Build docs
scripts/docs/build.sh

# Run docs site
scripts/docs/dev.sh

# Clean local temp files
scripts/clean/local_temp.sh

# Validate repository conventions
scripts/dev/check_repo_conventions.sh
```

The repository convention checker should verify:

- `AGENTS.md` exists,
- `CLAUDE.md` exists,
- docs pages exist,
- README exists,
- bug folders exist,
- development folders exist,
- ignored local directories exist,
- no forbidden temp files are staged,
- generated simulation outputs are not staged accidentally.

---

## 20. Testing Strategy

### 20.1 Test Categories

```text
tests/
  unit/
  integration/
  regression/
  validation/
  performance/
```

### 20.2 Unit Tests

Cover:

- ModelSpec parsing,
- units,
- serialization,
- registry lookup,
- diagnostic tools,
- internal tool loading.

### 20.3 Integration Tests

Cover:

- create experiment,
- run experiment,
- save capsule,
- reload capsule,
- plot diagnostics,
- export code.

### 20.4 Regression Tests

Every bug fix should add or update a regression test when feasible. The regression test should be linked in `bugs_and_fixes/bugfixes.md`.

### 20.5 Validation Tests

Cover scientific validity:

- dimensional consistency,
- conservation laws,
- analytical limits,
- benchmark reproduction,
- convergence checks.

### 20.6 Performance Tests

Track:

- runtime,
- memory usage,
- backend overhead,
- scaling,
- GPU utilization where applicable,
- visualization throughput.

Performance tests must not silently redefine correctness. Faster wrong code is not an optimization; it is vandalism.

---

## 21. Security and File Locality

### 21.1 File Locality

The program should keep temporary and imported files inside the installation/project directory:

```text
local_cache/
temp_imports/
temp_runs/
simulation_capsules/
```

External writes should occur only when the user explicitly exports a capsule, code, report, or data.

### 21.2 Agent Sandboxing

Agents should not:

- write outside allowed directories,
- delete user files,
- overwrite user-edited code silently,
- install arbitrary packages without approval,
- execute unknown external binaries without approval,
- promote generated modules without validation,
- hide generated assumptions.

### 21.3 Import Safety

Imported papers, code, datasets, and tools should be:

- copied into local project-controlled directories,
- scanned or validated where practical,
- assigned provenance metadata,
- isolated from trusted modules until reviewed.

---

## 22. Scientific Accuracy Policy

The workbench must prefer:

1. explicit assumptions,
2. validated modules,
3. known numerical methods,
4. documented approximations,
5. reproducibility,
6. uncertainty reporting,
7. human review.

The workbench must avoid:

1. hidden approximations,
2. hallucinated constants,
3. unsourced coefficients,
4. undocumented generated code,
5. unvalidated solver substitutions,
6. fake confidence,
7. performance hacks that alter physics.

If data is missing, the system should say:

```text
Required coefficient data is missing. The experiment can run only in exploratory mode using placeholder values.
```

It must not silently invent the missing coefficient. Voilà, the difference between science and sorcery.

---

## 23. Minimum Viable Product Definition

The MVP should include:

1. Repository governance files.
2. TypeScript UI shell.
3. Documentation site.
4. Core Python experiment API.
5. ModelSpec schema.
6. Units validation.
7. Simulation capsule save/load.
8. Simple 0D rate-equation simulation.
9. Simple laser pulse module.
10. Basic species module.
11. Basic diagnostics and plots.
12. Code viewer.
13. Internal documentation viewer.
14. Bugfix logging system.
15. Development timeline system.
16. Internal tool SDK prototype.
17. One example laser-species experiment.
18. One non-laser example, such as 2D Ising or Lennard-Jones MD.

The MVP should **not** attempt full autonomous paper-to-simulation generation. That belongs after the manual workbench is stable.

---

## 24. Suggested First Three Milestones

### Milestone 1: Repository and Workbench Skeleton

Deliver:

- repo structure,
- agent files,
- docs site,
- README,
- UI shell,
- core Python package,
- example configs.

### Milestone 2: Manual Simulation Capsule

Deliver:

- ModelSpec,
- units,
- simple experiment runner,
- save/load capsule,
- plot diagnostics,
- code/config viewer.

### Milestone 3: Internal Tool Prototype

Deliver:

- tool SDK,
- tool registry,
- diagnostic tool example,
- tool tests,
- docs page,
- UI tool manager prototype.

Only after these milestones should the project invest heavily in paper-ingestion agents.

---

## 25. Definition of Done for Agent Tasks

Every agent task must end with:

1. Code changes complete.
2. Tests added or updated.
3. Tests run or explicitly documented as not run.
4. Documentation updated.
5. `README.md` updated if build/usage changed.
6. Bugfix log updated if bug-related.
7. Development timeline updated if milestone-relevant.
8. No local temp/cache/generated files staged.
9. Generated code remains inspectable.
10. Scientific assumptions remain explicit.

A task that changes behavior but leaves documentation stale is not done. It is merely abandoned in a more photogenic state.

---

## 26. Long-Term End State

The mature system should allow this workflow:

1. User imports a paper on laser-species interaction.
2. Agent extracts equations, parameters, assumptions, figures, and validation targets.
3. Agent generates a ModelSpec.
4. Registry maps ModelSpec to trusted modules.
5. Agent identifies missing modules/data.
6. Agent proposes a computational experiment ladder:
   - 0D reduced model,
   - 1D propagation model,
   - 2D visual model,
   - high-performance backend option.
7. User approves one or more experiments.
8. Agent generates code in a capsule.
9. System runs validation checks.
10. User inspects code, plots, diagnostics, and assumptions.
11. Results are saved, exported, compared, or promoted into reusable modules.

The end state is not an oracle. It is a disciplined computational laboratory with agentic acceleration. That is much less romantic and vastly more useful.

---

## 27. Immediate Action Checklist

Create these files first:

```text
AGENTS.md
CLAUDE.md
README.md
.gitignore
```

Create these directories next:

```text
docs_site/
bugs_and_fixes/
program_development/
packages/core/
packages/internal_tools/
packages/physics_modules/
packages/solver_backends/
apps/workbench-ui/
simulation_capsules/
local_cache/
temp_imports/
temp_runs/
tests/
examples/
configs/
scripts/
```

Then implement, in order:

1. Repository convention checker.
2. Documentation site skeleton.
3. ModelSpec schema.
4. Units subsystem.
5. Experiment runner.
6. Simulation capsule save/load.
7. Basic diagnostics.
8. UI shell.
9. Internal tool SDK.
10. First laser-species example.

Do not begin with autonomous paper-reading. Begin with a system worth automating.
