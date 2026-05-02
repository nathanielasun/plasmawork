# tests/

Phase 1A/1B includes unit and integration tests for ModelSpec, units, the core
Experiment model, and experiment YAML save/load. Scientific runtime, module,
and UI tests continue to land as the corresponding workstreams are implemented.

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

The test scripts prefer `.venv/bin/python` when it exists, so running
`./scripts/dev/install.sh` once is enough for the wrapper commands to use the
repo-local dependencies.

`./scripts/test/all.sh` runs the default convention checker and the current test
suite. Open-workstream TODO assertions are opt-in and live behind
`./scripts/dev/check_repo_conventions.sh --include-open-workstreams`, because
unfinished backlog checks must not break the normal test runner.
