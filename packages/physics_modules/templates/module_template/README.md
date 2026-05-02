# module_template

Phase 1D module template. Copy this directory to
`packages/physics_modules/<domain>/<name>/` and edit:

1. `module.yaml` — fill in `name`, `domain`, `description`, `inputs`/`outputs`
   with real units, and `validity_domain`. Keep `status: draft` until tests
   pass, then move to `candidate`.
2. `src/__init__.py` — implement the module. Public functions take and return
   `simworkbench.units.Q` quantities at the boundary; raw floats stay inside.
3. `tests/test_<name>.py` — at minimum a unit test for the I/O contract and a
   test for one limiting / analytical case.
4. Add `assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`,
   and `examples/` before promoting to `validated`.

## Lifecycle

- `draft` — initial copy, may not run.
- `candidate` — runs, has tests, has units, has docs.
- `validated` — passes benchmark / limiting-case validation; reviewed.
- `trusted` — repeatedly validated, multi-reviewer approval.
- `deprecated` — replaced or no longer recommended.

Promotion criteria: plan §14.3 and `bugs_and_fixes/agent_error_patterns.md`
"Marking a phase gate complete with incomplete deliverable checks".
