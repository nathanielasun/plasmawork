# Phase 4 — Agent-Assisted Paper Ingestion

**Status: Not started**

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
