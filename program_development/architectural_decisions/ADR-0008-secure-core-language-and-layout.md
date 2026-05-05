# ADR-0008: Secure-core language, framework, ORM, and project layout

## Status
Proposed

## Date
2026-05-05

## Context

Phase 0.5 (`program_development/phase_05_security_implementation_plan.md`) turns `secure_multi_user_scaffolding_plan_v4.md` into a structural rebuild of the platform's identity, authorization, persistence, and sandbox substrate. The implementation plan names this ADR as Layer-0 gate `G1.L0.1`: pin the language, the HTTP framework, the database access layer, the project layout, and the integration shape (Shape A parallel new package, Shape B retrofit-in-place, Shape C fresh repo) before any Layer-1 work begins. Without this decision the downstream tasks (28-table migration set, capability-typed middleware stack, JCS canonicalization, sandbox runner, audit chain, approval system) cannot be assigned.

The decision is forced by four converging constraints:

1. **The v4 design contract is TypeScript-flavoured.**
   - v4 §6.1 / §6.2 specify the middleware list and the strict ordering directly as TypeScript router code (`requireAuth, enforceCsrfForStateChange, validateInputSchema(...)`).
   - §4.1 mandates allowlist input schemas for every state-changing endpoint.
   - §16 defines the approval token API in TypeScript-shaped types.
   - The plan can be ported to another language but every port introduces an opportunity for the middleware order to drift from the contract.

2. **The schema is large and CHECK-constraint heavy.**
   - v4 §11 enumerates 28 tables.
   - §12 specifies CHECK constraints, GRANT statements that distinguish a restricted application role from an admin role, and Postgres RLS Option A/B.
   - Migration tooling that makes the constraints, GRANTs, and seed data first-class — not free-text SQL strings — is load-bearing for the audit (and for the convention-checker assertions Phase 0.5 will add).
3. **The repository already ships substantial TypeScript.** ADR-0005 committed the workbench UI to a Vite + React stack and `docs_site/` shares it. The concrete signals enumerated from `apps/workbench-ui/package.json` and `apps/workbench-ui/tsconfig.json` are:
   - Node 24+ runtime, npm package manager (no pnpm or yarn lockfiles).
   - `"type": "module"` ESM throughout; no CommonJS escape hatch.
   - TypeScript 5.6.3 with `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`, target `ES2022`, `moduleResolution: "Bundler"`.
   - Vite 5.4.10 + `@vitejs/plugin-react` 4.3.3 for the UI build; `tsc --noEmit && vite build` is the build script (typecheck-then-bundle, never `tsc -b` per `CLAUDE.md`'s "Common Gotchas").
   - Vitest 2.1.4 + `@testing-library/react` 16 + `jsdom` 25 for component tests.
   - React 18.3 + React Router 6.26 — UI-only, but the React major fixes the JSX runtime version `secure_core` will need to match if it ever ships SSR endpoints.
   - `@docs/*` path alias to `docs_site/src/content` already wired through `tsconfig.json`; secure_core can do the analogous trick for shared types if it ships any.
4. **The existing FastAPI surface is single-user, no DB, filesystem-backed.**
   - `packages/core/pyproject.toml` ships FastAPI ≥0.110 and uvicorn against Python 3.11+, with pydantic 2, scipy 1.13+, h5py 3.10+, and pypdf 4 as the rest of the stack.
   - The API server has no auth, no workspaces, no sandbox, no approvals, no audit chain.
   - v4 §10.1 deprecates a list of these endpoints outright; the rest must become workspace-scoped or operator-only.
   - A retrofit (Shape B) would require touching every existing handler in lockstep with a security rebuild — exactly the "looks merged, isn't enforced" outcome the implementation plan §1 warns against.

This is the choice an implementing agent cannot safely make alone, so per the implementation plan it ships as an ADR before any Layer-1 task is unblocked.

## Decision

The secure-core substrate is built as a new TypeScript package under `packages/secure_core/` (Shape A — parallel new package), running on Node 24+ with Fastify, Drizzle ORM, and Postgres.

Specifically:

- **Language: TypeScript 5.6+**, `strict: true`, target `ES2022`, ESM (`"type": "module"`). Matches `apps/workbench-ui/tsconfig.json` and `docs_site/`.
- **Runtime: Node 24+**, the version already in use across `apps/workbench-ui/` and `docs_site/`. No Bun, no Deno; one runtime, one toolchain.
- **HTTP framework: Fastify 4.x.** Three properties make it the right fit:
  - Built-in JSON-schema validation (`fastify.addSchema` + per-route `schema: { body, params, querystring, headers }`) maps directly to v4 §4.1's "allowlist input schemas" requirement; rejecting unexpected fields and emitting the v4 §19.5 `request.unexpected_field` audit event are framework-level rather than handler-level concerns.
  - Built-in hooks (`onRequest`, `preParsing`, `preValidation`, `preHandler`, `onSend`) compose cleanly into the v4 §6.2 middleware order without forcing the order to be re-declared per route.
  - The typed plugin system gives a place to expose `requireCapability`, `loadWorkspace`, `enforceUniformNotFound`, etc. as first-class decorators rather than ad-hoc closures, so reviewers can grep for `fastify.decorate("requireCapability", ...)` and find the single definition.
- **ORM / query layer: Drizzle ORM** with `drizzle-kit` for migrations and `node-postgres` (`pg`) as the driver:
  - Drizzle's TypeScript-first schema declaration carries CHECK constraints, indexes, and foreign keys as code; the schema compiles or the build fails.
  - `drizzle-kit generate` produces deterministic SQL migrations that can be reviewed and replayed; the SQL is plain-text and version-controlled, not hidden behind a vendor format.
  - Raw SQL is available where v4's GRANTs and RLS policies (`GRANT INSERT ON audit_events TO app_role; REVOKE UPDATE, DELETE ON audit_events FROM app_role;`) need it. Drizzle does not pretend SQL doesn't exist; for a security substrate, that visibility is the point.
- **Database: Postgres 16+.** v4 §12 assumes Postgres-specific features (CHECK constraints, GRANT/REVOKE on a restricted role, optional RLS via `set_config(...)`). SQLite and MySQL are not in scope; the dev environment runs Postgres in a container.
- **Project layout: Shape A — new package under `packages/secure_core/`.** The existing FastAPI workbench (`packages/core/src/simworkbench/api/server.py`) continues to serve the single-user research workflow until secure_core reaches parity. Once parity is reached, the legacy surfaces are either refactored to call into secure_core (for the ones v4 §10.2 keeps) or removed (for the ones v4 §10.1 deprecates). The implementation plan §1 owns the cut-over plan; this ADR only fixes the boundary.
- **Layout inside `packages/secure_core/`** (frozen by the Layer-0 implementation manifest `G2`, not by this ADR — listed here only for orientation):
  - `package.json`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`.
  - `src/server.ts` — Fastify factory; the Layer-0 manifest pins the plugin registration order so v4 §6.2 is encoded once.
  - `src/middleware/` — one file per v4 §6.1 middleware (`requireAuth.ts`, `enforceCsrfForStateChange.ts`, `validateInputSchema.ts`, `attachAuditActor.ts`, `loadWorkspace.ts`, `enforceUniformNotFound.ts`, `requireWorkspaceMembership.ts`, `requireWorkspaceRole.ts`, `requireCapability.ts`, `enforceObjectWorkspaceScope.ts`, `requireApprovalIfHighRisk.ts`).
  - `src/db/schema/` — one file per logical table group from v4 §11 (identity, workspace, capsule, run, approval, audit, quota, anchor, recovery); `src/db/migrations/` generated by `drizzle-kit generate` and reviewed as plain SQL.
  - `src/auth/`, `src/audit/`, `src/approvals/`, `src/sandbox/`, `src/quota/`, `src/capsules/`, `src/runs/`, `src/tools/`, `src/workers/` — domain modules, each owning the matching v4 section.
  - `src/constants/` — `capabilities.ts`, `audit_events.ts`, `high_risk_actions.ts` (Layer-1 task L1.1, lint-enforced as the only place those string names exist).
  - `tests/` — Vitest, structured to match v4 §29 test numbering (`tests/29/test_29_05_user_cannot_access_another_workspace_capsule.test.ts`); `scripts/test/security.sh` wraps `vitest run` against this directory.

## Alternatives considered

- **TypeScript + Express + Prisma.** Express is the most familiar Node HTTP framework and Prisma is the most popular Node ORM. Rejected for two reasons:
  - Express's middleware model is positional and untyped at the framework boundary; there is no native input-schema validation, so `validateInputSchema` (v4 §4.1) would be a third-party plugin and the v4 §6.2 ordering would be enforced by convention rather than by the framework. Fastify's typed hooks and built-in JSON-schema validation map the v4 contract directly.
  - Prisma owns its migration tooling and emits a synthetic schema language (`schema.prisma`) that hides the CHECK constraints, GRANTs, and Postgres RLS policies the v4 §12 design depends on. The Layer-1 task L1.8 deliverable is a migration set with capability seed data, role definitions, and a non-app DB role with INSERT-only on log tables — Prisma can express the schema but treats raw SQL as an escape hatch. Drizzle exposes the SQL by design; for a security substrate, that visibility is the point.

- **Python + FastAPI + SQLAlchemy.** Continues the language already in `packages/core/`; would let secure_core share Python utilities with the existing workbench. Rejected for three reasons:
  - v4's middleware contract is written as TypeScript router code; porting it to FastAPI dependencies introduces a continuous translation tax on every reviewer for the next ten weeks of the implementation plan §10 calendar. Every PR review would have to mentally re-translate v4 §6.2 from TS into Python before checking conformance.
  - FastAPI's dependency-injection model is excellent for request-scoped resolution but the v4 §6.2 strict ordering (`requireAuth → enforceCsrfForStateChange → validateInputSchema → attachAuditActor → loadWorkspace → enforceUniformNotFound → requireWorkspaceMembership → requireCapability → enforceObjectWorkspaceScope → requireApprovalIfHighRisk`) is not naturally expressed as a DI graph; agents would re-derive it per endpoint, which is the exact pattern v4 §6.2 prohibits.
  - The workbench UI is already TypeScript; a TS server lets the wire types (`ApprovalRequest`, `Capsule`, `Run`, etc.) be generated from the Drizzle schema and consumed verbatim by the UI, removing a class of drift the existing FastAPI / `apps/workbench-ui/src/api/client.ts` boundary suffers from.

- **TypeScript + Hono + Kysely.** Hono is lighter than Fastify and Kysely is a thinner query builder than Drizzle. Rejected. Hono's hook/middleware story is less battle-tested for the strict-ordering use case, and Kysely does not own a migration tool the way Drizzle does — Phase 0.5 needs the migration set (28 tables, GRANTs, seed data, CHECK constraints) to be a first-class artifact, not a hand-curated SQL directory.

- **Shape B — retrofit secure-core into `simworkbench.api.server`.** Considered against Shape A. Rejected for three compounding reasons:
  - Every existing handler would need to grow auth, workspace scoping, capability checks, approval gates, audit emission, and sandbox enforcement in lockstep with the rebuild.
  - The v4 §10.1 deprecation list and v4 §10.2 workspace-scoped list would interleave with new endpoints, and the convention checker could not reliably assert "this endpoint has the v4 §6.2 stack" because some endpoints would be partially migrated mid-PR.
  - Implementation plan §1 marks this shape as the highest "looks merged, isn't enforced" risk; the Phase 1–6 false-close lessons in `bugs_and_fixes/agent_error_patterns.md` make clear that partially-applied invariants are how those phases shipped incomplete. Shape A makes the invariant per-package, not per-handler.

- **Shape C — fresh repo for secure-core.** Considered. Rejected. Defers rather than removes the integration cost; punts the question of which existing code becomes workspace-scoped (the convention checker and the docs site already assume that code lives in this repo). Cross-repo coordination would also break the autonomous-commit discipline `CLAUDE.md` relies on, since the secure-core changes and the workbench cut-over would land on different `origin`s and could not be atomic.

## Consequences

**Positive**

- **Middleware contract is direct.** v4 §6.1 / §6.2 maps to Fastify hooks one-for-one; reviewers comparing handler code to v4 read the same shape in both places, so the cross-cutting review check from implementation plan §8.2 ("every state-changing endpoint has a `requireCapability` call") is a `grep` away.
- **Schema is typed end-to-end.** Drizzle's typed schema makes the 28 tables, CHECK constraints, GRANTs, and seed data (capabilities from v4 §13, default roles, default rate limits) first-class TypeScript that compiles or fails to compile. The migration set requested by Layer-1 task L1.8 ships as `drizzle-kit generate` output reviewable as plain SQL.
- **Allowlist input schemas have a native home.** Fastify's built-in JSON-schema validation is the natural home for v4 §4.1 allowlist schemas; the Layer-2 task L2.3 (`validateInputSchema` framework) becomes a thin typed wrapper rather than a parser. Unexpected fields are rejected at the framework boundary and the `request.unexpected_field` audit event from v4 §19.5 is emitted automatically.
- **Wire types stop drifting.** Wire types between secure-core and `apps/workbench-ui/` can be generated from Drizzle's schema (via `drizzle-zod` or equivalent), removing the existing FastAPI ↔ `apps/workbench-ui/src/api/client.ts` drift class that `CLAUDE.md` calls out.
- **Cut-over is atomic.** Shape A keeps the existing FastAPI workbench unbroken until secure_core reaches parity; the cut-over is one explicit deletion + redirect commit rather than a multi-week interleaved rebuild that would be impossible to review.
- **Toolchain reuse.** Same Node major, same npm, same Vitest, same TypeScript strict settings as `apps/workbench-ui/` and `docs_site/`. New contributors learn one stack.
- **Convention checker can assert structure.** The Phase Gate Procedure's per-entity assertions work cleanly when secure_core lives in one well-bounded package; the checker can grow per-middleware-file and per-table-file assertions without entangling the existing Python tree.

**Negative**

- **Two production languages in the repo.** TypeScript (UI, docs site, secure-core) and Python (existing workbench, physics modules, runtime, ModelSpec, capsules, validators). Until the Shape A cut-over completes, both stacks must be maintained in parallel and contributors must be fluent in both. The convention checker, the lint rules, and `scripts/test/all.sh` all grow a TS branch alongside the existing Python branch.
- **Existing FastAPI surfaces will be deprecated.** Some logic currently behind those endpoints (capsule reload, ModelSpec generation, paper ingestion, codegen, validation runs, sweeps, comparison reports) needs a port path. The implementation plan §1 owns the cut-over decision, but this ADR commits to it: every existing FastAPI endpoint listed in v4 §10.1 is targeted for deletion, and every endpoint in v4 §10.2 is targeted for re-implementation in secure_core. Until the cut-over, both surfaces serve traffic and the UI must know which one to call for which feature.
- **Cross-language hash-chain canonicalization is a new failure mode.** RFC 8785 JCS (v4 §19.3) requires byte-identical canonicalization across every process that signs or verifies a chained log entry:
  - Layer-1 task L1.2 wraps `@truestamp/canonify` for TypeScript with a version-pinned constant.
  - If any worker process is Python, the matching `rfc8785` library is mandated; mixing implementations is forbidden.
  - Layer-3 task L3.1 ships a cross-language byte-equality test covering unicode normalization, integer-vs-float distinction, NULL handling, key ordering, and escaped characters.
  - ADR-0006's determinism discipline applies: the canonicalization is structural, not free-text. A drift here corrupts the audit chain silently.
- **Drizzle is younger than Prisma or SQLAlchemy.** The migration tooling and typed-schema features used here are stable, but dependency churn is higher. The secure-core `package.json` pins `drizzle-orm` and `drizzle-kit` to a known-good minor version; bumps land via ADR-mentioned commits, not silently.
- **Postgres becomes a hard dev-environment dependency.** The docs site and the existing workbench do not need it; secure-core does. The Layer-0 implementation manifest (`G2`) is responsible for the dev-environment story (containerized Postgres via `scripts/dev/postgres_up.sh`, ephemeral CI Postgres, plus a Postgres-instance-per-checkout decision for parallel agent work).
- **No code reuse with `packages/core/`.** Capsule readers, ModelSpec validators, and physics-module registry logic in `packages/core/` cannot be imported from secure_core. Either the logic is re-expressed in TypeScript (a meaningful port effort) or secure_core spawns Python workers and treats them as untrusted producers (the v4 §18 worker contract). The implementation plan does not pre-decide; this ADR flags the cost.

**Neutral**

- **Three `package.json` files in the TypeScript surface.** `apps/workbench-ui/package.json` and `docs_site/package.json` already exist; secure-core adds the third. Each has its own `node_modules`. `AGENTS.md` packaging-boundary rules already accept this split per ADR-0005.
- **Vitest is the shared test runner.** `apps/workbench-ui/` already runs Vitest 2.1; secure-core uses the same major. `scripts/test/security.sh` wraps `vitest run` against `packages/secure_core/tests/`, and `scripts/test/all.sh` gains a call to it once Layer-5 lands per implementation plan §7.
- **Convention-checker growth.** The checker grows assertions for `packages/secure_core/package.json`, `packages/secure_core/tsconfig.json`, `packages/secure_core/drizzle.config.ts`, the per-middleware files, and the per-table schema files. They start in `--include-open-workstreams` and graduate to default checks per the Phase Gate Procedure.
- **No Bun, no Deno, no edge runtime.** The decision is conservative on the JS-runtime axis: Node 24+ is what the rest of the repo uses. A future ADR may revisit if a deployment target requires it.

## Implementation notes

- This ADR's `Status` is `Proposed`. Per `CLAUDE.md` only the human owner can flip it to `Accepted`. Implementation plan gate `G1` requires the flip before Layer-1 starts; this ADR is one of the five `G1` deliverables (`G1.L0.1`).
- The Layer-0 implementation manifest (`G2` in the implementation plan) pins the directory tree, error-shape envelope, test fixture conventions, migration framework details, logging conventions, and per-endpoint canonical recipe inside `packages/secure_core/`. This ADR does not own those details; it owns the language / framework / ORM / shape choice they presuppose.
- Layer-1 task L1.8 (schema migration package) is the first place this ADR becomes load-bearing: the 28-table migration set, the GRANT statements, the CHECK constraints (including the V4-R3, V4-R6, V4-R7 fixes from `G0`), and the seed data (capabilities from v4 §13, default roles, default rate limits) all ship as Drizzle schema files plus `drizzle-kit generate` output. The migration is idempotent on a clean DB or fails loudly with a deterministic error.
- Layer-1 task L1.2 (JCS canonicalization) wraps `@truestamp/canonify` for TypeScript with the version pinned in a single constant. If any worker is implemented in Python, the matching `rfc8785` library is mandated and a cross-language byte-equality test ships in Layer-3 / L3.1 covering at minimum: unicode normalization, integer-vs-float distinction, NULL handling, key ordering, escaped characters.
- Fastify hooks map to v4 §6.2 ordering as follows. The manifest codifies this in a `composeMiddleware()` helper rather than per-route copy-paste:
  - `onRequest` → `requireAuth`.
  - `preParsing` → `enforceCsrfForStateChange`.
  - Route `schema:` (Fastify built-in) → `validateInputSchema`.
  - `preValidation` → `attachAuditActor`.
  - `preHandler` → `loadWorkspace`, `enforceUniformNotFound`, `requireWorkspaceMembership`, `requireCapability`, `enforceObjectWorkspaceScope`, `requireApprovalIfHighRisk`, in that order.
  - Any middleware that reads `request.body` must run after the route schema has validated it.
- The dev environment runs Postgres 16 in a container declared by `scripts/dev/postgres_up.sh` (added in the Layer-0 close commit alongside this ADR's `Accepted` flip). CI provisions an ephemeral Postgres for `scripts/test/security.sh`; production deployment is out of scope for this ADR.
- The existing FastAPI server is not modified by this ADR. The implementation plan §1 cut-over (which existing endpoints become workspace-scoped, which become operator-only, which are deprecated outright per v4 §10.1) is the follow-up deliverable, not part of this decision.
- ADR-0005 (UI framework) remains in force; `apps/workbench-ui/` continues on Vite + React + React Router and consumes secure-core's HTTP API once it lands. The `apps/workbench-ui/src/api/client.ts` rule from `CLAUDE.md` ("Every new FastAPI endpoint adds matching types... UI components import the type, never call `fetch` directly") extends to secure-core endpoints; the typed-client convention survives the framework change because the rule is about the boundary, not the stack. Wire types are generated from Drizzle's schema via `drizzle-zod` (or a successor) so the client and server never disagree on a field name.
- Convention-checker assertions added alongside this ADR's `Accepted` flip. They start in `--include-open-workstreams` and graduate to default checks as Layer-1 lands per the Phase Gate Procedure:
  - `packages/secure_core/package.json`
  - `packages/secure_core/tsconfig.json`
  - `packages/secure_core/drizzle.config.ts`
  - `packages/secure_core/src/server.ts`
  - `packages/secure_core/src/middleware/` (directory)
  - `packages/secure_core/src/db/schema/` (directory)
  - `packages/secure_core/src/constants/capabilities.ts`
  - `packages/secure_core/src/constants/audit_events.ts`
  - `packages/secure_core/src/constants/high_risk_actions.ts`
  - `scripts/test/security.sh`

## References

- Implementation plan: `program_development/phase_05_security_implementation_plan.md` §1, §2 (Gate G1.L0.1), §3 (Layer 1).
- Design contract: `secure_multi_user_scaffolding_plan_v4.md` §4.1 (allowlist input schemas), §6.1 / §6.2 (middleware list + ordering), §11 (28 tables), §12 (schema, CHECK constraints, GRANTs, RLS), §16 (approval system), §19.3 (RFC 8785 JCS), §29 (73-test security suite).
- ADR-0005 (UI framework — Vite + React) for the existing TypeScript repo signals.
- ADR-0006 (determinism policy) for the structural-not-free-text discipline applied here to the cross-language JCS contract.
- ADR-0001 (project scope) — the workbench remains the same product; this ADR rebuilds its substrate.
- Repo signals: `apps/workbench-ui/package.json`, `apps/workbench-ui/tsconfig.json`, `packages/core/pyproject.toml`.
