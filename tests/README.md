# tests/

Phase 0 creates the test layout and convention guards. Scientific runtime,
module, and UI tests begin in Phase 1+ as the corresponding subsystems land.

## Layout

| Directory | Purpose |
|---|---|
| `unit/` | Fast tests for isolated functions and schema logic |
| `integration/` | Cross-package and API boundary tests |
| `regression/` | Tests linked to entries in `bugs_and_fixes/bugfixes.md` |
| `validation/` | Scientific property tests: dimensions, conservation, analytical limits, convergence, benchmark reproduction |
| `performance/` | Performance checks that must not relax scientific correctness |

## Commands

```bash
./scripts/test/all.sh
./scripts/test/unit.sh
./scripts/test/integration.sh
./scripts/test/regression.sh
./scripts/test/validation.sh
./scripts/test/performance.sh
```

In Phase 0, the regression command runs `scripts/dev/check_repo_conventions.sh`, which is the active regression guard for repository bootstrap invariants.
