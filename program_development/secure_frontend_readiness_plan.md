# Secure Frontend Readiness Plan

**Date:** 2026-05-07
**Status:** Open implementation plan
**Scope:** Work required before a comprehensive secure multi-user frontend is built on top of `packages/secure_core/`.

This plan converts the current security review into frontend-readiness work. It covers quick fixes that unblock UI planning and deeper backend/platform work that must be stable before the frontend becomes the product surface for multi-user operation.

## Goals

1. Give frontend code a stable, typed API contract rather than requiring each component to infer route behavior from Fastify plugins.
2. Make readiness explicit: ready, fail-closed, deployment-gated, or planned.
3. Keep security controls server-derived. The frontend may present capability-informed affordances, but it must not become the enforcement layer.
4. Preserve the existing visual system in `STYLING.md` and the canonical docs-source rule in `docs_site/src/content/`.
5. Keep progress reporting synchronized in `README.md`, `program_development/timeline.md`, and this plan.

## Styling and UI Reference

Frontend implementation must read `STYLING.md` before new components land.

Use these UI primitives and tokens:

- `apps/workbench-ui/src/components/ui/Card.tsx`
- `apps/workbench-ui/src/components/ui/Pill.tsx`
- `apps/workbench-ui/src/components/ui/Kpi.tsx`
- `apps/workbench-ui/src/styles.css`

Security UI should use existing semantic colors:

- `warning` / `critical` / `trusted` for security health.
- `diagnostic` for observability/dashboard surfaces.
- `validation` for approval and review surfaces.
- `model` for structured workspace/object data.

Do not introduce a separate security dashboard visual language unless `STYLING.md` is updated in the same change.

## Directories to Work Within

Backend API and security contracts:

- `packages/secure_core/src/client/`
- `packages/secure_core/src/routes/`
- `packages/secure_core/src/security/`
- `packages/secure_core/src/middleware/`
- `packages/secure_core/test/client/`
- `packages/secure_core/test/routes/`
- `packages/secure_core/test/security/`

Frontend app:

- `apps/workbench-ui/src/api/`
- `apps/workbench-ui/src/components/security/`
- `apps/workbench-ui/src/components/workspaces/`
- `apps/workbench-ui/src/components/auth/`
- `apps/workbench-ui/src/components/ui/`
- `apps/workbench-ui/src/__tests__/`

Documentation and progress:

- `docs_site/src/content/`
- `docs_site/src/pages/docsPages.ts`
- `README.md`
- `program_development/timeline.md`
- `program_development/secure_frontend_readiness_plan.md`
- `bugs_and_fixes/`
- `scripts/dev/check_repo_conventions.sh`

## Named Backend Entities to Draw From

Existing secure-core entities the frontend must treat as source of truth:

- `buildApp` in `packages/secure_core/src/server.ts`
- `toHttpResponse` and `ErrorEnvelope` in `packages/secure_core/src/errors/`
- `composeMiddleware` and named middleware in `packages/secure_core/src/middleware/`
- `SecurityDashboardSnapshot` in `packages/secure_core/src/security/dashboard.ts`
- `registerSecurityOperationsRoutes` in `packages/secure_core/src/security/operations.ts`
- `buildSecurityRouteRateLimitMiddleware` in `packages/secure_core/src/rateLimits/policies.ts`
- Route plugins under `packages/secure_core/src/routes/`
- Worker routes under `packages/secure_core/src/workers/`

New frontend-readiness entities:

- `packages/secure_core/src/client/contracts.ts`
- `packages/secure_core/test/client/contracts.test.ts`
- `docs_site/src/content/secure_frontend_readiness.tsx`

## Quick Fixes Before Comprehensive Frontend

### Q1. Typed frontend contract

Add a TypeScript contract file that exports:

- closed route ids,
- route method/path/auth/CSRF/approval metadata,
- frontend readiness status,
- success response types for UI-bound routes,
- the secure-core error envelope type,
- helper filters for ready versus disabled routes.

Files:

- `packages/secure_core/src/client/contracts.ts`
- `packages/secure_core/src/client/index.ts`
- `packages/secure_core/test/client/contracts.test.ts`
- `scripts/dev/check_repo_conventions.sh`

### Q2. Session and permission model for UI

Status: implemented for `GET /auth/session`; initial Security Ops frontend
integration has landed. Broader product routes still need server-derived
capability gating before exposing high-risk actions.

The frontend uses a server-derived current-session shape to gate security
navigation and disabled-control states.

Desired route:

- `GET /auth/session`

Response should include:

- `user_id`,
- `session_id`,
- `actor_type`,
- `assurance_level`,
- live workspace memberships,
- role names,
- capabilities.

Rules:

- No identity fields accepted from request body.
- If auth context is malformed, fail closed.
- Memberships must be live and attached to non-deleted workspaces.

Implemented files:

- `packages/secure_core/src/routes/session.ts`
- `packages/secure_core/src/auth/sessionService.ts`
- `packages/secure_core/src/client/contracts.ts`
- `packages/secure_core/test/routes/session.test.ts`
- `packages/secure_core/test/auth/sessionService.test.ts`
- `docs_site/src/content/authentication.tsx`

### Q3. Response-schema parity

Every UI-bound route should declare a stable `schema.response` for success responses and use the shared error envelope for failures.

Start with:

- security dashboard,
- session,
- workspace list/detail,
- approvals,
- runs,
- artifacts,
- auth recovery flows.

Files:

- `packages/secure_core/src/routes/*.ts`
- `packages/secure_core/test/routes/*.test.ts`
- `packages/secure_core/src/client/contracts.ts`

### Q4. Frontend mocks and fixtures

Status: initial implementation landed for the workbench security-operations
route. The UI attempts live secure-core endpoints first and falls back to
explicitly labeled fixtures when the backend is not mounted locally.

Before UI construction, add frontend-facing fixtures for:

- authenticated human user,
- low-assurance user,
- operator with audit-read capability,
- workspace owner/member/viewer,
- approval required,
- rate limited,
- uniform 404,
- dashboard healthy/warning/critical.

Files:

- `apps/workbench-ui/src/api/secureCoreClient.ts`
- `apps/workbench-ui/src/api/secureCoreFixtures.ts`
- `apps/workbench-ui/src/components/security/SecurityOperationsPanel.tsx`
- `apps/workbench-ui/src/__tests__/SecurityOperationsPanel.test.tsx`

### Q5. UX-disabled fail-closed surfaces

Status: initial implementation landed for route-readiness rendering.
Fail-closed and deployment-gated surfaces render as disabled controls with
the route id, path, and backend readiness reason.

Explicitly list backend routes that exist but should not have active UI controls yet.

Current fail-closed surface:

- operator remediation: backend logs the attempt and throws until side effects are implemented.

Frontend behavior:

- show read-only status,
- no active destructive button,
- link to docs explaining the disabled state.

Files:

- `packages/secure_core/src/client/contracts.ts`
- `docs_site/src/content/operator_access.tsx`
- `apps/workbench-ui/src/components/security/SecurityOperationsPanel.tsx`

## Deeper Fixes Before Comprehensive Frontend

### D1. Full secure-core composition root

Build an app composition module that wires all route plugins with real services, pools, audit logger, rate-limit policies, approval middleware, secrets provider, WORM provider, and dashboard service.

Files:

- `packages/secure_core/src/app/secureCoreApp.ts`
- `packages/secure_core/test/app/secureCoreApp.test.ts`
- `packages/secure_core/src/security/operations.ts`
- `packages/secure_core/src/routes/index.ts`

Acceptance:

- A host app can import one function to register the secure multi-user API.
- Tests prove security middleware is real, not stubbed.
- Production-missing dependencies fail closed at registration.

### D2. Deployment probes and runtime gates

Status: CI entrypoints and protected workflow jobs are implemented; target
environments must provide the runner/resources before production enablement.

The frontend can be built locally without these, but production multi-user operation cannot be enabled until they pass.

Required probes:

- gVisor/runsc live sandbox probes,
- database role probes,
- WORM/object-lock provider readback,
- branch protection required checks,
- production secrets provider validation.

Files:

- `scripts/test/security.sh`
- `scripts/test/security_live_db.sh`
- `scripts/test/security_live_runsc.sh`
- `scripts/test/security_live_worm.sh`
- `scripts/test/security_supply_chain.sh`
- `.github/workflows/security.yml`
- `packages/secure_core/test/security/`
- deployment runbooks outside public docs if sensitive.

### D3. Auth product flow

Finalize frontend-visible behavior for:

- login,
- logout,
- session refresh/expiry,
- step-up auth,
- MFA recovery,
- password reset,
- email verification,
- disabled account,
- revoked session.

Files:

- `packages/secure_core/src/routes/auth.ts`
- `packages/secure_core/src/routes/session.ts`
- `docs_site/src/content/authentication.tsx`
- `apps/workbench-ui/src/components/auth/`

### D4. Workspace/object workflows

Stabilize list/read/write surfaces for:

- workspaces,
- capsules,
- runs,
- artifacts,
- tools,
- approvals,
- audit/provenance views.

Each flow needs:

- empty state,
- loading state,
- permission-denied state,
- uniform 404 behavior,
- version-conflict handling,
- rate-limit handling,
- approval-required handling.

### D5. End-to-end frontend-like integration tests

Add tests that behave like the future UI:

1. authenticate,
2. read current session,
3. select workspace,
4. list capsules,
5. create or inspect a run,
6. handle approval-required,
7. export artifact,
8. view dashboard/audit state.

Files:

- `packages/secure_core/test/integration/`
- `apps/workbench-ui/src/__tests__/`
- later Playwright or equivalent browser tests if adopted.

## Progress Reporting Rules

When a readiness task changes behavior or status, update:

1. this document,
2. `program_development/timeline.md`,
3. `README.md` if user-facing status changes,
4. docs page under `docs_site/src/content/`,
5. `bugs_and_fixes/` if it fixes a bug or repeated error pattern,
6. `scripts/dev/check_repo_conventions.sh` when a new invariant should remain true.

## Initial Work Order

Parallelizable now:

- Q1 typed contract and readiness manifest.
- Q5 disabled/fail-closed surface documentation.
- Documentation registration for secure frontend readiness.
- Convention-checker assertions.

Next after Q1/Q2:

- D1 composition root.
- Q3 response-schema parity.

Blocked on product/deployment decision:

- D2 production probes in target runtime.
- D3 exact login/step-up provider UX.
- Any destructive operator remediation UI.
