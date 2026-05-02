# ADR-0001: Project Scope and Initial Domain Focus

## Status
Accepted

## Date
2026-05-02

## Context
The plan in `scientific_simulation_workbench_agent_plan.md` describes a platform that could in principle cover most of computational physics — laser physics, fusion, plasma kinetics, molecular dynamics, phase transitions, Monte Carlo transport, PDE field simulations, and spectroscopy. Attempting all of these in parallel would (a) make every abstraction premature, (b) prevent any single domain from receiving the validation depth it requires, and (c) blur the boundary between trusted and exploratory results.

Plan §1 explicitly directs the project to be **narrow in initial goal but general in abstractions**. We need a written commitment to that scope to keep agents from drifting.

## Decision

**Initial scope.** The first scientifically validated domain is **laser–species interaction** with focus on:

- 0D rate-equation models for laser-driven species kinetics,
- Gaussian / pulsed laser source modules,
- absorption, emission, excitation, ionization, recombination rate processes,
- KrF excimer as the canonical worked example (per plan §18.1).

**General abstractions.** The internal interfaces — `ModelSpec`, `BaseTool`, `SolverBackend`, `SimulationCapsule`, units subsystem, registry, validation framework — are designed from day one to support adjacent domains:

- molecular dynamics,
- phase-transition / lattice models (Ising, Potts),
- PDE-based field simulations,
- Monte Carlo transport,
- plasma kinetics and PIC interfaces.

A second-domain example (Lennard-Jones MD or 2D Ising — plan §23 #18) ships in MVP to *prove* the abstractions are general, not to validate the second domain scientifically.

**Explicitly out of scope for MVP** (plan §23): autonomous paper-to-simulation generation, HPC backends, GPU kernels, parameter-sweep optimization, uncertainty quantification. Those are Phase 4+.

## Alternatives considered
- **Multi-domain breadth from day one**: rejected. Forces premature abstraction and dilutes validation effort.
- **Pure laser–species, no second-domain example**: rejected. Without a second domain, we cannot tell whether our abstractions are general or whether we have hidden laser-physics assumptions in the core.
- **Start with HPC / GPU**: rejected. Per plan §1.3, hardware specialization is layered under a stable interface, but the interface must exist first.

## Consequences

**Positive**
- Validation effort concentrates on one domain, which can reach `validated`/`trusted` status.
- Abstractions get stress-tested by a second domain without that domain demanding completeness.
- Agents have clear acceptance criteria for "done" — the laser-species example must work end-to-end.

**Negative**
- Some users with non-laser interests will see incomplete physics for their domain.
- Generality can only be claimed after the second-domain example proves the abstractions hold.

**Neutral**
- The plan's later phases (HPC, sweeps, autonomy) inherit the same scope discipline: each phase ships when its gate criteria are met, not when its name sounds done.

## Implementation notes
- Phase 1 workstreams 1A–1F (plan §Phase 1) implement the manual workbench within the laser-species scope.
- Phase 7 (validated module registry) is the first time non-laser modules receive deep validation.
- All ADRs that *narrow* the laser-species focus further (e.g. specific rate-coefficient sources) can be filed without revisiting this ADR. ADRs that *broaden* the MVP scope (adding a second validated domain to MVP) must reference and supersede this one.
