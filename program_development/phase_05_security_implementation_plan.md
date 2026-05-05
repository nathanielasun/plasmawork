# Phase 0.5 — Secure Multi-User Scaffolding: Implementation & Review Plan

**Owner:** to be assigned
**Status:** Draft (2026-05-05)
**Scope:** turn `secure_multi_user_scaffolding_plan_v4.md` (the design contract) plus `security_review_v4_and_decomposability.md` (the verification + decomposition appraisal) into an executable plan that another agent can pick up task-by-task and that a reviewing agent can audit.

This document is the **delivery plan**. The plan itself (`v4`) is the **design**. The review (`security_review_v4_and_decomposability.md`) is the **verification + decomposition assessment**. This file is the bridge: who does what, in what order, what each task ships, how the reviewing agent confirms it.

---

## How to use this document

- **An implementing agent** picks one task, reads the linked v4 sections + the prerequisite ADRs, ships the deliverables, runs the listed acceptance checks, opens a PR.
- **A reviewing agent** runs the cross-cutting review checks plus the per-task acceptance checks, signs off or returns to the implementing agent with concrete findings.
- **The human owner** unblocks Layer 0 (the architectural decisions agents cannot make alone), enforces gate transitions, and reviews the close-out audit before flipping the phase status.

Every task listed below carries:

1. **ID** (e.g. `L1.2`) — stable identifier across status updates.
2. **Title + scope** — one sentence each.
3. **Inputs** — sections of v4 to read; ADRs that must be Accepted first.
4. **Deliverables** — concrete files, schema, tests, docs.
5. **Acceptance** — checkable conditions (test names from §29, lint output, CI green).
6. **Review checks** — what the reviewing agent specifically looks for (often a forbidden-pattern grep or a negative-path probe).
7. **Blocked by** / **Blocks** — task graph.
8. **Estimate** — coarse t-shirt size (S / M / L / XL).

Assignments are tracked in the **Task Assignment Matrix** (§7). Reviewers MUST be different from implementers.

---

## 1. Working assumption about the existing repo

The existing workbench is FastAPI + filesystem, no DB, no users, no auth. Phase 0.5 cannot be a thin retrofit; it is a **structural rebuild of the platform's identity / authorization / persistence / sandbox substrate**.

Three viable shapes for that rebuild:

- **Shape A — new package, parallel.** New `packages/secure_core/` package runs alongside the existing workbench. The existing `simworkbench.api.server` continues to serve the single-user research workflow until secure_core reaches parity, at which point the existing surfaces are refactored to consume secure_core. **Cleanest separation; least disruption to existing tests.**
- **Shape B — retrofit in place.** Add auth / workspace / sandbox layers to `simworkbench.api.server` directly. Highest churn; most risk of "looks merged, isn't enforced" outcomes.
- **Shape C — fresh repo.** Build secure_core in a separate repo and integrate later. Highest isolation, but defers the integration cost rather than removes it; punts the question of which existing code becomes workspace-scoped.

**Recommendation: Shape A.** The Layer 0 implementation manifest pins this and specifies the boundary (which existing endpoints become workspace-scoped, which become operator-only, which are deprecated outright per v4 §10.1).

---

## 2. Pre-implementation gates

Three gates **must** be cleared before any Layer 1 work begins. Each is a small, bounded artifact that unblocks parallel agent work downstream.

### Gate G0 — V4 residual fixes

The v4 review identified ten residuals (`V4-R1` through `V4-R10`), one medium and nine low. Land them as edits to `secure_multi_user_scaffolding_plan_v4.md` itself, not as separate fixes during implementation. Doing this before agents start prevents downstream rework.

| ID | Severity | Section to edit | Edit |
|---|---|---|---|
| V4-R1 | Medium | §9.4 + §29 | Restore archive size + file-count limits dropped from v3. Add §29 test for archive size/file-count limit. |
| V4-R2 | Low | §7.2 + §19.5 | Add `csrf.failed` and `origin.mismatch` to required audit events; restate "CSRF failures emit audit events". |
| V4-R3 | Low | §12 schema | Either nullable `actor_type` (with NULL allowed) or add `'unauthenticated'` to enum. |
| V4-R4 | Low | §13 | Add `approval:request` capability; gate `POST /approval-requests` on it. |
| V4-R5 | Low | §21 | Specify `storage_reservations` lifecycle: periodic release job for expired/abandoned, explicit `status='expired'` handling. |
| V4-R6 | Low | §12 schema | CHECK constraint binding `period_start`/`period_end` to period-based `quota_key`s, OR split table. |
| V4-R7 | Low | §12 schema | Make `operator_events.audit_event_id` NOT NULL (or deferred constraint). |
| V4-R8 | Low | §5.6 | Define "Changing security configuration" concretely or remove. |
| V4-R9 | Low | §19.3 | Require tested JCS library; ban hand-rolled implementations; provide acceptable-library list. |
| V4-R10 | Low | §13 + §5.6 | Either share `run:approve_expensive` between expensive + HPC actions explicitly, or add `run:approve_hpc`. |

**Deliverable:** an updated `secure_multi_user_scaffolding_plan_v4.md` (or v4.1) committed to the repo with all ten edits applied. Convention checker assertion: `secure_multi_user_scaffolding_plan_v4.md` exists and contains `csrf.failed`, `origin.mismatch`, `approval:request`, `storage_reservations` lifecycle text.

**Owner:** plan author (human or single agent). 1 day.

### Gate G1 — Architectural decisions (5 ADRs)

These are the choices an agent cannot make alone. Each is a short ADR (one page each) under `program_development/architectural_decisions/`.

| ID | ADR | Decision required |
|---|---|---|
| L0.1 | `ADR-0008-secure-core-language-and-layout.md` | Language (TypeScript on Node 24+, or Python via FastAPI), framework (Express/Fastify/Hono vs FastAPI), ORM (Prisma/Drizzle vs SQLAlchemy), project layout (`packages/secure_core/`), Shape A vs B vs C from §1 above. **Recommendation: TypeScript / Fastify / Drizzle / Shape A** — v4's middleware contract is TypeScript-flavored and Drizzle gives a typed migration story. |
| L0.2 | `ADR-0009-sandbox-runtime.md` | Per-run sandbox technology: gVisor, Firecracker, Kubernetes sandboxed pod, podman + user namespaces, or local-only Docker for dev. Bind concrete CPU/mem/PID/wall-time/disk/net enforcement to one technology. Document the dev-vs-prod split. |
| L0.3 | `ADR-0010-worm-anchor-provider.md` | External WORM target for log-chain anchors: AWS S3 Object Lock, GCS Bucket Lock, Cloud KMS immutable key version, or vendor transparency log. Local files explicitly disqualified. Specify dev mock for offline/CI. |
| L0.4 | `ADR-0011-secrets-manager.md` | KMS / Vault / cloud Secret Manager / sealed deployment manager. Specify how dev/CI gets fake credentials without committing them. |
| L0.5 | `ADR-0012-worker-upload-protocol.md` | v4 §18.2 has Option A (server-issued single-use upload URL) vs Option B (worker pushes to authenticated endpoint). Pick one; the choice cascades into L3.9 / L4.11. |

**Deliverable:** five ADRs at status `Accepted`. Each ADR must enumerate at least two alternatives considered.

**Two-step process:**
1. An agent (or the human) drafts each ADR at status `Proposed` with explicit alternatives + a recommendation. This step has been completed (commit `5eccda0`) for ADR-0008..ADR-0012.
2. **The human owner reads each Proposed ADR, accepts or returns it for revision, and flips the status to `Accepted` in a single commit.** No agent may flip the status. Until that flip happens, Layer-1 task assignment is blocked.

**Owner:** human owner. Drafting takes ~30 min/ADR (already done); acceptance + flip is the agent-uncrossable gate.

### Gate G2 — Implementation manifest

A single-page artifact at `secure_core/IMPLEMENTATION_MANIFEST.md` (or wherever Layer 0 chose to put `packages/secure_core/`). Pins:

1. **Project layout** — directory tree, module boundaries, build entrypoints.
2. **Error shape contract** — the JSON envelope every endpoint returns on failure (status, code, message, details). v4 shows `VERSION_CONFLICT`; this manifest must enumerate every code used.
3. **Test fixture conventions** — factories for `workspace`, `user`, `member`, `session`, `capsule`, `run`, `tool`, `approval_request`, `sandbox_runner_mock`. How to spin up a clean DB per test.
4. **Migration framework** — how migrations run, how seed data lands (capabilities from §13, role definitions, default rate limits), how rollbacks work.
5. **Logging/test conventions** — naming, location of `scripts/test/security.sh`, how to run a single security test.
6. **Per-endpoint canonical recipe** — the one-paragraph spec the reviewer flagged as missing: when you write any state-changing endpoint, your handler must (a) declare an allowlist input schema, (b) register middleware in this exact order, (c) emit these audit events, (d) return errors in this shape.

**Deliverable:** `IMPLEMENTATION_MANIFEST.md` checked in alongside the Layer 0 ADRs.

**Owner:** human owner + one agent. 1 day.

**Gate transition:** all three gates (G0, G1, G2) must be Accepted/landed before Layer 1 starts. The convention checker grows three assertions matching the three deliverables.

---

## 3. Layer 1 — Conventions and primitives

8 tasks, mostly parallel. After L1.6 (secrets) blocks on G1.L0.4 and L1.8 (migrations) blocks on L1.1.

| ID | Title | Inputs | Deliverables | Acceptance | Blocks | Est |
|---|---|---|---|---|---|---|
| L1.1 | Centralized constants | §13 capabilities, §5.6 high-risk, §19.5 audit-event names | `capabilities.ts` (typed const), `high_risk_actions.ts`, `audit_events.ts` | Constants exhaustively cover plan; lint fails on string literals matching capability/event names outside these modules | L1.8, L2.6, L3.1 | S |
| L1.2 | JCS canonicalization | §19.3, V4-R9 | Wrap a tested JCS library (e.g. `@truestamp/canonify` for TS, `rfc8785` for Python); export `canonicalize(value): string` with version-pinned constant | Per-language unit test: 6+ cases including unicode normalization, integer-vs-float, NULL handling, key ordering, escaped characters | L3.1 | S |
| L1.3 | Token utilities | §5.4, §16.2 | `tokens.ts`: `mintToken()`, `hashToken()` (SHA-256/HMAC-SHA-256), `compareTokenConstantTime()` | Unit tests for entropy (>=128 bits), constant-time on mismatched-length input, hash output deterministic | L3.3, L3.8 | S |
| L1.4 | Error shape + HTTP mapping | Manifest §G2.2 | `errors.ts`: typed error class hierarchy, `toHttpResponse()` mapper, no leaked stack traces in production mode | Test that every error path returns the manifest's envelope; no error path returns 5xx for an expected user mistake | L2.* | S |
| L1.5 | Test fixtures | Manifest §G2.3 | `tests/fixtures/`: factories returning realistic entities; per-test DB cleanup helper | Smoke test: creates a workspace + member + capsule + run in <50ms; second test sees a clean DB | L5.* | S |
| L1.6 | Secrets client wrapper | ADR-0011 | `secrets.ts`: `getSecret(name): Promise<string>`, in-memory cache with TTL, no logging of values | Test: secret value never appears in test output / log capture | L3.8 | M |
| L1.7 | Audit logger interface | §19.4 redaction | `auditLogger.ts`: typed event API, redaction allowlist, refuses `metadata: req.body` shape | Lint (test) refuses passing `req.body` to logger; runtime refuses keys outside allowlist | L2.8, L3.1 | S |
| L1.8 | Schema migration package | §11 + §12 + §12.1 + V4-R3/R6/R7 fixes | Migration set: 28 tables, indexes, CHECK constraints, GRANT statements, capability seed data, default roles | `pnpm migrate:reset` produces the schema; SELECT against `role_permissions` returns rows for all capabilities; non-app role has INSERT-only on log tables | All of L3, L4 | M |

**Layer 1 review checks (cross-task):**
- No use of `any` / `unknown` without narrowing.
- No string literals for capability or event names outside L1.1.
- No hand-rolled crypto.
- No `process.env` reads outside L1.6.
- Migration is idempotent: applying twice on a clean DB is safe (or fails loudly with a deterministic error).

---

## 4. Layer 2 — Middleware and shared services

12 tasks, parallel after Layer 1. Each is a focused middleware with a small spec and a tight test set.

| ID | Title | Inputs | Tests from §29 | Est |
|---|---|---|---|---|
| L2.1 | `requireAuth` + session lifecycle | §5, §6.3, §23 | #1, #2, #3, #4 | M |
| L2.2 | `enforceCsrfForStateChange` (auth + unauth) | §7.2, V4-R2 | #17, #18, #19 | M |
| L2.3 | `validateInputSchema` framework | §4.1 | #10, #11, #12 | S |
| L2.4 | `loadWorkspace` + `enforceUniformNotFound` | §4.4, §6.3 | #5, #6, #7, #8, #23, #24 | S |
| L2.5 | `requireWorkspaceMembership` (cache + invalidation) | §5.2 | #59, #60 | M |
| L2.6 | `requireCapability` (DB-backed via `role_permissions`) | §13 | #22, #24 | S |
| L2.7 | `enforceObjectWorkspaceScope` | §4.3, §10.3 | (covered by §29 #5–#9) | S |
| L2.8 | `attachAuditActor` | §19.1 | (covered by audit-chain tests) | S |
| L2.9 | `requireApprovalIfHighRisk` | §16, §6.3 | #25, #26, #27, #28, #29, #34, #35, #61 | M |
| L2.10 | Workspace path builder + safe `open()` | §9.3, §9.4 | #13, #14, #15, #16 | M |
| L2.11 | Archive extraction safety | §9.4.11–13 + V4-R1 | #15 + new V4-R1 test | M |
| L2.12 | Rate-limit middleware | §8 | #20, #21 | S |

**Layer 2 review checks:**
- Every middleware uses `requireCapability` from L2.6 (no inline DB reads of `role_permissions` in handlers).
- Every middleware emits at least one audit event on the rejection path; reviewer greps the failing tests' DB state to confirm.
- The middleware order in §6.2 is encoded once (e.g. as a `composeMiddleware()` helper), not duplicated per route.
- No middleware looks at `req.body` for actor identity.
- No middleware swallows an error silently — every catch logs + re-throws or maps to the L1.4 error shape.

---

## 5. Layer 3 — Subsystems

10 tasks. Three groups can run in parallel after Layer 2; within a group, the listed dependencies hold.

### Group A — audit + approval

| ID | Title | Inputs | Tests from §29 | Blocks | Est |
|---|---|---|---|---|---|
| L3.1 | Audit/provenance/operator chain writers + verifier | §19, V4-R9 | #48, #51–56 | L3.2, L4.7 | L |
| L3.2 | External anchor committer | §19.3, ADR-0010 | #49, #50 | L4.* | M |
| L3.3 | Approval system (request, token issuance, atomic consumption) | §16 | #25–35, #61 | L4.6 | L |

### Group B — capsules + runs + quota

| ID | Title | Inputs | Tests from §29 | Blocks | Est |
|---|---|---|---|---|---|
| L3.4 | Capsule version + lock system | §20 | #36, #37 | L4.2 | M |
| L3.5 | Quota counters + storage reservations | §21, V4-R5/R6 | #47 | L4.5 | M |
| L3.6 | Run state machine + persistence | §14 | (state-transition tests) | L3.7, L4.3 | M |

### Group C — execution + worker + outbound

| ID | Title | Inputs | Tests from §29 | Blocks | Est |
|---|---|---|---|---|---|
| L3.7 | Sandbox runner | §15, ADR-0009 | #38–43, #67 | L4.3, L4.11 | XL |
| L3.8 | Worker token issuer | §18.1 | #44 | L4.11 | M |
| L3.9 | Worker artifact upload endpoint | §18.2, ADR-0012 | #45, #46 | L4.5, L4.11 | M |
| L3.10 | SSRF-safe URL fetcher + outbound webhook signer | §26 | #69, #70, #71 | L4.* | M |

**Layer 3 review checks:**
- L3.1: a hand-mutated `audit_events.metadata` row breaks chain verification under both Option A and Option B (Test #55).
- L3.2: chain verification fails when local anchor doesn't match external WORM (Test #50). Reviewer must check the dev mock faithfully implements object-lock semantics.
- L3.3: approval consumption happens in a single SQL UPDATE per §16.4. Reviewer probes: parent request flipped to `denied` while a token issuance is in flight; the consumption must fail per Test #29.
- L3.5: reviewer probes concurrent quota writes (Test #47) — exactly `limit` succeed.
- L3.7: reviewer reviews ADR-0009 binding; checks no `--privileged` / `network: host` / shared mounts in the runner config; checks the egress allowlist is enforced via a real proxy, not an env var (Test #41–43).
- L3.8/L3.9: worker token cannot upload for a different run (Test #44); upload path is server-derived (Test #45).

---

## 6. Layer 4 — Endpoints

12 tasks, all parallel after Layer 3 finishes.

| ID | Title | Tests from §29 | Notes |
|---|---|---|---|
| L4.1 | Workspace CRUD + members | #5, #59, #60 | |
| L4.2 | Capsules CRUD + fork | #5, #36, #37 | Depends on L3.4 |
| L4.3 | Runs (create, list, cancel) | #6, #25, #61 | Depends on L3.6, L3.7 |
| L4.4 | Tools CRUD + promotion request | #7 | |
| L4.5 | Artifacts + export | #8, #47 | Depends on L3.5 |
| L4.6 | Approval request endpoints | #25–35 | Depends on L3.3, L2.9 |
| L4.7 | Audit-events + provenance-events read | #51–56, ADR option A vs B | |
| L4.8 | Recovery flows (password reset, email verify, email change, MFA recovery) | #57, #58 | |
| L4.9 | Bootstrap endpoint | #62 | Depends on L0.3 |
| L4.10 | Operator endpoints | #63–65 | |
| L4.11 | Worker internal endpoints | #44, #45, #46 | Depends on L3.7, L3.8, L3.9 |
| L4.12 | Health / metrics / readiness | (added; not in v4) | |

**Layer 4 review checks (per endpoint):**
- Endpoint registers middleware in §6.2 order via the L2 `composeMiddleware()` helper. No inline rebuild.
- Endpoint declares an allowlist input schema (L2.3); reviewer probes with an extra body field — must 400 + audit event `request.unexpected_field`.
- Endpoint emits the required audit events from §19.5; reviewer checks the test asserts the event row exists.
- Endpoint never reads `actor_user_id` / `created_by` / `workspace_id` / `role` etc. from the body.
- Cross-workspace probe: same endpoint, but path object belongs to another workspace → uniform 404 (Test #5–8, #23).
- Failure path: missing capability → 403 (Test #24); missing approval on high-risk → 403 + `approval.required` audit event.

---

## 7. Layer 5 — Integration testing + CI

| ID | Title | Notes | Est |
|---|---|---|---|
| L5.1 | §29 test suite scaffolding | Test runner, fixtures, harness, DB role separation (run app role tests as the restricted DB role per §12.1.1) | M |
| L5.2 | All §29 tests | Grouped per the review's §29 mapping; one PR per group | XL |
| L5.3 | CI integration + branch protection | `scripts/test/security.sh` runs on every PR; admin override emits `branch_protection.bypass` audit event; CI runs without prod secrets (Test #73) | M |
| L5.4 | Documentation | §28 list: `docs_site/src/content/security_*.tsx` pages cover threat model, capability list, approval flow, sandbox, audit chain | M |
| L5.5 | ADR-0013 final form | Aggregates the L0 ADRs into the canonical `ADR-0013-secure-multi-user-foundation.md` referenced by v4 §Purpose. ADR number changed from the original v4 reference to ADR-0004 (units-library is already at that slot — finding from the round-1 review). | S |

**Layer 5 review checks:**
- Every §29 test (#1–#84) is green, named explicitly, and runs on a clean DB. The list expanded from the original 73 to 84 when the V4 residual fixes (R1–R10) added one test per residual: #74 archive size+count limits (R1), #75–76 csrf/origin audit emission (R2), #77 unauthenticated `actor_type` (R3), #78 `approval:request` capability gate (R4), #79 storage-reservation reaper (R5), #80 quota period CHECK (R6), #81 operator_events FK NOT NULL (R7), #82 each enumerated security-config change gates on high-risk approval (R8), #83 cross-language JCS byte-equality (R9), #84 distinct `run:approve_hpc` capability (R10).
- Tests #51–54 run as the restricted DB role, not as superuser. Reviewer probes by inspecting the test harness's connection string.
- Test #62 (bootstrap-after-restore) actually exercises a DB restore against an ephemeral instance, not just a unit test of the gate logic.
- Test #83 runs against fixtures from BOTH the TS canonicalization library (`@truestamp/canonify`) and a chosen reference implementation in another language (Python `rfc8785` if any worker is Python, else a CLI invocation of `serde_jcs`). Byte-identical output is the gate.
- `scripts/test/security.sh` exits non-zero on any failure; CI pipeline fails the PR; branch-protection refuses merge.
- Documentation page count matches §28 list; each page is reachable from the workbench UI Documentation tab via the existing `import.meta.glob` pattern.

---

## 8. Cross-cutting review checks (apply to every PR)

The reviewing agent runs these on every PR, regardless of which layer the PR is in:

1. **Forbidden-pattern grep:** the v4 forbidden body fields (§4.1) must not appear in any new request handler. Reviewer command: `grep -nE 'req\.body\.(user_id|actor_id|created_by|updated_by|approved_by|workspace_id|status|storage_path)' <changed-files>` returns nothing.
2. **Capability check coverage:** every state-changing endpoint touched in the PR has a `requireCapability` call. Grep for `app.(post|put|patch|delete)` and confirm one-to-one with `requireCapability(`.
3. **Audit emission:** every state-changing endpoint emits at least one audit event from §19.5. Grep `auditLogger.write(` per endpoint.
4. **Test ↔ §29 mapping:** every new test's name references the §29 test number it covers (`test_29_05_user_cannot_access_another_workspace_capsule`). PRs that add untraceable security tests are returned.
5. **No security TODOs:** `grep -nE 'TODO.*(auth|security|permission|capability|approval|sandbox|audit)' <changed-files>` returns nothing — per v4 §30 item #27.
6. **Failed-closed sanity:** the reviewer disables the relevant middleware in a scratch branch (replacement no-op), runs the test suite, and confirms the security tests fail (not pass-through). If the test passes when the middleware is no-op, the test is testing the wrong thing.
7. **DB privilege check:** any new migration that touches a log table (`audit_events`, `provenance_events`, `operator_events`, `log_chain_anchors`, `workspace_membership_events`) must NOT grant UPDATE/DELETE to the application role. Reviewer greps the migration for `GRANT.*ON.*audit_events`.
8. **Schema canonicalization parity:** any new field added to a chained table must appear in the canonicalized field set in §19.3. Reviewer greps both files for the field name.

---

## 9. Definition of Done (close-out gate)

Phase 0.5 is complete only when **all** of these hold. Maps 1:1 with v4 §30 items #1–27 plus the residual gates from this plan.

| # | Item | Evidence |
|---|---|---|
| 1 | Authentication middleware functional | L2.1 shipped; tests #1–4 green |
| 2 | Sessions persistent + revocable | L2.1 + L4.8; test #59 |
| 3 | Session tokens HttpOnly-cookie only | §7.1 enforced; test #18 |
| 4 | Workspace-scoped authorization functional | L2.4 + L2.5; tests #5–9 |
| 5 | Role/capability checks DB-backed | L2.6; test #22, #24 |
| 6 | Allowlist body schemas | L2.3; tests #10–12 |
| 7 | Global artifact endpoints removed | §10.1 list audited; test #12 |
| 8 | Workspace artifact namespacing enforced | L2.10; tests #13–16 |
| 9 | Path builder blocks traversal/symlinks/zip-slip/dotfiles | L2.10/L2.11; tests #13–16, V4-R1 |
| 10 | Sandboxing enforced | L3.7; tests #38–43, #67 |
| 11 | DNS egress controlled | §15.3; tests #41–43 |
| 12 | Worker credentials per-run scoped | L3.8; test #44 |
| 13 | Worker upload path server-derived | L3.9; test #45 |
| 14 | Run state persisted | L3.6; (state-transition tests) |
| 15 | Approvals persisted | L3.3; tests #25–35 |
| 16 | Approval tokens high-entropy, bound, single-use, atomic | L1.3 + L3.3; tests #25–35 |
| 17 | Audit/prov/operator logs immutable + externally anchored | L3.1 + L3.2; tests #48–56 |
| 18 | Capsule edit conflicts detected | L3.4; tests #36, #37 |
| 19 | High-risk actions require human approval | §17, L2.9; tests #34, #61 |
| 20 | Quota enforcement atomic | L3.5; test #47 |
| 21 | Bootstrap multi-gated + DB-restore resistant | L4.9; test #62 |
| 22 | Operator access time-limited + audited | L4.10; tests #63–65 |
| 23 | Security tests pass on every PR | L5.3; test #73 |
| 24 | Documentation updated | L5.4; §28 list complete |
| 25 | AGENTS.md updated | §1.1 insert landed |
| 26 | CLAUDE.md updated | §1.2 insert landed |
| 27 | No security-sensitive TODOs | Cross-cutting check #5 |
| Plus | V4 residuals R1–R10 closed | G0 + per-test additions |
| Plus | All five Layer-0 ADRs Accepted | G1 |
| Plus | IMPLEMENTATION_MANIFEST.md current | G2 |

---

## 10. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Layer 0 ADRs delay agents (esp. ADR-0009 sandbox) | High | Spike the sandbox decision first; have agents work Layer 1 in parallel since L1 is technology-light. |
| Hash-chain canonicalization mismatches across language clients (e.g. worker in Python, server in TS) | Medium | Mandate the same JCS library by name in L1.2; if cross-language, a single shared canonicalization service (HTTP) is preferable to two implementations. |
| Test #62 (bootstrap-after-restore) is hard to actually exercise | Medium | Plan an ephemeral-DB CI lane with a backup/restore step; budget time accordingly. |
| Approval system race conditions caught only late | Medium | Test #29 (parent-status check) and #47 (quota concurrency) must run with >=10 concurrent workers. |
| RLS Option B SECURITY DEFINER misuse (SQL injection through string concat) | Medium | Reviewer cross-cutting check: any code path that calls `set_config()` or `SET app.workspace_id` must use parameterized SQL. Lint rule. |
| Secrets accidentally land in audit metadata | Medium | L1.7 redaction allowlist + lint rule + Test #46 + ad-hoc dump-test in CI that scans audit JSON for known secret patterns. |
| Sandbox runner ships with a CPU/mem/PID limit forgotten | High (per reviewer) | Reviewer protocol: run a fork-bomb / mem-bomb / 5-minute-tight-loop / 100GB-write inside a dev sandbox. Each must be killed by the runner. |
| Workforce burnout from §29's 73-test scale | Medium | Group tests per the review's mapping; one PR per group; reviewers reject PRs that bundle multiple groups. |
| Convention checker becomes the gate instead of the spec | Low | All §29 tests must be runnable independently and named for §29 numbers; the checker only gates structural completeness. |

---

## 11. Task Assignment Matrix

Use this template to assign tasks. Reviewer must be different from implementer.

| Task ID | Implementer | Reviewer | PR | Status | Acceptance run |
|---|---|---|---|---|---|
| G0 | _unassigned_ | _unassigned_ | — | Not started | — |
| G1.L0.1 | _unassigned_ | _unassigned_ | — | Not started | — |
| G1.L0.2 | _unassigned_ | _unassigned_ | — | Not started | — |
| G1.L0.3 | _unassigned_ | _unassigned_ | — | Not started | — |
| G1.L0.4 | _unassigned_ | _unassigned_ | — | Not started | — |
| G1.L0.5 | _unassigned_ | _unassigned_ | — | Not started | — |
| G2 | _unassigned_ | _unassigned_ | — | Not started | — |
| L1.1 | _unassigned_ | _unassigned_ | — | Blocked on G0–G2 | — |
| L1.2 | _unassigned_ | _unassigned_ | — | Blocked | — |
| ... | | | | | |

Update on every PR open / merge / close.

---

## 12. Handoff template — what the implementing agent receives

When assigning a task, the orchestrating agent (or human owner) gives the implementing agent:

```text
Task: <ID + title>
Read first:
  - secure_multi_user_scaffolding_plan_v4.md §<sections>
  - program_development/architectural_decisions/<relevant ADRs>
  - program_development/phase_05_security_implementation_plan.md (this file)

Deliverables:
  - <files>
  - <tests>

Acceptance:
  - <named tests pass>
  - <cross-cutting checks pass>

Constraints:
  - You MUST NOT touch <list of out-of-scope subsystems>.
  - You MUST emit audit events for every rejection path.
  - You MUST NOT add security-sensitive TODOs.

Open the PR against `secure-core-phase-0.5` (or the integration branch).
Tag the reviewer assigned in §11.
```

The reviewing agent receives:

```text
Review task: <PR URL>
Run:
  - The cross-cutting checks (§8 of this plan).
  - The acceptance checks listed for the task.
  - Probe the negative path: what happens if the middleware/handler is replaced
    with a no-op? Does the test still pass? If yes, return the PR.

Sign-off requires:
  - All §29 tests in the task's scope green.
  - No forbidden-pattern grep hits.
  - No security TODOs.
  - The implementer correctly mapped every new test to a §29 number.

Return with concrete findings — never "looks good". The plan exists
because security can't be lightly trusted; reviewing security PRs
must mirror that.
```

---

## 13. Cross-references

- `secure_multi_user_scaffolding_plan_v4.md` — design contract.
- `security_review_v4_and_decomposability.md` — verification + decomposition.
- `LIMITATIONS.md` — what the workbench can/can't do today (Phase 0.5 is the gap this plan closes).
- `STYLING.md` — UI styling for the security-related panels (login, approval, audit) when L4 ships them.
- `AGENTS.md` + `CLAUDE.md` — receive the §1.1 and §1.2 inserts as part of L5.5.
- `bugs_and_fixes/agent_error_patterns.md` — implementing agents should add a pattern entry whenever a security implementation goes wrong, per the existing audit-pattern discipline.

---

## 14. Bottom line

The v4 plan is implementable as specified. The review's verdict — "unusually decomposable for a security plan of this scope" — is correct, but only if the three pre-implementation gates (G0 residual fixes, G1 architectural ADRs, G2 implementation manifest) are cleared first. After that, the work fans out into ~45 agent-tractable tasks across 5 layers, of which the majority can run in parallel within their layer.

Estimated calendar time, with a small agent team:
- **Pre-implementation gates (G0–G2):** 1 week.
- **Layer 1:** 1 week, parallel.
- **Layer 2:** 2 weeks, parallel.
- **Layer 3:** 3–4 weeks, three groups parallel; the sandbox runner (L3.7) is the critical path.
- **Layer 4:** 2 weeks, parallel.
- **Layer 5:** 2 weeks, partly serial.

**Total: ~10–12 weeks.** Compressible if the sandbox decision arrives early and the reviewing agent has a reliable stable of cross-cutting checks pre-built.

The risk is not in the plan; it is in the discipline of treating security PRs as load-bearing instead of merging on first green CI. The cross-cutting review checks in §8 exist to make that discipline reproducible across reviewers.
