# program_development/

Implementation history and architectural decision record for the Scientific Simulation Workbench.

## Files

| Path | Purpose |
|---|---|
| `timeline.md` | Chronological log of major implementation milestones |
| `architectural_decisions/ADR-NNNN-*.md` | Architectural decision records |
| `milestones/phase_NN_*.md` | Phase-level milestone notes and gate criteria |

## When to update

- **Timeline**: any milestone-relevant change. Append a dated entry summarizing what was completed, what changed, open questions, and next steps.
- **ADRs**: any decision that constrains future work — file format, IR schema, dependency choice, abstraction boundary, agent autonomy gate. ADRs are numbered sequentially and use the template in `architectural_decisions/_template.md` (or the format in plan §6.2). Once Accepted, ADRs are not rewritten — supersede them with a new ADR.
- **Milestones**: when a phase begins, ends, or its gate criteria change.

## Numbering

ADRs use four-digit zero-padded numbers: `ADR-0001`, `ADR-0002`, etc. The first three are reserved:

- `ADR-0001-project-scope.md`
- `ADR-0002-simulation-capsule-format.md`
- `ADR-0003-model-spec-ir.md`

Phase milestone files use `phase_NN_<short_name>.md` matching the phase numbers in the agent plan (Phase 0 through Phase 10).
