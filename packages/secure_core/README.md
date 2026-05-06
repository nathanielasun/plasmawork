# `packages/secure_core/`

Secure multi-user authentication, workspace isolation, sandbox, and audit
substrate for the Scientific Simulation Workbench.

**Status:** Layer-1 primitives implemented. The package contains the
accepted ADR-backed constants, cryptography helpers, error envelope,
test fixtures, secrets wrapper, audit logger, and schema/migration
substrate. Layer-2 middleware and the secure HTTP server are not yet
implemented.

## Reading order for incoming agents

1. `secure_multi_user_scaffolding_plan_v4.md` (repo root) — design contract.
2. `security_review_v4_and_decomposability.md` (repo root) — verification +
   decomposition assessment.
3. `program_development/phase_05_security_implementation_plan.md` — the
   task graph, gates, review checks, and Definition of Done.
4. `program_development/architectural_decisions/ADR-0008` through `ADR-0012`
   — the five accepted Layer-0 architectural decisions.
5. `IMPLEMENTATION_MANIFEST.md` — project layout, error shape, fixture
   conventions, per-endpoint canonical recipe.

## Current boundary

This package is a parallel secure-core substrate. The existing FastAPI
workbench remains the active single-user API until the later middleware,
route, and cut-over layers land.
