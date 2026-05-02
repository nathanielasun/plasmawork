# bugs_and_fixes/

This directory is the **bug memory** for the Scientific Simulation Workbench. Coding agents and human contributors must consult it before modifying any subsystem with prior bugs, and must update it whenever they fix a bug or hit a known failure mode.

## Files

| File | Purpose |
|---|---|
| `bugfixes.md` | Chronological log of resolved bugs, with root cause, fix, and regression protection |
| `known_failures.md` | Open / unresolved limitations and their workarounds |
| `regression_tests.md` | Mapping of regression tests to the bugs they protect against |
| `agent_error_patterns.md` | Recurring agent mistakes — what to avoid and why |
| `program.log.example` | Template for the runtime log (`program.log` itself is gitignored) |

## Workflow

### When you fix a bug

1. Add an entry to `bugfixes.md` using the template at the top of that file.
2. Add or extend a regression test under `tests/regression/` and reference it in the bugfix entry and in `regression_tests.md`.
3. If the bug exposed a category of agent mistake, add it to `agent_error_patterns.md`.

### When you hit a limitation that won't be fixed immediately

1. Add an entry to `known_failures.md`.
2. Cross-reference any related GitHub issue or ADR.

### Before modifying a subsystem

```bash
grep -nE "<subsystem-keyword>" bugs_and_fixes/bugfixes.md bugs_and_fixes/known_failures.md bugs_and_fixes/agent_error_patterns.md
```

If matches exist, read them. Run the linked regression test before and after your change.

## What this is not

This is not a changelog and not an issue tracker. It is institutional memory designed to keep agents from re-introducing fixed bugs. Do not file feature requests here.
