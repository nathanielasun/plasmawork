# Plan v4: Verification and Decomposability Assessment

## Part 1: Verification

### Coverage of v3 review findings

Every High and Medium finding from the v3 review is addressed in v4 with
both a spec change and a matching §29 test:

| Finding | Spec location in v4 | Test |
|---|---|---|
| H3-1 log_chain_anchors privilege | §12.1.4 dedicated section | #54, #56 |
| H3-2 approval consumption checks parent status | §16.4 SQL with JOIN | #29 |
| H3-3 decided_by required on terminal states | §12 schema CHECK | #30 |
| H3-4 operator_events table | §12 schema | #63, #64, #65 |
| H3-5 quota atomicity | §21.2 + new tables | #47 |
| H3-6 high-risk approver_user_id required | §16.2 prose + test | #31 |
| H3-7 role-bound tokens workspace-bound | §16.2 + §16.3 hash includes workspace | #33 |
| H3-8 canonicalization field set enumerated | §19.3 explicit field lists | #55 |
| H3-9 session_hash algorithm specified | §5.4 SHA-256/HMAC, no Argon2id | (covered by token tests) |
| H3-10 RLS injection mitigation | §12.1.3 Option B SECURITY DEFINER + LOCAL | (structural) |
| M3-1 §6.2 chain complete | §6.2 includes attachAuditActor + enforceUniformNotFound | (structural) |
| M3-2 high-risk recheck at commit | §5.2 last paragraph | #61 |
| M3-3 approval token transport | §16.1 X-Approval-Token header | #35 |
| M3-4 bootstrap WORM marker | §22.1 explicit list, "regular file does not qualify" | #62 |
| M3-5 run_events redaction | §19.4 explicit table list | #46 |
| M3-6 last_seen_at protocol | §5.5 dedicated section | #66 |
| M3-7 mutability of event tables | §12.1.2 INSERT-only list | #51-54 |
| M3-8 global tools access | §10.3 Global Tools Policy | #68 |
| M3-9 UUID v7 leakage | §9.2 explicit non-leak rule | #72 |
| M3-10 missing tests | §29 grew from 58 to 73 | (the new tests) |
| L3-1 approval handler separation | §6.3 explicit prose | (structural) |
| L3-2 uniform 404 vs intra-workspace 403 | §4.4 split | #23, #24 |
| L3-3 body vs URL params | §4.1 last paragraph | (clarification) |
| L3-4 split incident_response | §13 capabilities split into 3 | #63 |
| L3-5 branch-protection bypass mechanism | §29 GitHub/GitLab integration | (CI) |
| L3-6 test list duplication | §29 consolidated, no §29.1 | (cleanup) |

22 of 22 substantive findings closed. The Definition of Done in §30
covers them. The plan is verified against the prior review.

### New issues introduced by v4 / regressions

None of these are blocking. Most are spec compression that lost
detail, or small omissions surfaced by the tighter v4 organization.

**V4-R1 (medium). Archive extraction lost size and file-count limits.**
V3 §9.5 listed "enforce size limits," "enforce file-count limits," and
"emit audit events for rejected archive entries." V4 §9.4.11–13
compressed this to "validate every entry destination," "refuse symlink/
hardlink/device entries," "reject zip-slip paths." Size and file-count
limits and the audit-on-rejection requirement are gone. Without them,
zip bombs are unaddressed. §29 test #15 covers zip-slip but no test
covers archive size or file-count limits.

Edit: restore the dropped requirements in §9.4 and add a corresponding
§29 test (e.g., "archive exceeding configured size or file-count limit
is rejected and audited").

**V4-R2 (low). §7.2 dropped "CSRF failures emit audit events."**
V3 §7.2.4 explicitly required this. V4 §7.2 doesn't restate it. §19.5
audit event list does not include `csrf.failed` or `origin.mismatch`.
Test #17 and #18 cover rejection but not the audit emission.

Edit: add `csrf.failed` and `origin.mismatch` to the §19.5 list and
restate the audit requirement in §7.2.

**V4-R3 (low). `audit_events.actor_type` is `NOT NULL` with no value
suitable for unauthenticated events.** V4 schema requires
`actor_type IN ('human', 'ai_agent', 'worker', 'operator')`, but
events like `login.failed` have no actor. Implementer either invents a
"human" default (semantically wrong; the actor isn't authenticated
yet) or makes the column nullable and adds it to the canonicalization
NULL-handling rules.

Edit: either make `actor_type` nullable (and add NULL to the CHECK
allowlist), or add `'unauthenticated'` to the enum. The provenance
table doesn't have this issue because pre-auth provenance events don't
exist.

**V4-R4 (low). Approval-request creation has no listed capability.**
§10.2 lists `POST /workspaces/:workspaceId/approval-requests`. §13
capability list doesn't include `approval:request`. The §6.2 example
chain pattern always includes a `requireCapability(...)` call, so the
endpoint requires *some* capability. Different implementers will pick
different ones — `workspace:view`, the action-specific capability, or
none at all.

Edit: add `approval:request` to the §13 capability list and specify it
on the create-approval endpoint.

**V4-R5 (low). `storage_reservations` has no cleanup specification.**
A reservation that's never committed or released holds quota space
until `expires_at`, which depends on application code to set
correctly. No background job is specified to release expired
reservations or to recompute quota counters from committed
reservations.

Edit: §21 should specify the reservation lifecycle: a periodic
release job, plus explicit handling of `status = 'expired'`
transitions. Without this, a tenant who creates many reservations and
abandons them can deny quota to legitimate writes.

**V4-R6 (low). `quota_counters.period_start`/`period_end` are
nullable** with no CHECK constraint matching them to the `quota_key`.
Daily quotas need a period; cumulative quotas don't. An implementer
can put a daily quota in a row with NULL period and it'll silently
fail to roll over.

Edit: either add a CHECK that period columns are non-null for
period-based keys (requires either an enum of which keys are
period-based or a separate column), or split into two tables.

**V4-R7 (low). `operator_events.audit_event_id` is nullable** but
§22.2 requires every platform capability use to "emit a... audit event"
and "operator event row." If both must exist together, the audit_event_id
should be `NOT NULL`. Currently nothing prevents an operator event row
without a corresponding audit row.

Edit: make the column NOT NULL, or add a deferred constraint that
enforces the relationship at transaction commit.

**V4-R8 (low). "Changing security configuration" in §5.6 is undefined.**
It's listed as a high-risk action but the term has no concrete
definition. Capability assignments? Allowlist updates? Sandbox policy?
Different implementers will gate different actions.

Edit: enumerate or define the term, or remove it as too vague to be
operative.

**V4-R9 (low). Canonicalization library quality is implied but not
required.** §19.3 specifies RFC 8785 JCS but doesn't require using a
tested JCS library vs writing one. JCS has subtle rules around number
serialization (no exponent unless necessary, integers vs floats,
unicode normalization for keys) that hand-rolled implementations
typically get wrong, which makes hash chains fail to verify across
implementations or across language clients.

Edit: §19.3 should specify "use a tested JCS implementation; do not
roll your own" with a link to an acceptable library list.

**V4-R10 (low). HPC-vs-expensive run capability mapping is not
explicit.** §5.6 lists "expensive compute runs" and "HPC/cloud
submission" as separate high-risk actions. §13 has only
`run:approve_expensive`. There's no `run:approve_hpc`. Either the
actions share a capability (and §5.6 should say so) or HPC needs its
own.

Edit: clarify in §13.

### Summary of verification

V4 is **ready to implement** subject to:

- Restoring archive size/file-count limits (V4-R1, medium).
- Tightening the schema/CSRF nits in V4-R2 through V4-R10 (low).

These are tightening of existing controls, not redesign. None block
starting implementation; they should land before §30 item #27 ("no
security-sensitive TODOs remain") is closed.

---

## Part 2: Decomposability into Agentic Programming Tasks

### Overall assessment

V4 is **unusually decomposable** for a security plan of this scope.
The plan-level properties that make this true:

1. **Section boundaries map to subsystems.** §6 middleware, §15
   sandbox, §16 approvals, §19 audit, §21 quotas, §18 worker — each
   is a coherent unit with its own schema, rules, and tests.
2. **Concrete schema in §12.** The DDL is a single artifact an agent
   can generate as a migration without inferring shape.
3. **Concrete SQL in §16.4 and §21.2.** The atomic-update patterns
   are shown verbatim and can be lifted directly.
4. **Test list in §29 is bound to specific behaviors.** Tests act as
   the agent's fitness function: an implementation passes or fails
   each test individually.
5. **Definition of Done in §30 is checkable.** Each item maps to a
   visible, testable condition.
6. **Forbidden patterns are named.** §4.1, §9.6 (in v3, folded into §9
   in v4), and several "do not do this" examples mean agents have
   negative examples to avoid.
7. **Capability constants are enumerated in §13.** No invention
   needed.

Against this, v4 has **specific properties that resist
decomposition** and need supplementary guidance before agents start
parallel work:

1. **Cross-cutting concerns aren't isolated.** Audit logging permeates
   every feature; an agent implementing "capsule update endpoint"
   needs §19 events list, §19.4 redaction rules, §19.5 event names,
   plus §6 middleware. The plan is correct that security is structural,
   but that means many tasks have many cross-references.
2. **Some controls span the deployment.** WORM anchoring (§19.3),
   sandbox runtime choice (§15.1), KMS choice (§24), branch-protection
   enforcement (§29) — these require operational decisions an agent
   cannot make alone. The plan correctly identifies these as
   choices but doesn't gate the dependent code tasks behind those
   decisions.
3. **No language, framework, or project layout pinned.** The plan
   uses TypeScript-flavored types (`type AuthContext = …`,
   `req.body`) but never says the implementation is TypeScript. Two
   agents in parallel will pick different frameworks if not told.
4. **No error shape contract.** §4.4 shows one error shape
   (`VERSION_CONFLICT`); §16 doesn't specify the shape of
   approval errors; §21 doesn't specify quota-exceeded errors. Agents
   will diverge.
5. **No test fixture conventions.** §29 lists 73 tests but doesn't
   specify how a test creates a workspace, a member, a capsule.
   Different agents will invent different factories.
6. **Some invariants require integration tests not unit tests.** Test
   #61 (high-risk recheck at commit), #62 (bootstrap-after-restore),
   #47 (quota concurrency), #50 (anchor-vs-WORM mismatch), #66
   (idle timeout) all require multi-component setup. These are not
   independently agent-tractable as "write the test."
7. **Some sections describe policy, not code.** §13 ("Suggested
   roles"), §5.5 idle timeouts, §5.3 password parameters, §15.3
   egress allowlist — these are values to choose, not algorithms to
   implement. They need ADRs first.

### Proposed task decomposition

I would structure implementation as **5 layers, ~40 tasks**, with
explicit dependencies. The sketch below is what I'd hand to an
agentic team. Each layer must complete before the next starts; within
a layer, tasks marked [P] can be parallel.

**Layer 0: Foundation decisions (human, not agent).** ~5 ADRs.

- L0.1 Pin language, framework, ORM/query layer, project layout.
- L0.2 Choose sandbox runtime (gVisor, Firecracker, Kubernetes
  sandbox, etc.) and implement runner-binding interface.
- L0.3 Choose WORM provider for log anchors (S3 Object Lock, GCS
  Bucket Lock, KMS marker).
- L0.4 Choose secrets manager (KMS, Vault, cloud SM).
- L0.5 Choose worker artifact upload protocol (§18.2 Option A or B).

These are the tasks where agents will go in different directions
unless humans pick first. 1–2 days of architectural decision-making
saves weeks of agent rework.

**Layer 1: Conventions and primitives.** ~8 tasks, mostly parallel.

- L1.1 [P] Centralized constants module: capabilities (§13),
  high-risk actions (§5.6), audit event names (§19.5).
- L1.2 [P] Tested JCS canonicalization library (§19.3 + V4-R9).
- L1.3 [P] CSPRNG token utilities: generate, hash (SHA-256 / HMAC),
  constant-time compare (§5.4).
- L1.4 [P] Standard error-shape contract and HTTP-mapping helper.
- L1.5 [P] Test-fixture conventions: workspace, user, member,
  session, capsule, run, tool.
- L1.6 [P] Secrets manager client wrapper (depends on L0.4).
- L1.7 [P] Audit/provenance logger interface with redaction
  allowlist (§19.4).
- L1.8 Schema migration package (§12 + §12.1 grants). Single agent.
  Depends on L1.1 for capability seed data.

Layer 1 produces the toolchain every later task imports. Without
this, layer 2 agents reinvent these primitives inconsistently.

**Layer 2: Middleware and shared services.** ~12 tasks, mostly
parallel after Layer 1.

- L2.1 [P] requireAuth + session lifecycle (login, rotate,
  revoke) (§5, §6.3).
- L2.2 [P] enforceCsrfForStateChange (auth + unauth variants) (§7.2).
- L2.3 [P] validateInputSchema framework (§4.1).
- L2.4 [P] loadWorkspace + enforceUniformNotFound (§4.4, §6.3).
- L2.5 [P] requireWorkspaceMembership with cache + invalidation
  (§5.2). Test #59, #60.
- L2.6 [P] requireCapability backed by role_permissions (§13).
- L2.7 [P] enforceObjectWorkspaceScope (§4.3).
- L2.8 [P] attachAuditActor (§19.1).
- L2.9 [P] requireApprovalIfHighRisk (§16, §6.3).
- L2.10 [P] Workspace path builder + safe file open (§9.3, §9.4).
- L2.11 [P] Archive extraction safety (§9.4.11–13 + V4-R1 fix).
- L2.12 Rate-limit middleware (§8). Standalone.

Layer 2 produces the middleware library. Each middleware has a tight
spec and a small test set drawn from §29.

**Layer 3: Subsystems.** ~10 tasks, parallelizable in groups.

- L3.1 Audit/provenance/operator hash-chain writers + verifier (§19,
  V4-R9). Depends on L1.2 (canonicalization), L1.7 (logger).
- L3.2 External anchor committer (§19.3). Depends on L0.3, L3.1.
- L3.3 Approval system: request creation, token issuance, atomic
  consumption with context hash (§16). Depends on L1.3 (tokens), L2.9.
- L3.4 Capsule version + lock system (§20). Depends on L1.3.
- L3.5 Quota counter + storage reservation system with atomic
  enforcement (§21, V4-R5, V4-R6). Standalone.
- L3.6 Run state machine + persistence (§14).
- L3.7 Sandbox runner (§15). Depends on L0.2.
- L3.8 Worker token issuer (§18.1). Depends on L1.6 (secrets).
- L3.9 Worker artifact upload endpoint (§18.2). Depends on L0.5,
  L3.7, L3.8.
- L3.10 SSRF-safe URL fetcher + outbound webhook signer (§26).

**Layer 4: Endpoints.** ~12 tasks, all parallel after Layer 3.

- L4.1 [P] Workspace CRUD + members (§10.2 first block).
- L4.2 [P] Capsules CRUD + fork (§10.2).
- L4.3 [P] Runs (create, list, cancel) (§10.2). Depends on L3.6,
  L3.7.
- L4.4 [P] Tools CRUD + promotion request (§10.2).
- L4.5 [P] Artifacts + export (§10.2). Depends on L3.5.
- L4.6 [P] Approval request endpoints (create, approve, deny)
  (§10.2). Depends on L3.3.
- L4.7 [P] Audit-events + provenance-events read endpoints
  (§10.2, §12.1.3). Requires L0 choice between Option A or B.
- L4.8 [P] Recovery flows (password reset, email verification,
  email change, MFA recovery) (§23).
- L4.9 [P] Bootstrap endpoint (§22.1). Depends on L0.3 (WORM).
- L4.10 [P] Operator endpoints (§22.2).
- L4.11 [P] Worker internal endpoints (§18.2).
- L4.12 [P] Health / metrics / readiness (not in plan but every
  service needs it; task should be added).

**Layer 5: Integration testing and CI.** ~5 tasks, partly serial.

- L5.1 §29 test suite scaffolding (test runner, fixtures, harness).
- L5.2 [P] Test groups: auth (#1–#4, #18, #19), workspace isolation
  (#5–#9), input validation (#10–#12), path safety (#13–#16),
  CSRF/origin (#17–#19, V4-R2), rate limit (#21), uniform
  responses (#23, #24), approval (#25–#35), capsule versioning
  (#36, #37), sandbox (#38–#43, #67, #68), worker (#44, #45, #46),
  quota (#47), audit chain (#48–#56), recovery (#57, #58),
  membership cache (#59, #60), high-risk recheck (#61), bootstrap
  (#62), operator (#63–#65), idle timeout (#66), webhook (#69, #70),
  SSRF (#71), UUID leakage (#72), CI isolation (#73).
- L5.3 CI integration + branch protection.
- L5.4 Documentation pages (§28 list).
- L5.5 ADR-0004 final form.

### Tasks that are inherently hard for agents

Some tasks decompose less cleanly and need extra scaffolding:

1. **L3.7 sandbox runner** — heavily deployment-dependent. The agent
   needs a concrete target (Docker, gVisor, Firecracker, K8s) with a
   reference implementation to clone. Without that, an agent given
   "write the sandbox runner" will produce something that probably
   doesn't enforce one of CPU, memory, wall-time, PID, disk, or
   network isolation correctly.
2. **Test #62 (bootstrap-after-restore)** — requires actually
   staging a DB restore from backup in CI. This is an
   integration-test exercise that's hard to reproduce without an
   ephemeral DB and a backup pipeline. The test is correct as
   stated; it's expensive to actually run.
3. **Test #50 (local anchor mismatch against external WORM)** —
   requires a real WORM endpoint. Unit-testable with a mock, but
   the mock needs to faithfully model object-lock semantics.
4. **Test #67 (trusted tool still runs inside sandbox)** —
   requires the trusted-tool path to exist plus the sandbox plus the
   capability system. Cross-subsystem.
5. **Tests #51–#54 (application role cannot mutate immutable
   tables)** — require running tests as the application's restricted
   DB role, which test harnesses often don't do by default. The
   harness likely runs migrations as a superuser and tests as the
   superuser. Distinguishing roles in tests is straightforward but
   non-default; agents may miss it.
6. **§22.1 bootstrap implementation** — requires real WORM
   integration AND a way to test the "after restore" property.
   Probably needs a separate ADR before implementation.
7. **§19.3 canonicalization correctness across languages** — if any
   other system (worker, batch job) hashes audit rows, all clients
   must agree on canonicalization. JCS is meant to handle this, but
   debugging mismatches is painful. A single tested library shared
   by all clients is the right answer.

### What v4 should add to be more agent-tractable

Without changing any security content, v4 could add:

1. **Implementation manifest section** pinning language, framework,
   project layout, ORM, error shape, fixture conventions. Roughly
   one page.
2. **Task-decomposition appendix** like the above, so that an
   agentic project lead can hand each task to an agent with a
   concrete contract. The plan currently makes this exercise
   straightforward but doesn't do it.
3. **Cross-cutting checklist per endpoint** — a short canonical
   recipe ("when you write any state-changing endpoint, your
   handler must: declare schema, register middleware in this order,
   emit these audit events, handle these errors"). This is what an
   agent would otherwise reinvent.
4. **List of decisions deferred to ADR** so dependent tasks can
   block on the ADR rather than make the choice silently. The
   current plan has many "ADR required" mentions but they're
   scattered.

### Summary of decomposability

V4 is **highly decomposable**. The outline above produces ~45
agent-tractable tasks across 5 layers, of which the majority can
run in parallel within their layer. The pieces that resist
decomposition are well-defined and concentrated in:

- ~5 architectural decisions (Layer 0) that humans must make first.
- ~5 integration tests that require multi-subsystem setup.
- ~3 subsystems (sandbox, WORM anchor, audit-read DB role) where
  the implementation is bounded but the operational binding is not.

This is normal for a security spec at this scope. It is unusually
clean compared to most security plans; the structural decisions in
v4 (concrete schema, concrete SQL, concrete middleware list,
explicit test list, fail-closed defaults, named forbidden patterns)
make implementation by agents a tractable exercise rather than a
guessing game. The remaining decomposition work is principally
**operational pinning** — pick the language, pick the sandbox, pick
the WORM provider — not security work.

---

## Bottom line

**Verification:** v4 closes every prior-review finding with matching
tests. There are 10 small residuals, of which 1 (V4-R1, archive
size/file-count limits) is medium and 9 are low. None block
implementation start. They should land before §30 item #27 closes.

**Decomposability:** v4 is unusually well-suited to agentic
implementation. A 5-layer, ~45-task decomposition is straightforward
to produce. The plan would benefit from a small implementation
manifest pinning language, framework, layout, error shape, and
fixture conventions; that's a one-day human deliverable, not a v5.

If this plan is the design contract for an agent team, the
remaining work before agents can start is roughly:

1. ~10 lines of v4 fixes (V4-R1 through V4-R10).
2. ~5 architectural ADRs (language, sandbox, WORM, secrets manager,
   worker upload protocol).
3. ~1 implementation manifest (project layout, error shape, fixture
   conventions).

After those three artifacts exist, the plan is ready to hand to a
multi-agent build. The structural soundness of v4 carries through
into the implementation because the plan itself is structured
around the same boundaries the implementation needs.
