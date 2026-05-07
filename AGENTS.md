# AGENTS.md — Operating Instructions for All Development Agents

This file is the canonical instruction set for autonomous and semi-autonomous coding, review, and documentation agents working in the **Scientific Simulation Workbench** repository. The full architectural design is in `scientific_simulation_workbench_agent_plan.md`. This file distills the durable rules that survive across phases.

`CLAUDE.md` duplicates these rules and adds operational specifics for Claude Code.

---

## Mandatory Repository Rules for Development Agents

1. **Documentation stays synchronized with code.** If behavior, configuration, APIs, simulation modules, build instructions, or capsule format change, update the relevant page in `docs_site/src/content/` and `README.md` *before* completing the task. If platform support, shell wrappers, path handling, filesystem behavior, compiler/runtime prerequisites, sandbox assumptions, or deployment probe requirements change, also update `docs_site/src/content/os_compatibility.tsx`, the workbench docs navigation metadata, and the README compatibility summary.

2. **Maintain program documentation inside `docs_site/`** as TypeScript/MDX-compatible pages accessible from the workbench UI. Do not duplicate documentation strings into the UI source — load from the canonical docs. The in-app docs browser uses `apps/workbench-ui/src/components/DocsViewer.tsx` metadata (`DOC_PAGE_META`, `DOC_SECTIONS`) for its searchable, collapsible sidebar; the standalone docs site uses `docs_site/src/pages/docsPages.ts` metadata. Update both whenever a docs page is added, renamed, or substantially repurposed. Documentation must read as a user/developer manual, not as phase/workstream closure notes or agent-only instructions.

3. **Maintain a root-level `README.md`** with build instructions, installation instructions, repository structure, development workflow, testing commands, and update procedures.

4. **Maintain `.gitignore`** so local cache directories, temporary simulation files, intermediate paper imports, generated run outputs, and local environment files are never committed.

5. **Keep temporary files local to the program installation directory.** Do not write program artifacts into arbitrary user directories. The allowed local-only roots are:
   - `local_cache/`
   - `temp_imports/`
   - `temp_runs/`
   - `simulation_capsules/`

   External writes (export of code, data, or report) only occur when the user explicitly exports a capsule.

6. **Maintain `bugs_and_fixes/`** with:
   - `program.log.example` (template — actual `*.log` files are ignored)
   - `bugfixes.md`
   - `known_failures.md`
   - `regression_tests.md`
   - `agent_error_patterns.md`

7. **Before modifying code related to an existing subsystem, inspect `bugs_and_fixes/`** for relevant historical bugs. Do not reintroduce known errors. If you fix a bug, log it in `bugfixes.md` and add or link a regression test.

8. **Maintain `program_development/`** with implementation timeline, development history, architectural decision records, and milestone phase notes.

9. **Generated scientific simulations must be inspectable, editable, modular, exportable, and reloadable**, and must be tied to explicit assumptions, units, parameters, and validation checks.

10. **Prefer precise validated modules over broad approximations.** Fast nonsense is still nonsense. If a coefficient or sub-model is missing, mark the run `exploratory` and surface the gap — do not silently invent values.

11. **The convention checker is the source of truth for repository health and completed deliverables.** The default `scripts/dev/check_repo_conventions.sh` mode is the hard gate and must stay green. Intentionally open workstream TODOs live behind `scripts/dev/check_repo_conventions.sh --include-open-workstreams`; that mode may fail by design and must not be wired into `scripts/test/all.sh`. A phase is complete only when the default checker exits zero and no relevant open-workstream TODO assertion remains failing. Markdown checkboxes are aspirational; checker assertions are enforced. See **Phase Gate Discipline** below.

12. **Documented commands must exist as executables.** Every script path mentioned in `README.md`, `CLAUDE.md`, `AGENTS.md`, or any docs page must be present on disk and executable, even before its subsystem is implemented. If the implementation is unavailable in the current environment, use a fail-closed stub that explains the blocker and exits non-zero. A docs reference and the corresponding command land in the same commit.

13. **Reality-test plan-derived artifacts.** The plan document is design, not implementation. Patterns copied from it (`.gitignore` rules, directory diagrams, filename templates, command lists) get reality-tested against the actual filesystem before commit — see `bugs_and_fixes/agent_error_patterns.md` "Treating the plan document as a check instead of as a draft".

14. **The plan's workstream description is the deliverable list — milestone Pre-gate hints are illustrative, never substitutive.** Before claiming a workstream done, enumerate every named class, file, module, script, config key, ADR, and test from `scientific_simulation_workbench_agent_plan.md` `§Phase N → Workstream NX` and confirm each is asserted in the convention checker and exists on disk. If the milestone Pre-gate hints disagree with the plan, the plan wins and the milestone is patched first. See `bugs_and_fixes/agent_error_patterns.md` "Implementing the agent's checklist instead of the plan's deliverable list".

---

## Secure Multi-User Development Requirements

These rules apply to every agent touching authentication, authorization, workspace isolation, audit logging, provenance actor tracking, execution sandboxing, approval workflows, capsule version protection, or any code under `packages/secure_core/`. Source: `secure_multi_user_scaffolding_plan_v4.md` §1.1.

All development agents must treat authentication, authorization, workspace isolation, audit logging, provenance actor tracking, execution sandboxing, approval workflows, and capsule version protection as first-class requirements.

Do not create global capsule, run, tool, or artifact endpoints.

Do not trust `id`, `user_id`, `actor`, `actor_id`, `actor_user_id`, `created_by`, `updated_by`, `approved_by`, `decided_by`, `workspace_role`, `role_id`, `workspace_id`, `created_at`, `updated_at`, `current_version_id`, `status`, `disabled_at`, `storage_path`, `assurance_level`, `auth_method`, or any `*_hash` field from request bodies at any nesting depth.

All actor fields must be derived server-side from authenticated session context.
Malformed authenticated context must fail closed; do not normalize `unauthenticated` or missing actor state into `human`, `operator`, or any other privileged actor type.

Protected JSON-body routes must run the audit-aware `validateInputSchema` / `bodyValidation` middleware. Do not rely only on Fastify `schema.body`; route body rejection must emit the security audit row and must run before handler logic.

Routes must accept workspace-scoped object references, not client-supplied storage facts. For capsules, tools, and artifacts, accept a server-resolved object id such as `source_artifact_id`, then derive `content_hash`, `storage_path`, and any status fields server-side.

All artifacts must be workspace-scoped under:

```text
workspaces/<workspace_id>/
```

Every protected object access must verify:

1. authenticated identity,
2. live workspace membership,
3. role or capability,
4. object belongs to workspace,
5. operation is valid for object state,
6. high-risk actions have valid approval,
7. high-risk actions re-check membership/capability at commit.

Read models that return current session or workspace membership state must preserve live memberships even when the role grants zero capabilities. Capability joins are left joins for membership listing; the capability set may be empty.

High-risk actions must carry an approval request id and consume the approval token through L2.9 before handler side effects. Mandatory privilege preconditions, including operator step-up authentication, must run before L2.9 consumes a single-use approval token. Services that mutate membership, roles, lifecycle status, or other privilege-bearing state must re-check the actor's live capability inside the transaction immediately before commit.

Worker and sandbox code that writes derived artifacts must reserve and commit quota for every written artifact, including extracted or generated byproducts. If any reservation, validation, or side effect cannot be completed, clean up every file created by the path and fail closed.

Security-sensitive code must not be implemented as permissive stubs. If authentication, authorization, audit logging, sandboxing, approval checks, or path isolation are incomplete, dependent endpoints must fail closed.

Never disable a security test to make CI green. Failing security tests block merge.

Layer-5 integration rules:

- `scripts/test/security.sh` is a hard PR gate and must stay directly invoked by `scripts/test/all.sh`; do not replace it with a package-level test that omits the security matrix.
- Every v4 §29 security assertion must have a literal `§29 #NN —` entry in `packages/secure_core/test/security/section29_coverage.test.ts`, with evidence that points at executable code, tests, docs, or CI.
- Security CI and local security gates must fail closed when production-secret-shaped environment variables are present. Use test fixtures or mock providers only.
- External audit anchors are not verified by local database rows alone. The verifier must compare `log_chain_anchors.external_anchor_uri` against the WORM provider object when a provider is configured.
- High-risk approval middleware must reject non-human actors before token consumption or handler side effects. Approval tokens do not make `ai_agent`, `worker`, or `operator` actors approvers.
- Branch-protection or emergency-operator override paths must emit `branch_protection.bypass` audit events; undocumented bypasses are security bugs.

Security summaries in this file must be reviewed at least once per major release or whenever the security scaffolding plan changes.

Until Phase 0.5 deployment-specific live probes are green in the target runtime, dependent features that require these guarantees must remain disabled or scoped to single-user local-only operation. The implementation plan, gates, and ADRs live at:

- `secure_multi_user_scaffolding_plan_v4.md` (design)
- `security_review_v4_and_decomposability.md` (review + decomposition)
- `program_development/phase_05_security_implementation_plan.md` (executable plan)
- `program_development/architectural_decisions/ADR-0008` through `ADR-0012` (Layer-0 decisions; Accepted)
- `program_development/architectural_decisions/ADR-0013-secure-multi-user-foundation.md` (Layer-5 security foundation; Accepted)
- `packages/secure_core/IMPLEMENTATION_MANIFEST.md` (project layout, error envelope, fixture conventions)

---

## Repository Architecture Rules

- **Languages**: Python for core/runtime/physics (`packages/core`, `packages/physics_modules`, `packages/solver_backends`); TypeScript for UI (`apps/workbench-ui`) and docs (`docs_site/`).
- **Packaging boundary**: a Python package and a TS package never import each other directly. They communicate via the documented HTTP/IPC API in `packages/core/.../api/`.
- **Module SDK**: physics modules and internal tools live under `packages/physics_modules/<domain>/<name>/` and `packages/internal_tools/registry/<name>/` respectively, each with `module.yaml` or `tool.yaml`, `src/`, `tests/`, `docs/`, `examples/`, `README.md`, `changelog.md`.
- **Capsules**: simulation outputs are isolated inside `.lxp/` capsule directories (see plan §7). Generated code lives in `<capsule>/src/generated/`; user-edited code in `<capsule>/src/user_edits/`. Agents never overwrite `user_edits/` silently.
- **No circular imports across phase boundaries.** The dependency direction is: `physics_modules → core`, `solver_backends → core`, `agent_orchestration → core`, `apps/workbench-ui → core` (via API), `docs_site` is standalone.

---

## Required Documentation Practices

- Every behavioral change updates the matching docs page (see plan §4.2 for the page list).
- Every new physics module and internal tool ships with a `README.md`, `assumptions.md` (or equivalent inline doc), input/output units, validity domain, at least one test, and at least one example.
- Every public Python function gets a docstring stating: purpose, inputs (with units), outputs (with units), assumptions, references.
- Every TypeScript public API gets a TSDoc block.

---

## Required Testing Practices

- New code lands with tests. The test layout is: `tests/{unit,integration,regression,validation,performance}`.
- Every bug fix adds or updates a regression test where feasible, linked from `bugs_and_fixes/bugfixes.md`.
- Validation tests assert scientific properties (dimensions, conservation, analytical limits, convergence, benchmark reproduction). Performance tests must not silently relax correctness tolerances.
- **Test fixtures are deep-copied when mutated.** A module-level dict like `MINIMAL_SPEC = {...}` is shared across tests. Any test that derives a variant must use `copy.deepcopy(FIXTURE)` — never `dict(FIXTURE)`, `{**FIXTURE}`, `FIXTURE.copy()`, or list-slice copies — because those leave nested lists/dicts shared, and the next test inherits the pollution. Better: factory functions or `pytest.fixture` with `scope="function"`. See `bugs_and_fixes/agent_error_patterns.md` "Shallow-copying a mutable test fixture".
- **Test wrappers prefer the repo virtualenv.** `scripts/test/*.sh` resolve a Python interpreter in the order `SIMWORKBENCH_PYTHON` → `.venv/bin/python` → bare `python`. Tests must run from a clean shell without manual `source .venv/bin/activate`.
- **Cross-shell launchers keep parsing in Python.** Dev entrypoints that need passthrough arguments should delegate to a Python launcher rather than owning Bash arrays or shell-specific parsing. Bash 3 with `set -u` treats empty array expansion as unbound, so wrappers must pass `"$@"` to the launcher and regression-test the no-extra-args path.

---

## Code Style and Module Boundaries

- Python: type hints on all public APIs; `ruff` clean; explicit error handling at boundaries; no bare `except`.
- TypeScript: strict `tsconfig`; no `any` in exported types.
- **Hard rules belong inside the function, not as a caller-controlled flag.** A library may keep a `_for_tests=True` kwarg, but API endpoints hard-code the rule's positive form and UI controls never expose toggles for security checks. See `agent_error_patterns.md` "Hard rule made optional via a client-controlled API parameter".
- **TypeScript API client types mirror FastAPI body schemas one-to-one.** Every new endpoint adds the matching `*Body` / response interface in `apps/workbench-ui/src/api/client.ts` first; UI components import the type, never call `fetch` directly. Drift here corrupts boundary validation parity.
- **Endpoints named after a transformation perform that transformation server-side.** `/diff` returns `{added, removed, changed, unchanged}`, not `{previous, current}`. `/preview` shows what would happen, not what already happened. The matching test asserts non-trivial output, not key-presence. See `agent_error_patterns.md` "Diff endpoint that doesn't compute a diff".
- **Validators consume the artifact named in their function.** A `Validate*Runner` for a generated file imports/parses/exec's THAT file, not the upstream source. Negative regression test: corrupt the artifact and assert the validator reports `failed` (not `passed`/`incomplete`). See `agent_error_patterns.md` "Validation runs the source-of-truth, not the generated artifact".
- **Loop-validators run their checks BEFORE any `continue`/`break`/`return` skips.** Inputs the early-exit covers still get validated. Negative test: send the input the early-exit covers and assert the validator still raises. See `agent_error_patterns.md` "Validation rule fires after a permissive early-exit".
- Units are first-class. No raw floats for physical quantities crossing module boundaries — use the units subsystem (`packages/core/src/simworkbench/units/`).
- Flexible `dict[str, Any]` fields at scientific boundaries (`fields.initialization`, `interactions.valid_regime`, etc.) require recursive validation that rejects raw numbers and unitless numeric strings. See `bugs_and_fixes/agent_error_patterns.md` "Letting `dict[str, Any]` bypass scientific boundary validation".
- Cached singletons use `@functools.lru_cache(maxsize=1)` on a factory function, not `global` declarations on module-level mutable state. See `bugs_and_fixes/agent_error_patterns.md` "Module-level mutable state for cached singletons".
- Module boundaries are enforced by the registry. New cross-module coupling requires an ADR in `program_development/architectural_decisions/`.

---

## Bug Memory and Regression Prevention

- Before editing a subsystem, `grep` the relevant subsystem path inside `bugs_and_fixes/` to check for prior bugs.
- After fixing a bug, append to `bugfixes.md` using the template in plan §5.1 (date, subsystem, symptoms, root cause, fix, regression protection, agent warning).
- Patterns of repeated agent mistakes go in `agent_error_patterns.md`.

---

## Safety Limits for Generated Scientific Code

- Generated code must declare its assumptions, units, validity regime, and source paper.
- Generated code never replaces a validated solver call with a naive timestep loop without an explicit ADR.
- Generated coefficients must be sourced. Missing data is reported, never fabricated.
- Generated code is placed inside a capsule sandbox (`<capsule>/src/generated/`). Promotion to a registry module requires validation evidence and human approval.
- **Mixed-shape review rules cover every shape.** When a rule applies across structured rows + Markdown + binary, the check has a branch per shape. Markdown's review marker is the absence of the "AGENT DRAFT — needs human review" banner; rows have an `edited_by` field. See `agent_error_patterns.md` "Validating one input shape but not all input shapes".
- **Producer / consumer defense-in-depth on cross-cutting predicates.** When component A computes a predicate (e.g. `ModuleMatch.is_compatible`) and component B consumes it (e.g. `GapAnalyzer.missing_modules`), B independently re-derives the predicate rather than trusting A's signaling. Both layers carry the rule. See `agent_error_patterns.md` "Compatibility checks that pattern-match instead of validating dimensionality".
- **Cross-cutting "always-on" prose has a regression test.** Any rule of the form "X must hold whenever Y" gets a test that reads the relevant state and fails when the invariant drifts. Prose without a test ages into a lie. Example: `tests/regression/test_security_sandbox_enforcement.py`.
- **Privileged checks derive identity server-side, not from a request body.** The HTTP API never reads `actor`, `role`, `user`, or any privilege claim from JSON. Privileged transitions require an out-of-band approval token (e.g. `simworkbench.tools.grant_approval` writes a single-use file under `local_cache/tool_approvals/`). The endpoint consumes the token and refuses without it. See `agent_error_patterns.md` "Trusting a client-supplied actor identity for a privileged check".
- **Exporters validate destination outside source BEFORE writing.** Any exporter that walks a tree refuses a target inside the source. Defense-in-depth: also exclude the in-flight archive from the rglob walk. Regression test: target = `<source>/exports/<x>.zip`; assert refusal AND assert the resulting archive doesn't contain itself. See `agent_error_patterns.md` "Archive contains its own destination".
- **Canonical-format serializers preserve every semantic field.** When format A is the canonical store and format B is a sidecar, every field present in B is present (in equivalent shape) in A. List of strings → vlen-string array, not bool. Cross-format parity test: write canonical-only, read back, every documented field round-trips. See `agent_error_patterns.md` "Serializer drops semantic fields when writing the canonical format".
- **Regenerate-in-place writers list and clean orphans.** Every "regenerate" / "rewrite" code path tracks the prior manifest's file set, computes `(prior - current)`, and removes orphans through the same sandbox that gates writes. Regression test: generate, mutate spec to drop an artifact, regenerate, assert the artifact no longer exists AND appears in `result.removed_files`. See `agent_error_patterns.md` "Generator skips cleanup, leaving stale artifacts".
- **Plan verbs map to UI affordances, not just buttons.** When the plan says "Editor", the panel ships a textarea + write endpoint and a Vitest test that exercises the editor (saves a file, asserts the response path). Word-by-word verb audit at close time. See `agent_error_patterns.md` "UI calls itself an editor while shipping a viewer".
- **The hard-gate test runner runs the typechecker.** `scripts/test/all.sh` invokes `scripts/test/ui.sh` (or any per-language equivalent), which runs `tsc --noEmit` BEFORE the unit-test runner. Vitest does not typecheck — esbuild/swc strips types. A type error in a UI component referencing a renamed API field will pass `vitest run` and break `tsc`; without the explicit typecheck step in the gate, the bug ships. See `agent_error_patterns.md` "Test gate runs unit tests but not the typechecker".

---

## Adding Internal Tools and Simulation Modules

- Use the templates in `packages/internal_tools/templates/` and `packages/physics_modules/templates/`.
- Lifecycle: `draft → candidate → validated → trusted → deprecated`. Agents may create `draft` and `candidate` only. Promotion to `trusted` requires a human reviewer.
- Promotion criteria are in plan §14.3.
- Lifecycle promotion gates must live in the registry/library function that mutates `tool.yaml` or `module.yaml`, not only in an API wrapper. For physics modules, `candidate → validated` requires a single-use human approval token, benchmark artifacts listed in `module.yaml`, declared tests that exist, and a passing test run before the status field is rewritten. Do not expose public `skip_approval`, `consume_approval=False`, `run_tests=False`, or similar bypass flags on lifecycle mutators.
- Plan-named module families must be enumerated exactly before a phase/workstream is closed. Do not collapse a named family into one "reference module" unless the deferral is explicit in the milestone and encoded as an opt-in TODO assertion.

---

## File Locality

- Imported papers, datasets, and tools are copied into local project-controlled directories before use:
  - papers → `temp_imports/papers/` then capsule `paper_sources/`
  - imported tools → `local_cache/imported_tools/`
  - run artifacts → `temp_runs/<run_id>/` and the owning capsule
- Agents must not write outside these roots without an explicit export step initiated by the user.

---

## Program Development History

- Major implementation work appends an entry to `program_development/timeline.md` (date, completed, changed, open questions, next steps).
- Architectural decisions get an ADR (see plan §6.2) numbered sequentially in `program_development/architectural_decisions/`.
- Milestone phase completions update `program_development/milestones/phase_NN_*.md`.

---

## Explicit Warnings Against Reproducing Already-Fixed Bugs

- The most common agent failure is removing a defensive check or rewriting validated code with a "simpler" version that loses an invariant. Read the surrounding tests and `bugs_and_fixes/bugfixes.md` first.
- Do not "clean up" or "simplify" code in `validated`/`trusted` modules without an ADR.
- Do not change tolerances in validation tests to make them pass. Investigate the root cause.
- Do not switch backends to make a number look better. Backend choice never silently changes physics.
- Registry discovery must not hide invalid `module.yaml` / `tool.yaml` by silently skipping bad files. Bad metadata is a failed gate, not an absent module.
- Do not promote a module by trusting `actor="human"` or any other caller-supplied identity. The mutating registry path must consume server/local approval evidence itself.
- Do not let stale metadata point at missing tests or benchmarks. Every path declared in `module.yaml` is part of the public contract and must resolve during promotion checks.
- Do not preserve deprecated phase-state behavior after later phases ship. Current commands, runtime errors, UI copy, and docs must describe the present contract; old "lands in Phase N", "pending", or success-exiting "not implemented" stubs are bugs. See `agent_error_patterns.md` "Deprecated phase-state contract survives after later phases ship".

---

## Phase Gate Discipline

Phase 0 was initially marked complete with stale README status, missing package manifests, missing milestone files, and missing documented scripts. The bug is logged in `bugs_and_fixes/bugfixes.md` (2026-05-02 — *Phase 0 gate false positive*). The rules below exist so that mistake does not recur.

### A phase gate has three independent checks

A phase is genuinely complete only when **all three** of the following are true:

1. **Default convention checker is green.** `scripts/dev/check_repo_conventions.sh` exits zero. Every completed plan-named deliverable, every documented command path, every milestone filename, and every package entrypoint has a corresponding hard-gate assertion.
2. **Status is synchronized everywhere.** The phase status reads identically in `README.md`, `program_development/milestones/phase_NN_*.md`, and `program_development/timeline.md`. (Add: any ADR Status field, any `module.yaml` / `tool.yaml` lifecycle field, any `docs_site/src/content/*.tsx` page that names the status.) Status flips happen in **one commit** that touches every place the status is mirrored.
3. **Deliverables-to-checker mapping is complete.** Every deliverable listed in the milestone file's Phase Gate, the relevant plan section, and the `README.md` status table has at least one checker assertion. Completed deliverables are hard-gate assertions. Open deliverables are opt-in assertions under `--include-open-workstreams` until implemented, then promoted to the default gate before the workstream is claimed complete.

### When starting a phase

The first action of any agent opening a new phase is to extend the convention checker:

1. Read the plan section for that phase, the milestone file, and the README sections it touches.
2. List every deliverable: package manifests, source entrypoints, documented commands, configs, ADRs, milestone files, docs pages, examples, tests.
3. For each open deliverable, add an assertion to the `--include-open-workstreams` section of `scripts/dev/check_repo_conventions.sh` (file exists, executable, contains required pattern, does not collide with `.gitignore`, etc.).
4. Run `scripts/dev/check_repo_conventions.sh --include-open-workstreams`; that opt-in mode fails after this step — that is correct. The default checker must still pass unless a completed invariant regressed.
5. Implement the work. As deliverables are completed, move their assertions into the default gate or otherwise ensure the default checker owns them before claiming the phase complete.

### When starting a workstream

A workstream is the smallest unit a phase can claim "done" against. The Phase 1A bug came from declaring Workstream 1A done after implementing only one of its six named classes — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 1A/1B gate overstated implementation completeness*. To prevent recurrence:

1. Open `scientific_simulation_workbench_agent_plan.md` and locate `## Phase N` → `### Workstream NX:`. Read the entire bullet list.
2. Enumerate every named entity — every class name, file path, config key, script, ADR, test, and example. Treat each as one row of the deliverable table.
3. Cross-check against the milestone's `Pre-gate verification → Convention-checker assertions to add` list. If the milestone is missing an entity from the plan, **update the milestone first** in a single small commit before any code lands. The milestone hints must reflect the plan's deliverable list, not the agent's mental model.
4. For every open entity, add or extend a `scripts/dev/check_repo_conventions.sh --include-open-workstreams` assertion. Prefer one assertion per named entity rather than one assertion for the whole directory. Do not add intentionally failing TODO assertions to the default checker.
5. Run `scripts/dev/check_repo_conventions.sh --include-open-workstreams` — it should fail loudly with one failure per missing entity. Run the default checker too; it must stay green.
6. Workstream done = every plan-named entity has a green default-gate assertion AND a unit test (or an explicitly-deferred-to-named-followup with an opt-in checker assertion that fails until resolved).

This sequence is mandatory. The illustrative starting-point hints in the milestone Pre-gate sections are exactly that — starting points. They cannot replace the plan's enumerated workstream description.

### When closing a phase

Before flipping any phase status to "Complete":

1. Run `scripts/dev/check_repo_conventions.sh` and confirm zero failures.
2. Run `scripts/dev/check_repo_conventions.sh --include-open-workstreams` and confirm no TODO assertion remains for the phase being closed.
3. Run any subsystem tests relevant to the phase.
4. Audit status references with a single grep:
   ```bash
   grep -nE "Phase NN" README.md program_development/milestones/phase_NN_*.md program_development/timeline.md
   ```
   Confirm every match agrees with the new status. **Read every match the grep returns**, not just the first paragraph — the same status is often mirrored in a banner *and* a status table within the same file.
5. Commit the status flip in one commit that touches all status-bearing files at once.
6. Push (this is a major change per **Autonomous Git Operations**).
7. Grep current user-facing surfaces for stale phase-state claims before the close commit:
   ```bash
   grep -RInE "currently active|Pending\\.|not implemented yet|scheduled for Phase|lands in Phase|wait for Phase|Phase 0 placeholder|skeleton" README.md CLAUDE.md docs_site/src/content apps packages scripts | grep -v "program_development/milestones" || true
   ```
   Historical ADR/timeline/milestone text may remain historical, but current commands, runtime errors, UI copy, and README/docs examples must not describe a deprecated phase state.

### Behavioral verification — the lesson of the Phase 2 + 3 + 4 + 5 closes

Existence checks (steps 1–6 above) are necessary but not sufficient. The convention checker proves files exist. It does not prove that the phase gate's *behaviors* work. Phases 1, 2, 3, 4, and 5 each shipped an incomplete close (Phase 4 twice; Phase 5 once) because the agent confused "all entities exist" or "the gate verb is satisfied" with "the plan's deliverable list is met". Add these sixteen behavioral checks before any close commit:

1. **End-to-end gate walk.** Each plan §Phase-N gate criterion exercised on a real artifact. For "portable, inspectable, reloadable, exportable": save → load → run → export → fork → reload, each step a separate integration test.
2. **Documented scripts run.** `grep -rn "scheduled for Phase" scripts/` returns no current entrypoint stubs. Every script the README/CLAUDE.md/docs page advertises as runnable either runs successfully on a typical input or fails closed with a documented environment/deployment blocker.
3. **Producer-writer wiring.** Every writer that landed in this phase appears in the producer's call site. Round-trip the producer's output through the writer's `load_*` to catch hand-rolled equivalents that bypass the new writer.
4. **Validator field parity.** Every new producer output has a matching validator required-field. Diff the validator's `REQUIRED_FILES` and the producer's outputs in the same review.
5. **Destructive-after-validate in exporters / registries.** Every exporter validates the entire plan before any `rmtree` / `unlink` / write. Tests assert source-survival on self-export. Same rule for registry mutations: `register_from_template`, `set_status`, etc. validate user-controlled names BEFORE any filesystem touch.
6. **UI panels actually render.** Every UI panel that promises to show X has a Vitest test that mounts the component, mocks the backend, and asserts X is in the rendered output.
7. **Status-sync grep reads every match.** When `grep -nE "Phase NN"` returns multiple lines in the same file (banner + table), read all of them.
8. **Build scripts succeed and emit no source-tree artifacts.** `scripts/build/*.sh` exit 0; `find apps/*/src docs_site/src -name '*.js' -o -name '*.d.ts'` is empty afterwards.
9. **Gate-clause verb walk** *(Phase 3 false-close lesson)*. Read the plan's `## Phase Gate` paragraph for the phase. Extract every **verb**. For each verb, confirm three things: (a) a real implementation, (b) a user-facing surface (UI button / API endpoint / library function), (c) an end-to-end test in `tests/integration/test_phase_N_gate_walk.py` that exercises the verb on a real artifact, with at least one negative case. Existence checks 1–8 don't catch missing verbs because the verbs aren't entities; they're operations. The gate-walk file makes them first-class.
10. **Workstream task-bullet walk** *(Phase 4 audit lesson)*. The verb is one level of granularity; each `### Workstream NX → Tasks:` bullet is finer. Copy the entire bullet list from plan §Phase N / NX into a checklist; tick each bullet only when an artifact + test ships. Phase 4's "import" verb expanded into six task bullets (Import PDFs, Store, Extract text, Extract tables, Extract figures, Preserve source). Two shipped; the close still felt complete because the verb did. The gate-walk test asserts each bullet's artifact lands on disk — not just that the verb works.
11. **Boundary validation parity** *(Phase 4 audit lesson)*. For every API endpoint that accepts user input, send `""`, `" "`, `"\t"`, malformed types, missing fields. Each must return 400; provenance/state must remain unchanged. UI validation is necessary but never sufficient — every layer that accepts an input must validate it. Library functions get the same rule: a public method called by the API rejects the same inputs the API would reject.
12. **Success path runs, not just the structured failure** *(Phase 4 audit round 2)*. For every "supports X" claim, three things must land: (a) the dep is installed (`pyproject.toml` + `scripts/dev/install.sh` + a probe `.venv/bin/python -c "import <dep>"`), (b) the structured exception propagates to the user (every `raise <Error>` has a matching `try / except` at the API boundary AND a test asserting the documented status code, NOT a 500), (c) a happy-path test exercises the success path with a real fixture (hand-roll the smallest valid binary fixture if needed). The structured failure path being complete is necessary but not sufficient — the success path must run.
13. **Hard rules don't take a client-controlled flag** *(Phase 5 audit lesson)*. A "must hold" rule is enforced inside the library, not by trusting a request-body field. The API endpoint hard-codes the rule's positive form; UI does not expose a bypass toggle. Library may keep a `_for_tests=True` kwarg. Negative regression test sends the bypass attempt and asserts the rule still fires.
14. **Mixed-shape rules cover every shape** *(Phase 5 audit lesson)*. When a rule applies across a union of shapes (rows + Markdown + binary), the check has a branch per shape. Markdown's review marker is the absence of an "AGENT DRAFT — needs human review" banner; structured rows have an `edited_by` field; binary blobs have their own marker.
15. **Compatibility checks compare against the consumer's contract** *(Phase 5 audit lesson)*. Don't accept "parses cleanly" or "is non-empty" as compatibility. Compute the consumer's required shape (dimensions, schema, port set) and check coverage of THAT.
16. **Cross-cutting "always-on" prose has a regression test** *(Phase 5 audit lesson)*. Each cross-cutting invariant ("always-on", "must be enabled", "always required") has a regression test that reads the relevant state and fails when the invariant drifts. Prose without a test ages into a lie.

The named patterns each of these defends against live in `bugs_and_fixes/agent_error_patterns.md`. Keep that file current whenever a repeated agent failure appears; recent patterns include security context normalization, production-secret CI leakage, zero-capability membership joins, and deprecated phase-state contract drift.

### When a checker assertion is wrong

The checker can be wrong (e.g. asserts a file that the plan no longer wants). When you discover this, fix the **assertion** — do not mark the phase complete by removing the failing check. Removing a check to silence a failure is the same category of mistake as lowering a validation tolerance. If the plan and the checker genuinely disagree, file an ADR before changing either.

### Aspirational documentation is forbidden

A "complete" status anywhere in the repository asserts that the artifacts described actually exist. If you find a file claiming completion that the artifacts do not support, the file is wrong — fix it, and log the drift in `bugs_and_fixes/bugfixes.md` so future agents see the precedent.

---

## Autonomous Git Operations

Agents working in this repository are **authorized to commit and push without per-action user approval**, subject to the rules below. This is a durable authorization recorded here in `AGENTS.md` and in `CLAUDE.md` — it overrides the default "always ask before pushing" behavior of coding-agent harnesses *for this repository only*.

### What agents must do

After completing a meaningful unit of work, agents commit. After a *major* change, they also push to `origin` on the current branch.

A change is **major** — and warrants an immediate push — if any of the following are true:

- A workstream within a phase is completed (e.g. "Phase 0 / Workstream 0B done").
- A phase gate is passed.
- A bug is fixed and logged in `bugs_and_fixes/bugfixes.md`.
- A module or tool transitions status (`draft → candidate → validated → trusted → deprecated`).
- An ADR is added, accepted, deprecated, or superseded.
- The diff spans more than three files of meaningful change, or crosses subsystem boundaries.
- A milestone file or `program_development/timeline.md` entry is added.
- A user-visible feature is shipped or removed.

Routine tweaks (typo fixes, single-file polish, in-progress edits) commit but do not necessarily push immediately — batch them under the next major push so the remote history remains a useful changelog.

### What agents must not do without explicit user approval

- Force-push of any kind (`--force`, `--force-with-lease`) to any branch.
- Destructive rewrites of published history (interactive rebase that drops or edits commits already on `origin`).
- Skipping hooks (`--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`).
- Committing files that might contain secrets — `.env`, `*.local.yaml`, credential files, API keys, service-account JSON. If such a file appears in the diff, stop and surface it.
- Committing tracked artifacts the convention checker forbids (logs, simulation outputs, capsule contents).
- Deleting branches (`-D`, `-d`) other than transient agent-created branches the agent itself created in the same session.
- Pushing to a branch other than the current branch's tracked upstream.
- Creating, closing, or commenting on PRs, issues, or releases — these are user actions.
- `git reset --hard`, `git checkout --` of files with uncommitted user work, or any operation that throws away work without it being recoverable.

### Commit and push hygiene

- Stage specific files by path. Never use `git add -A` or `git add .` — those are how secrets and stray artifacts slip in.
- Before committing, run the default convention checker (`scripts/dev/check_repo_conventions.sh`) and the tests relevant to the touched subsystem. If either fails, fix the underlying problem before the commit. If the diff changes open workstream planning or TODO assertions, also run `scripts/dev/check_repo_conventions.sh --include-open-workstreams` and verify the failure list is intentional and documented. Do not bypass.
- Commit messages are imperative, ≤ 72 characters in the subject, with a body explaining *why*. Reference the ADR, bugfix entry, workstream ID, or milestone where relevant.
- Always create a new commit rather than amending — amending after a hook failure modifies the wrong commit and risks losing work.
- The `Co-Authored-By:` trailer for the Claude model that did the work is required.
- After a successful push, update `program_development/timeline.md` if the change is milestone-relevant.

### When pre-commit or pre-push hooks fail

Fix the underlying issue and create a new commit. Never use `--no-verify`. The hook is a defensive check installed deliberately — bypassing it is the same class of mistake as lowering a validation tolerance to make a test pass.

### When in doubt

If the action being taken is described above as "must not do without explicit user approval", or if the agent is uncertain whether a change qualifies as major, the agent commits locally but waits to push. The user can always trigger the push later.

---

## Agent Definition of Done

A task is done when:

1. Code changes complete.
2. Tests added or updated.
3. Tests run, or it is documented why they were not.
4. Documentation updated.
5. `README.md` updated if build/usage changed. Status fields agree with `program_development/milestones/` and `timeline.md` per **Phase Gate Discipline**.
6. `bugs_and_fixes/bugfixes.md` updated if bug-related, with a regression-test reference in `regression_tests.md`.
7. `program_development/timeline.md` updated if milestone-relevant.
8. No local temp/cache/generated files staged.
9. Generated code remains inspectable, with units and assumptions surfaced.
10. Default convention checker (`scripts/dev/check_repo_conventions.sh`) passes. If the task added or changed a deliverable that the plan, README, or any milestone references, the checker has been **extended** to assert that deliverable — completed deliverables in default mode, open TODOs in `--include-open-workstreams`.
11. Every documented command path the change introduced exists on disk as an executable (or stub). Every plan-derived pattern (gitignore rule, filename, identifier) has been reality-tested.
12. **For workstream-completion tasks**: every plan-named entity in `§Phase N → Workstream NX` has been enumerated, asserted in the checker, implemented, and tested. The milestone's Pre-gate hint list has been updated where it disagreed with the plan. If any entity was deferred, the deferral is named in the commit message and an explicit opt-in follow-up checker assertion encodes the deferral. Intentionally failing TODO assertions must not break `scripts/test/all.sh`.
13. **`LIMITATIONS.md` is current** if the change shipped a capability, promoted a module/backend/tool to `validated` / `trusted`, removed a claimed feature, or otherwise altered what a user can do today. The dated header at the top is bumped in the same commit. Routine bug fixes / refactors / test additions do NOT update LIMITATIONS.md.
14. **`STYLING.md` is consulted** before any UI styling change, and updated when the change adds a new design token, primitive component, layout pattern, or shifts an existing visual contract. UI styling lives in `apps/workbench-ui/src/styles.css` only — no Tailwind, no per-component CSS files, no inline color literals. The shared `Card` / `Pill` / `Kpi` / `FolderBrowser` primitives are composed; new panels do not re-invent their shapes.
15. The change is committed. If the change is *major* (per the criteria in **Autonomous Git Operations** above), it has also been pushed to `origin`.
