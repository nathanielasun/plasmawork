# Phase 4 — Agent-Assisted Paper Ingestion

**Status: Not started**

> Note: the plan numbers Phase 4 as "Agent-Assisted Paper Ingestion" (plan §Phase 4). The filename keeps the original plan's placeholder convention; the content below tracks the actual Phase 4.

## Objective
Enable agents to read scientific papers and generate structured interpretation artifacts, *without* yet autonomously producing trusted simulations. (Plan §Phase 4.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 4A | Paper Import System | PDFs into capsule, extract text/tables/figures metadata |
| 4B | Equation Extraction | extract, store JSON, link to sections, flag OCR uncertainty, allow human correction |
| 4C | Parameter Extraction | constants, sim parameters, units, tables, missing-units flagging |
| 4D | Scientific Interpretation Agent | identify system, species, interactions, approximations, regimes, diagnostics, validation targets |
| 4E | Review UI | display extracted artifacts, allow edits, track edits in provenance |

## Phase Gate
Phase 4 is complete when a paper can be imported and converted into human-reviewable scientific interpretation artifacts (`paper_summary.md`, `assumptions.md`, `validity_domain.md`, `implementation_plan.md`).

## Hard rules carried forward
- Agents do not produce trusted simulations in this phase. Only interpretation artifacts.
- All outputs require human review before they feed Phase 5 ModelSpec generation.
