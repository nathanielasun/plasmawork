# Regression Tests

Index of regression tests and the bugs they protect against. Every entry in `bugfixes.md` should appear here.

| Bug entry | Test path | What it asserts |
|---|---|---|
| 2026-05-07 — Secure-core Layer-4 route and worker hardening | `packages/secure_core/test/routes/{workspaces,capsules,tools,runs,artifacts,approvals,operator,bootstrap,health}.test.ts`; `packages/secure_core/test/workers/{tokenRoute,uploadRoute}.test.ts`; `packages/secure_core/test/operatorService.test.ts`; `scripts/dev/check_repo_conventions.sh` | Protected route bodies run audit-aware validation; storage/hash/status fields are server-derived; high-risk workspace/operator actions require approval and commit-time checks; worker uploads validate declared size and commit all derived quota; operator remediation fails closed until side effects are real. |
| 2026-05-06 — Secure-core Layer-2 traversal and input-boundary hardening | `packages/secure_core/test/paths/safeOpen.test.ts`; `packages/secure_core/test/paths/extractArchive.test.ts`; `packages/secure_core/test/middleware/validateInputSchema.test.ts`; `packages/secure_core/test/middleware/requireAuth.test.ts`; `packages/secure_core/test/middleware/compose.test.ts`; `packages/secure_core/test/paths/builder.test.ts`; `scripts/dev/check_repo_conventions.sh` | Direct safe-open traversal does not create outside files, archive extraction refuses destination-side symlink escapes, forbidden body fields are rejected recursively including aliases and wildcard hashes, bearer session tokens are refused, middleware order drift fails at registration, and workspace paths do not duplicate the `workspaces/` namespace. |
| 2026-05-06 — Secure-core Layer-1 ADR audit fixes | `packages/secure_core/test/secrets/client.test.ts`; `packages/secure_core/test/db/schema.test.ts`; `packages/secure_core/test/errors/shapes.test.ts`; `packages/secure_core/test/config/constants.test.ts`; `scripts/dev/check_repo_conventions.sh`; `npm --prefix packages/secure_core audit` | Secrets provider dispatch is real and non-leaking, anchor rows require version-pinned external references, app and anchor-writer DB roles cannot over-mutate anchors, error details redact forbidden keys, high-risk actions map to typed capabilities, dependency audit is clean, and the convention checker owns L1.6/L1.8 invariants. |
| 2026-05-04 — Phase 7 post-close audit | `tests/regression/test_module_registry_promotion_gates.py`; `tests/regression/test_phase7_module_metadata_integrity.py`; `scripts/dev/check_repo_conventions.sh` | Module lifecycle promotion cannot bypass approval/test gates, invalid module metadata fails discovery, Phase 7B plan-named modules/artifacts exist, stale test/benchmark metadata paths are caught, and validated modules win equal-score matching ties. |
| 2026-05-02 — Open workstream TODOs broke the default test gate | `tests/regression/test_convention_checker_modes.py`; `scripts/dev/check_repo_conventions.sh`; `scripts/test/all.sh` | Default convention checking remains green for completed work, open Phase 1 backlog is opt-in, and missing 1C/1D TODO assertions stay visible. |
| 2026-05-02 — Phase 1A/1B gate overstated implementation completeness | `tests/unit/test_modelspec.py`; `tests/unit/test_experiment.py`; `tests/integration/test_experiment_save_load.py`; `scripts/dev/check_repo_conventions.sh` | Workstream 1A has Experiment/config/save-load coverage; ModelSpec flexible dicts cannot bypass unit enforcement; test wrappers prefer the repo virtualenv. |
| 2026-05-02 — Phase 0 gate false positive for missing skeleton files | `scripts/dev/check_repo_conventions.sh` | All Phase 0 skeleton/package/script files and Phase 0-10 milestone files exist, and documented scripts are executable. |
| 2026-05-02 — Bare `build/` swallowed `scripts/build/` | `scripts/dev/check_repo_conventions.sh` | `scripts/build/<file>` and other project-owned source directories are not gitignored. |

---

## How to add an entry

When you add a regression test:

1. Place the test under `tests/regression/test_<short_topic>.py` (or `.ts` for UI-side).
2. Add a row above with the bug entry's date and title, the test path, and a one-line description of the invariant it asserts.
3. Cross-reference this row from the bugfix entry's "Regression protection" section.

## Conventions

- Regression tests must be deterministic. Mark non-deterministic tests with `@pytest.mark.flaky` only after investigating the root cause.
- Regression tests must run in CI on every PR. They are not optional, even when slow — split a slow test out into `tests/performance/` if needed and keep a fast guard in `tests/regression/`.
