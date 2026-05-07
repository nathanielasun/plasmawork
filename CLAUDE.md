# CLAUDE.md — Claude Code Operating Manual

This file is the Claude Code runbook for the **Scientific Simulation Workbench** repository.

`AGENTS.md` is the source of truth for durable policy. `CLAUDE.md` is the executable operating guide: commands, procedures, close gates, and Claude-specific Git behavior. If the two drift, obey `AGENTS.md` for rules and patch this file to match.

---

## 1. Non-Negotiable Repository Rules

Treat these as load-bearing. Do not reinterpret them because a local task seems small.

### Documentation and repository structure

1. Keep documentation synchronized with code. Any change to behavior, configuration, APIs, simulation modules, build instructions, or public workflow must update:
   - the relevant `docs_site/src/content/<page>` file;
   - `README.md`;
   - the in-program docs viewer when applicable.
2. Maintain documentation as TypeScript/MDX under `docs_site/`. The in-program docs viewer uses the searchable, collapsible sidebar metadata in `apps/workbench-ui/src/components/DocsViewer.tsx` (`DOC_PAGE_META`, `DOC_SECTIONS`), and the standalone docs site uses `docs_site/src/pages/docsPages.ts`; update both metadata maps whenever docs pages are added, renamed, or substantially repurposed. Docs content should read as a user/developer manual, not as phase/workstream closure notes or agent-only instructions.
3. Maintain a root-level `README.md`.
4. Maintain `.gitignore`. Never commit local caches, temp simulation files, intermediate imports, generated outputs, `.env` files, or secrets.
5. Maintain `bugs_and_fixes/` and `program_development/`.
6. Every documented command path in `README.md`, `CLAUDE.md`, `AGENTS.md`, or docs pages must exist on disk and be executable. If the subsystem is not implemented yet, add an executable stub in the same commit as the doc reference.

### Scientific and simulation boundaries

7. Generated scientific simulations must be inspectable, editable, modular, exportable, reloadable, and tied to explicit assumptions, units, parameters, and validation checks.
8. Prefer validated modules over broad approximations. If a coefficient, equation, source, unit, or validity regime is missing, report the gap; do not fabricate.
9. At scientific boundaries, reject raw floats and unitless numeric strings inside flexible fields such as `dict[str, Any]`, `fields.initialization`, and `interactions.valid_regime`. Use recursive validators.
10. Generated code belongs in `<capsule>/src/generated/`; user edits belong in `<capsule>/src/user_edits/`. Never overwrite user edits.
11. Capsule provenance is append-only after completion. To rerun with changes, fork the capsule.

### Gates, checkers, and lifecycle mutations

12. `scripts/dev/check_repo_conventions.sh` is the hard gate for repository health and completed deliverables. It must stay green.
13. `scripts/dev/check_repo_conventions.sh --include-open-workstreams` is the opt-in TODO gate for open work. It may fail by design and must never be wired into `scripts/test/all.sh`.
14. Reality-test plan-derived artifacts. The plan is design; the filesystem is truth.
15. The plan's `§Phase N → Workstream NX` description is the deliverable list. Milestone pre-gate hints are only prompts; enumerate the plan's full bullet list before claiming completion.
16. Lifecycle promotion gates live at the mutation boundary. Registry methods that rewrite `tool.yaml`, `module.yaml`, backend metadata, or lifecycle state must enforce human approval, scientific evidence, declared test existence, and test execution. UI/API checks may call the registry gate; they are not the gate.
17. Public lifecycle mutators must not expose bypass flags such as `skip_approval`, `consume_approval=False`, `run_tests=False`, or equivalents.
18. Registry discovery must fail loudly on invalid metadata. A broken `module.yaml` or `tool.yaml` must produce a path-specific parse error, not disappear behind a silent skip.
19. Plan-named families are enumerated exactly. A single reference module does not satisfy a family unless the deferral is explicit and pinned by a failing opt-in checker assertion.

### Code-craft invariants

20. Mutating tests must deep-copy fixtures. `data = dict(FIXTURE)` is a trap; use `copy.deepcopy` or fixture factories.
21. Avoid module-level mutable singleton caches. Use `@functools.lru_cache(maxsize=1)` on factory functions instead of `global` state.
22. Validators named after an artifact must consume that artifact. `validate_generated_code` imports, parses, or executes generated code; it does not merely reload the upstream spec.
23. Loop-based validators run contract checks before any `continue`, `break`, or `return` that would skip inputs.
24. Endpoints named after operations must perform those operations. `/diff` returns a real diff; `/preview` returns a future-state preview; `/validate` validates the named artifact.
25. Exporters that walk a tree validate the target is outside the source before writing and exclude in-flight archives from the walk.
26. Regenerate-in-place writers must delete orphaned prior outputs through the same sandbox that gates writes.

---

## 2. Standard Commands

Do not invent command names. If a command is documented and missing, create an executable stub in the same commit as the documentation reference.

### Local development

```bash
# One-time install: Python core + UI
scripts/dev/install.sh

# Run the TypeScript workbench UI
scripts/dev/run_ui.sh

# Run the Python backend / API server
scripts/dev/run_backend.sh

# Run the docs site
scripts/docs/dev.sh
```

### Python package REPL

```bash
cd packages/core
python -m pip install -e .
python -c "import simworkbench; print(simworkbench.__version__)"
```

### Tests

```bash
# All tests
scripts/test/all.sh

# Subsets
scripts/test/unit.sh
scripts/test/validation.sh
scripts/test/regression.sh

# Specific Python test file
pytest tests/unit/test_modelspec.py -x -v

# UI tests
cd apps/workbench-ui && npm test

# UI typecheck; Vitest is not a typechecker
bash scripts/test/ui.sh
# or
npm --prefix apps/workbench-ui run typecheck
```

### Security checks

```bash
scripts/test/security.sh
scripts/dev/check_repo_conventions.sh
scripts/dev/check_workspace_paths.sh
scripts/dev/check_security_headers.sh
scripts/dev/check_security_schema.sh
```

Current status:

- `scripts/dev/check_repo_conventions.sh` exists and is the hard gate.
- `scripts/test/security.sh` runs the §29 spec-level invariants under `packages/secure_core/test/security/` (always-on); live-runtime gVisor / DB / S3 probes are env-gated for the dedicated CI lane.
- `scripts/dev/check_workspace_paths.sh`, `scripts/dev/check_security_headers.sh`, and `scripts/dev/check_security_schema.sh` are reserved command contracts; create them with their owning follow-up layers.

---

## 3. Common Gotchas

- `python3 -m venv .venv`: uv is not used. Default to `.venv/bin/python` and `.venv/bin/ruff`.
- `yaml.safe_dump` writes list items with 2-space indentation, not 4. Round-trip through `yaml.safe_load` and `yaml.safe_dump`; do not string-replace `"\n    -"`.
- FastAPI request-body Pydantic classes must be at module scope. Classes inside `create_app()` can trigger 422 “missing field” failures.
- Vitest + React 18 StrictMode renders components twice. Prefer `screen.getAllByText("X")` or scope with `within(...)`.
- Every new FastAPI endpoint adds matching types to `apps/workbench-ui/src/api/client.ts` before UI code uses it. UI components import the typed client; they do not call `fetch` directly.
- Use `tsc --noEmit && vite build`, not `tsc -b`, because `tsc -b` can leak `.js` and `.d.ts` into `src/`.
- Read the latest 4–8 entries in `bugs_and_fixes/agent_error_patterns.md` before any close commit. Six consecutive phases shipped incomplete closes; yes, apparently the universe required empirical repetition.
- `rate_equation_0d` under `packages/physics_modules/species/` is the Phase 1 canonical solver and reference module for ModelSpec / ModuleMatcher tests.
- HDF5 metadata can silently drop list-shaped fields. Cross-format parity tests must prove every documented field round-trips.

---

## 4. Editing Protocol Before Touching Code

Before modifying an existing subsystem:

1. Identify the subsystem and likely affected invariants.
2. Inspect historical bugs and patterns:

   ```bash
   grep -nE "packages/core/runtime|runtime/" bugs_and_fixes/bugfixes.md
   grep -nE "your-subsystem-keyword" bugs_and_fixes/known_failures.md
   grep -nE "your-pattern" bugs_and_fixes/agent_error_patterns.md
   ```

3. Read any relevant regression entry and identify the protecting test.
4. Run that regression before and after the change.
5. If behavior intentionally changes, add or update a regression test and explain the invariant shift in the commit message.

---

## 5. Documentation Maintenance

Required docs pages live under `docs_site/src/content/`:

- `overview`
- `installation`
- `usage`
- `architecture`
- `module_development`
- `internal_tools`
- `simulation_capsules`
- `agent_workflows`
- `validation`
- `troubleshooting`

When changing documented behavior:

1. Update the relevant MDX/TSX page.
2. Update `README.md`.
3. Update the in-program docs viewer when the feature is visible there.
4. Verify docs render with `scripts/docs/dev.sh`.
5. Add a timeline entry in `program_development/timeline.md` when the change is milestone-relevant.

`LIMITATIONS.md` is the outward-facing capability map. Update it only when capabilities or limitations materially change:

- phase status flips to `Complete`;
- module, backend, or tool promotes to `validated` or `trusted`;
- an audit finds a claimed-but-unshipped feature;
- the autonomy layer changes substantially, such as replacing a heuristic stand-in with a real LLM.

Do not churn `LIMITATIONS.md` for routine bug fixes, refactors, or tests that merely confirm existing behavior.

---

## 6. Filesystem and Artifact Boundaries

### Allowed temporary roots

Use repository-relative paths through `pathlib.Path(__file__).resolve()` or `simworkbench.paths`.

| Root | Purpose |
|---|---|
| `local_cache/` | caches, coefficient tables, parsed paper artifacts |
| `temp_imports/` | imports staged for review |
| `temp_runs/` | in-flight run artifacts before capsule promotion |
| `simulation_capsules/` | finalized capsule directories |

Use `tempfile.TemporaryDirectory(dir=local_cache_root())` for cleanable temporary work. Do not write to `~/`, `/tmp/`, or arbitrary absolute paths.

### Off-limits destructive edits

| Directory / file | Allowed | Forbidden |
|---|---|---|
| `<capsule>/provenance/` | append-only runtime updates | manual edits, deletions |
| `<capsule>/src/user_edits/` | user changes only | agent overwrites |
| `<capsule>/paper_sources/` | initial import | edits to original paper files |
| `bugs_and_fixes/` | new entries | removing or rewriting history |
| `program_development/architectural_decisions/` | new ADRs, status updates | rewriting accepted ADRs |
| `physics_modules/.../validated/`, `.../trusted/` | new version branches | in-place behavior changes without ADR |
| `LICENSE` | none | any modification |

When the safe path is uncertain, fail closed and make a reversible addition rather than a destructive rewrite.

---

## 7. Generated Code and Provenance

When an agent generates simulation code into a capsule:

1. Write generated code to `<capsule>/src/generated/`.
2. Preserve `<capsule>/src/user_edits/`; never overwrite it.
3. Format generated Python with `ruff format`; format TypeScript with `prettier`.
4. Add a top-of-file header declaring source paper DOI/title, ModelSpec version, generation timestamp, and agent identifier.
5. Give public functions docstrings stating units and assumptions.
6. Ensure generated code runs in isolation:

   ```bash
   python <capsule>/src/generated/run.py
   ```

7. Ensure capsule export produces a self-contained archive:

   ```bash
   scripts/export/capsule.sh <name>
   ```

Every run touches `<capsule>/provenance/`:

| File | Contents |
|---|---|
| `provenance.lock` | environment, package versions, backend, hardware metadata, random seeds, ModelSpec hash, source-code hashes |
| `agent_trace.md` | chronological record of agent actions, inputs, decisions, generated/modified files |
| `environment.yaml` | pip/conda freeze |

Never delete or rewrite provenance in a completed capsule. Fork instead:

```bash
scripts/export/fork_capsule.sh <src> <dst>
```

---

## 8. Adding Modules and Internal Tools

### Add a simulation module

Modules live at `packages/physics_modules/<domain>/<name>/` for domains such as `laser`, `plasma`, `species`, `spectroscopy`, `molecular_dynamics`, `phase_transition`, `pde`, and `monte_carlo`.

1. Copy `packages/physics_modules/templates/<closest-template>/` into the new module path.
2. Edit `module.yaml` per plan §14.2: name, version, domain, status `candidate`, inputs/outputs with units, validity domain, references.
3. Implement `src/`. Public functions use unit-aware quantities at boundaries.
4. Add tests: at minimum I/O contract tests and one validation test against a limiting or analytical case.
5. Add `README.md`, `assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`, and `examples/`.
6. Register the module in `packages/physics_modules/<domain>/index.yaml` or run `scripts/dev/refresh_registry.sh`.
7. Run `scripts/test/validation.sh`.
8. Update `docs_site/src/content/module_development.tsx` if the module introduces a new interface pattern.

Promotion from `candidate` to `validated` requires plan §14.3 criteria and a human reviewer.

### Add an internal tool

Internal tools live at `packages/internal_tools/registry/<tool_name>/`.

1. Create from **Internal Tools → New Tool from Template** or copy `packages/internal_tools/templates/<category>/`.
2. Edit `tool.yaml` per plan §9.3: name, version, type, entrypoint, inputs/outputs with units, compatible domains, requirements, validation tests.
3. Implement `src/tool.py` extending `simworkbench.tools.BaseTool` with `validate_inputs` and `run`.
4. Add tests, `README.md`, `docs/`, and `examples/`.
5. Register with `scripts/dev/refresh_registry.sh` or restart the UI.
6. Tool lifecycle begins at `draft`; tests allow `candidate`; `trusted` requires a human reviewer.

---

## 9. UI Styling Contract

Read `STYLING.md` before any visual change.

Read it before:

- adding or refactoring a UI panel;
- introducing a callout, info box, banner, or other visual treatment;
- choosing a color for a new state;
- touching `apps/workbench-ui/src/styles.css`.

Hard rules:

- No Tailwind, PostCSS, or CSS-in-JS.
- No per-component CSS files; all styling lives in `apps/workbench-ui/src/styles.css`.
- No `999px` border-radius on multi-line content; pill rounding is for chips only.
- No inline color hex literals. Add or propose a token.

Update `STYLING.md` only when adding a design token, shipping a shared primitive in `components/ui/`, or changing an existing visual contract.

---

## 10. Security Rules for Multi-User Workbench Work

Source: `secure_multi_user_scaffolding_plan_v4.md` §1.2.

These rules apply when editing routes, storage, capsules, run execution, worker code, tool registries, agent orchestration, approval workflows, artifact exports, or any code under `packages/secure_core/`.

Before editing those areas, inspect:

1. authentication middleware;
2. workspace authorization middleware;
3. role/capability checks;
4. object workspace-scope checks;
5. audit/provenance actor handling;
6. sandboxing and worker execution constraints;
7. capsule version/locking logic;
8. relevant security regression tests;
9. `bugs_and_fixes/agent_error_patterns.md`.

Never accept client-provided server-derived fields, at any nesting depth. This includes:

- identity fields: `id`, `user_id`, `actor`, `actor_id`, `actor_user_id`;
- authorship fields: `created_by`, `updated_by`, `approved_by`, `decided_by`;
- authorization fields: `workspace_role`, `role_id`, `workspace_id`;
- lifecycle fields: `created_at`, `updated_at`, `current_version_id`, `status`, `disabled_at`;
- storage/security fields: `storage_path`, `assurance_level`, `auth_method`, any `*_hash`.

Hard security rules:

- Derive identity, workspace, role, and audit actor server-side.
- Malformed authenticated context fails closed; never coerce `unauthenticated` into a privileged actor type for audit or authorization.
- Protected JSON-body routes run audit-aware `validateInputSchema` / `bodyValidation`; do not rely only on Fastify `schema.body`.
- Accept object references such as `source_artifact_id`; derive `content_hash`, `storage_path`, and lifecycle `status` server-side.
- Current-session and workspace-membership read models preserve live memberships even when the role grants zero capabilities; capability joins for listing use left joins and may return an empty capability set.
- High-risk route handlers consume an L2.9 approval token before side effects, but mandatory privilege preconditions such as operator step-up auth run before that token is consumed. Privilege-bearing services re-check live capability inside the transaction before commit.
- Worker/sandbox writers reserve and commit quota for every derived artifact; failed paths clean up every file they created.
- Never write workspace artifacts outside the server-generated workspace path.
- Never bypass authorization checks for convenience.
- Never implement security TODOs as permissive placeholders.
- Never disable security tests.
- If secure implementation is not possible in the current change, fail closed and document the blocker.
- Keep `scripts/test/security.sh` as a direct hard gate from `scripts/test/all.sh`; it owns the v4 §29 security matrix and production-secret-env refusal.
- Keep `packages/secure_core/test/security/section29_coverage.test.ts` synchronized with v4 §29; every numbered assertion needs a literal `§29 #NN —` entry and executable evidence.
- External WORM anchors require provider-backed comparison, not just a local `log_chain_anchors` row.
- L2.9 high-risk approval middleware rejects non-human actors before token consumption.
- Branch-protection or emergency-operator override paths emit `branch_protection.bypass`.

Current security status as of 2026-05-07:

- Phase 0.5 Layer-0 ADRs are accepted.
- Layer-1 through Layer-5 secure-core slices are implemented and covered by the security gate.
- L2.9 approval-token middleware is implemented; protected high-risk routes must use it rather than local token checks, and non-human actors cannot consume high-risk approval tokens.
- `scripts/test/security.sh`, `scripts/test/all.sh`, `.github/workflows/security.yml`, and `packages/secure_core/test/security/section29_coverage.test.ts` are the Layer-5 integration surface.
- Deployment-specific live probes for gVisor, database roles, and WORM infrastructure remain environment-gated and are required before production multi-user operation.
- Full gate: `program_development/phase_05_security_implementation_plan.md`.

---

## 11. Phase and Workstream Gate Procedure

Phase completion requires existence checks, behavior checks, status synchronization, and tests. Existence alone is not completion.

### Phase complete means all three are true

1. `bash scripts/dev/check_repo_conventions.sh` exits zero.
2. Phase status agrees across `README.md`, `program_development/milestones/phase_NN_*.md`, `program_development/timeline.md`, and every ADR, `module.yaml`, `tool.yaml`, or docs page that names the phase.
3. Every deliverable in the milestone phase gate, plan `§Phase NN`, and README status table has a convention-checker assertion:
   - completed deliverables in default hard-gate mode;
   - open deliverables in `--include-open-workstreams` mode.

### Start a phase

```bash
# 1. Read the plan section.
sed -n '/^# Phase NN:/,/^# Phase /p' scientific_simulation_workbench_agent_plan.md \
  | head -200

# 2. Read the milestone.
cat program_development/milestones/phase_NN_*.md

# 3. Read README and relevant docs.
grep -nE "Phase NN" README.md docs_site/src/content/*.tsx
```

Then:

1. Enumerate every open deliverable from the plan and milestone.
2. Add one opt-in convention-checker assertion per deliverable under `--include-open-workstreams`.
3. Run the opt-in checker and confirm it fails for the missing deliverables.
4. Keep the default checker green.
5. Implement until opt-in failures are resolved.
6. Promote completed assertions into the default hard gate before claiming completion.

### Start a workstream

```bash
# 1. Locate the workstream in the plan.
awk '/^### Workstream NX:/,/^### Workstream/' \
    scientific_simulation_workbench_agent_plan.md

# 2. Compare milestone pre-gate hints.
awk '/Convention-checker assertions to add/,/Status sync at close/' \
    program_development/milestones/phase_NN_*.md
```

Rules:

- The plan's full workstream description wins over milestone hints.
- Patch the milestone first if it omits entities named by the plan.
- Add one checker assertion per named class, file, module, script, config key, ADR, test, or example.
- If deferring an entity, name the deferral in the commit message and keep a failing opt-in checker assertion so the deferral remains visible.

Preferred assertion granularity:

```bash
check_file_exists packages/core/src/simworkbench/experiment/types.py
check_file_exists packages/core/src/simworkbench/experiment/__init__.py
check_file_exists packages/core/src/simworkbench/serialization/experiment.py
check_file_exists tests/unit/test_experiment.py
check_file_exists tests/integration/test_experiment_save_load.py
```

### Close a phase

Before flipping status to `Complete`:

```bash
bash scripts/dev/check_repo_conventions.sh
bash scripts/dev/check_repo_conventions.sh --include-open-workstreams
bash scripts/test/all.sh

grep -nE "Phase NN" README.md \
  program_development/milestones/phase_NN_*.md \
  program_development/timeline.md \
  $(grep -lE "Phase NN" docs_site/src/content/*.tsx 2>/dev/null)
```

Then:

1. Confirm every status reference agrees.
2. Update `LIMITATIONS.md` if the phase adds capability or changes limitations.
3. Stage all status-bearing files explicitly.
4. Commit the status flip in one commit.
5. Push if the change qualifies as major under the Git rules below.

### Status-flip commit template

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

## 12. Behavioral Close Audit

Run these before closing any phase or workstream that claims a completed behavior. They condense the accumulated false-close lessons from Phases 1–6.

| Area | Required audit |
|---|---|
| End-to-end behavior | Exercise every plan phase-gate criterion on a real artifact through integration tests. |
| Documented scripts | Every advertised current entrypoint runs on typical input; future commands are executable stubs. |
| Producer/writer wiring | Every new writer is called by the producer; producer output round-trips through the writer's loader. |
| Validator parity | Required files/fields in validators match producer outputs. |
| Destructive operations | Exporters and registries validate all user-controlled names/targets before writes, deletes, or `rmtree`. |
| UI rendering | Each promised panel mounts in Vitest and asserts the promised content appears. |
| Status sync | Read every grep match, not only the first. README banners and status tables both count. |
| Build cleanliness | UI and docs builds succeed without emitting `.js` or `.d.ts` into source trees. |
| Gate verbs | Each verb in the plan's phase gate has implementation, user-facing surface, positive test, and negative test. |
| Workstream bullets | Each task bullet in the plan has an artifact and a test. |
| API boundary validation | Empty strings, whitespace, malformed types, and missing fields fail with 4xx and no state mutation. |
| Success paths | For every “supports X” claim, prove dependency installation, structured error mapping, and happy-path fixture success. |
| Hard rules | Hard requirements live in libraries or mutation boundaries, not client-controlled flags. |
| Mixed-shape artifacts | Rules covering unions enumerate every shape: structured rows, Markdown, binary blobs, etc. |
| Consumer compatibility | Compatibility checks compare against the consumer's required schema, dimensions, ports, and units. |
| Always-on prose | Every “always” / “must” invariant has a regression test. |
| Artifact validation | A “validate X” step consumes X directly; corrupt-X tests must fail. |
| Early exits | Validators check contracts before permissive loop exits. |
| Identity and privilege | HTTP APIs never read privilege claims from request bodies. |
| Transform endpoints | Endpoints named `/diff`, `/preview`, `/state-after-X`, etc. perform the named transformation. |
| Archive targets | Export targets are outside source trees and in-flight archives are excluded from walks. |
| Serializer parity | Canonical formats preserve every semantic field, including lists. |
| Regeneration cleanup | Regenerate-in-place paths delete orphans and report removed files. |
| UI verbs | Plan verbs such as “edit,” “approve,” or “export” map to actual affordances and tests, not labels alone. |

The full pattern list lives in `bugs_and_fixes/agent_error_patterns.md`. Read it before changing convention-checker logic, gate criteria, registry mutations, lifecycle gates, or scientific I/O boundaries.

---

## 13. Reality Tests for Plan-Derived Patterns

### Gitignore changes

Probe representative source paths before committing ignore rules:

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

A warning means the ignore rule is too aggressive. Anchor or specialize it until no source path is swallowed.

### Filenames

When the plan suggests one filename but the section title implies another, follow the section title. Document the divergence in the milestone file, and in `bugs_and_fixes/bugfixes.md` if discovered through a bug.

### Directory entrypoints

| Directory pattern | Required entrypoints |
|---|---|
| `apps/<name>/` | `package.json`, `tsconfig.json`, `src/app/page.tsx` or equivalent |
| `packages/core/`, `packages/<name>/` | `pyproject.toml`, `src/<package>/__init__.py` |
| `packages/physics_modules/<domain>/<module>/` | `module.yaml`, `src/`, `tests/`, `README.md` |
| `packages/internal_tools/registry/<tool>` | `tool.yaml`, `src/`, `tests/`, `README.md` |
| `docs_site/` | `package.json`, `tsconfig.json`, content files in `src/content/` |

### Documented commands

When documentation references a command, create the script or stub in the same commit:

```bash
#!/usr/bin/env bash
# scripts/dev/run_ui.sh
set -euo pipefail

echo "scripts/dev/run_ui.sh: scheduled for Phase 1 / Workstream 1F (UI Workbench)"
echo "See program_development/milestones/phase_01_manual_workbench.md."
exit 0
```

---

## 14. Pre-Commit Greps for Known Code-Craft Failures

Run these checks when the diff touches their domains.

### Shallow-copied fixtures

```bash
grep -nrE 'data\s*=\s*(dict\([A-Z_]+\)|\{\*\*[A-Z_]+\})' tests/
```

Matches require replacement with `copy.deepcopy(FIXTURE)` or a fixture factory.

### Mutable singleton caches

```bash
grep -nrE '^\s*global ' packages/core/src/
grep -nrE '^_[A-Z_]+\s*[:=]\s*(None|\{\}|\[\])' packages/core/src/
```

Matches require justification or replacement with `@functools.lru_cache(maxsize=1)`.

### Raw numbers in flexible scientific fields

Every flexible numeric field needs negative tests like:

```python
def test_raw_float_rejected_in_<field>():
    with pytest.raises(ValueError):
        from_dict({..., "<field>": {"key": 42.0}})


def test_unitless_numeric_string_rejected_in_<field>():
    with pytest.raises(ValueError):
        from_dict({..., "<field>": {"key": "42"}})
```

A workstream introducing a flexible scientific field is not done until these tests pass.

---

## 15. Fixing Wrong Checker Assertions

The convention checker can be wrong. Fix the assertion; do not delete it to make the phase appear complete.

If the plan and checker genuinely disagree:

1. open or update an ADR;
2. explain which source wins and why;
3. patch the checker and docs in the same logical change.

---

## 16. Autonomous Git Operations

The user has authorized autonomous commits and pushes for this repository only. Other repositories require explicit approval.

### Rules

- Commit after every meaningful unit of work.
- Push to `origin/<current-branch>` after every major change.
- Never force-push.
- Never amend or rebase public commits without explicit approval.
- Never use `--no-verify`, `--no-gpg-sign`, or equivalent bypasses.
- Never stage secrets, credentials, `.env*`, `*.local.yaml`, service-account JSON, or generated artifacts.
- Never use `git add -A` or `git add .`; stage explicit paths.

### Major changes that require immediate push

| Trigger | Example |
|---|---|
| Workstream completed | `Phase 0 / Workstream 0B done` |
| Phase gate passed | `Phase 0 gate verified` |
| Bug fixed and logged | new `bugs_and_fixes/bugfixes.md` entry |
| Lifecycle transition | module/tool/backend `candidate → validated` |
| ADR status change | accepted, deprecated, superseded |
| Milestone update | phase started or completed |
| Multi-file diff | more than about 3 meaningful files or cross-subsystem change |
| User-visible feature | shipped or removed |

Routine in-progress edits get a local commit and hold the push until bundled into a major change.

### Actions requiring explicit user approval

- force-push;
- rebase/amend that rewrites commits already on `origin`;
- `git reset --hard`, `git checkout --`, `git clean -f`, `git branch -D`, except transient agent branches;
- skipping hooks;
- committing possible secrets;
- pushing to a non-tracked branch;
- creating, closing, merging, or commenting on PRs, issues, releases, or tags.

### Commit-and-push procedure

```bash
# 1. Verify
bash scripts/dev/check_repo_conventions.sh
# plus relevant tests, usually scripts/test/<subset>.sh

# 2. Inspect
git status --short
git diff --stat
git diff

# 3. Stage explicit paths only
git add CLAUDE.md scripts/dev/check_repo_conventions.sh

# 4. Commit with HEREDOC
git commit -m "$(cat <<'EOF'
<imperative subject <= 72 chars>

- Explain why the change exists.
- Reference the ADR / bugfix / workstream / milestone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# 5. Verify commit
git status
git log -1

# 6. Push when major
git push
```

If `git push` fails because the remote moved ahead:

1. `git pull --rebase --autostash`;
2. resolve conflicts without discarding upstream commits;
3. rerun checker and tests;
4. push;
5. stop and ask if the rebase would rewrite already-pushed commits.

When in doubt, commit locally, hold the push, and report why.

---

## 17. Definition of Done

A Claude task is done only when all applicable items are true:

1. `scripts/dev/check_repo_conventions.sh` passes.
2. New or moved deliverables are represented in the convention checker.
3. New documented commands exist and are executable.
4. Plan-derived names, gitignore rules, and paths have been reality-tested.
5. Relevant regression and subsystem tests pass.
6. Documentation, README, docs viewer, timeline, and `LIMITATIONS.md` are updated where applicable.
7. Phase/module/tool/backend status is synchronized across every status-bearing file.
8. Workstream-completion tasks enumerate, assert, implement, and test every plan-named entity; deferrals are explicit and pinned by opt-in checker assertions.
9. Code-craft anti-pattern greps have been run when relevant.
10. New public APIs have usage examples in the relevant docs page.
11. The final response names changed files and deferred decisions.
12. The change is committed; major changes are pushed.

---

## 18. Current Phase Snapshot

As of 2026-05-07:

| Phase | Status | Notes |
|---|---|---|
| 0 | Complete | Repository bootstrap. |
| 1 | Complete | Manual Scientific Workbench; post-review capsule save/reload fixes landed. |
| 2 | Complete | Simulation Capsule System; manifest schema, HDF5 bulk data, provenance, export/fork, Capsule Explorer. |
| 3 | Complete | Internal Tool SDK/Registry; lifecycle, endpoints, experiment binding. |
| 4 | Complete | Agent-Assisted Paper Ingestion; post-close PDF and artifact fixes landed. |
| 5 | Complete | ModelSpec generation, module matching, gap analysis, experiment proposals. |
| 6 | Complete | Sandboxed code generation, generated tests, validation run, Generated Code UI. |
| 7 | Complete | Validated Physics Module Registry; six validated analytic modules, plasma candidates. |
| 8 | Complete | HPC/hardware backends; Python/Numba validation, C++ ABI, CUDA probes, Slurm/Ray/external-PIC adapters. |
| 9 | Complete | Sweeps, optimization, uncertainty, comparison reports. |
| 10 | Next | Open via the phase/workstream gate procedure: write gate-walk tests first, enumerate plan deliverables, add opt-in checker assertions, then implement. |
| 0.5 Security | In progress | Layer-0 ADRs accepted; Layer-1 through Layer-4 slices under implementation/audit; L2.9 implemented and required on high-risk routes. |

Current convention-checker state:

- Default mode covers every Phase 0–9 entity.
- `--include-open-workstreams` is empty pending Phase 10.
- Bug history and `agent_error_patterns.md` must be consulted before changing checker logic, gate behavior, registries, lifecycle gates, or scientific I/O boundaries.
