# Regression Tests

Index of regression tests and the bugs they protect against. Every entry in `bugfixes.md` should appear here.

| Bug entry | Test path | What it asserts |
|---|---|---|
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
