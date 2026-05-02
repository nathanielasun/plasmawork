# ADR-0003: Use ModelSpec as the Intermediate Representation Between Papers and Experiments

## Status
Accepted

## Date
2026-05-02

## Context
The platform must transform scientific papers into runnable, validated simulations. Two extreme designs were possible:

1. **Paper → code directly.** An agent reads the paper and emits Python. Fast to demo, impossible to validate, impossible to compose, impossible to reuse modules.
2. **Paper → structured ModelSpec → code.** The structured intermediate representation acts as the contract: validation runs against it, modules map onto it, code generation is mechanical, and the same ModelSpec can target multiple backends.

Plan §1 and §8 prescribe option 2. This ADR records the decision and freezes the high-level shape of the IR so that later phases can extend it without re-litigating its existence.

## Decision

**All paper-derived simulations pass through a structured ModelSpec.** Direct paper→code generation is forbidden. The ModelSpec is the unique entry point for the codegen, registry mapping, validation, and backend selection systems.

**ModelSpec format**: YAML, JSON-schema-validated. Top-level sections (plan §8.1):

- `model` — name, version, domain, description
- `sources` — papers (title, DOI, local path, extracted sections)
- `geometry` — dimensionality (0/1/2/3), coordinate system, domain bounds, boundary conditions
- `species` — name, type, charge, mass (with units), internal states, initial density
- `fields` — name, type, initialization, evolution equation
- `interactions` — name, participants, equation refs, coefficient sources, valid regime
- `equations` — id, latex, description, assumptions, units_checked
- `solvers.recommended` — name, reason, backend compatibility
- `diagnostics` — name, quantity, output format, visualization
- `validation` — expected limits, paper figures to reproduce, conservation laws, convergence requirements

**Validation rules** (plan §8.2): the ModelSpec validator checks for missing units, missing species, unknown interaction participants, inconsistent dimensionality, invalid solver compatibility, missing boundary conditions, unsupported backend requirements, missing coefficient sources, unknown validity regimes, and diagnostics referencing nonexistent quantities.

**Versioning**: schema is versioned (`schema_version: 0.1` to start). Breaking changes increment major version and require migration hooks in `packages/core/src/simworkbench/model_spec/migrations/`.

**Units**: every physical quantity in a ModelSpec carries explicit units. The units subsystem (Phase 1B) enforces this on load. Raw floats for physical quantities are rejected at the ModelSpec boundary.

## Alternatives considered

- **Direct paper→code**: rejected for the reasons above.
- **A class hierarchy in Python instead of a YAML schema**: rejected. A serializable text IR is portable across languages, diffable, version-controllable, and survives capsule export. A class hierarchy is a representation of the IR in memory, not the IR itself; we will of course also have one (`packages/core/src/simworkbench/model_spec/types.py`).
- **JSON instead of YAML**: rejected for the human-authoring case. Equation strings and multi-line descriptions are friendlier in YAML. JSON Schema still validates YAML. JSON-only could be revisited if YAML's edge cases (booleans, anchors) cause problems.
- **A general physics ontology like CellML / SBML / FMI**: deferred. These are valuable but heavy and laser-physics-imperfect. The ModelSpec is intended to be a project-specific format that can later interoperate with established standards via importers/exporters in `packages/agent_orchestration/`.

## Consequences

**Positive**
- The ModelSpec is the validation surface — every check has one place to live.
- Module retrieval, gap analysis, and codegen all operate on the same input.
- A ModelSpec can target multiple backends without regeneration.
- Capsules carry a ModelSpec, making the scientific intent of every experiment legible.

**Negative**
- Up-front schema work is required before any simulation is generated.
- Adding a new physics concept (e.g. radiative transfer) requires extending the schema and its validator.
- Agents must learn the schema; they cannot fall back to free-form code.

**Neutral**
- The schema will evolve. Migrations are first-class. Old capsules carry their schema version and are migrated on load.

## Implementation notes
- Phase 1A defines the v0.1 schema and types.
- Phase 1B adds the units subsystem and integrates it with ModelSpec validation.
- Phase 5A produces the agent that generates ModelSpecs from interpreted papers.
- Phase 5B/5C produce the registry-mapping and gap-analysis layers that consume ModelSpec.
- Any future ADR proposing a parallel IR (e.g. for live experiment control) must explain why it cannot be a ModelSpec extension.
