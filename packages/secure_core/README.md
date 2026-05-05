# `packages/secure_core/`

Secure multi-user authentication, workspace isolation, sandbox, and audit
substrate for the Scientific Simulation Workbench.

**Status:** unimplemented. This directory is the destination for Phase 0.5
work; until Layer-1 begins it contains only the manifest that pins the
project's conventions.

## Reading order for incoming agents

1. `secure_multi_user_scaffolding_plan_v4.md` (repo root) — design contract.
2. `security_review_v4_and_decomposability.md` (repo root) — verification +
   decomposition assessment.
3. `program_development/phase_05_security_implementation_plan.md` — the
   task graph, gates, review checks, and Definition of Done.
4. `program_development/architectural_decisions/ADR-0008` through `ADR-0012`
   — the five Layer-0 architectural decisions (Proposed; flip to Accepted
   before Layer-1 starts).
5. `IMPLEMENTATION_MANIFEST.md` — project layout, error shape, fixture
   conventions, per-endpoint canonical recipe.

## Why empty

Layer 0 (the five ADRs + this manifest + the v4 residual fixes) must be
Accepted by the human owner before Layer 1 begins. The artifacts exist;
the implementation does not. Per the implementation plan §2, Layer 1
starts after Gate G2 closes.
