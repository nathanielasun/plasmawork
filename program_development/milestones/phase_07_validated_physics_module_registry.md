# Phase 7 — Validated Physics Module Registry

**Status: Complete (2026-05-03; post-close audit fixed 2026-05-04).** All five workstreams 7A–7E shipped. The post-close audit moved module promotion gates into `ModuleRegistry.set_status`, added exact Phase 7B plan-named module paths, and made stale metadata paths fail regression checks.

## Objective
Move from one-off generated simulations to reusable validated scientific modules. (Plan §Phase 7.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 7A | Registry Maturation | lifecycle, versioning, dependency metadata, benchmark references, compatibility metadata |
| 7B | Laser-Species Modules | laser pulse, absorption, emission, excitation, ionization, recombination, electron temperature, species density, stiff rate-equation adapter |
| 7C | Plasma Modules | electromagnetic fields, particle pusher interface, PIC adapter, collisional models, boundary-condition library |
| 7D | General Physics Examples | molecular dynamics, Ising/Potts, wave equation, reaction-diffusion |
| 7E | Validation Library | analytic benchmarks, paper reproduction, conservation, convergence, cross-solver comparison |

## Phase Gate
Phase 7 is complete when core modules are reusable, documented, tested, and validated for explicit regimes.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 7:

- ☑ Laser-species modules under `packages/physics_modules/laser/{absorption,emission,excitation,ionization,recombination}/` and `packages/physics_modules/species/{electron_temperature,species_density}/`, each with `module.yaml`, `src/`, `tests/`, `benchmarks/`, `assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`.
- ☑ Stiff rate-equation solver adapter under `packages/physics_modules/species/rate_equation_0d/`.
- ☑ Plasma modules under `packages/physics_modules/plasma/` (electromagnetic fields, particle pusher interface, PIC adapter, collisional model, boundary-condition library).
- ☑ Generality proofs: a molecular-dynamics module, an Ising/Potts module, a wave-equation module, and a reaction-diffusion module each transition `candidate → validated` against an analytic or benchmark reference.
- ☑ Validation library at `tests/validation/` covers conservation, convergence, paper reproduction, and cross-solver comparison.
- ☑ Registry v1 metadata: `module.yaml` fields for dependencies, benchmarks, and compatibility are populated for every validated module.
- ☑ `configs/agents.yaml` — `release` role flipped to `enabled: true`.
- ☑ Regression tests in `tests/regression/` cover every bug already logged in `bugs_and_fixes/bugfixes.md` for the affected module families.

Note: additional Phase 7B modules added during the 2026-05-04 audit remain `candidate` until a human reviewer supplies approval tokens and benchmark evidence. Agents may not promote them directly.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 7 row, `timeline.md`, every promoted module's `module.yaml` lifecycle field, and any docs page that named "Phase 7 — pending".
