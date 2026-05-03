# Phase 4 — Agent-Assisted Paper Ingestion

**Status: Complete (opened 2026-05-02; closed 2026-05-02). All five workstreams 4A, 4B, 4C, 4D, 4E shipped.**

## Objective
Enable agents to read scientific papers and generate structured interpretation artifacts, without yet autonomously producing trusted simulations. (Plan §Phase 4.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 4A | Paper Import System | PDFs into capsule, extracted text/tables/figure metadata, source preservation |
| 4B | Equation Extraction | equation JSON, source links, OCR uncertainty, human correction |
| 4C | Parameter Extraction | constants, simulation parameters, units, table values, missing-unit flags |
| 4D | Scientific Interpretation Agent | system, species, interactions, approximations, valid regimes, diagnostics, validation targets |
| 4E | Review UI | extracted artifacts, assumptions, edits, provenance tracking |

## Phase Gate
Phase 4 is complete when a paper can be imported and converted into human-reviewable scientific interpretation artifacts.

## Hard rules carried forward
- Agents do not produce trusted simulations in this phase. Only interpretation artifacts.
- All outputs require human review before they feed Phase 5 ModelSpec generation.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 4:

- ☑ `packages/agent_orchestration/src/paper_ingestion/__init__.py` — paper import pipeline.
- ☑ `packages/agent_orchestration/src/equation_extraction/__init__.py` — equation extractor with confidence flags.
- ☑ `packages/agent_orchestration/src/paper_ingestion/parameter_extractor.py` — flags missing units.
- ☑ `configs/agents.yaml` — `paper_ingestion`, `physics_interpretation`, and `security_sandbox` roles flipped to `enabled: true`.
- ☑ Review UI panel in `apps/workbench-ui/` renders extracted equations, parameters, assumptions, and tracks edits in provenance.
- ☑ One real paper-to-interpretation run produces all five artifacts: `paper_summary.md`, `extracted_equations.json`, `extracted_parameters.yaml`, `assumptions.md`, `validity_domain.md`, `implementation_plan.md`.
- ☑ `tests/integration/test_paper_ingestion_roundtrip.py` covers a small sample paper end-to-end.
- ☑ `docs_site/src/content/agent_workflows.tsx` — Phase-0 banner replaced; ingestion stage documented.
- ☑ `bugs_and_fixes/agent_error_patterns.md` — paper-ingestion-specific patterns added if any are observed.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 4 row, `timeline.md`, `configs/agents.yaml`, and any docs page that named "Phase 4 — pending".
