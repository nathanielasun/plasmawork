# `packages/secure_core/` — Implementation Manifest

**Status:** Draft (2026-05-05). Locks once Layer-0 ADRs flip to Accepted.
**Source:** `secure_multi_user_scaffolding_plan_v4.md`, decomposed by `program_development/phase_05_security_implementation_plan.md`. ADR-0008 pins language/framework/ORM/layout; ADR-0009 sandbox; ADR-0010 WORM; ADR-0011 secrets; ADR-0012 worker upload protocol.

This manifest is the **per-task contract** every implementing agent reads first. It pins the conventions the v4 plan deliberately leaves open so two agents working in parallel produce code that composes without collision.

---

## 1. Project layout

```text
packages/secure_core/
  package.json
  tsconfig.json
  drizzle.config.ts
  vitest.config.ts
  README.md
  IMPLEMENTATION_MANIFEST.md            ← this file
  src/
    index.ts                            ← Fastify app factory (createApp())
    config/
      env.ts                            ← typed env reader; refuses unknown keys
      capabilities.ts                   ← Capability literal-union (§13)
      audit_events.ts                   ← AuditEvent literal-union (§19.5)
      high_risk_actions.ts              ← HighRiskAction literal-union (§5.6)
      rate_limits.ts
    db/
      schema.ts                         ← Drizzle table defs; all 28 tables
      migrate.ts
      pool.ts                           ← role-aware connection factory
      transactions.ts                   ← SET LOCAL helpers for §12.1.3 RLS
      seeds/
        capabilities.sql                ← static capability rows
        roles.sql                       ← suggested roles per §13
    crypto/
      tokens.ts                         ← CSPRNG + hash + constant-time compare
      hmac.ts                           ← keyed HMAC over canonicalized inputs
      jcs.ts                            ← thin wrapper over @truestamp/canonify
    errors/
      shapes.ts                         ← error envelope per §3 below
      mapper.ts                         ← code → HTTP status
    middleware/
      compose.ts                        ← composeMiddleware() — encodes §6.2
      requireAuth.ts                    ← L2.1
      enforceCsrf.ts                    ← L2.2
      validateInputSchema.ts            ← L2.3 (Fastify schema integration)
      loadWorkspace.ts                  ← L2.4
      enforceUniformNotFound.ts         ← L2.4
      requireWorkspaceMembership.ts     ← L2.5 (cache + invalidation)
      requireCapability.ts              ← L2.6
      enforceObjectWorkspaceScope.ts    ← L2.7
      attachAuditActor.ts               ← L2.8
      requireApprovalIfHighRisk.ts      ← L2.9
      rateLimit.ts                      ← L2.12
    paths/
      builder.ts                        ← workspacePath() — §9.3
      safeOpen.ts                       ← openat2 / O_NOFOLLOW per-component
      archive.ts                        ← zip-slip + size + count limits (§9.4 + v4-R1)
    audit/
      logger.ts                         ← typed event API + redaction (§19.4)
      chain.ts                          ← prev_hash/row_hash writer
      anchor.ts                         ← external WORM committer (ADR-0010)
      verifier.ts                       ← chain verification + anchor compare
    approvals/
      requests.ts                       ← create / status transitions
      tokens.ts                         ← issue / consume (§16.4 atomic SQL)
      contextHash.ts                    ← token_context_hash (§16.3)
    capsules/
      versions.ts                       ← optimistic versioning (§20)
      locks.ts
    runs/
      stateMachine.ts                   ← §14
      service.ts
    quotas/
      counters.ts                       ← atomic SQL update (§21.2)
      reservations.ts                   ← lifecycle + reaper (v4-R5)
    sandbox/
      runner.ts                         ← gVisor binding per ADR-0009
      proxy.ts                          ← L7 egress allowlist client
    workers/
      tokens.ts                         ← per-run scoped credential issuer
      uploads.ts                        ← Option-A endpoint (ADR-0012)
    outbound/
      fetch.ts                          ← SSRF-safe fetcher (§26.1)
      webhooks.ts                       ← signer + replay protection (§26.2)
    secrets/
      client.ts                         ← AWS Secrets Manager + dev fallback (ADR-0011)
    routes/
      auth/                             ← L4.1, L4.8
      workspaces/                       ← L4.1
      capsules/                         ← L4.2
      runs/                             ← L4.3
      tools/                            ← L4.4
      artifacts/                        ← L4.5
      approvals/                        ← L4.6
      audit/                            ← L4.7
      bootstrap/                        ← L4.9
      operator/                         ← L4.10
      workers/                          ← L4.11
      health/                           ← L4.12
  test/
    fixtures/                           ← workspace, user, member, capsule…
    helpers/                            ← test DB lifecycle, role-switching client
    integration/                        ← cross-component
    security/                           ← §29 #1–#84 (numbered to match)
```

The package is consumed by the existing FastAPI workbench through a thin proxy layer in a later phase. Until that exists, `packages/secure_core/` runs as its own service on a separate port; the existing `simworkbench.api.server` continues to serve single-user research workflows unchanged. This is "Shape A" from the implementation plan — see ADR-0008.

---

## 2. Stack pin

- **Language:** TypeScript 5.6+ on Node 24 (LTS). `"type": "module"` ESM.
- **HTTP:** Fastify 4.x.
- **DB:** PostgreSQL 16+. Drizzle ORM for schema + migrations.
- **Validation:** Fastify schema validation (Ajv) for input allowlists. The schemas register at route-definition time; an unknown body field hits Ajv's `additionalProperties: false` and produces the §4.1 audit event before the handler runs.
- **Tests:** Vitest. Each test runs against a fresh DB schema seeded from migrations.
- **Lint:** ESLint with `@typescript-eslint/strict` + custom rules forbidding the §4.1 forbidden body fields and string literals matching capability/audit-event names outside `src/config/`.
- **Format:** Prettier (single config in repo root).
- **Crypto:** Node's `crypto` module + `@truestamp/canonify` for JCS. No hand-rolled crypto.
- **Secrets:** `@aws-sdk/client-secrets-manager` in prod; gitignored `local_cache/secrets/secrets.local.json` for dev (ADR-0011).
- **Object storage:** `@aws-sdk/client-s3` for both anchor commits and (eventually) artifact storage.
- **Sandbox:** `runsc` invoked through `dockerode` with a fixed runtime config; egress proxy is a co-located `tinyproxy` container per run (ADR-0009).

The convention checker grows assertions for each pin: `package.json` lists each dependency; `tsconfig.json` is `"strict": true`; `drizzle.config.ts` exists.

---

## 3. Error shape contract

Every error response — auth failure, workspace not-found, schema rejection, approval refusal, quota exceeded, sandbox violation, anything — uses this envelope:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Capsule update rejected: version is stale.",
    "details": { "expected_version_id": "...", "actual_version_id": "..." },
    "request_id": "req_01J3QY..."
  }
}
```

- **`code`:** screaming-snake-case identifier from a closed enum in `src/errors/shapes.ts`.
- **`message`:** human-readable, single sentence, no PII, no internal paths.
- **`details`:** OPTIONAL object with structured context. NEVER includes user input verbatim, secrets, stack traces, internal IDs not already known to the caller.
- **`request_id`:** UUIDv7 generated in `requestId` middleware (runs before everything else). Echoed in audit rows for cross-correlation.

The closed error-code enum (initial set; expand as needed in dedicated commits):

```text
UNAUTHENTICATED              401
SESSION_REVOKED              401
SESSION_EXPIRED              401
SESSION_IDLE_TIMEOUT         401
DISABLED_USER                401
CSRF_FAILED                  403
ORIGIN_MISMATCH              403
NOT_FOUND                    404         ← uniform across §4.4 cases
PERMISSION_DENIED            403         ← intra-workspace missing capability
APPROVAL_REQUIRED            403
APPROVAL_TOKEN_INVALID       403
APPROVAL_TOKEN_REUSED        403
APPROVAL_CONTEXT_MISMATCH    403
INPUT_INVALID                400
UNEXPECTED_FIELD             400
PATH_INVALID                 400
ARCHIVE_REJECTED             400
VERSION_CONFLICT             409
QUOTA_EXCEEDED               429
RATE_LIMITED                 429
WORKER_UPLOAD_DENIED         403
SANDBOX_VIOLATION            500
INTERNAL_ERROR               500
```

`NOT_FOUND` is intentionally identical for §4.4 cases (nonexistent workspace, deleted, not member, object in another workspace, nonexistent object). The handler MUST NOT surface which case applies.

`SANDBOX_VIOLATION` returns 500 by design — the user shouldn't be told whether they tripped a network rule, a syscall block, or a quota. Audit captures the cause; the response doesn't.

`INTERNAL_ERROR` is the catch-all. In dev, the response details may include a redacted exception class name; in prod, never. Set `NODE_ENV=production` to enforce.

---

## 4. Test fixture conventions

`test/fixtures/` exports factory functions. Factories MUST:

- Accept overrides for any field (`overrides: Partial<Workspace>`).
- Default every required field to a deterministic, reproducible value.
- Insert into the test DB and return the persisted row.
- Never write to `audit_events` / `provenance_events` / `operator_events` — use `auditLogger` for that.

Required factories (one per file):

```ts
makeUser(overrides?)
makeSession(user, overrides?)
makeWorkspace(creator, overrides?)
makeRole(workspace, capabilities[], overrides?)
makeMember(workspace, user, role, overrides?)
makeCapsule(workspace, creator, overrides?)
makeRun(workspace, capsule, requester, overrides?)
makeTool(workspace, creator, overrides?)
makeApprovalRequest(workspace, requester, action, overrides?)
makeApprovalToken(request, overrides?)
makeStorageReservation(workspace, bytes, overrides?)
```

Test-DB lifecycle:

```ts
// test/helpers/db.ts
beforeEach(async () => {
  await resetTestDb();          // truncate, re-seed capabilities + roles
});
```

`resetTestDb()` runs the migrations against a per-test-runner schema namespace, then truncates non-seed tables, then re-seeds `roles` + `role_permissions` + a default `quota_counters` row. It does NOT drop the schema (slow); it truncates.

Role-aware test client:

```ts
// test/helpers/client.ts
const appClient = makeClient({ dbRole: "secure_core_app" });
const auditClient = makeClient({ dbRole: "secure_core_audit_read" });
```

Tests #51–54 in §29 (application role cannot mutate immutable tables) MUST run as `secure_core_app`, not the test superuser.

---

## 5. Per-endpoint canonical recipe

Every state-changing endpoint MUST follow this exact pattern. The reviewer's cross-cutting check #2 (capability coverage) and check #3 (audit emission) verify it.

```ts
// src/routes/capsules/update.ts
import { composeMiddleware } from "../../middleware/compose";
import { auditLogger } from "../../audit/logger";
import { CapsuleUpdateSchema } from "./schemas";
import { requireApprovalIfHighRisk } from "../../middleware/requireApprovalIfHighRisk";

app.put<{ Params: CapsuleParams; Body: CapsuleUpdateInput }>(
  "/workspaces/:workspaceId/capsules/:capsuleId",
  {
    schema: { body: CapsuleUpdateSchema },          // §4.1 allowlist
    preHandler: composeMiddleware([                  // §6.2 fixed order
      requireRequestId,
      requireAuth,
      enforceCsrfForStateChange,
      attachAuditActor,
      loadWorkspace,
      enforceUniformNotFound,
      requireWorkspaceMembership,
      requireCapability("capsule:update"),
      enforceObjectWorkspaceScope("capsule"),
      requireApprovalIfHighRisk,
    ]),
  },
  async (req, reply) => {
    const result = await capsuleService.update({
      actorUserId: req.auth.userId,                  // server-derived
      workspaceId: req.params.workspaceId,
      capsuleId: req.params.capsuleId,
      allowedPatch: req.body,                        // schema-validated
    });

    await auditLogger.write({
      workspaceId: req.params.workspaceId,
      action: "capsule.updated",                     // from §19.5
      actorUserId: req.auth.userId,
      actorType: req.auth.actorType,
      objectType: "capsule",
      objectId: req.params.capsuleId,
      result: "succeeded",
      requestId: req.id,
      metadata: { version_id: result.versionId },    // redaction-allowlisted
    });

    return reply.code(200).send(result);
  }
);
```

Constraints enforced by code review:

1. `composeMiddleware([…])` lists middleware in §6.2 order. No ad-hoc reordering.
2. `req.body` is read only after `validateInputSchema`. No `req.body` field is passed verbatim to the DB.
3. Every state-changing endpoint emits at least one audit event from `src/config/audit_events.ts`. Lint rule grep.
4. `actorUserId` is `req.auth.userId`, not from `req.body`. Lint rule grep.
5. Non-success paths emit `result: "denied" | "failed"` audit events. Reviewer checks the rejection-path test asserts this.
6. Errors thrown from the service layer use the typed error classes in `src/errors/shapes.ts`. The Fastify `setErrorHandler` maps each to the §3 envelope.

---

## 6. Migration framework

- Migrations are Drizzle SQL migrations under `src/db/migrations/NNNN_<name>.sql`.
- Migrations are idempotent on a clean DB; a second run is a no-op or fails loudly with a deterministic error.
- Capability + role seed data lives in separate migrations (`9000_seed_capabilities.sql`, `9001_seed_roles.sql`) so seed updates don't conflict with schema changes.
- Migrations run as a separate DB role (`secure_core_migrator`) with DDL grants. The application role (`secure_core_app`) gets its grants AT migration time, not by superuser prerogative.
- Rollback policy: there is no automatic down-migration. Schema changes that need to be undone get a new forward migration. Audit log tables MUST NEVER be reverted; their schema additions must be backwards-compatible.

```ts
// src/db/pool.ts
export const appPool = makePool({ role: "secure_core_app" });
export const auditReadPool = makePool({ role: "secure_core_audit_read" });
export const anchorWriterPool = makePool({ role: "secure_core_anchor_writer" });
```

Routes import the pool that matches their privilege level. The test harness can switch.

---

## 7. Logging conventions

- Application logs (Fastify pino): structured JSON to stdout. NEVER include `req.body`, `req.headers.cookie`, `req.headers.authorization`, `req.headers["x-approval-token"]`, or any field whose name appears in the §4.1 forbidden list.
- Audit logs: written via `auditLogger.write(typedEvent)` from `src/audit/logger.ts`. The logger's metadata field accepts only allowlisted keys per `src/audit/redaction.ts`.
- `console.log` is forbidden in `src/`; lint rule blocks it. Only `req.log` (Fastify's request-scoped logger) is allowed.

`scripts/test/security.sh` runs all `test/security/*.test.ts` files plus a static-analysis sweep that fails the build if a forbidden logging pattern appears in `src/`.

---

## 8. Convention-checker assertions to add

When `packages/secure_core/` ships its first migration, the workbench's `scripts/dev/check_repo_conventions.sh` grows:

- `check_file_exists packages/secure_core/package.json`
- `check_file_exists packages/secure_core/IMPLEMENTATION_MANIFEST.md`
- `check_grep_in_file '"type": "module"' packages/secure_core/package.json`
- `check_grep_in_file '"strict": true' packages/secure_core/tsconfig.json`
- per-layer assertions matching the implementation plan's task list.

Until the first task ships, only this manifest's existence is asserted (in the same place as the v4 plan + review + implementation plan).

---

## 9. What this manifest does not pin

- Specific HTTP status codes beyond the table in §3 — handlers may extend the closed enum, but only with an entry in `src/errors/shapes.ts`.
- Specific Fastify plugin choices for cookies, rate limiting, etc. — implementing agents pick once the L2 task assigns them, document in the task PR, then update this manifest.
- Specific Postgres extension dependencies — listed in migrations as needed.
- The frontend integration story — Phase 0.5 ships the API; the workbench UI absorbs it later.

If an implementing agent finds themselves making one of these choices in passing, the choice goes into a manifest update PR before any code that depends on it lands.

---

## 10. Cross-references

- `secure_multi_user_scaffolding_plan_v4.md` — design contract.
- `security_review_v4_and_decomposability.md` — verification + decomposition.
- `program_development/phase_05_security_implementation_plan.md` — the task graph.
- `program_development/architectural_decisions/ADR-0008-secure-core-language-and-layout.md` — the language pin this manifest implements.
- `program_development/architectural_decisions/ADR-0009-sandbox-runtime.md`, `ADR-0010-worm-anchor-provider.md`, `ADR-0011-secrets-manager.md`, `ADR-0012-worker-upload-protocol.md` — the operational pins.
