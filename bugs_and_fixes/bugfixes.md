# Bugfix Log

Each resolved bug is logged here using the template below. Entries are append-only and ordered most-recent-first.

---

## Template (copy when adding a new entry)

```markdown
## YYYY-MM-DD: Short bug title

### Affected subsystem
`packages/<path>/`

### Symptoms
What the user or test observed.

### Root cause
The actual cause, not just the error message.

### Fix
What changed. Reference commit SHA or PR.

### Regression protection
Test path(s) added or updated. Cross-listed in `regression_tests.md`.

### Agent warning
What future agents must not repeat.
```

---

<!-- Append entries below this line, most recent first. -->

## 2026-05-04: Phase 7 post-close audit — lifecycle gate bypass and incomplete module family

### Affected subsystem
- `packages/core/src/simworkbench/modules/`
- `packages/core/src/simworkbench/modeling/module_match.py`
- `packages/physics_modules/laser/`
- `packages/physics_modules/species/`

### Symptoms
`ModuleRegistry.set_status(..., actor="human")` could promote a module without an approval token or passing declared tests, and invalid validated metadata was hidden by `refresh()` because malformed `module.yaml` files were skipped. Phase 7B also collapsed the laser-species family into a small reference subset: plan-named modules such as `laser/absorption`, `laser/emission`, `laser/excitation`, `laser/ionization`, `laser/recombination`, `species/electron_temperature`, and `species/species_density` were missing or incomplete. Some existing module YAML files pointed at tests that did not exist. `ModuleMatcher` surfaced module lifecycle status but did not use it to prefer validated modules when scores tied.

### Root cause
The privileged gate lived partly in prose/API flow instead of the mutating registry method, and the public mutator still exposed bypass-style flags. Convention checks verified selected reference modules rather than every plan-named family member and did not assert metadata evidence paths. Registry discovery treated invalid metadata as ignorable, so a broken module could disappear from a fresh registry instead of failing the gate.

### Fix
`ModuleRegistry.set_status` now validates the target metadata before writing, consumes the single-use module approval token at the mutation boundary, requires benchmark artifacts and declared tests, and always runs those tests before `candidate → validated`. Public approval/test bypass flags were removed. Registry refresh now fails on invalid module metadata instead of skipping the file. Added `python -m simworkbench.modules.approve` to match the documented approval flow. Phase 7B plan-named laser/species modules now exist with module YAML, docs, source, tests, examples, and benchmark placeholders where validation is still pending. Stale test paths for validated and candidate modules were fixed with module-local tests. Module matching now ranks trusted/validated modules above candidates at equal scientific score.

### Regression protection
- `tests/regression/test_module_registry_promotion_gates.py`
- `tests/regression/test_phase7_module_metadata_integrity.py`
- `scripts/dev/check_repo_conventions.sh`

### Agent warning
Do not put lifecycle safety in an API wrapper while leaving the library mutator permissive. Do not add public "test fixture" flags that skip human approval or test execution on a production mutator. Do not mark a plan-named module family complete by shipping only a reference module; enumerate every name and make the convention checker assert the artifacts. Do not silently skip bad registry metadata during discovery.

## 2026-05-03: Phase 6 post-close audit (round 2) — UI typecheck broken; test gate skipped tsc

### Affected subsystem
- `apps/workbench-ui/src/components/codegen/GeneratedCodeView.tsx`
- `scripts/test/all.sh` (no UI typecheck step)

### Symptoms
The Phase 6 round-1 audit fix renamed the codegen-diff API field from `current_files` to `current_preview` (so the endpoint actually returned a diff). The TS type in `apps/workbench-ui/src/api/client.ts` was updated; the consumer at `GeneratedCodeView.tsx:255` still read `diff.current_files.length`. `npm --prefix apps/workbench-ui run typecheck` failed with TS2339; `vitest run` passed because esbuild/swc strips types instead of checking them; the round-1 close commit landed broken on `main`.

### Root cause
The repo's hard-gate test runner (`scripts/test/all.sh`) ran `lint.sh` + `unit.sh` + `integration.sh` + `regression.sh` + `validation.sh` + `performance.sh` — every Python check — but did not invoke `tsc --noEmit`. The TS package's `package.json build` script chained `tsc --noEmit && vite build`, so a build would have failed; `all.sh` never built. Convention checker covered the existence of every existing test script but didn't require a UI test step.

### Fix
- Updated `GeneratedCodeView.tsx` to render the diff lists (added/removed/changed) from the new shape — this also closed the "Diff endpoint that doesn't compute a diff" pattern leak that had reached the UI (the panel was reporting "Current tree carries N file(s)" instead of showing the actual diff entries).
- Added `scripts/test/ui.sh` that `cd`s into `apps/workbench-ui/` and runs `npm run typecheck` then `npm test`. Wired into `scripts/test/all.sh`.
- Convention checker asserts `scripts/test/ui.sh` exists + is executable (435 → 436).
- New Vitest test `renders the diff lists (added/removed/changed) when the diff endpoint reports them` — mounts the panel with a mocked diff response and asserts each bucket's rows appear in the DOM.

### Regression protection
- `scripts/test/ui.sh` runs as part of `scripts/test/all.sh`. Type drift between FastAPI body schemas and the TS API client now fails the gate.
- New Vitest test pins the expected DOM shape for the diff panel.
- New error pattern at the bottom of `agent_error_patterns.md`: "Test gate runs unit tests but not the typechecker".

### Agent error patterns added
1 new pattern at the bottom of `bugs_and_fixes/agent_error_patterns.md`:
- "Test gate runs unit tests but not the typechecker"

### Warning to future agents
`vitest run` is **not** a typechecker. esbuild/swc strips types instead of checking them. Always run the explicit `tsc --noEmit` step before considering UI work green. After this fix, `bash scripts/test/all.sh` runs both — but if you change the test wiring, preserve the typecheck step. Same applies to any future TS package: it gets its own `scripts/test/<pkg>.sh` that runs typecheck before vitest, wired into `all.sh`.

---

## 2026-05-03: Phase 6 post-close audit — eight legitimate review findings

### Affected subsystem
- `simworkbench.codegen.validation_run` (Phase 6E)
- `simworkbench.runtime.python_cpu` (Phase 1, exposed by Phase 6 codegen path)
- `simworkbench.api.server` — `/api/tools/{name}/status`, `/api/runs`, `/api/capsules/{name}/codegen/diff`
- `simworkbench.serialization.bulk_data` + `simworkbench.serialization.capsule` (HDF5 round-trip)
- `simworkbench.serialization.exporters.archive`
- `simworkbench.codegen.generator` (regeneration cleanup)
- `apps/workbench-ui/src/components/codegen/GeneratedCodeView.tsx` (editor)

### Symptoms
1. **Critical:** `ValidationRunner.run` reloaded `model_spec.yaml` and ran `Runner` directly — never imported `<capsule>/src/generated/experiment.py`. Corrupting the generated file with invalid Python returned `incomplete` with no failure.
2. **Critical:** One-participant interactions with non-placeholder `paper:` coefficients silently no-op'd. The backend skipped them BEFORE coefficient validation fired (`if len(species) < 2: continue`).
3. **High:** `POST /api/tools/{name}/status` accepted `actor=human` from the body. Any caller (including the autonomous agent) could promote a tool to `validated` by claiming to be a human.
4. **Medium:** `POST /api/runs` returned HTTP 500 on malformed `RunConfig` inputs (e.g. `max_steps=0`, malformed `end_time`). The constructor lived outside the try/except.
5. **Medium:** HDF5 metadata stored only `placeholder_used: bool`. HDF5-only capsule reload returned `placeholders=[]` — the names were lost.
6. **Medium:** `export_archive` walked `<capsule>` with `rglob` after creating the destination zip. A target inside the capsule (e.g. `<capsule>/exports/<capsule>.zip`) captured itself.
7. **Medium:** `/api/capsules/{name}/codegen/diff` returned `{previous, current_files}` only — no real diff. The gate-walk test asserted only that two keys existed in the response.
8. **Low:** `CodeGenerator.generate` overwrote files but never deleted orphans. Stale `src/generated/` artifacts lingered through regeneration into export.
9. **Low:** Phase 6D plan said "Generated Code Viewer **and Editor**". The shipped UI was a list/action panel — no inline editor for `user_edits/`.

### Root cause
The Phase 6 close commit verified file presence + the sixteen behavioral checks but did not (a) corrupt the generated artifact and re-run validation, (b) iterate every interaction arity through the runtime, (c) test the API's privileged path with a credential bypass, (d) round-trip an HDF5-only capsule, (e) self-export to an archive inside the source, (f) actually compute the diff endpoint's claim, (g) regenerate after dropping a spec field, or (h) word-audit the plan deliverable description against the shipped panel. Each failure mode is a behavioral check the Phase 6 close was missing — eight new patterns now in `agent_error_patterns.md` and four new behavioral checks (#17–#24 in `CLAUDE.md → Phase Gate Procedure → Closing a phase`).

### Fix
1. `ValidationRunner` now uses `runpy.run_path` against `<capsule>/src/generated/experiment.py`, calls its `run()` function, and surfaces every exception as `validation_status: failed` with the exception text in `failure`.
2. `python_cpu.RatePopulationBackend.initialize` validates coefficient sources for every interaction BEFORE the arity branch, then implements decay (arity 1) AND conversion (arity 2) AND rejects arity 3+ explicitly.
3. `ToolStatusBody.actor` is removed entirely. The API hard-codes `actor="agent"` for agent-allowed transitions; human-only transitions consume a single-use approval token written by `simworkbench.tools.grant_approval` (or `python -m simworkbench.tools.approve`). The token lives at `<repo>/local_cache/tool_approvals/<name>__<from>-to-<to>.approval` and is read+deleted on use.
4. `start_run` now wraps `load_modelspec_yaml`, `Experiment.from_model_spec`, and `RunConfig(...)` in try/except — every `ValueError` / Pydantic `ValidationError` returns 400.
5. `_coerce_attr` now stores `list[str]` as a vlen-string array. `save_capsule` writes `placeholders: list[str]` to HDF5 metadata; `load_capsule` reads it back (sidecar fills in only when HDF5 doesn't carry the field).
6. `export_archive` validates `archive.relative_to(capsule)` raises BEFORE creating the destination, with a defense-in-depth `path.resolve() == archive_resolved` exclude in the rglob walk.
7. `/codegen/diff` runs the generator into a temp capsule under `temp_runs/`, computes `added`/`removed`/`changed`/`unchanged` against the prior manifest, and tears down the temp tree before returning.
8. `CodeGenerator.generate` now reads the prior manifest, computes orphans, and removes them through `_remove_under_sandbox` (same allowed-roots / off-limits checks as `sandboxed_write`). `CodeGenerationResult.removed_files` lists what was cleaned.
9. `GeneratedCodeView` gains a Path/Contents textarea + Save button bound to `apiClient.writeUserEdit`. New backend endpoint `POST /api/capsules/{name}/user_edits/{path:path}` calls `simworkbench.codegen.user_edit_write` — a separate library function that accepts paths under `user_edits/` ONLY (paper_sources/, provenance/, src/generated/ are refused).

### Regression protection
- `tests/regression/test_validation_runner_executes_generated_code.py` — corrupts `experiment.py` with invalid Python; asserts `validation_status: failed` with `SyntaxError` in `failure`.
- `tests/regression/test_interaction_validation_fires_for_all_arity.py` — sends arity-1 with `paper:` (raises), arity-1 with `placeholder:` (runs), arity-2 with `paper:` (raises), arity-3 (raises).
- `tests/integration/test_api_server.py::test_set_tool_status_rejects_unauthorized_agent_promotion` — POST without approval → 403; POST with grant → 200; second POST → 403 (single-use). Plus `test_set_tool_status_ignores_actor_from_body` — posting `actor=human` → 403.
- `tests/regression/test_run_config_400_not_500.py` — `max_steps=0` / malformed `end_time` / unknown YAML path each → 400, never 500.
- `tests/regression/test_capsule_hdf5_only_preserves_placeholders.py` — strips JSON sidecar; reload preserves `placeholders` byte-for-byte.
- `tests/regression/test_archive_does_not_contain_itself.py` — refuses target inside source; canonical export does not contain its own filename.
- `tests/regression/test_codegen_cleanup_and_diff.py` — orphan file removed on regenerate; `/diff` returns added/removed/changed; `/diff` does not mutate disk.
- `tests/regression/test_user_edits_editor_endpoint.py` — POST writes under `user_edits/`; library refuses `paper_sources/`, `provenance/`, `src/generated/`, and path-escape.

### Agent error patterns added
8 new patterns at the bottom of `bugs_and_fixes/agent_error_patterns.md`:
- "Validation runs the source-of-truth, not the generated artifact"
- "Validation rule fires after a permissive early-exit"
- "Trusting a client-supplied actor identity for a privileged check"
- "Diff endpoint that doesn't compute a diff"
- "Archive contains its own destination"
- "Serializer drops semantic fields when writing the canonical format"
- "Generator skips cleanup, leaving stale artifacts"
- "UI calls itself an editor while shipping a viewer"

### Warning to future agents
The Phase Gate Procedure's behavioral checks now span twenty-four entries (was sixteen). Read 17–24 before any Phase 7+ close — they catch the modes that pass existence checks while shipping broken behavior. The pattern this audit reinforces: *every plan verb maps to a real artifact, a real test, and a real corrupt-the-input regression*. "It compiled" / "the test passed" / "the convention checker is green" are necessary, not sufficient.

---

## 2026-05-03: Phase 5 post-close audit — four legitimate review findings

### Affected subsystem
Phase 5 ModelSpec generation + module mapping (commit `e886ede`). The Phase 5 close passed all twelve behavioral checks but a user audit found four gaps the checks didn't cover.

### Symptoms
1. **Critical: Phase 5 review gate publicly bypassable.** `POST /api/proposals` accepted `require_reviewed: false` in the body; the UI exposed a checkbox that flipped the same flag. A direct probe with the bypass wrote `model_spec.yaml` and `experiment_proposal.md` from agent-only interpretation, in violation of plan §Phase 4's hard rule.
2. **High: Phase 5 only checked `edited_by` on structured rows.** The four interpretation Markdown files (`paper_summary.md`, `assumptions.md`, `validity_domain.md`, `implementation_plan.md`) carry the agent's "needs human review" / "AGENT DRAFT" banner. The generator's `_enforce_human_review` walked equations + parameters but never opened the Markdown. A capsule with signed rows + banner-bearing Markdown was accepted.
3. **High: ModuleMatcher's `unit_compat` was a parse-check, not a dimensionality-check.** A fake module declaring a single `second`-dimensioned output scored `unit_compat=1.0` for a species-density ModelSpec. The check verified that every module-output unit parsed cleanly, not that it was dimensionally what the spec needed.
4. **High cross-phase safety drift: `security_sandbox` disabled.** `agents.yaml` declares the role as "Always-on once any agent is enabled". Phases 4+5 enabled four other roles; `security_sandbox.enabled` stayed `false`. The rule was prose; no code read or enforced it.

### Root cause
Four new failure modes:

- *Hard rule made optional via a client-controlled API parameter* — issue 1.
- *Validating one input shape but not all input shapes the rule covers* — issue 2.
- *Compatibility checks that pattern-match instead of validating dimensionality* — issue 3.
- *Cross-cutting safety rule encoded in a comment but not enforced in code* — issue 4.

### Fix
- `ProposalBody` no longer accepts `require_reviewed`. The endpoint hard-codes `True`. UI checkbox removed; `apiClient.createProposal(capsule)` no longer accepts the flag. Regression test posts the bypass attempt, asserts 400, AND verifies no artifacts land on disk.
- `_enforce_human_review` now also walks the four interpretation Markdown documents and refuses any that still contain `"needs human review"` or `"agent draft"`. Regression test plants the banner in `assumptions.md` and asserts the generator refuses.
- `ModuleMatcher.unit_compat` rewritten: `_required_output_dims(spec)` returns the dims the consumer needs (number density for species), `unit_compat = n_required_covered / len(required)`. Parses-but-wrong-dim → 0. Regression test creates a fake module whose only output is `second` and asserts `unit_compat < 1.0`.
- `agents.yaml` flips `security_sandbox.enabled` to `true`. New `tests/regression/test_security_sandbox_enforcement.py` reads the YAML and asserts: if any non-sandbox role is enabled, `security_sandbox` MUST be enabled too.

### Regression protection
- `test_phase_5_gate_walk.py::test_phase_5_api_rejects_require_reviewed_bypass`
- `test_phase_5_gate_walk.py::test_phase_5_refuses_when_interpretation_markdown_still_has_review_banner`
- `test_module_retrieval.py::test_unit_compat_rejects_dimensionally_incompatible_outputs`
- `test_security_sandbox_enforcement.py` (3 tests)

### Agent warning — sixteen behavioral checks
The Phase Gate Procedure's twelve checks didn't catch any of these four issues. Four new checks join the list:

- **#13. Hard rules don't take a client-controlled flag.** Every "must hold" rule is enforced inside the library, not by trusting a request-body field. UI controls don't expose toggles for security checks.
- **#14. Mixed-shape rules cover every shape.** When a rule applies to "every interpretation artifact" (or any union-of-shapes set), enumerate the shapes and assert the check has a branch per shape.
- **#15. Compatibility checks compare against the consumer's contract.** Don't accept "parses cleanly" or "is non-empty" as compatibility. Compute the consumer's required shape and check coverage of THAT.
- **#16. Cross-cutting "always-on" prose has a regression test.** Each cross-cutting invariant has a test that reads the relevant state and fails when the invariant drifts.

Phases 1, 2, 3, 4, and 5 each shipped an incomplete close. Sixteen behavioral checks now — four more than before.

---

## 2026-05-03: Phase 4 post-close audit (round 2) — PDF success path + scope drift

### Affected subsystem
Phase 4 paper ingestion. The first audit (commit `48263d5`) added `extract_text(pdf_path)` and a structured `TextExtractionError` with a clean message. A second audit found the failure path was correct but the success path was unimplemented.

### Symptoms
1. **PDF import returned HTTP 500.** `pypdf` was missing from `packages/core/pyproject.toml` and from the venv. The API endpoint caught only `PaperIngestionError`, not `TextExtractionError`. A direct `POST /api/papers/import` with a `.pdf` returned an uncaught traceback.
2. **Docs/status drift on PDF scope.** Milestone said PDFs were in 4A scope; `agent_workflows.tsx` said "Markdown today; PDF support is a Phase 4+ extension"; README's Phase 4 banner didn't mention `extracted_text.md` / `extracted_tables.json` / `extracted_figures.json` at all.

### Root cause
- *Shipping the structured error without shipping the success path* — issue 1. The agent built the error path and treated that as feature support. Three things make a feature work: dep installed, error propagated, success-path test. Only the error message landed.
- The status drift is the existing *Duplicated phase status across nearby paragraphs* pattern applied to scope claims (PDF supported here, not supported there) instead of completion status.

### Fix
- Added `pypdf>=4.0,<6.0` as a hard dep in `packages/core/pyproject.toml`. Reinstalled in venv (`pypdf-5.9.0`).
- API's `import_paper` endpoint now catches `(PaperIngestionError, TextExtractionError)` together, surfacing both as 400 with the error message in the body.
- New 600-byte hand-rolled PDF fixture at `tests/fixtures/phase_4_paper/sample.pdf` containing the text "Phase 4 PDF fixture". New gate-walk test `test_phase_4_gate_walk_pdf_import_success_path` posts the PDF to the API, asserts 200, and asserts `extracted_text.md` contains the embedded text.
- README banner updated to list `extracted_text.md`, `extracted_tables.json`, `extracted_figures.json`, and PDF support; `agent_workflows.tsx` updated to say "Markdown and PDF" with a complete Outputs list.

### Regression protection
- `tests/integration/test_phase_4_gate_walk.py::test_phase_4_gate_walk_pdf_import_success_path` — happy-path PDF import end-to-end through the API.
- `tests/unit/test_text_extraction.py::test_extract_text_from_pdf_raises_when_pypdf_missing` (existing) — failure-path complement.
- Together: every "supports PDF" claim has both a success-path test and a failure-path test.

### Agent warning — twelfth behavioral check
The Phase Gate Procedure expands from 11 → **12 behavioral checks**. New:

**#12. Success path runs, not just the structured failure.** For every "supports X" claim:
1. The dep is in `pyproject.toml` and installed by `scripts/dev/install.sh`.
2. Every `raise <StructuredError>` has a matching `try / except` at the API boundary AND a test asserting the documented status code (NOT a 500).
3. A happy-path test exercises the success path with a real fixture. For binary formats, hand-roll the smallest valid file.

A clean error path is necessary but never sufficient — the success path must actually run, and a test must prove it.

---

## 2026-05-03: Phase 4 post-close audit — three legitimate review findings

### Affected subsystem
Phase 4 paper ingestion at commit `6b5fd77`. The Phase 4 close passed all nine behavioral checks (gate-walk test written first, default checker 394/394, etc.) but a user audit found three gaps the nine checks didn't cover.

### Symptoms
1. **Workstream 4A's task list was 2/6 implemented.** Plan §Phase 4 / 4A enumerates: (1) Import PDFs, (2) Store papers locally, (3) Extract text, (4) Extract tables, (5) Extract figures metadata, (6) Preserve source files. Only (2) and (6) shipped — `PaperImporter` did `shutil.copy2` + `read_text(encoding="utf-8")` and called the result good. No `extracted_text.md`, no `extracted_tables.json`, no `extracted_figures.json`, no PDF entry point. The gate-walk test asserted "paper imported" via the file-copied check, which made the verb feel complete.
2. **`InterpretationView` was read-only.** The "Allow edits" verb covers equations + parameters + interpretation. The backend's `apply_edit` accepted `artifact="interpretation"` (and a unit test exercised it), but the UI never wired up an Edit button for the four interpretation Markdown documents. A reviewer using only the UI couldn't edit `assumptions.md` or `paper_summary.md`.
3. **API boundary trusted client-supplied `reviewer`.** UI required a reviewer name; backend accepted `reviewer=""` and recorded `agent=reviewer:` in `provenance/agent_trace.md`. curl / agents / scripts that bypass the UI corrupted the audit trail with no resistance.

### Root cause
Three new agent failure modes:

- *Skipping workstream task bullets when the gate-verb walk seems satisfied* — issue 1. The ninth check covers gate verbs; it doesn't enforce task-bullet coverage. A verb with five sub-tasks was satisfied at the verb level after one sub-task shipped.
- *Treating multi-target verbs as done when one target is implemented* — issue 2. The verb "edit" applied to three artifact kinds; two had UI surfaces; the third silently lacked one.
- *Validating at the UI but not at the API boundary* — issue 3. The classic defense-in-depth gap: UI guards a field, backend trusts whatever the client sent.

### Fix
A single follow-up commit:

- New module `simworkbench.ingestion.text_extraction` with `extract_text` (Markdown identity + optional `pypdf` for PDF), `extract_tables` (Markdown pipe-tables), `extract_figures` (Markdown image refs + nearby caption). `pypdf` is optional with a structured `TextExtractionError` when missing — never silently stub PDF text.
- `PaperImporter.ingest` now writes `extracted_text.md`, `extracted_tables.json`, `extracted_figures.json` alongside the existing equations/parameters/interpretation outputs. `IngestionArtifacts` exposes the new paths. `read_extracted` surfaces them to the API. Provenance notes record the new counts.
- `tests/unit/test_text_extraction.py` covers all three extractors plus the PDF-without-pypdf failure path. The gate-walk test now asserts each new artifact exists with expected content from the fixture (which now includes a real Markdown table and image+caption).
- `InterpretationView` rewritten with an inline Edit button per Markdown section; reviewer name required (UI side), and the backend validates strictly at the boundary. `PaperReview` passes `capsule` + `onEdited` through.
- `PaperImporter.apply_edit` rejects empty/whitespace `reviewer` at the library boundary with `PaperIngestionError`. The API endpoint surfaces this as 400. New regression `test_phase_4_gate_walk_api_edit_refuses_empty_reviewer`. New positive test `test_phase_4_gate_walk_api_edit_interpretation_artifact`.

### Regression protection
Each new pattern has a Detection section. Concrete tests added:
- `tests/unit/test_text_extraction.py` — eight tests for text/tables/figures + the structured PDF error.
- `test_phase_4_gate_walk.py::test_phase_4_gate_walk_end_to_end_library` extended to assert every task-bullet artifact lands on disk.
- `test_phase_4_gate_walk.py::test_phase_4_gate_walk_api_edit_refuses_empty_reviewer` asserts boundary validation.
- `test_phase_4_gate_walk.py::test_phase_4_gate_walk_api_edit_interpretation_artifact` exercises the third edit target.

### Agent warning
The Phase Gate Procedure expands to **eleven** behavioral checks with these two additions:

- **#10. Workstream task-bullet walk.** For each workstream NX, copy the `Tasks:` bullet list from plan §Phase N / NX into a checklist; tick each bullet only when an artifact + test ships. The ninth check (gate-verb walk) covers verbs; the tenth covers each verb's sub-tasks.
- **#11. Boundary validation parity.** For every API endpoint accepting user input, send empty/whitespace/malformed values and assert 400. UI validation is necessary but never sufficient — every layer that accepts an input validates it.

Phases 1, 2, 3, and 4 each shipped a false / incomplete close. The pattern across all four: the agent treated some narrower-than-the-plan completeness criterion as evidence of meeting the plan.

---

## 2026-05-02: Phase 3 false close — five legitimate review findings

### Affected subsystem
Repository-wide. Phase 3 close at commit `c7040c1` claimed Phase 3 complete; a user audit identified five issues — one critical security issue (path traversal), and four behavioral gaps where the Phase 3 gate verbs ("test, register, **use it in an experiment**, export") had no implementation despite the convention checker passing 358/358. The gate, the convention checker, ruff, all tests, and both build scripts were green.

### Symptoms
1. **Phase 3 gate's verbs were not implemented.** Plan §Phase 3 says "create, **test**, document, register, **use it in an experiment**, and **export** a tool." The Phase 3D UI shipped only `list / view-docs / status`; there was no edit, run-tests, import, export, execute, or experiment-binding code path. The plan's gate criterion never had an integration test that walked the verbs end-to-end.
2. **Path traversal in `register_from_template`.** A `target_name="../../_phase3_escape_probe"` got past the `is_under_workbench(root)` check (which validated only `root`, not the resolved `target`) and created a directory outside the registry root before any name-shaped validation fired.
3. **Template registration produced non-loadable tools.** `register_from_template` rewrote `tool.yaml`'s `name:` but left `src/tool.py`'s `name = "TEMPLATE"` literal. `RegisteredTool.load_class()` then refused the mismatch, so every tool registered through the canonical template flow was unloadable.
4. **Lifecycle promotion not gated on scientific state.** Plan §9.5 says `validated` requires "Passes tests and benchmark cases". `set_status(..., ToolStatus.VALIDATED, actor="human")` only checked the actor + transition rule. A candidate tool with `validation.tests: []` was accepted as validated; the rule the label represented was never checked at the moment the label was written.
5. **Output contracts declared but not enforced.** A `BaseTool` subclass declaring `outputs: [peaks, peak_count]` could `return ToolOutput({"wrong": 1})` and `execute()` accepted it. Inputs were validated; outputs were not. The first downstream consumer would fail with a `KeyError` instead of a structured contract violation.

### Root cause
Five new agent failure modes, each now logged in `agent_error_patterns.md`:

- *Implementing the gate's verbs you can see, not the verbs the plan listed* — issue 1. The agent enumerated the file paths from the milestone hint (`ToolList`, `ToolDetail`, `ToolDocs`, `ToolStatus`) and built convention-checker assertions for them, then implemented exactly what the assertions covered. The plan's enumerated **verbs** (test, register, use-in-experiment, export) were skipped because they didn't appear as file paths. This is a stronger, gate-specific form of *Implementing the agent's checklist instead of the plan's deliverable list*.
- *Path traversal via unvalidated user-controlled component in destination paths* — issue 2.
- *Cross-check on registered artifact that ignores half its identity* — issue 3.
- *Lifecycle promotion that checks the actor but not the artifact's scientific state* — issue 4.
- *Validating inputs but not outputs at scientific boundaries* — issue 5.

The deeper meta-pattern: **the eight behavioral checks added after the Phase 2 false close don't include a "verb-walk" check**. They check existence of files, status sync, build success, and so on — but they don't enumerate the plan's gate-clause verbs and exercise each one. The Phase 3 close passed all eight checks while four of the five Phase 3 verbs had no implementation. The check list needs a ninth check.

### Fix
A single follow-up commit (this one) addresses all five:

- New gate-walk integration test: `tests/integration/test_phase_3_gate_walk.py` exercises every verb end-to-end (create-via-template → run-tests → execute → export → import-external → use-in-experiment via `Experiment.tool_refs` and `apply_tools`). Six tests, one per verb.
- Backend gains four new endpoints: `POST /api/tools/{name}/run-tests`, `POST /api/tools/{name}/execute`, `POST /api/tools/{name}/export`, `POST /api/tools/import`. Each one has integration coverage in the gate-walk file.
- UI's `ToolDetail` adds Run-tests and Export buttons; `ToolList` adds an Import-external form. Vitest test count unchanged for now (the gate-walk tests live on the Python side; the UI behaviour is verified by the Python integration tests against a real Vite-bundle-equivalent backend client).
- `Experiment` gains a `tool_refs: list[ToolReference]` field; `simworkbench.tools.apply_tools(experiment, diagnostics)` resolves each reference, pulls the named diagnostics, runs the tool through `RegisteredTool.execute` (which now validates outputs), and returns a dict keyed by tool name. This is the "use in an experiment" gate verb.
- `register_from_template` validates `target_name` syntactically AND verifies the resolved `target.relative_to(root)` BEFORE any filesystem touch. Two regression tests (`test_register_from_template_refuses_path_traversal`, `test_register_from_template_yields_loadable_tool`).
- `register_from_template` also rewrites `name = "TEMPLATE"` in the entrypoint module so the class identity matches the metadata. The integration test asserts the registered tool actually instantiates and `cls.name == target_name`.
- `ToolRegistry.set_status(name, ToolStatus.VALIDATED, ...)` requires `validation.tests` non-empty AND runs pytest on those tests before flipping the label. Two regression tests (`test_set_status_validated_requires_declared_tests`, `test_set_status_validated_runs_tests_and_refuses_failures`).
- `RegisteredTool.execute(**kwargs)` validates the returned `ToolOutput` against `metadata.outputs`; missing declared keys raise `ToolRegistryError`. One regression test.

### Regression protection
Each of the five patterns has a Detection section. Concrete tests added:
- `tests/integration/test_phase_3_gate_walk.py` — six end-to-end tests, one per Phase 3 verb. This is the canonical gate-walk file; future phases that name verbs in their gate get one too (`test_phase_N_gate_walk.py`).
- `tests/integration/test_tool_registry.py::test_register_from_template_refuses_path_traversal` — eight forbidden names, all rejected before any filesystem touch.
- `tests/integration/test_tool_registry.py::test_register_from_template_yields_loadable_tool` — register a template; immediately call `entry.load_class()`; assert `cls.name == target_name`.
- `tests/integration/test_tool_registry.py::test_set_status_validated_requires_declared_tests` — empty tests list raises `LifecycleError` with `validation.tests is empty`.
- `tests/integration/test_tool_registry.py::test_set_status_validated_runs_tests_and_refuses_failures` — declare a deliberately-failing test, assert promotion raises `LifecycleError` with `validation tests failed`.
- `tests/integration/test_tool_registry.py::test_registered_tool_execute_validates_declared_outputs` — write a tool that drops a declared port, assert `RegisteredTool.execute()` raises with `missing declared`.

### Agent warning
The Phase Gate Procedure's eight behavioral checks now have a **ninth: gate-clause verb walk**. Before any close commit, read the plan's `## Phase Gate` paragraph for the phase, extract every verb, and confirm each one has:

1. A real implementation (not a stub).
2. A user-facing surface (UI button / API endpoint / library function).
3. A test in `tests/integration/test_phase_N_gate_walk.py` that exercises the verb end-to-end on a real artifact and asserts the user-observable result.

The convention checker's existence assertions cover deliverable artifacts. The eight existing behavioral checks cover **structural** behaviors (status sync, build success, source-tree cleanliness). The new ninth check covers the **verbs** the plan promises a user can do. A close that skips it ships another false close.

Phases 1, 2, and 3 each had a false close. The pattern across all three: the agent treated the existence of named entities as evidence of the gate criteria being satisfied. The fix is the same each time — read the plan's gate paragraph as the source of truth, not the milestone hint.

---

## 2026-05-02: Phase 2 false close — six legitimate review findings

### Affected subsystem
Repository-wide. Phase 2 close at commit `d88db3e` claimed Phase 2 complete; user review identified seven outstanding issues spanning capsule reload, `save_capsule`'s use of the Phase 2B writers, `CapsuleValidator`'s required-files list, the exporters' destruct-before-guard ordering, the Capsule UI's code viewer, the diagnostics API JSON fallback, and the source-aggregate hash's subtree set. Plus the README's two-place phase-status string drifted, and the build scripts emitted `.js` files into the source tree.

### Symptoms
1. **Reload was a stub.** `scripts/dev/run_capsule.sh` still printed `Capsule loading is scheduled for Phase 2.` and exited 2. README:239 documents this script as the reload entrypoint, so the Phase 2 gate ("portable, inspectable, **reloadable**, exportable") was unmet.
2. **`save_capsule` ignored the Phase 2B writers.** `provenance.lock` was a hand-rolled minimal dict (didn't validate as `ProvenanceLock` — `load_lock()` raised); `environment.yaml` was never written; `agent_trace.md` was overwritten on each save instead of appended via `AgentTraceWriter`. Phase 2B writers existed and had unit tests, but no producer actually invoked them.
3. **`CapsuleValidator` accepted broken Phase 2 capsules.** `REQUIRED_FILES` listed `results/diagnostics.json` (legacy) but not `results/diagnostics.h5` (Phase 2A canonical), and didn't require `provenance/environment.yaml` (Phase 2B). Deleting `diagnostics.h5` left the validator green.
4. **Exporters destructively `rmtree`d the destination before checking source/target overlap.** `export_capsule(capsule, capsule, kinds=("code",))` deleted `<capsule>/src/generated` before raising. The notebook exporter embedded `Path('/Users/.../capsule.lxp')` as a literal — exports were not portable.
5. **`CapsuleCodeView` never showed any code.** It fetched `src/generated/__index__` from the file endpoint, which only serves files, so the call always returned 404 and the panel stayed empty. The convention checker's existence assertion was satisfied because the component file existed.
6. **`/api/capsules/{name}/diagnostics` JSON fallback returned the wrong shape.** It returned the whole capsule JSON sidecar (`run_id`, `state`, `elapsed_seconds`, `placeholders`, `diagnostics`, ...) as `series`, leaking metadata keys into the UI's series table.
7. **`SourceRegistry.DEFAULT_SUBTREES` didn't include `paper_sources/`.** Editing `paper_sources/paper.txt` did not shift the capsule's identity hash — silent break of the provenance chain after a paper edit.

Plus: README:5 said "Phase 2 complete" while README:33 said "In progress (2A, 2B, 2C, 2D open)"; `scripts/build/ui.sh` and `scripts/docs/build.sh` failed (the former emitted `.js` into `src/`, the latter had no local `tsc`). Vitest was picking up the leaked `.js` test duplicates.

### Root cause
Six new agent failure modes, each now logged in `agent_error_patterns.md`:

- *Convention-checker existence ≠ phase-gate behavior* — issues 1, 5. The checker proved files existed; nobody proved the gate-criterion behaviors worked end-to-end.
- *Building writers without wiring producers* — issue 2. Phase 2B's writers had unit tests; the producer that should have called them did not.
- *Schema drift between writers and validators* — issue 3. Phase 2A made HDF5 canonical; the validator's required list didn't follow.
- *Destructive-before-guard in exporters* — issue 4 (first half).
- *Embedding absolute paths in exported artifacts* — issue 4 (second half).
- *Build script emits compile artifacts into the source tree* — the `.js` leak.
- *Duplicated phase status across nearby paragraphs* — README:5 vs README:33.

Issue 6 (diagnostics API JSON fallback) is a plain wiring bug in the JSON-sidecar-shape contract; issue 7 is a narrow `DEFAULT_SUBTREES` omission. Both were caught by the audit grepping the actual user-facing surface, not the convention checker.

### Fix
A single follow-up commit (this one) addresses all seven:

- `scripts/dev/run_capsule.sh` becomes a real implementation calling `load_capsule` + `Runner`. Smoke test at `tests/integration/test_run_capsule_script.py`.
- `save_capsule` calls `ProvenanceLock` + `write_lock`, `write_environment`, `AgentTraceWriter(...).append(...)`. The hand-rolled `_write_toml`/`_toml_value` helpers are deleted.
- `CapsuleValidator.REQUIRED_FILES` adds `results/diagnostics.h5` and `provenance/environment.yaml`; `RECOMMENDED_FILES` (new) holds `results/diagnostics.json` (warning-only sidecar). Three new validator tests assert the new requirements.
- Exporters validate the entire plan before any `rmtree`. Notebook uses `Path('..') / 'results'` instead of an absolute path. Tests assert the source survives a self-export attempt and that no absolute path appears in the notebook source.
- New `GET /api/capsules/{name}/tree?subtree=<path>` endpoint enumerates files. `CapsuleCodeView` calls it, groups by `src/generated`, `src/user_edits`, `src/kernels`, and lets the user click a file to view it.
- `/api/capsules/{name}/diagnostics` JSON fallback returns `payload["diagnostics"]` (or the payload itself if no `diagnostics` key) — never the whole sidecar.
- `SourceRegistry.DEFAULT_SUBTREES` includes `paper_sources/`. New regression test asserts editing `paper_sources/paper.txt` shifts the aggregate hash.
- README's status-table line flipped to **Complete**; build scripts use `tsc --noEmit && vite build`; tsconfig sets `noEmit: true`; `.gitignore` carries defensive rules for `apps/*/src/**/*.js` and `docs_site/src/**/*.js`.

### Regression protection
Each new pattern has a Detection section. Concrete tests added:
- `tests/integration/test_run_capsule_script.py` exercises the reload script end-to-end and asserts the script is not the Phase-0 stub.
- `tests/unit/test_capsule_validator.py` adds `test_validator_requires_diagnostics_h5`, `test_validator_requires_environment_yaml`, `test_validator_warns_on_missing_diagnostics_json_sidecar`.
- `tests/unit/test_export_code.py::test_export_code_refuses_self_overwrite` and the matching test in `test_export_data.py` assert source-survival after a self-export attempt.
- `tests/unit/test_export_notebook.py::test_notebook_uses_relative_capsule_path` asserts no absolute path leaks into the notebook source.
- `tests/integration/test_api_server.py` adds `test_get_capsule_diagnostics_json_fallback` and `test_get_capsule_tree_lists_src_files`.
- `tests/unit/test_provenance_sources.py::test_paper_sources_in_default_aggregate_hash`.

### Agent warning
A close commit must verify gate-criterion *behavior*, not just existence. The eight checks for any future close:

1. Every plan §Phase-N gate criterion exercised end-to-end on a real artifact (save → load → run → export → fork → reload).
2. Every documented script path runs successfully on a typical input — `grep -rn "scheduled for Phase" scripts/` returns only stubs in not-yet-opened phases.
3. Every writer that landed in this phase has an integration test proving the producer actually invokes it (round-trip the producer's output through the writer's `load_*`).
4. Every new validator field corresponds to a producer field that was added in the same workstream — diff the validator and producer commits.
5. Every exporter validates the full plan before any destructive op; tests assert source-survival on self-export.
6. Every UI panel that promises to show X has a test that asserts X is in the rendered output, not just that the component file exists.
7. README + CLAUDE.md + milestone + timeline all agree on phase status — `grep -nE "Phase NN" <files>` reads every match.
8. `scripts/build/*.sh` succeeds; the source tree has no `.js` or `.d.ts` artifacts after the build.

A close commit that skips any of these is rolled back, the new patterns are re-read, and the work is finished. Phases 1 and 2 each shipped a false-close — the third has one less excuse.

---

## 2026-05-02: Phase 1 false close — seven legitimate review findings

### Affected subsystem
Repository-wide. Phase 1 close at commit `37132a5` claimed Phase 1 complete; user review identified seven outstanding issues spanning the convention checker, the runtime checkpoint guard, the API server, the `python_cpu` backend's placeholder handling, ruff cleanliness, status sync, and the plan's Phase Gate items.

### Symptoms
1. Phase Gate items 4 and 5 (capsule save / reload) marked Phase-2-deferred without ADR authority. Plan §1772 lists both as Phase 1 close requirements; close commit silently narrowed the contract.
2. Default convention checker still showed 148 checks — same as before any 1C/1D/1E/1F work landed. Completed deliverables remained inside the `--include-open-workstreams` opt-in branch and never ratcheted into the hard gate.
3. `simworkbench.runtime.checkpoint.checkpoint_dir()` ran `mkdir(parents=True, exist_ok=True)` *before* `write_checkpoint()`'s `is_under_workbench()` guard. Regression tests passed because they only asserted the exception, not the absence of `/tmp/checkpoints/` and `~/elsewhere/checkpoints/` on disk.
4. The example ModelSpec flags its rate constant as a placeholder (`coefficient_sources: ["placeholder: ..."]`), but `RunSummary.placeholder_used` always returned False. The `python_cpu` backend used the same `1.0/s` default for placeholder *and* unsourced rates — silent fabrication risk per `agent_error_patterns.md` "Silently inventing missing physical coefficients".
5. `_RUNS` was module-global in `packages/core/src/simworkbench/api/server.py`. `create_app()`'s docstring claimed isolation but the registry leaked across apps. Reordering `test_start_run_executes_simple_rate_equations` before `test_runs_list_initially_empty` flipped the latter from passing to failing.
6. CLAUDE.md "Phase-Specific Operational Notes" still said "Phase 1 has not started" and "Workstreams 1C-1F are pending". The milestone top header said "Complete" but the per-workstream subsections still showed `☐ Open` checkboxes for 1C/1D/1E/1F.
7. `ruff check` produced 28 violations across `packages/core/src/`, `packages/physics_modules/`, and `tests/`. AGENTS.md "Code Style and Module Boundaries" requires ruff clean; the close commit ran pytest + the convention checker but never ran ruff.

### Root cause
Six separate but related agent failure modes, each now logged in `agent_error_patterns.md` as a named pattern:

- *Unilaterally redefining a Phase Gate item during the close* — issue 1.
- *Closing a workstream without promoting its assertions from opt-in to default* — issue 2.
- *Side-effecting before validating* — issue 3.
- *API factory advertises isolation while sharing module-global state* — issue 5.
- *Status-sync that misses CLAUDE.md and per-workstream subsections* — issue 6.
- *Skipping the linter the repo rules require* — issue 7.

Issue 4 (placeholder coefficient handling) is a recurrence of the existing pattern *Silently inventing missing physical coefficients* combined with insufficient API surfacing; the agent treated "placeholder is OK because it's flagged in the YAML" as sufficient when the runtime needs to (a) refuse unsourced non-placeholder rates and (b) propagate `placeholder_used` through the API to the UI.

### Fix
A series of follow-up commits, each addressing one issue in isolation:
- Commit X (this one): reopen Phase 1 status, log this bugfix, add the six new patterns to `agent_error_patterns.md`.
- Subsequent commits: checkpoint guard order, placeholder surfacing + non-fabrication, API state isolation, ruff cleanup + lint script, capsule save/reload (Phase Gate items 4-5), opt-in→default promotion, status sync.
- Final close commit when all seven issues are green AND the default checker covers every Phase 1 entity.

### Regression protection
Each of the six patterns has a Detection section. Where a regression test is feasible:
- Issue 2: convention checker self-check verifies default-mode count is non-decreasing across workstream closes.
- Issue 3: regression test asserts `Path("/tmp/checkpoints").exists()` is False after a refusal — not just that the exception was raised.
- Issue 5: integration test creates two app instances, registers state in one, asserts the other doesn't see it.
- Issue 7: `scripts/test/all.sh` calls `scripts/test/lint.sh` (new) which runs ruff.

### Agent warning
A "close" commit is the moment to be most paranoid, not least. Six checks the agent must run before a close commit:
1. Every plan §Phase-N gate item ticked (or paired with an Accepted ADR deferring it).
2. Default convention checker count strictly higher than at workstream open.
3. Ruff clean.
4. Status grep across README, AGENTS, CLAUDE, program_development, docs_site, apps yields zero contradictory references.
5. Side-effect-before-validate grep clean (any new `mkdir` / `open(..., "w")` in workbench code preceded by a guard).
6. Module-global mutable state grep clean in API factories.

A close commit that skips any of these is rolled back, the patterns are re-read, and the work is finished.

## 2026-05-02: Per-app and per-package `build/` outputs were not gitignored

### Affected subsystem
`.gitignore` (root-level), discovered while opening Workstream 1F.

### Symptoms
`git check-ignore -v apps/workbench-ui/build/foo.js` reported the path was **not** matched by any ignore rule. Same for `packages/core/build/foo.py`. Once the UI ships and its build tool emits to `apps/workbench-ui/build/` (some tools — Astro/CRA — do), those outputs would be staged by accident.

### Root cause
The earlier `build/` → `/build/` fix anchored the rule to the repository root to stop it swallowing `scripts/build/` — correct, but it left every per-app and per-package `build/` directory unprotected. The `bugs_and_fixes/agent_error_patterns.md` "Bare gitignore globs" pattern explicitly prescribes the full fix:
> Anchor build-output ignores to where they are produced:
> - `/build/` for top-level outputs
> - `apps/*/build/` for per-app outputs
> - `packages/*/build/` for per-package Python build artifacts (if used)

The first bullet was applied earlier; the other two were not. The Workstream 1F open ran the bug-memory grep procedure, which surfaced the pattern, then ran `git check-ignore -v apps/workbench-ui/build/foo.js` and confirmed the gap.

### Fix
Added `apps/*/build/` and `packages/*/build/` to `.gitignore` directly below `/build/`. Reality-test reconfirms: `apps/workbench-ui/build/foo.js` and `packages/core/build/foo.py` are now ignored, while `scripts/build/ui.sh` and `scripts/build/.gitkeep` remain tracked.

Caught and fixed as part of the Workstream 1F open commit.

### Regression protection
- `scripts/dev/check_repo_conventions.sh` extended with a "build/ output ignore tiers" section that probes `apps/workbench-ui/build/`, `packages/core/build/`, and `/build/` and asserts each is matched by an ignore rule. Cross-references the existing source-paths-not-ignored regression which asserts `scripts/build/ui.sh` is NOT ignored. Both regressions live in the default checker so a future overly-narrow change shows up immediately.

### Agent warning
When you anchor a `build/` ignore, do not stop at `/build/`. The pattern requires `/build/` AND `apps/*/build/` AND `packages/*/build/` together — root-anchored alone leaves per-app and per-package outputs exposed. After any `.gitignore` change, run `git check-ignore -v` against probes in every directory tier (`apps/<name>/build/`, `packages/<name>/build/`, `/build/`, `scripts/build/<name>`) before commit.

## 2026-05-02: Open workstream TODOs broke the default test gate

### Affected subsystem
`scripts/dev/check_repo_conventions.sh`, `scripts/test/all.sh`, Phase 1 milestone tracking.

### Symptoms
Opening Phase 1 Workstreams 1C, 1D, and 1E inserted intentionally failing TODO assertions into the default convention checker. As a result, `./scripts/test/all.sh` failed before running pytest even though the implemented 1A/1B unit and integration tests were green. The TODO backlog also under-covered the plan: the 1C progress test was missing, the `run_backend.sh` Phase-0 stub satisfied only the generic executable check, and the 1D module template source/test files were not asserted.

### Root cause
The checker mixed two different concepts: hard repository invariants for completed work and intentionally failing assertions for open implementation backlog. Because `scripts/test/all.sh` calls the default checker, expected TODO failures became normal test failures. The workstream-opening checklist also counted grouped prose instead of every named file/assertion.

### Fix
Split the convention checker into default hard-gate mode and opt-in open-workstream mode. `scripts/dev/check_repo_conventions.sh` now passes for completed repository invariants, while `scripts/dev/check_repo_conventions.sh --include-open-workstreams` exposes the 1C/1D/1E backlog. Added missing opt-in assertions for `tests/unit/test_runtime_progress.py`, the real `scripts/dev/run_backend.sh` implementation, and `packages/physics_modules/templates/module_template/{src/__init__.py,tests/test_template.py}`. Updated README, docs, milestone notes, `AGENTS.md`, and `CLAUDE.md`.

### Regression protection
- `tests/regression/test_convention_checker_modes.py` asserts that default checker mode passes while opt-in mode reports the current corrected Phase 1 backlog.
- `scripts/test/all.sh` continues to call only default checker mode before running pytest.

### Agent warning
Do not put intentionally failing workstream TODO assertions in the default checker path. The default convention checker is the hard gate for completed work; open backlog belongs behind `--include-open-workstreams` and must not break the normal test runner.

## 2026-05-02: Phase 1A/1B gate overstated implementation completeness

### Affected subsystem
`packages/core/src/simworkbench/{model_spec,experiment,serialization,units}/`, `scripts/test/`.

### Symptoms
Phase 1 Workstreams 1A and 1B were documented around ModelSpec and units, but verification found plan-level gaps:

- Workstream 1A had ModelSpec but not `Experiment`, `RunConfig`, `DiagnosticConfig`, `BackendConfig`, or experiment save/load.
- ModelSpec unit enforcement only covered typed `Quantity` fields; raw floats passed through flexible dictionaries such as `fields.initialization` and `interactions.valid_regime`.
- Several plan §8.2 ModelSpec validation rules were missing: missing species, unknown equation references, missing coefficient sources, unsupported backends, unknown validity-regime keys, missing spatial bounds, and missing spatial boundary conditions.
- `scripts/test/*.sh` used ambient `python`, so tests failed outside an activated `.venv` even though the repo-local virtualenv had the required dependencies.
- README status text still described Phase 0 while the phase table showed Phase 1 in progress.

### Root cause
The convention checker and milestone notes verified file presence and the ModelSpec slice, not the complete Workstream 1A deliverable list or behavioral validator coverage. Flexible `dict[str, Any]` fields created a unit-validation escape hatch. Test wrappers assumed the user's shell had already activated the repo virtualenv.

### Fix
Implemented `simworkbench.experiment` with `Experiment`, `RunConfig`, `DiagnosticConfig`, and `BackendConfig`. Added `simworkbench.serialization` experiment YAML save/load helpers. Hardened ModelSpec validators for flexible parameter dictionaries and the missing plan §8.2 checks listed above. Updated test wrappers to prefer `.venv/bin/python`. Synced README, docs, milestone, timeline, convention checker, and regression records.

Commit: `f90a56a` (`Complete Phase 1A core model and harden units validation`).

### Regression protection
- `tests/unit/test_modelspec.py` now covers raw numeric bypasses, missing species, unknown equation refs, missing coefficient sources, unsupported backends, unknown validity-regime keys, and missing spatial bounds/boundary conditions.
- `tests/unit/test_experiment.py` covers core experiment/config models.
- `tests/integration/test_experiment_save_load.py` covers experiment YAML save/load.
- `scripts/dev/check_repo_conventions.sh` now asserts the new implementation/test files and test-wrapper virtualenv behavior.

### Agent warning
Do not treat one slice of a workstream as the full workstream. Translate every named plan deliverable into implementation and tests. Avoid `dict[str, Any]` at scientific boundaries unless it has recursive validation that rejects raw physical numbers.

## 2026-05-02: Phase 0 gate false positive for missing skeleton files

### Affected subsystem
Repository bootstrap / convention checker / development history.

### Symptoms
Phase 0 was marked complete even though several plan-required or README-advertised artifacts were missing:

- milestone files existed only for Phase 0-5 and several filenames did not match plan phase numbers;
- `apps/workbench-ui/package.json`, `apps/workbench-ui/tsconfig.json`, `packages/core/pyproject.toml`, and `packages/core/src/simworkbench/__init__.py` were absent despite the plan's initial tree;
- README-documented wrapper scripts such as `scripts/docs/dev.sh`, `scripts/docs/build.sh`, and `scripts/test/all.sh` did not exist;
- `README.md` still marked Phase 0 as in progress while the milestone/timeline marked it complete.

### Root cause
The Phase 0 convention checker verified broad directories and a small milestone subset, but did not verify the full plan-matching skeleton, executable documented scripts, or Phase 0-10 milestone coverage. Documentation and milestone status drifted after the gate was marked as passed.

### Fix
Added the missing Phase 0 package skeleton files, documented command wrappers, and plan-matching milestone files for Phase 0 through Phase 10. Removed stale Phase 2-5 milestone filenames. Extended `scripts/dev/check_repo_conventions.sh` to verify the missing package files, executable scripts, and all Phase 0-10 milestone files. Updated README, docs-site pages, development timeline, and bug-memory records to reflect the corrected gate.

Commit: `11e04f1` (`Fix Phase 0 bootstrap gate coverage`).

### Regression protection
- `scripts/dev/check_repo_conventions.sh` now checks all corrected artifacts and passes with 116 checks.
- `bugs_and_fixes/regression_tests.md` cross-lists this convention checker guard.

### Agent warning
Do not mark a phase gate complete from directory-level checks alone. Check the exact deliverables named by the plan, README command paths, and development-history naming rules.

## 2026-05-02: Bare `build/` ignore rule swallowed `scripts/build/`

### Affected subsystem
`.gitignore` (root-level)

### Symptoms
Files placed under `scripts/build/` (intended location of build scripts per the planned §19 commands like `scripts/build/ui.sh`) were silently ignored by git. `git check-ignore` traced the match to `.gitignore:18:build/`. The convention checker still passed because it only verified directory existence, not that the directory's *contents* were trackable.

### Root cause
The plan §3.2 specifies a bare `build/` ignore rule, intended for top-level Node/Vite build output. As written, `build/` matches every directory named `build` anywhere in the tree — including `scripts/build/`, which we explicitly use for build scripts.

Once a directory is ignored, gitignore's negation rules cannot re-include files inside it: "It is not possible to re-include a file if a parent directory of that file is excluded." So a simple `!scripts/build/` does not solve it.

### Fix
Replaced `build/` with `/build/` in `.gitignore`, anchoring the rule to the repository root. Added an inline comment explaining why and warning future agents not to reintroduce a bare `build/`. Top-level Node/Vite/Python build artifacts still get ignored; `scripts/build/`, `packages/<x>/build/`, and any other nested `build/` directory remain trackable.

Commit: `db040b6` (`Bootstrap Phase 0: governance, docs, bug memory, and autonomous git`).

### Regression protection
- Added `scripts/build/.gitkeep` so the directory is staged.
- Documented the trap in `agent_error_patterns.md` (entry: "Bare gitignore globs that conflict with project directories").
- Extended `scripts/dev/check_repo_conventions.sh` to verify representative source paths under `scripts/build/`, `scripts/dev/`, `scripts/test/`, `scripts/docs/`, `packages/physics_modules/`, `apps/workbench-ui/`, and `docs_site/` are not gitignored.

### Agent warning
Do not generalize a `build/` ignore rule across the whole tree. Project directories whose name happens to be `build` exist deliberately. Anchor build-output ignores to the place they are produced, or use specific patterns like `apps/*/build/`.
