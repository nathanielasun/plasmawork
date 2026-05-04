# Changelog

## 0.1.0 — 2026-05-03 — Phase 7 / 7B

- Status: `candidate` → `validated`.
- Added Registry v1 metadata: dependencies, benchmarks, compatibility.
- Added benchmarks:
  - `first_order_decay` — single-species exponential decay vs analytic
    closed form, 1e-4 relative tolerance.
  - `two_species_conversion` — mass conservation across A → B at rate
    k, 1e-6 relative drift.
- Added validity domain doc + equations doc + assumptions doc.
- Phase-1 backend's runtime gained 1- and 2-participant arity coverage
  (Phase 6 audit). 3+ participant interactions raise an explicit
  error.
