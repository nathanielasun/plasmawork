# CLAUDE.md — Operating Manual for Claude Code Agents

This file is the operationally-explicit playbook for Claude Code agents working in the **Scientific Simulation Workbench** repository. It duplicates the durable rules from `AGENTS.md` and adds concrete commands and procedures.

If `AGENTS.md` and this file ever drift, `AGENTS.md` is the source of truth for *rules* and this file is the source of truth for *how to run things*.

---

## Mandatory Repository Rules

(Identical durable ruleset as `AGENTS.md`. Treat the following as load-bearing.)

1. Keep documentation synchronized with code. If behavior, configuration, APIs, simulation modules, or build instructions change, update `docs_site/src/content/<page>` and `README.md` before completing the task.

2. Maintain program documentation inside `docs_site/` as TypeScript/MDX pages. The workbench UI loads documentation from this canonical source.

3. Maintain a root-level `README.md`.

4. Maintain `.gitignore` — local caches, temp simulation files, intermediate paper imports, generated run outputs, and `.env` files must never be committed.

5. Keep temporary files inside `local_cache/`, `temp_imports/`, `temp_runs/`, and `simulation_capsules/`. Never write program artifacts to arbitrary user directories. External writes only via explicit export.

6. Maintain `bugs_and_fixes/` (see structure below).

7. Before modifying an existing subsystem, inspect `bugs_and_fixes/` for relevant historical bugs. Do not reintroduce known errors.

8. Maintain `program_development/` with timeline, ADRs, and milestone files.

9. Generated scientific simulations must be inspectable, editable, modular, exportable, reloadable, and tied to explicit assumptions, units, parameters, and validation checks.

10. Prefer precise validated modules over broad approximations. Missing coefficient → report, do not fabricate.

11. The convention checker is the source of truth for repository health and completed deliverables. Default `scripts/dev/check_repo_conventions.sh` is the hard gate and must stay green. Open workstream TODOs live behind `scripts/dev/check_repo_conventions.sh --include-open-workstreams`; that opt-in mode may fail by design and must not be wired into `scripts/test/all.sh`. See **Phase Gate Procedure** below.

12. Every command path you mention in `README.md`, `CLAUDE.md`, `AGENTS.md`, or any docs page must exist on disk as an executable. Use stubs for unimplemented subsystems. Doc reference and stub land in the same commit.

13. Reality-test every plan-derived artifact. The plan is design; the filesystem is truth. See **Phase Gate Procedure → Reality-test plan-derived patterns**.

14. The plan's `§Phase N → Workstream NX` description is the deliverable list. Milestone Pre-gate hints are illustrative — read them to start, but enumerate the plan's full bullet list before claiming a workstream done. See **Phase Gate Procedure → Starting a workstream** below.

15. Recursive validation at scientific boundaries. Any `dict[str, Any]` field where physical numbers can land (`fields.initialization`, `interactions.valid_regime`, etc.) gets a recursive validator that rejects raw floats and unitless numeric strings.

16. Test fixtures are deep-copied when mutated. `data = dict(FIXTURE)` is a trap — use `copy.deepcopy` or fixture factories.

17. No `global` declarations on cached singletons. Use `@functools.lru_cache(maxsize=1)` on the factory function instead.

18. Lifecycle promotion gates live at the mutation boundary. A registry method
    that rewrites `tool.yaml` or `module.yaml` must enforce human approval,
    scientific evidence, declared test existence, and test execution itself.
    API/UI checks may call the registry gate, but they are not the gate. Public
    lifecycle mutators do not expose `skip_approval`, `consume_approval=False`,
    `run_tests=False`, or similar bypass flags.

19. Plan-named module families are enumerated exactly. Before closing a
    workstream such as Phase 7B, list every module named in the plan and make
    the convention checker assert each completed deliverable. A single
    "reference module" does not satisfy a family unless the deferral is explicit
    and recorded as an opt-in TODO assertion.

20. Registry discovery does not hide invalid metadata. If a `module.yaml` or
    `tool.yaml` cannot load, the gate fails with the file path and parse error;
    do not silently skip it and make a broken module look absent.

---

## How to Run the Program Locally

> Phase 0 complete (2026-05-02). Phase 1 (Manual Scientific Workbench) complete (2026-05-02 with review-fix corrections; see `bugs_and_fixes/bugfixes.md` *Phase 1 false close*). Phase 2 (Simulation Capsule System) complete (2026-05-02): all four workstreams 2A–2D shipped — canonical `manifest.toml` v0.1 schema + structural validator + migration registry, HDF5 bulk data (ADR-0002 Accepted), provenance triad with source-aggregate hashing, full export system (code/data/plots/notebook/report/archive) + `fork_capsule()`, and the six-tab Capsule Explorer UI wired to four new backend endpoints. Every documented script path exists on disk; scripts whose subsystem is not yet implemented are stubs that print "Phase N — not implemented yet" and exit cleanly. Do not invent command names; if a script is missing, add a stub for it in the same commit as the doc reference.

```bash
# One-time install (Python core + UI)
scripts/dev/install.sh

# Run the TypeScript workbench UI (Phase 1F)
scripts/dev/run_ui.sh

# Run the Python backend / API server (Phase 1A–C)
scripts/dev/run_backend.sh

# Run the docs site (Phase 0B)
scripts/docs/dev.sh
```

If you need a Python REPL with the workbench package importable:

```bash
cd packages/core
python -m pip install -e .
python -c "import simworkbench; print(simworkbench.__version__)"
```

---

## How to Run Tests

```bash
# All tests
scripts/test/all.sh

# Subsets
scripts/test/unit.sh
scripts/test/validation.sh
scripts/test/regression.sh
```

For a specific Python test file:

```bash
pytest tests/unit/test_modelspec.py -x -v
```

For TypeScript tests in the UI app:

```bash
cd apps/workbench-ui && npm test
```

---

## Common Gotchas

- `python3 -m venv .venv` — uv is not used; default to `.venv/bin/python` and `.venv/bin/ruff`.
- `yaml.safe_dump` writes list items with **2-space** indent, not 4. Don't string-replace `"\n    -"`; round-trip via `yaml.safe_load` + `yaml.safe_dump`.
- FastAPI request-body Pydantic classes MUST be at module scope. Classes defined inside `create_app()` return 422 "missing field". See `*Body(BaseModel)` declarations in `simworkbench.api.server`.
- Vitest + React 18 StrictMode renders components twice → `screen.getByText("X")` raises on multiple matches. Use `screen.getAllByText("X").length > 0` or scope with `within(getByRole("navigation"))`.
- Every new FastAPI endpoint adds matching types to `apps/workbench-ui/src/api/client.ts` first; UI components import the type, never call `fetch` directly.
- `tsc -b` leaks `.js` and `.d.ts` into `src/`; build scripts use `tsc --noEmit && vite build`. `.gitignore` carries fallback rules but don't rely on them.
- Convention checker has two modes: default (hard gate, must stay green) and `--include-open-workstreams` (TODO list, may fail by design). Tests in `tests/regression/test_convention_checker_modes.py` enforce the contract.
- Six consecutive phases (1–6) shipped incomplete closes; every audit added named patterns to `bugs_and_fixes/agent_error_patterns.md`. Read the latest 4–8 patterns before any close commit, not just the gate criteria.
- `rate_equation_0d` (under `packages/physics_modules/species/`) is the Phase 1 canonical solver and the reference module for ModelSpec / ModuleMatcher tests. New species-domain integration tests typically target it.
- "Validate X" code paths must consume X. If a validator is named after the generated artifact, it imports/parses the artifact — not the spec the artifact was generated from. Negative test: corrupt the artifact, expect `failed`.
- Loop-based validators do their checks BEFORE any `continue` / `break` / `return` skip. Inputs that the early-exit covers still get validated. Phase 1's `python_cpu` had this shape; Phase 4's interpretation banner check had it too.
- HTTP API never reads `actor`, `role`, `user`, or any privilege claim from the request body. Privileged paths require an out-of-band token (e.g. `simworkbench.tools.grant_approval` writes a single-use file under `local_cache/tool_approvals/`).
- Endpoints named `/diff`, `/preview`, `/state-after-X` perform that operation server-side. Returning inputs and asking the caller to compute the result is a bug, even if the test passes.
- Exporters that walk a tree validate the destination is OUTSIDE the source BEFORE writing. Defense-in-depth: also exclude the in-flight archive from the rglob walk.
- HDF5 metadata serialization can drop list-shaped fields. Cross-format parity test: write canonical-only, read back, assert every documented field round-trips. Lists become vlen-string arrays, not bools.
- Regenerate-in-place writers track the prior manifest and DELETE orphans through the same sandbox that gates writes. Without that step, stale files survive into export.
- `vitest run` is **not** a typechecker — esbuild/swc strips types. Run `bash scripts/test/ui.sh` (or `npm --prefix apps/workbench-ui run typecheck`) before considering UI work green; that script is wired into `scripts/test/all.sh`.

---

## How to Update Documentation Pages

1. Open the relevant page under `docs_site/src/content/`. The required pages are:
   `overview`, `installation`, `usage`, `architecture`, `module_development`, `internal_tools`, `simulation_capsules`, `agent_workflows`, `validation`, `troubleshooting`.
2. Make the change in the MDX/TSX file.
3. Verify the docs site renders: `scripts/docs/dev.sh`.
4. If the change documents a new feature, also update `README.md` and the in-program docs viewer.
5. Add a timeline entry in `program_development/timeline.md` when the change is milestone-relevant.

---

## How to Add a Simulation Module

Modules live at `packages/physics_modules/<domain>/<name>/` (laser, plasma, species, spectroscopy, molecular_dynamics, phase_transition, pde, monte_carlo).

1. Copy `packages/physics_modules/templates/<closest-template>/` into the new path.
2. Edit `module.yaml` per plan §14.2: name, version, domain, status (`candidate`), declared inputs/outputs with units, validity domain, references.
3. Implement `src/`. Public functions take and return unit-aware quantities (no raw floats at the boundary).
4. Add tests in `tests/`: at minimum a unit test for I/O contracts and a validation test for a limiting/analytical case.
5. Add `README.md`, `assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`, `examples/`.
6. Register the module: add a row to `packages/physics_modules/<domain>/index.yaml` (or run `scripts/dev/refresh_registry.sh`).
7. Run `scripts/test/validation.sh` to confirm.
8. Update `docs_site/src/content/module_development.tsx` if the module introduces a new interface pattern.

Promotion `candidate → validated` requires the criteria in plan §14.3 and a human reviewer.

---

## How to Add an Internal Tool

Internal tools are diagnostic, visualization, importer, validator, exporter, etc. They live at `packages/internal_tools/registry/<tool_name>/`.

1. From the workbench UI: **Internal Tools → New Tool from Template**, OR copy `packages/internal_tools/templates/<category>/` into the registry.
2. Edit `tool.yaml` per plan §9.3: name, version, type, entrypoint, declared inputs/outputs with units, compatible domains, requires, validation tests.
3. Implement `src/tool.py` extending `simworkbench.tools.BaseTool` with `validate_inputs` and `run`.
4. Add tests in `tests/`.
5. Add `README.md`, `docs/`, `examples/`.
6. Register: `scripts/dev/refresh_registry.sh` (or restart the UI).
7. Tool starts in `draft`. After tests pass it becomes `candidate`. Promotion to `trusted` requires a human reviewer.

---

## How to Inspect the Bugfix History Before Modifying Code

Before editing files in any subsystem:

```bash
# 1. Find which subsystem you're touching, then grep the bug log for it
grep -nE "packages/core/runtime|runtime/" bugs_and_fixes/bugfixes.md
grep -nE "your-subsystem-keyword" bugs_and_fixes/known_failures.md
grep -nE "your-pattern" bugs_and_fixes/agent_error_patterns.md
```

If the area has prior bugs:
- Read the relevant entry. Note the regression test that protects against the bug.
- Run that regression test before and after your change: `pytest <linked test path>`.
- If your change might affect the protected invariant, explain why in the commit message and add a new regression test if behavior changes intentionally.

---

## How to Avoid Writing Temporary Files Outside the Installation Directory

- Always use `pathlib.Path(__file__).resolve()` or the `simworkbench.paths` module to resolve workbench-relative paths.
- Allowed temp roots:
  - `local_cache/` — caches, downloaded coefficient tables, parsed paper artifacts
  - `temp_imports/` — imports staged for review
  - `temp_runs/` — in-flight run artifacts before promotion to a capsule
  - `simulation_capsules/` — finalized capsule directories
- Use `tempfile.TemporaryDirectory(dir=local_cache_root())` rather than the system tempdir for anything that should be cleanable by `scripts/clean/local_temp.sh`.
- Do not write to `~/`, `/tmp/`, or absolute paths chosen by the agent.

---

## How to Keep Generated Code Readable and Exportable

When an agent generates simulation code into a capsule:

- Place it in `<capsule>/src/generated/`. User edits go in `<capsule>/src/user_edits/` — never overwrite that directory.
- Format with the project formatter (`ruff format` for Python, `prettier` for TS).
- Top-of-file header must declare: source paper (DOI/title), ModelSpec version, generation timestamp, agent identifier.
- Public functions get docstrings stating units and assumptions.
- Generated code must be runnable in isolation: `python <capsule>/src/generated/run.py`.
- Capsule export (`scripts/export/capsule.sh <name>`) must produce a self-contained archive.

---

## How to Maintain Scientific Provenance

Every run touches `<capsule>/provenance/`:

- `provenance.lock` — environment, package versions, backend, hardware metadata, random seeds, ModelSpec hash, source-code hashes.
- `agent_trace.md` — chronological record of each agent action: which inputs were read, which decisions were made, which files were generated/modified.
- `environment.yaml` — pip/conda freeze.

Never delete or rewrite `provenance/` files in a completed capsule. To re-run with changes, fork the capsule (`scripts/export/fork_capsule.sh <src> <dst>`).

---

## Off-Limits Directories for Destructive Edits

The following directories must not be modified by an agent except via the documented interface:

| Directory | Allowed change | Forbidden |
|---|---|---|
| `<capsule>/provenance/` | Append-only via runtime | Manual edits, deletions |
| `<capsule>/src/user_edits/` | User only | Agent overwrites |
| `<capsule>/paper_sources/` | Initial import only | Edits to original paper files |
| `bugs_and_fixes/` | Add new entries | Removing or rewriting historical bug entries |
| `program_development/architectural_decisions/` | New ADRs, status updates on existing ADRs | Rewriting accepted ADRs |
| `physics_modules/.../validated/` and `.../trusted/` modules | New version branches | In-place behavioral changes without an ADR |
| `LICENSE` | None | Any modification |

When in doubt, ask before editing. Prefer reversible additions over destructive rewrites.

---

## Phase-Specific Operational Notes

**Phase 0** (Repository Bootstrap) — complete 2026-05-02.
**Phase 1** (Manual Scientific Workbench) — complete 2026-05-02. All six workstreams 1A–1F shipped, including the post-review-fix capsule save/reload that satisfies Phase Gate items 4 and 5.
**Phase 2** (Simulation Capsule System) — complete 2026-05-02. All four workstreams 2A–2D shipped. ADR-0002 Accepted with HDF5 bulk-data lock-in; canonical `manifest.toml` schema (`v0.1`) + validator + migration registry; provenance triad with source-aggregate hashing; full export pipeline (code/data/plots/notebook/report/archive) + `fork_capsule()`; six-tab Capsule Explorer UI (Manifest / ModelSpec / Code / Results / Validation / Provenance) over four new backend endpoints (`GET /api/capsules/{name}`, `/files/{path}`, `/validate`, `/diagnostics`).
**Phase 3** (Internal Tool SDK and Registry) — complete 2026-05-02. All five workstreams 3A–3E shipped (with post-close gate-walk fixes). `BaseTool` ABC + `ToolInput`/`ToolOutput` contracts; `ToolMetadata` Pydantic schema; lifecycle state machine with agent/human + scientific gating; `ToolRegistry` discovers `packages/internal_tools/registry/` and `local_cache/imported_tools/`; eight backend endpoints; experiment binding via `Experiment.tool_refs` + `apply_tools`.
**Phase 4** (Agent-Assisted Paper Ingestion) — complete 2026-05-02 (with PDF + extracted-artifacts fixes 2026-05-03). All five workstreams 4A–4E shipped plus two post-close audits.
**Phase 5** (ModelSpec Generation and Module Mapping) — complete 2026-05-03. All four workstreams 5A–5D shipped. `simworkbench.modeling.ModelSpecGenerator` transforms reviewed Phase-4 artifacts into a schema-valid ModelSpec (refuses unreviewed input per plan §Phase 4 hard rule); `ModuleMatcher` walks the physics-module registry with per-bullet sub-scores; `GapAnalyzer` covers all five §10.4 categories; `ExperimentProposer` writes `experiment_proposal.md` with all five §Phase 5 / 5D bullets; "Proposals" UI tab over `POST /api/proposals` runs the full pipeline. Gate-walk integration test was written BEFORE implementation per the ninth Phase Gate Procedure check.
**Phase 6** (Sandboxed Agentic Code Generation) — complete 2026-05-03. All five workstreams 6A–6E shipped. `simworkbench.codegen.CodeGenerator` deterministically renders runnable Python `experiment.py`, configs, diagnostic helpers, generated tests (unit / dimensional / smoke / regression / convergence-when-applicable), and a README into `<capsule>/src/generated/`; `simworkbench.codegen.sandbox.sandboxed_write` is the single producer-side gate that refuses every write under `src/user_edits/`, `paper_sources/`, and `provenance/` with no opt-out at any layer; `simworkbench.codegen.TestGenerator` covers each plan-named pytest category as a real file; `simworkbench.codegen.ValidationRunner` runs the generated experiment on the Phase-1 `Runner` (LSODA, never a hand-rolled timestep loop per plan §15.2) and writes `validation/{validation_summary.md, status.yaml, plots/*.csv}`; new "Generated Code" UI tab over four new backend endpoints (`GET/POST /api/capsules/{name}/codegen`, `GET .../codegen/diff`, `POST .../validate-run`). Gate-walk integration test was written BEFORE implementation per the ninth Phase Gate Procedure check; ten gate-walk tests cover every gate verb plus the API hard-rule bypass guard.
**Phase 7** (Validated Physics Module Registry) — complete 2026-05-03; post-close audit fixed 2026-05-04. All five workstreams 7A–7E shipped. `simworkbench.modules` ships `ModuleRegistry`, `ModuleMetadata` Pydantic (Registry v1: dependencies, benchmarks, compatibility), `ModuleStatus` lifecycle (draft→candidate→validated→trusted→deprecated) gated inside `ModuleRegistry.set_status` by single-use approval tokens, benchmark artifacts, declared tests, and mandatory test execution. Six modules transition to `validated` against analytic benchmarks: `laser/absorption_lambert_beer`, `species/rate_equation_0d`, `molecular_dynamics/lennard_jones`, `phase_transition/ising_2d`, `pde/wave_equation_1d`, `pde/reaction_diffusion_1d`. The full Phase 7B laser-species family exists as candidate/validated modules. Plasma module skeletons ship as `candidate`. `simworkbench.validation_library` exposes `ConservationCheck`, `ConvergenceCheck`, `PaperReproduction`, `CrossSolverComparison`.
**Phase 8** (HPC and Hardware Backends) — complete 2026-05-04; post-close audit fixed 2026-05-04. All six workstreams 8A–8F shipped. `simworkbench.runtime.solver_backend` exposes the `SolverBackend` ABC + `BackendCapabilities` descriptor; `simworkbench.backends` ships `BackendRegistry`, `BackendStatus` lifecycle gated inside `set_status` by single-use approval tokens (`consume_backend_approval` is consumed at the mutation boundary, NOT the actor string), Pydantic `Literal`-typed metadata that refuses malformed status values at load (rule 20), capability-aware `recommend(spec)` filtered to validated/trusted by default. `python_cpu` and `numba_cpu` are validated; cross-backend agreement asserted within 1e-6 relative. The C++ kernel pipeline ships a CMake build + ctypes ABI wrapper (`axpy` reference kernel) that REFUSES non-contiguous inputs to honor its in-place contract. The CUDA adapter exposes capability probe + memory estimator + determinism warning; ADR-0006 documents policy; `_resolve_backend_determinism` consults runtime registry first, then `BackendRegistry` metadata, raises `CapsuleSaveError` if neither knows the backend (no comfortable defaults). HPC orchestration ships `SlurmJob` (locality-checked write), `RayAdapter`, `import_remote_result`. The external-PIC adapter applies the same locality check to all writers. 15 gate-walk + 18 audit-regression tests cover every gate verb plus the seven negative-path findings.

Current state:
- Default convention checker covers every Phase 0/1/2/3/4/5/6/7/8 entity (~609 checks); the opt-in `--include-open-workstreams` mode is empty awaiting Phase 9.
- Phase status synchronized across `README.md`, `program_development/milestones/{phase_00..phase_08}_*.md`, `program_development/timeline.md`, all `docs_site/src/content/*.tsx` pages that name the phase, and this file.
- Bugs logged in `bugs_and_fixes/bugfixes.md` with regression checks:
  - 2026-05-02 *Bare `build/` ignore rule swallowed `scripts/build/`*
  - 2026-05-02 *Phase 0 gate false positive for missing skeleton files*
  - 2026-05-02 *Phase 1A/1B gate overstated implementation completeness*
  - 2026-05-02 *Per-app and per-package `build/` outputs were not gitignored*
  - 2026-05-02 *Phase 1 false close — seven legitimate review findings*
  - 2026-05-02 *Phase 2 false close — six legitimate review findings*
  - 2026-05-02 *Phase 3 false close — five legitimate review findings*
  - 2026-05-03 *Phase 4 post-close audit — three legitimate review findings*
  - 2026-05-03 *Phase 4 post-close audit (round 2) — PDF success path + scope drift*
- `bugs_and_fixes/agent_error_patterns.md` now carries 33 named patterns. Read them before changing convention-checker logic, gate-criterion behaviors, registry mutations, lifecycle gates, or scientific I/O boundaries.

Phase 9 is next per plan §Phase 9. Open it via **Phase Gate Procedure → Starting a workstream** below: write the gate-walk test FIRST, then enumerate plan deliverables, add per-entity opt-in convention-checker assertions, then implement until everything is green.

---

## Phase Gate Procedure (Claude-Specific)

Phase 0 was initially marked "complete" with stale README status, missing package manifests, missing milestone files, and missing documented scripts. The bug is logged at `bugs_and_fixes/bugfixes.md` 2026-05-02 — *Phase 0 gate false positive*. The procedure below is the operational discipline that prevents recurrence.

### Three independent checks for "phase complete"

A phase is complete only when **all three** are true:

1. Default `scripts/dev/check_repo_conventions.sh` exits zero.
2. The phase status reads identically in `README.md`, `program_development/milestones/phase_NN_*.md`, and `program_development/timeline.md`. Any ADR, `module.yaml`, `tool.yaml`, or `docs_site/src/content/*.tsx` page that names the status agrees too.
3. Every deliverable in the milestone's Phase Gate, the plan's `§Phase NN`, and the README's status table has at least one assertion in the convention checker. Completed deliverables are default hard-gate assertions; open deliverables are opt-in `--include-open-workstreams` assertions until implemented.

### Starting a phase — the deliverables-to-checker translation

The first action when opening a new phase is to extend the convention checker. Concretely:

```bash
# 1. Read the plan section for the phase.
sed -n '/^# Phase NN:/,/^# Phase /p' scientific_simulation_workbench_agent_plan.md \
  | head -200

# 2. Read the milestone file.
cat program_development/milestones/phase_NN_*.md

# 3. Read README and the relevant docs page.
grep -nE "Phase NN" README.md docs_site/src/content/*.tsx
```

Then enumerate every open deliverable into a checklist (see milestone "Pre-gate verification" template). For each deliverable, add a `check_file_exists`, `check_file_executable`, `check_dir_exists`, `check_grep_in_file`, or negative grep call under the opt-in `--include-open-workstreams` section of `scripts/dev/check_repo_conventions.sh`. Run the opt-in checker — it should fail. The default checker must still pass unless a completed invariant regressed.

```bash
bash scripts/dev/check_repo_conventions.sh --include-open-workstreams
# Convention check FAILED — N failure(s), M check(s) ok.
```

Implement until the relevant TODO assertions are green, then promote completed deliverable assertions into the default hard gate before claiming the phase or workstream complete.

### Starting a workstream — enumerate from the plan, not from the milestone hints

The Phase 1A bug (`bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 1A/1B gate overstated implementation completeness*) came from implementing the milestone Pre-gate hints rather than the plan's full Workstream description. The hints listed only ModelSpec; the plan listed *Experiment, ModelSpec, RunConfig, DiagnosticConfig, BackendConfig, serialization*. Five of six entities were missed.

Procedure for any new workstream:

```bash
# 1. Locate the workstream in the plan.
awk '/^### Workstream NX:/,/^### Workstream/' \
    scientific_simulation_workbench_agent_plan.md
# Read the full bullet list. Note every named class, file, module, script,
# config key, ADR, test, and example.

# 2. Compare against the milestone Pre-gate hints.
awk '/Convention-checker assertions to add/,/Status sync at close/' \
    program_development/milestones/phase_NN_*.md

# 3. Diff. If the milestone is missing entities the plan names, patch the
#    milestone first in a small commit BEFORE writing any code. The milestone's
#    Pre-gate list must reflect the plan, not the agent's interpretation.
```

Once the milestone Pre-gate matches the plan, every open named entity gets one opt-in assertion:

```bash
# In scripts/dev/check_repo_conventions.sh, prefer:
check_file_exists packages/core/src/simworkbench/experiment/types.py
check_file_exists packages/core/src/simworkbench/experiment/__init__.py
check_file_exists packages/core/src/simworkbench/serialization/experiment.py
check_file_exists tests/unit/test_experiment.py
check_file_exists tests/integration/test_experiment_save_load.py
# ... one assertion per plan-named entity, not one assertion per directory.
```

Run `bash scripts/dev/check_repo_conventions.sh --include-open-workstreams` — every missing entity is one failure. The failures are the workstream's TODO list. Also run the default checker; it must stay green and `scripts/test/all.sh` must not depend on intentionally failing TODO mode. Implement until the relevant TODOs are green; only then is the workstream done.

If you choose to defer an entity to a follow-up workstream, **say so explicitly in the commit message** ("RunConfig deferred to Workstream 1C — see milestone phase_01") AND keep a failing opt-in convention-checker assertion that encodes the deferral, so the deferral remains visible until resolved without breaking the normal test runner.

### Closing a phase — status flip in one commit

Before flipping any phase status to "Complete":

```bash
# 1. Run the checker.
bash scripts/dev/check_repo_conventions.sh
# expect: Convention check PASSED

# 1b. Confirm no relevant open TODO remains.
bash scripts/dev/check_repo_conventions.sh --include-open-workstreams

# 2. Run subsystem tests if any apply.
bash scripts/test/all.sh   # or the most relevant subset

# 3. Audit status references.
grep -nE "Phase NN" README.md \
  program_development/milestones/phase_NN_*.md \
  program_development/timeline.md \
  $(grep -lE "Phase NN" docs_site/src/content/*.tsx 2>/dev/null)

# 4. Confirm every match agrees with the new status.

# 5. Stage all status-bearing files and commit in one commit.
git add README.md \
  program_development/milestones/phase_NN_*.md \
  program_development/timeline.md \
  <other status-bearing files>
git commit -m "..."   # Use the HEREDOC pattern below.

# 6. Push (this is a major change per Autonomous Git Operations).
git push
```

### Closing a phase — twenty-four behavioral checks (Phase 2 + 3 + 4 + 5 + 6 lessons)

Phases 1, 2, 3, 4, 5, and 6 each shipped an incomplete close (Phase 4 twice; Phase 5 once; Phase 6 with eight findings). Steps 1–6 above (convention checker green, status sync, etc.) are the existence checks. They are necessary but not sufficient. The convention checker proves files exist; it does not prove the gate criteria's *behaviors* work. Add these twenty-four before the close commit:

1. **End-to-end gate walk.** Every plan §Phase-N gate criterion exercised on a real artifact. For Phase 2 that meant: run the example, save it as a capsule, reload it via `scripts/dev/run_capsule.sh`, validate it, export it, fork it, reload the fork. Each step on its own integration test, not just a manual demo.
2. **Documented scripts run.** `grep -rn "scheduled for Phase" scripts/` returns only stubs in not-yet-opened phases. Every script the README, CLAUDE.md, or any docs page advertises as a current entrypoint runs successfully on a typical input. (Phase 2 close shipped `scripts/dev/run_capsule.sh` still as the Phase-0 stub even though README documented it as the reload path.)
3. **Producer-writer wiring.** Every writer that landed in this phase appears in the producer's call site by file:line. Round-trip the producer's output through the writer's `load_*` to catch hand-rolled equivalents. (Phase 2 close shipped `save_capsule` writing a hand-rolled `provenance.lock` that didn't validate as `ProvenanceLock`; `environment.yaml` wasn't written; `agent_trace.md` was overwritten instead of appended.)
4. **Validator field parity.** Every new producer output corresponds to a validator required-field added in the same workstream. Diff the validator's `REQUIRED_FILES` and the producer's outputs — they must agree. (Phase 2 close shipped the validator requiring `diagnostics.json` while the canonical format had become `diagnostics.h5`.)
5. **Destructive-after-validate in exporters / registries.** Every exporter validates the entire plan before any `rmtree` / `unlink` / write. Tests assert source-survival on self-export. Same rule for registry mutations: `register_from_template`, `set_status`, etc. validate user-controlled names BEFORE any filesystem touch (Phase 3 close shipped `register_from_template` accepting `target_name="../../escape"` and creating the directory before any name-shaped check fired).
6. **UI panels actually render.** Every UI panel that promises to show X has a Vitest test that mounts the component, mocks the backend, and asserts X is in the rendered output. (Phase 2 close shipped `CapsuleCodeView` requesting `src/generated/__index__` from the file endpoint — always 404 — and the test suite never noticed because there was no test that asserted code actually rendered.)
7. **Status-sync grep reads every match.** `grep -nE "Phase NN" README.md` will sometimes return multiple lines in the same file (banner + table). Read all of them. (Phase 2 close shipped README:5 saying "complete" while README:33 said "In progress".)
8. **Build scripts succeed and emit no source-tree artifacts.** `scripts/build/ui.sh` and `scripts/docs/build.sh` exit 0; `find apps/*/src docs_site/src -name '*.js' -o -name '*.d.ts'` is empty afterwards. (Phase 2 close shipped `tsc -b && vite build` which leaked `.js` files into `src/` whenever typecheck failed; Vitest then double-counted them.)
9. **Gate-clause verb walk** *(Phase 3 false-close lesson)*. Read the plan's `## Phase Gate` paragraph for the phase. Extract every **verb**. For each verb, confirm three things exist:
   - A real backend or library implementation (not a stub, not a TODO comment).
   - A user-facing surface (UI button / API endpoint / documented function).
   - A test in `tests/integration/test_phase_N_gate_walk.py` that exercises the verb end-to-end on a real artifact, with at least one negative case.

   The Phase 3 gate said "create, **test**, document, register, **use it in an experiment**, and **export** a tool." The close shipped list / view-docs / status only — five gate verbs went unimplemented while the convention checker, ruff, all tests, and both build scripts were green. Existence checks 1–8 don't catch missing verbs because the verbs aren't entities; they're operations. The gate-walk file makes the verbs first-class.

10. **Workstream task-bullet walk** *(Phase 4 audit lesson)*. The gate verb is one level of granularity; the plan's `### Workstream NX → Tasks:` bullet list is a finer one. Open `scientific_simulation_workbench_agent_plan.md` to the workstream's section, copy the entire `Tasks:` bullet list into a checklist. Tick each bullet only when an artifact + test ships. The Phase 4 close satisfied the verb "import" but only 2 of the 6 task bullets under Workstream 4A had implementations — the other four (`Extract text`, `Extract tables`, `Extract figures metadata`, `Import PDFs`) had no code. The gate-walk test asserted the verb worked, not each bullet. The fix: the gate-walk test asserts each task bullet's artifact lands on disk. A close-commit pre-flight: `git diff` + the plan's bullet list, side-by-side.

11. **Boundary validation parity** *(Phase 4 audit lesson)*. For every API endpoint that accepts user input, send `""`, `" "`, `"\t"`, malformed types, missing fields. Each must return 400; provenance/state must remain unchanged. UI validation is a UX nicety; the API's validation is the actual gate. The Phase 4 close shipped a UI that required reviewer-name and a backend that accepted `reviewer=""` — `agent=reviewer:` rows accumulated in `provenance/agent_trace.md` from any caller bypassing the UI. Library functions get the same rule: `PaperImporter.apply_edit(reviewer="")` raises at the public method, not at some downstream consumer.

12. **Success path runs, not just the structured failure** *(Phase 4 audit round 2)*. For every "supports X" claim, the close commit verifies three things: (a) the dep is installed (`pyproject.toml` + `scripts/dev/install.sh` + a probe like `.venv/bin/python -c "import pypdf"`), (b) the structured exception propagates to the user (every `raise <Error>` has a matching `try / except` in `simworkbench.api.server` AND a test asserting the documented status code), (c) a happy-path test exercises the success path with a real fixture (for binary formats: hand-roll the smallest valid file). The Phase 4 close had a clean `TextExtractionError` for "PDF without pypdf" — but pypdf wasn't installed, the API didn't catch the error (HTTP 500 instead of 400), and no test ever imported a PDF successfully. The structured failure path was complete; the success path was unreachable.

13. **Hard rules don't take a client-controlled flag** *(Phase 5 audit lesson)*. Every "must hold" rule is enforced inside the library, not by trusting a request-body field. UI controls do not expose toggles for security checks. A library may keep a `_for_tests=True` kwarg, but the API endpoint hard-codes the rule. Negative regression test: send the bypass attempt as a body field; assert the rule still fires (4xx, no artifacts on disk). The Phase 5 close shipped `POST /api/proposals` accepting `require_reviewed: false`; bypass wrote `model_spec.yaml` and `experiment_proposal.md` from agent-only interpretation.

14. **Mixed-shape rules cover every shape** *(Phase 5 audit lesson)*. When a rule applies to "every interpretation artifact" (or any union-of-shapes set), enumerate the shapes and assert the check has a branch per shape. Structured rows: `edited_by` non-empty. Markdown / free text: agent's "needs human review" / "AGENT DRAFT" banner is gone. Binary blobs: per-shape review marker. The Phase 5 close shipped a `_enforce_human_review` that walked equations + parameters but never opened the four interpretation Markdown files; capsule with signed rows + banner-bearing Markdown was accepted as reviewed.

15. **Compatibility checks compare against the consumer's contract** *(Phase 5 audit lesson)*. Don't accept "parses cleanly" or "is non-empty" as compatibility. Compute the consumer's required shape — required dimensions, required schema fields, required port set — and check coverage of THAT, not just "the input parsed". The Phase 5 close shipped a `unit_compat` that returned 1.0 if every module-output unit was pint-parseable; a fake module emitting only `second` for a species-density spec scored 1.0.

16. **Cross-cutting "always-on" prose has a regression test** *(Phase 5 audit lesson)*. Grep the repo for "always", "must be enabled", "always required", "always check" — every cross-cutting invariant has a regression test that reads the relevant config / state / artifact and fails when the invariant drifts. The Phase 5 close left `security_sandbox.enabled = false` in `agents.yaml` while four other roles were enabled, despite the role's own description carrying the "Always-on once any agent is enabled" rule. Prose without a test ages into a lie.

17. **A "validate X" step must consume X** *(Phase 6 audit lesson)*. Validators named after generated/derived artifacts must actually open them — import the Python file, parse the YAML, exec the script — not bypass the artifact for the upstream source of truth. Negative regression test: corrupt the artifact (invalid Python, missing entry point); the validator must report `failed`, not `passed` / `incomplete`. The Phase 6 close shipped a `ValidationRunner` that reloaded `model_spec.yaml` and never imported `<capsule>/src/generated/experiment.py`; a corrupted generated file passed silently.

18. **Validation rules fire BEFORE permissive early-exits** *(Phase 6 audit lesson)*. Every contract check that loops over inputs runs before any `continue` / `break` / `return` that skips the input. Inputs that the early-exit would cover still get validated. Negative test: send the input the early-exit covers and assert the validator still raises. The Phase 6 close shipped a `python_cpu` backend that validated coefficient sources INSIDE the iteration body and AFTER an `if len(species) < 2: continue`. One-participant interactions with non-placeholder rates silently no-op'd.

19. **Privileged checks derive identity server-side** *(Phase 6 audit lesson)*. The HTTP API never reads `actor`, `role`, `user`, or any privilege claim from a request body. Either the server has authentication (then derive from the session) or the privileged path requires an out-of-band token (a file written by a local CLI, a one-shot approval). Negative test: post the bypass field and assert 4xx. The Phase 6 close shipped `POST /api/tools/{name}/status` accepting `actor=human` from the body — the autonomous agent could promote tools to `validated` by claiming to be a human.

20. **Endpoints named after a transformation perform that transformation** *(Phase 6 audit lesson)*. `/diff` returns `{added, removed, changed, unchanged}`, not `{previous, current}`. `/preview` shows what *would* happen, not what already happened. If the endpoint can't perform the named operation, rename it (`/state`, `/snapshot`). The matching test asserts behavior under conditions that should produce a non-trivial result, not just key-presence. The Phase 6 close shipped `/codegen/diff` that returned manifest + hashes only; the gate-walk test asserted only that two keys existed in the response.

21. **Archive / export targets validated outside source** *(Phase 6 audit lesson)*. Every exporter that walks a directory and writes an archive validates `target.relative_to(source)` raises, BEFORE creating the destination. Defense-in-depth: also exclude the in-flight archive from the walk via `path.resolve() == archive.resolve()`. Negative test: call exporter with a target inside the source; assert refusal AND assert the archive's contents don't include the archive itself. The Phase 6 close shipped `export_archive` that wrote `<capsule>/exports/<capsule>.zip` and then walked `<capsule>/`, capturing itself.

22. **Canonical-format serializers preserve every semantic field** *(Phase 6 audit lesson)*. When format A is the canonical store and format B is a sidecar, every field that exists in B exists in A — not in a downgraded form. List of strings → vlen-string array, not a boolean. Cross-format parity test: write through canonical-only path, read back, assert every documented field matches. The Phase 6 close shipped HDF5 metadata that stored `placeholder_used: bool` and dropped `placeholders: list[str]`; HDF5-only capsules reloaded with empty placeholders.

23. **Regenerate-in-place writers list and clean orphans** *(Phase 6 audit lesson)*. Every "regenerate" / "rewrite" / "refresh" code path tracks the prior manifest's file set, computes `(prior - current)`, and removes orphans through the same sandbox that gates writes. Regression test: generate, mutate spec to drop an artifact, regenerate, assert the dropped artifact no longer exists on disk AND appears in `result.removed_files`. The Phase 6 close shipped a `CodeGenerator` that overwrote files but never removed orphans — old files lingered into export.

24. **Plan verbs drive UI components, not just plan-named buttons** *(Phase 6 audit lesson)*. When the plan says "Generated Code Viewer **and Editor**", the panel ships a textarea + write endpoint. When it says "Allow user edits", there is an interaction users can perform. Word-by-word audit of the plan's deliverable description: every verb maps to a real UI affordance and a Vitest test that exercises the affordance (not just that a button exists). The Phase 6 close shipped a list/action panel; "Edit" was prose, not a feature.

The full list of named patterns these checks defend against lives in `bugs_and_fixes/agent_error_patterns.md` (currently 45 patterns; the eight new ones from the Phase 6 audit are at the bottom: validation-runs-source-of-truth-not-artifact, validation-rule-fires-after-early-exit, client-supplied-actor-identity, diff-endpoint-doesnt-diff, archive-contains-its-own-destination, serializer-drops-semantic-fields, generator-skips-cleanup, ui-claims-editor-ships-viewer).

### Reality-test plan-derived patterns

Anything copied from `scientific_simulation_workbench_agent_plan.md` gets reality-tested before commit.

**Gitignore changes** — probe representative source paths:
```bash
for d in scripts/build scripts/dev scripts/test scripts/docs scripts/clean scripts/export \
         apps/workbench-ui/src/app packages/physics_modules/laser/src \
         packages/core/src/simworkbench docs_site/src/content; do
  if git check-ignore -q "$d/foo.tmp" 2>/dev/null; then
    echo "WARNING: $d/* matched by ignore rule"
    git check-ignore -v "$d/foo.tmp"
  fi
done
```
A `WARNING` line means the rule is too aggressive. Anchor it (`/build/`) or specialize it (`apps/*/build/`) until no warnings appear.

**Filenames** — when the plan suggests a filename and the plan's section title disagrees with the placeholder filename in §3, follow the section title. Document the divergence in the milestone file (and in `bugs_and_fixes/bugfixes.md` if the divergence was discovered through a bug, as happened with Phase 2–5 milestones).

**Directory entrypoints** — when you add a top-level package directory, you add its language entrypoint in the same commit:

| Directory pattern | Required entrypoints |
|---|---|
| `apps/<name>/` (TypeScript) | `package.json`, `tsconfig.json`, `src/app/page.tsx` (or equivalent) |
| `packages/core/` and `packages/<name>/` (Python package) | `pyproject.toml`, `src/<package>/__init__.py` |
| `packages/physics_modules/<domain>/<module>/` | `module.yaml`, `src/`, `tests/`, `README.md` |
| `packages/internal_tools/registry/<tool>/` | `tool.yaml`, `src/`, `tests/`, `README.md` |
| `docs_site/` | `package.json`, `tsconfig.json`, content files in `src/content/` |

The convention checker enforces these.

**Documented commands** — when you add a command path to docs, you create the script (or a stub) in the same commit:

```bash
#!/usr/bin/env bash
# scripts/dev/run_ui.sh
#
# Phase 1F — TypeScript workbench UI launcher.
# Implementation scheduled for Phase 1 / Workstream 1F.
echo "scripts/dev/run_ui.sh: scheduled for Phase 1 / Workstream 1F (UI Workbench)"
echo "See program_development/milestones/phase_01_manual_workbench.md."
exit 0
```

The stub exits 0 so the docs flow stays usable. Stubs become real implementations during the phase that owns them.

### Code-craft anti-patterns to grep before commit

Three small habits caught during the Phase 1A correction sweep. Run these checks as a pre-commit pass when you touch the relevant subsystems:

**1. Shallow-copied test fixtures.** A `data = dict(FIXTURE)` followed by `data["nested"] = [...]` mutates the fixture's nested list, polluting later tests:

```bash
# Should produce nothing — mutating tests must use deepcopy or fixture factories.
grep -nrE 'data\s*=\s*(dict\([A-Z_]+\)|\{\*\*[A-Z_]+\})' tests/
```

If anything matches, replace with `from copy import deepcopy; data = deepcopy(FIXTURE)` or refactor to a `pytest.fixture` factory.

**2. Module-level mutable singletons.** A pattern like `_REGISTRY = None` + `global _REGISTRY` in a factory function leaks state across tests and complicates patching. Prefer `@functools.lru_cache(maxsize=1)` on the factory:

```bash
# Hits warrant justification or replacement.
grep -nrE '^\s*global ' packages/core/src/
grep -nrE '^_[A-Z_]+\s*[:=]\s*(None|\{\}|\[\])' packages/core/src/
```

**3. Raw numbers crossing scientific boundaries through `dict[str, Any]` fields.** When you add or change a flexible-dict field at a ModelSpec or module boundary, ensure recursive validation rejects raw `int`/`float` and unitless numeric strings. Reference: `simworkbench.model_spec.types._validate_parameter_tree`. Pattern in negative tests:

```python
# tests/unit/test_<schema>.py — every flexible dict needs at least one of these.
def test_raw_float_rejected_in_<field>():
    with pytest.raises(ValueError):
        from_dict({..., "<field>": {"key": 42.0}})

def test_unitless_numeric_string_rejected_in_<field>():
    with pytest.raises(ValueError):
        from_dict({..., "<field>": {"key": "42"}})
```

A workstream that introduces a new flexible-dict field is not done until both negative tests exist and pass.

### When a checker assertion is wrong

The checker can be wrong (e.g. it asserts a file the plan no longer wants). When this happens, fix the **assertion** — do not delete the failing check to make the phase appear complete. If the plan and the checker genuinely disagree, file an ADR before changing either.

### Status-flip commit message template

```bash
git commit -m "$(cat <<'EOF'
Close Phase NN: <one-line summary of what's now true>

- README.md status: In progress → Complete.
- Milestone phase_NN_<name>.md: status header and Phase Gate boxes ticked.
- Timeline: dated entry with Completed / Changed / Open questions / Next steps.
- Convention checker: NN/NN passed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Autonomous Git Operations (Claude-Specific)

The user has authorized — durably, in this file and in `AGENTS.md` — autonomous commits and pushes for this repository. This authorization replaces the harness default of "always ask before committing or pushing" *for this repo only*. Other repositories require explicit approval as usual.

### TL;DR
- Commit after every meaningful unit of work.
- Push to `origin/<current-branch>` after every **major** change (definition below).
- Never force-push, never `--no-verify`, never stage secrets or artifacts, never amend.
- If anything is ambiguous, commit but hold the push.

### What counts as a "major change" — push immediately

Push as soon as any one of these is true:

| Trigger | Example |
|---|---|
| Workstream completed | "Phase 0 / Workstream 0B done" |
| Phase gate passed | "Phase 0 gate verified" |
| Bug fixed and logged | New entry in `bugs_and_fixes/bugfixes.md` |
| Module / tool status transition | `candidate → validated`, etc. |
| ADR change | Accepted, deprecated, or superseded |
| Milestone update | New phase started or completed |
| Multi-file diff | More than ~3 files of meaningful change, or crosses subsystem boundaries |
| User-visible feature | Shipped or removed |

Routine in-progress edits — single-file polish, typo fixes, partial work — get a commit but **wait on the push** until they bundle into a major change.

### What requires explicit user approval (never autonomous)

- Force-push (`--force`, `--force-with-lease`) to any branch.
- Rebase / amend that rewrites commits already on `origin`.
- `git reset --hard`, `git checkout --`, `git clean -f`, `git branch -D` (except for transient agent-created branches).
- Skipping hooks: `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`, etc.
- Committing files that may contain secrets: `.env`, `.env.*`, `*.local.yaml`, `*credentials*`, service-account JSON, anything with API keys. If such a file is in the diff, **stop and ask**.
- Pushing to a branch other than the current branch's tracked upstream.
- Creating, closing, merging, or commenting on PRs, issues, or releases. Use `gh` only when the user explicitly requests it.
- Tagging releases.

### The autonomous commit-and-push procedure

When a major change is ready:

1. **Verify the work**
   ```bash
   bash scripts/dev/check_repo_conventions.sh
   ```
   Run any tests relevant to the changed subsystem (Phase 1+ this means `scripts/test/<subset>.sh`).
   If anything fails, fix the root cause and re-verify. Never bypass.

2. **Inspect the diff**
   ```bash
   git status --short
   git diff --stat
   git diff
   ```
   Confirm there are no unintended changes, no secrets, no temp/cache/output artifacts. Confirm the convention checker is happy.

3. **Stage by explicit path** — never `git add -A` or `git add .`
   ```bash
   git add AGENTS.md CLAUDE.md scripts/dev/check_repo_conventions.sh   # example
   ```

4. **Commit with a HEREDOC** so the message body keeps its formatting and the co-author trailer survives:
   ```bash
   git commit -m "$(cat <<'EOF'
   Phase 0 complete: governance, docs skeleton, bug memory, dev history

   - Repository skeleton with .gitkeep markers (Workstream 0A).
   - Vite + React docs site with the ten content pages from §4.2 (0B).
   - bugs_and_fixes/ + agent_error_patterns and the first real bugfix (0C).
   - program_development/ with timeline, ADR-0001..0003, milestone stubs (0D).
   - Convention checker at scripts/dev/check_repo_conventions.sh (90 checks, gate green).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

5. **Verify the commit landed**
   ```bash
   git status
   git log -1
   ```
   If a pre-commit hook failed, the commit did *not* happen. Fix the underlying issue and create a NEW commit — never `--amend` after a hook failure.

6. **Push to origin's tracked branch**
   ```bash
   git push
   ```
   Plain `git push` is correct because every branch in this repo tracks its `origin/<name>` upstream. Do not pass `--force` or `--force-with-lease` autonomously.

7. **If `git push` fails because the remote moved ahead**
   - Pull with rebase: `git pull --rebase --autostash`.
   - Resolve any conflicts (do not discard upstream commits).
   - Re-run convention checker and tests.
   - Push.
   - If the rebase would rewrite commits already on origin, stop and ask the user.

8. **Update the timeline if milestone-relevant**
   Append an entry to `program_development/timeline.md` and include it in a follow-up commit (or in the same commit if it was prepared up-front).

### Commit message style

- Imperative subject ≤ 72 characters.
- Blank line, then a body explaining *why* the change exists. The diff already shows *what*.
- Reference the ADR / bugfix / workstream / milestone the commit corresponds to.
- One commit per logical unit. Do not pile unrelated changes into one commit; split with `git add -p` if needed.
- Always include the `Co-Authored-By:` trailer for the Claude model that did the work.

### When pre-commit or pre-push hooks fail

Fix the actual problem. Investigate, do not bypass. Hooks exist because someone (us) installed them deliberately. Bypassing a hook is the same category of mistake as lowering a validation tolerance — it makes the immediate problem disappear and pushes the cost to a future surprise.

### When in doubt

Commit locally, hold the push, and tell the user what you did and why you held back. The user can run a single `git push` to release the work, or course-correct the commit before it goes out. This is cheap; an erroneous push is not.

---

## Definition of Done (Claude-Specific)

A Claude task is done when, in addition to the `AGENTS.md` checklist:

- Default `scripts/dev/check_repo_conventions.sh` passes. If the task added or moved a deliverable named in the plan, README, milestone, or any docs page, the checker has been **extended** with a corresponding assertion — completed deliverables in default mode, open TODOs in `--include-open-workstreams`. It is not enough that the existing checks still pass.
- Every documented command path the change introduced exists on disk and is executable (real implementation or stub).
- Every plan-derived pattern (gitignore rule, filename, identifier) has been reality-tested per **Phase Gate Procedure → Reality-test plan-derived patterns**.
- If the task changed phase or module status, the status reads identically across `README.md`, the relevant milestone file, `program_development/timeline.md`, and any ADR / `module.yaml` / `tool.yaml` / docs page that names it. The status flip lands in a single commit.
- **For workstream-completion tasks**: every plan-named entity in `§Phase N → Workstream NX` has been enumerated, asserted in the convention checker, implemented, and tested. The milestone's Pre-gate hint list has been updated where it disagreed with the plan. Deferrals are named in the commit message with a corresponding failing opt-in assertion. Intentionally failing TODO assertions must not break `scripts/test/all.sh`.
- The "Code-craft anti-patterns to grep before commit" checks have been run when the diff touches their domains: deepcopy in test fixtures, no `global` on cached singletons, raw-number rejection in any new flexible-dict scientific field.
- The summary at the end of the response names the changed files and any decisions deferred to the user.
- Any new public API has a usage example in the relevant docs page.
- The change is committed. If it qualifies as **major** (per the criteria above), it has also been pushed to `origin`.
