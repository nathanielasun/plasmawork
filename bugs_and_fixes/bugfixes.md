# Bugfix Log

Each resolved bug is logged here using the template below. Entries are append-only and ordered most-recent-first.

---

## Template (copy when adding a new entry)

```markdown
## YYYY-MM-DD: Short bug title

### Affected subsystem
`packages/<path>/`

### Symptoms
What the user or test observed.

### Root cause
The actual cause, not just the error message.

### Fix
What changed. Reference commit SHA or PR.

### Regression protection
Test path(s) added or updated. Cross-listed in `regression_tests.md`.

### Agent warning
What future agents must not repeat.
```

---

<!-- Append entries below this line, most recent first. -->

## 2026-05-07: Backend launcher failed on empty Bash array expansion

### Affected subsystem
- `scripts/dev/run_backend.*`
- `tests/regression/test_run_backend_launcher.py`

### Symptoms
Running `./scripts/dev/run_backend.sh` on macOS failed before Python started:
`line 45: EXTRA_ARGS[@]: unbound variable`.

### Root cause
The Bash wrapper used `set -u`, initialized `EXTRA_ARGS=()`, and expanded
`"${EXTRA_ARGS[@]}"` when no passthrough arguments were provided. macOS Bash
3.2 treats that empty array expansion as an unbound variable. The wrapper
therefore encoded shell-version-specific parsing behavior into a dev
entrypoint.

### Fix
Moved backend launcher parsing into `scripts/dev/run_backend.py` and reduced
the Unix wrapper to a Python-launcher delegate that passes `"$@"` unchanged.
Added PowerShell and cmd.exe wrappers that call the same Python launcher, so
Unix and Windows shells share one parser and backend command assembly path.

### Regression protection
- `tests/regression/test_run_backend_launcher.py`
- `scripts/dev/check_repo_conventions.sh`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Do not reintroduce shell-owned passthrough arrays for dev launchers. Keep
argument parsing in the shared Python launcher and test the no-extra-args path.

## 2026-05-07: Session introspection hid zero-capability workspace memberships

### Affected subsystem
- `packages/secure_core/src/auth/sessionService.ts`
- `packages/secure_core/test/auth/sessionService.test.ts`

### Symptoms
The new `/auth/session` SQL reader joined `workspace_memberships` to
`role_permissions` with an inner join. A user with a live workspace
membership whose role currently grants no capabilities would disappear
from the current-session response instead of appearing with an empty
capability list.

### Root cause
The read model reused the capability-resolution join as if permissions
were required for membership visibility. Membership liveness and
capability grants are separate facts; the UI needs both, including the
zero-capability state.

### Fix
The session reader now uses `LEFT JOIN role_permissions` and accepts
`NULL` capability rows. Grouping preserves the live membership and
returns `capabilities: []` when no valid permissions are attached.

### Regression protection
- `packages/secure_core/test/auth/sessionService.test.ts`
- `scripts/dev/check_repo_conventions.sh`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Read models that summarize membership plus capabilities must not make
capability rows a prerequisite for returning the membership. Use a left
join and test the zero-capability state.

## 2026-05-07: Worker token route upgraded malformed actor context in audit

### Affected subsystem
- `packages/secure_core/src/workers/tokenRoute.ts`
- `packages/secure_core/test/workers/tokenRoute.test.ts`

### Symptoms
The worker-token issuance route contained a defensive audit expression
that mapped `req.auth.actorType === "unauthenticated"` to
`"operator"` when emitting `worker.token_issued`. Production
`requireAuth` derives `"human"` today, but the branch was still an
unsafe fallback: a malformed authenticated context would be upgraded
in audit accountability instead of rejected.

### Root cause
The route tried to paper over an impossible auth shape at the audit
emission site. Security-sensitive code should fail closed on malformed
server-derived context, not coerce it into a privileged actor type.

### Fix
The handler now rejects `actorType: "unauthenticated"` after `requireAuth`
and before run lookup/token issuance. Successful audit rows use
`req.auth.actorType` directly without any privileged fallback.

### Regression protection
- `packages/secure_core/test/workers/tokenRoute.test.ts`
- `scripts/dev/check_repo_conventions.sh`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Do not "normalize" malformed auth context into a privileged actor type
for audit or authorization. If authenticated context is internally
inconsistent, reject before side effects.

## 2026-05-07: Operator step-up ran after approval consumption

### Affected subsystem
- `packages/secure_core/src/routes/operator.ts`
- `packages/secure_core/src/routes/securityDashboard.ts`
- `packages/secure_core/src/middleware/operatorStepUp.ts`
- `packages/secure_core/test/routes/{operator,securityDashboard}.test.ts`

### Symptoms
Operator routes enforced AAL2/AAL3 step-up authentication inside the
handler. For high-risk operator incident routes, L2.9 approval-token
middleware ran in `preHandler` before the handler-level step-up check.
An AAL1 operator session with a valid approval token could consume the
token and then be rejected for missing step-up. Step-up denials also did
not emit a `permission.denied` audit row, so denied-access dashboard
counters missed that class of refusal.

### Root cause
Step-up was modeled as route business logic instead of part of the
authorization middleware chain. That placed it after approval-token
consumption and outside the audited denial path.

### Fix
Added `withOperatorStepUp`, a decorator for platform capability
middleware. It runs the existing platform capability check and then
checks AAL2/AAL3 in the same `requireCapability` slot, before
`requireApprovalIfHighRisk`. On denial it writes `permission.denied`
with `denied_reason: "step_up_required"` and the relevant platform
capability. Operator routes and the security dashboard route now use
the decorator.

### Regression protection
- `packages/secure_core/test/routes/operator.test.ts`
- `packages/secure_core/test/routes/securityDashboard.test.ts`
- `scripts/dev/check_repo_conventions.sh`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Privilege preconditions that can reject a request must run before
single-use approval tokens are consumed. Handler-level checks are too
late for high-risk routes if L2.9 lives in `preHandler`.

## 2026-05-07: Security operations backend wiring hardening

### Affected subsystem
- `packages/secure_core/src/security`
- `packages/secure_core/src/routes`
- `packages/secure_core/src/middleware`
- `packages/secure_core/src/rateLimits`
- `packages/secure_core/test/{security,middleware,rateLimits}`

### Symptoms
The initial security-operations slice exposed dashboard primitives but
left several backend prerequisites incomplete for frontend work: the
dashboard route had only an injected reader interface, no SQL-backed
service; the operator dashboard route was exported but not composed
with real auth/platform-capability middleware; named rate-limit
policies existed but route plugins had no typed hook for the named
policies; and the new platform-capability check initially considered
active membership rows without proving the associated workspace was
still live.

### Root cause
The first slice stopped at module boundaries. Security declarations
were present, but not all had a production composition point. The
platform capability implementation reused membership rows without
carrying the standard "live workspace" predicate into the operator
authorization query.

### Fix
Added `SecurityDashboardService` and `SqlSecurityDashboardDataSource`
for audit-read-pool-backed dashboard data, a stable dashboard response
schema, `registerSecurityOperationsRoutes`, `buildDashboardVerifiers`,
and `startPeriodicAuditChainVerifier`. Added
`requirePlatformCapability` and made it require an active membership
attached to a non-deleted workspace. Added route hooks plus a
`buildSecurityRouteRateLimitMiddleware` factory for named auth, upload,
run, approval, and export rate-limit policies.

### Regression protection
- `packages/secure_core/test/security/dashboardService.test.ts`
- `packages/secure_core/test/security/operations.test.ts`
- `packages/secure_core/test/middleware/requirePlatformCapability.test.ts`
- `packages/secure_core/test/rateLimits/policies.test.ts`
- `scripts/dev/check_repo_conventions.sh`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Do not stop at route exports or policy tables for security work.
Security features need a production composition seam, live-data source,
and negative tests for stale membership/workspace state. Platform
capability grants must include the same live-membership and
live-workspace predicates as workspace-scoped authorization.

## 2026-05-07: Security operations scaffolding enforcement drift

### Affected subsystem
- `packages/secure_core/src/rateLimits`
- `packages/secure_core/src/audit`
- `packages/secure_core/src/secrets`
- `packages/secure_core/test/{rateLimits,audit,secrets}`

### Symptoms
The first security-operations slice introduced rate-limit policy
metadata, a periodic audit-chain verifier job, and production secrets
validation. Review found three subtle drifts before commit: named
rate-limit policies could still default to IP scoping unless every
caller remembered a custom extractor; a verifier exception could escape
the periodic job as an unhandled rejection instead of an audit-visible
verification failure; and production secrets validation treated a blank
`AWS_REGION` as authoritative even when `AWS_DEFAULT_REGION` was set,
while not refusing `AWS_SESSION_TOKEN`.

### Root cause
The implementation modeled the desired security controls, but some
controls lived in metadata or happy-path helpers rather than in the
runtime enforcement path. Negative tests covered declared coverage, but
not miswired middleware scope, thrown verifier dependencies, or blank
environment fallback.

### Fix
Rate-limit policies now derive their runtime key extractor from
`keyScope` by default and fail closed when account/workspace scoped
middleware is registered before the required context exists. Worker
upload rate limits hash the presented worker token rather than storing
the raw token as a key. The periodic verifier converts thrown verifier
dependencies into `verifier_error` failure reports and prevents timer
callbacks from creating unhandled rejections. Production secrets
validation now selects the first non-blank AWS region and rejects static
session-token credentials.

### Regression protection
- `packages/secure_core/test/rateLimits/policies.test.ts`
- `packages/secure_core/test/audit/periodicVerifier.test.ts`
- `packages/secure_core/test/secrets/productionValidation.test.ts`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Security policy declarations are not enforcement. A named policy must
own its default runtime behavior, background verifier jobs must turn
dependency failures into auditable outcomes, and production environment
fallbacks must ignore blank variables rather than treating them as set.

## 2026-05-07: Secure-core Layer-5 security gate completion

### Affected subsystem
- `packages/secure_core/src/audit`
- `packages/secure_core/src/middleware`
- `packages/secure_core/test/{audit,db,middleware,security}`
- `scripts/test/{security,all}.sh`
- `.github/workflows/security.yml`
- `docs_site/src/content`
- `AGENTS.md` / `CLAUDE.md`

### Symptoms
Layer-5 review found integration gaps after the lower security layers
were implemented. The security runner covered only the sandbox subset
instead of the full v4 §29 matrix; `scripts/test/all.sh` did not pin the
security gate directly; no CI workflow owned the security lane; external
WORM anchors could be trusted from the local database row without reading
the external object; high-risk approval middleware could consume a valid
token for a non-human actor; app-role append-only coverage was incomplete
for provenance/operator/anchor tables; and the docs/ADR surface did not
describe the secure multi-user foundation at the same level as the code.

### Root cause
Layer-5 was treated as a collection of previously existing package tests
rather than as its own integration product. Numbered review assertions
were scattered across subsystems, so a green package test could hide
missing matrix entries, missing CI wiring, and cross-layer verification
holes.

### Fix
Added a v4 §29 coverage manifest with literal entries for all 84
assertions, wired the hard security gate into `scripts/test/all.sh`, and
added a dedicated GitHub Actions security workflow. `scripts/test/security.sh`
now refuses production-secret-shaped environment variables. Audit anchor
providers expose readback and `AuditChainVerifier` compares the latest
local anchor row with the configured WORM object. L2.9 high-risk approval
middleware rejects non-human actors before consuming tokens. DB-gated
tests cover app-role update/delete denial on provenance, operator, and
anchor chain tables. Security docs and ADR-0013 now describe the shipped
foundation without exposing production secrets or provider internals.

### Regression protection
- `packages/secure_core/test/security/section29_coverage.test.ts`
- `packages/secure_core/test/security/sandbox.test.ts`
- `packages/secure_core/test/audit/anchor.test.ts`
- `packages/secure_core/test/db/schema.test.ts`
- `packages/secure_core/test/middleware/requireApprovalIfHighRisk.test.ts`
- `packages/secure_core/test/config/constants.test.ts`
- `scripts/test/security.sh`
- `scripts/test/all.sh`
- `.github/workflows/security.yml`
- `scripts/dev/check_repo_conventions.sh`

### Agent warning
Do not claim a security layer is complete because package tests are
green. The numbered security matrix must be explicitly mapped, the
security runner must be in the hard gate, CI must not inherit production
secrets, external anchors must be verified against the external object,
and high-risk approvals remain human-only even when a valid token exists.

## 2026-05-07: Secure-core Layer-4 route and worker hardening

### Affected subsystem
- `packages/secure_core/src/routes`
- `packages/secure_core/src/workspaces`
- `packages/secure_core/src/workers`
- `packages/secure_core/src/operator`
- `packages/secure_core/test`
- `scripts/dev/check_repo_conventions.sh`
- `AGENTS.md` / `CLAUDE.md`

### Symptoms
Layer-4 review found route-level security drift that could bypass the
accepted v4 plan's server-derived identity, approval, and quota rules.
Several protected routes relied on Fastify `schema.body` instead of the
audit-aware body validator; capsule/tool write APIs accepted
`content_hash` and `storage_path`; tool PATCH exposed lifecycle `status`;
workspace membership and operator incident actions lacked complete
approval/commit-time checks; worker archive uploads reserved extracted
bytes without committing that reservation; malformed `declared_size`
could escape as a raw parser error; and operator remediation returned a
success-shaped result despite no destructive side effect being wired.

### Root cause
Layer-4 route implementations treated handler-local schemas and service
stubs as sufficient security boundaries. The v4 rules require
defense-in-depth at the route boundary, middleware chain, service
transaction, and worker accounting layer. Those layers were implemented
in pieces, but not consistently joined across every endpoint.

### Fix
Added shared route body-validation helpers that invoke
`validateInputSchema` and wired them into workspace, capsule, tool, run,
artifact, approval, operator, bootstrap, and worker-token routes. Capsule
and tool create/update paths now accept `source_artifact_id` and resolve
`content_hash` / `storage_path` server-side. Tool PATCH no longer accepts
`status`. Workspace membership mutations require an approval request id,
pass through L2.9, and re-check `workspace:manage_members` inside the SQL
transaction before commit. Operator audit/investigate/remediate paths now
require step-up auth; investigate/remediate require approval. Operator
remediation records a failed attempt and throws until side effects ship.
Worker uploads validate `declared_size` syntax before `BigInt`, commit
both archive and extracted-byte reservations, report `extracted_bytes`,
and validate Prometheus metric/label identifiers before rendering.

### Regression protection
- `packages/secure_core/test/routes/{workspaces,capsules,tools,runs,artifacts,approvals,operator,bootstrap,health}.test.ts`
- `packages/secure_core/test/workers/{tokenRoute,uploadRoute}.test.ts`
- `packages/secure_core/test/operatorService.test.ts`
- `scripts/dev/check_repo_conventions.sh`
- `npm --prefix packages/secure_core run typecheck`
- `npm --prefix packages/secure_core test`

Cross-listed in `bugs_and_fixes/regression_tests.md`.

### Agent warning
Do not treat Fastify body schemas, request-body storage facts, or
success-shaped stubs as security enforcement. Protected body validation
must be audit-aware; lifecycle and storage facts are derived server-side;
high-risk actions consume L2.9 approval before side effects; services
re-check privilege in the commit transaction; and writers that create
derived artifacts must account and clean up every file they produce.

## 2026-05-06: Secure-core Layer-2 traversal and input-boundary hardening

### Affected subsystem
- `packages/secure_core/src/middleware`
- `packages/secure_core/src/paths`
- `scripts/dev/check_repo_conventions.sh`
- `AGENTS.md` / `CLAUDE.md`

### Symptoms
Layer-2 audit found several implementation discrepancies against
`secure_multi_user_scaffolding_plan_v4.md` and
`program_development/phase_05_security_implementation_plan.md`: direct
`safeOpenPath` callers could touch a `../outside` candidate before the
final containment error; archive extraction trusted destination
directories after validating archive entry names; the forbidden body
field scan covered only a top-level subset of v4 §4.1; bearer
authorization was documented as refused but not enforced; the workspace
path builder's default root produced `workspaces/workspaces/<id>`; and
`composeMiddleware` silently sorted out-of-order middleware.

### Root cause
The implementation proved happy-path structure and many negative cases,
but missed the exact side-effect ordering and "all shapes" variants:
direct safe-open calls vs. builder-mediated calls, destination-side
symlinks vs. archive-entry symlinks, nested request-body fields vs.
top-level fields, and registration-order enforcement vs. runtime sorting.

### Fix
Moved component validation ahead of any candidate filesystem open in
`safeOpenPath`; routed archive file writes through `safeOpenPath` and
added lstat-based destination directory traversal; expanded
`validateInputSchema` to recursively reject the full v4 §4.1 field list,
camelCase aliases, and wildcard `*_hash` fields; made `requireAuth`
refuse `Authorization: Bearer`; corrected the workspace path builder's
default root; and changed `composeMiddleware` to throw on out-of-order
registration.

### Regression protection
- `packages/secure_core/test/paths/safeOpen.test.ts`
- `packages/secure_core/test/paths/extractArchive.test.ts`
- `packages/secure_core/test/middleware/validateInputSchema.test.ts`
- `packages/secure_core/test/middleware/requireAuth.test.ts`
- `packages/secure_core/test/middleware/compose.test.ts`
- `packages/secure_core/test/paths/builder.test.ts`
- `scripts/dev/check_repo_conventions.sh`

### Agent warning
Security helpers must reject before touching the filesystem, and tests
must assert absence of side effects, not just the thrown error. Lists
copied from the plan must be copied completely and applied recursively
when the rule says "request bodies", not only at the top-level envelope.

## 2026-05-06: Secure-core Layer-1 ADR audit fixes

### Affected subsystem
- `packages/secure_core/src/secrets`
- `packages/secure_core/src/db`
- `packages/secure_core/src/errors`
- `scripts/dev/check_repo_conventions.sh`
- Phase 0.5 ADR / limitation status documentation

### Symptoms
The Layer-1 implementation mostly existed, but several accepted-ADR
invariants were present only in prose or were missing from the hard gate:
the secrets provider still had a production stub path, one database role
had broader access than its contract, anchor rows were not forced to carry
a version-pinned external reference, and error details could echo unsafe
keys. Dependency audit also found outdated secure-core Node tooling below
patched advisory lines.

### Root cause
The close relied on file-existence checks and status prose instead of
negative probes against the actual enforcement layer: provider dispatch,
SQL GRANTs, schema CHECKs, error-envelope mapping, and convention-checker
coverage.

### Fix
Implemented the missing secrets provider paths, centralized environment
reads under the secrets package, made the anchor URI check executable in
schema and migration SQL, narrowed the anchor-writer grant, sanitized
error details at the HTTP mapper, ratcheted the convention checker for
L1.6/L1.8, upgraded the secure-core Node dependency tree to patched
release lines, and corrected high-level status/documentation drift.

### Regression protection
Updated `packages/secure_core/test/secrets/client.test.ts`,
`packages/secure_core/test/db/schema.test.ts`,
`packages/secure_core/test/errors/shapes.test.ts`,
`packages/secure_core/test/config/constants.test.ts`, and
`scripts/dev/check_repo_conventions.sh`. Also ran
`npm --prefix packages/secure_core audit`.

### Agent warning
Security invariants do not count until the enforcement layer and a
negative test both carry them. Comments, accepted ADRs, and role names
are not enforcement.

## 2026-05-04: Phase 10 round-2 audit — six legitimate review findings

### Affected subsystem
- `simworkbench.autonomy.experiment_design` (placeholder propagation)
- `simworkbench.api.server` (autonomy endpoints — provenance trace, budget config, missing smoke endpoint)
- `simworkbench.autonomy.sweep_agent` (early-stop on failure ratio)
- `simworkbench.autonomy.scientific_review` (locality guard)
- `simworkbench.autonomy.approval_gates` (locality guard)
- `simworkbench.sweep.engine` (per-row observer hook, new infrastructure)
- `apps/workbench-ui/src/components/autonomy/AutonomyPanel.tsx` (smoke button)

### Symptoms
1. **Critical** — Placeholder coefficients in `ModelSpec.interactions[*].coefficient_sources` were not propagated into `ExperimentPlan.placeholders`. A placeholder-backed spec produced `capsule_status_for_plan(plan) == "validated"`, exactly the failure plan §22 (Scientific Accuracy Policy) exists to prevent. Direct probe: `PLACEHOLDER_PROBE [] validated`.
2. **High** — Phase 10 inspectability/provenance was not actually written. The autonomy API endpoints returned 200 but no `<capsule>/provenance/agent_trace.md` entry appeared. The misleading regression test in `tests/regression/test_autonomy_provenance_trail.py` only asserted "the reviewer doesn't write into off-limits subtrees", not "an agent_trace entry was actually appended". Direct probe: `TRACE_EXISTS False`.
3. **High** — `ControlledSweepAgent` did not stop failed runs early. The agent ran the full capped sweep, then RELABELED the result `high_failure_rate` at the end. The plan-named "stop failed runs" verb (Workstream 10C) was a label, not an actual mid-sweep abort. Direct probe: 20 grid points → 20 attempted → 20 failed before any stop signal.
4. **High** — Phase 10 writers wrote outside workbench-managed roots when given arbitrary paths. `ScientificReviewer.write(/private/tmp/...)` and `ApprovalGate(state_dir=/private/tmp/...)` both accepted off-workbench targets, even though the same Phase-8/9 audit pattern had locked down `SweepEngine`, `SweepCheckpoint`, `ComparisonReport`, `SlurmJob`, `StubPICAdapter`. The review writer had a partial in-capsule subtree check; that check fired only AFTER `relative_to(capsule)`, which silently accepted any capsule path on disk.
5. **Medium** — API sweep ignored configured server policy. `configs/agents.yaml` set `controlled_sweep.budget.max_evaluations_per_launch: 32`, but the autonomy sweep endpoint hard-coded `budget=8`. Direct probe: `BUDGET_PROBE 32 200 8 budget_cap` (config 32, request 200, executed 8, stopped at hard-coded cap).
6. **Medium** — Workstream 10B had no user-facing smoke endpoint or UI. The plan's deliverable list named four autonomy verbs (design / smoke / sweep / review); the API and UI shipped only three. The UI panel docstring claimed "drives the four autonomy endpoints" but the smoke handler was missing.

### Root cause
- **Finding 1:** `ExperimentDesigner.design` constructed `ExperimentPlan(placeholders=[])` unconditionally. The walk over `spec.interactions` was added by hand for tests in `test_autonomy_no_validated_without_evidence.py` via `with_placeholder_coefficient(...)`, but the real-world path (a spec on disk with a `placeholder:`-prefixed `coefficient_sources` entry) never wired through.
- **Finding 2:** Plan §Phase 10 milestone Pre-gate listed "every autonomous decision is logged in the capsule's `provenance/agent_trace.md`" but the API endpoints just returned the agent's data. The `AgentTraceWriter` from Phase 2B was not imported anywhere in `simworkbench.api.server`. The provenance regression test passed because it asserted a NEGATIVE (the reviewer doesn't touch off-limits trees), not a POSITIVE (the trace gets written).
- **Finding 3:** `SweepEngine` had no per-row observer hook, so the agent had no way to interrupt the engine mid-sweep. The agent's `launch` post-processed the report after `engine.run()` returned. The pattern is the same shape as the Phase 9 audit's "label vs. actually stop" finding for `BayesianOptimizerHook`.
- **Finding 4:** The review/approval writers were added without the standard `require_workbench_target=True` + `is_under_workbench` check. Each new Phase introduces new writers; without a shared helper, agents forget the rule. Caught the same way for `SweepEngine` / `SweepCheckpoint` / `ComparisonReport` (Phase 9 audit) — Phase 10 re-introduced the leak on a different surface.
- **Finding 5:** `ControlledSweepAgent(budget=8, ...)` was a Python literal in the API endpoint, not a read from `configs/agents.yaml`. The YAML's `controlled_sweep.budget.max_evaluations_per_launch: 32` was prose, not enforced.
- **Finding 6:** The Phase 10 close shipped `simworkbench.autonomy.SmokeRunner` as a library and had three (not four) API endpoints. The mismatch between "the library has four agents" and "the API has three handlers" was hidden by the gate-walk test, which exercised the LIBRARY agents directly rather than going through the API.

### Fix
1. `ExperimentDesigner.design` now walks `spec.interactions` and appends every interaction whose `coefficient_sources` carries an entry starting with `"placeholder"` (matches the runtime's convention in `simworkbench.runtime.python_cpu`). Two regression tests cover the placeholder-flagged case (`exploratory`) and the clean case (`validated`).
2. New `_trace_autonomy()` helper in `simworkbench.api.server` wraps `AgentTraceWriter`. Every autonomy endpoint (`design`, `smoke`, `sweep`, `review`) now appends one row to `<capsule>/provenance/agent_trace.md` carrying the agent role, action name, files touched, and a notes field summarising the result. Three regression tests pin the trace's existence.
3. `SweepEngine.__init__` gained a new `on_row` callback parameter; returning `True` stops the engine cleanly. `ControlledSweepAgent.launch` wires this to a per-row failure-rate check (defers the abort signal until at least four rows are seen, then stops once `failed / total >= failure_ratio_threshold`). The engine sets `stopped_reason="stopped_by_observer"` and the agent overwrites with the specific cause `"high_failure_rate"`. Regression: 20 grid points + always-failing objective stops at <20 runs with the right cause.
4. `ScientificReviewer.write` and `ApprovalGate.__init__` (and `grant_autonomy_approval`) gained `require_workbench_target=True` + `is_under_workbench` checks. The opt-out kwarg matches the pattern used by every other Phase-8/9/10 writer; tests using `tmp_path` pass `require_workbench_target=False`.
5. New `_autonomy_sweep_budget()` helper in `simworkbench.api.server` reads `configs/agents.yaml::controlled_sweep.budget.max_evaluations_per_launch` and falls back to a documented default. The sweep response now includes `budget` so callers can verify the server-side cap.
6. New `POST /api/autonomy/smoke/{name}` endpoint plus `apiClient.smokeExperiment` and a "Smoke run" button + result section in `AutonomyPanel.tsx`. The endpoint runs `SmokeRunner` against the capsule's spec and writes the matching provenance trace.

### Regression protection
- 13 new tests in `tests/regression/test_phase_10_round2_audit.py` covering all six findings (one or more tests per finding, with both positive + negative paths where applicable).
- Six new error patterns added to `bugs_and_fixes/agent_error_patterns.md`:
  1. Spec-level placeholder data not propagated through derived plan objects.
  2. API endpoint claims provenance/inspectability but writes no trace.
  3. Mid-loop abort labeled but not enforced (sibling of Phase-9 BayesianOptimizerHook finding).
  4. New writer surfaces miss the locality guard (sibling of Phase-9 finding, repeated for Phase-10 surfaces).
  5. Hard-coded server-side budget while YAML carries a documented cap.
  6. UI/library claim N affordances while API ships fewer.

### Agent warning
- When the spec's data structure carries a placeholder-marker convention (e.g. `"placeholder:"` prefix on `coefficient_sources`), every derived plan / report / capsule that asks "is this fabricated?" must walk the original structure, not just the explicit setter the test fixtures use. A library helper that's only callable manually is not a propagator.
- "Provenance trail exists" is a positive claim; a regression test that only asserts "the reviewer doesn't touch user_edits/" doesn't verify the positive. Add an explicit existence + content check.
- Agents that wrap a long-running engine for early-stop semantics need a per-row callback. Post-call relabeling is not stopping.
- Each new writer surface in a new phase needs the locality guard; this is the third audit (Phase 8, Phase 9, Phase 10) where a writer slipped through. A shared wrapper helper would prevent recurrence.
- YAML config blocks documenting a cap need to be read by code; otherwise they're prose. Cross-cutting "always-on" rules from `configs/agents.yaml` are tested for code/YAML lockstep.
- Plan's deliverable list defines an N-item set; the API and UI must both ship N items. The gate-walk test exercising library agents directly hides UI/API gaps — write at least one end-to-end test that goes through the user-facing surface.

---

## 2026-05-04: Phase 9 post-close audit — eight legitimate review findings

### Affected subsystem
- `simworkbench.sweep.engine` (`SweepEngine.__init__`, `SweepEngine.run`, `SweepEngine.resume`)
- `simworkbench.sweep.samplers` (`AdaptiveSampler.points`)
- `simworkbench.sweep.checkpoint` (`SweepCheckpoint.save`)
- `simworkbench.reports` (`ComparisonReport.write`)
- `simworkbench.optimization.random_search` (`RandomSearchOptimizer`)
- `simworkbench.optimization.bayesian` (`BayesianOptimizerHook`)
- `simworkbench.uncertainty` (`ParameterDistribution`, `bootstrap_confidence_interval`, `SensitivityAnalysis`)
- `examples/parameter_sweep_quadratic/run_sweep.py`
- `apps/workbench-ui/src/App.tsx` (and adjacent component docstrings)

### Symptoms
1. **Critical:** Adaptive sweep resume hung indefinitely. `AdaptiveSampler.points()` cleared `self._history` on entry; `SweepEngine` then pre-populated `sampler._history` with the checkpoint's completed rows. The clear ran AFTER the populate (because `points()` is a generator), wiping the history. The sampler re-proposed an already-completed point, the duplicate-skip filter consumed it without advancing, and the loop spun until killed. Direct probe: a constant-proposing sampler resumed with no cap never terminated.
2. **High:** Phase 9 writers bypassed the workbench locality guard. `SweepEngine(checkpoint_path=...)`, `SweepCheckpoint.save(target)`, and `ComparisonReport.write(target)` all accepted arbitrary paths without `is_under_workbench` checks. Phase 8 had added the same guard to `SlurmJob.write` and `StubPICAdapter`; Phase 9's new writers shipped without it.
3. **High:** Phase 9 was not full-gate clean. Targeted ruff over Phase 9 files initially failed with multiple violations (unsorted imports, unused imports, line length); resolved before this audit reached the run, but the gate-walk did not include a ruff assertion specific to the phase's source tree.
4. **Medium:** `examples/parameter_sweep_quadratic/run_sweep.py` wrote to `temp_runs/<name>/comparison/manifest.json` while `GET /api/comparison/<capsule>` read from `simulation_capsules/<capsule>.lxp/comparison/manifest.json`. The example printed success; the UI's Comparisons tab returned 404. Neither side noticed because the API tests used a hand-rolled fixture in the right path, not the example's output.
5. **Medium:** `RandomSearchOptimizer.optimize` returned `OptimizationResult(best_parameters={}, best_value=inf, evaluations=N, rejected_by_constraints=N)` when every candidate was rejected by constraints. Downstream callers seeing `best_value=inf` could not distinguish "searched, found nothing better than infinity" from "never executed the objective". `evaluations=N` was misleading: no objective call ever happened.
6. **Medium:** `BayesianOptimizerHook.optimize` ran the full budget then labeled the result `early_stop` if the threshold matched. The budget cap was respected, but "early stop" was a label, not a termination — the wrapper never actually stopped `gp_minimize` early. `evaluations` summed executed + rejected, hiding the true work count.
7. **Low:** UQ boundary validation was incomplete. `ParameterDistribution(kind="normal", params={"stddev": -1.0})` constructed cleanly and crashed deep in numpy. `uniform` with `low >= high` produced silent garbage. `bootstrap_confidence_interval(n_resamples=0)` raised an obscure numpy index error. `SensitivityAnalysis(distributions={})` constructed and only failed at `evaluate()` time.
8. **Low:** Docs/UI status polish incomplete. `apps/workbench-ui/src/App.tsx` rendered `<p className="phase-tag">Phase 1F</p>` after Phase 9 closed. Adjacent component docstrings still mentioned "Phase 1F" as the headline phase.

### Root cause
- **Finding 1:** Coupling bug. The engine and the sampler each thought they owned the reset/populate contract for `_history`. The sampler's `points()` generator cleared on entry "between sweep runs"; the engine pre-populated on resume. Generator semantics meant the clear ran after the populate.
- **Finding 2:** Phase 9's writers were introduced WITHOUT the locality guard the Phase 8 audit had added to other writers. The rule lives in `agent_error_patterns.md` prose rather than a shared helper everyone has to call. Each new writer surface is a fresh chance to forget.
- **Finding 4:** Example/consumer divergence. The example was written before the API endpoint settled on the capsule path; nobody updated the example when the endpoint's read path was finalized. No regression test exercised the example → API round-trip.
- **Finding 5:** The result-shape contract was "evaluations is the budget consumed", not "evaluations is the executed count". Both interpretations are defensible, but the all-rejected case proved the executed-count interpretation is the useful one.
- **Finding 6:** The wrapper retrofitted early-stopping at the result-inspection stage instead of using `gp_minimize`'s `callback=` parameter. Common pattern when the third-party routine is treated as a black box.
- **Finding 7:** Validation lived at sample-time / call-time rather than constructor-time. Frozen dataclasses pushed the question to `sample()`; non-dataclass functions had no validation at all.
- **Finding 8:** The phase tag is a hard-coded JSX literal rather than a value derived from a phase constant. Phase status flips updated `README.md` and the milestone but missed `App.tsx`.

### Fix
1. Removed `_history.clear()` from `AdaptiveSampler.points()`. The engine now owns the lifecycle: `run()` clears `sampler._history` and pre-populates from the checkpoint BEFORE advancing the iterator. Added `DUPLICATE_SKIP_LIMIT=100` safety counter — even a pathological adaptive sampler now stops with `stopped_reason="adaptive_stuck"` instead of looping forever.
2. Added `require_workbench_target: bool = True` kwarg + `is_under_workbench` check to `SweepEngine.__init__`, `SweepEngine.resume`, `SweepCheckpoint.save`, and `ComparisonReport.write`. Test fixtures using pytest's `tmp_path` (which lies outside the workbench-managed roots) pass `require_workbench_target=False`.
3. Verified ruff clean over `packages/core/src/simworkbench/{sweep,optimization,uncertainty,reports}` and added `test_audit_phase_9_files_pass_ruff` to keep it that way.
4. Updated `examples/parameter_sweep_quadratic/run_sweep.py` to write to `simulation_capsules/<name>.lxp/comparison/`. The example now prints the matching `GET /api/comparison/<capsule>` URL. Regression test exercises the example → API round-trip via FastAPI's `TestClient`.
5. `RandomSearchOptimizer` now returns `evaluations=executed` (not `executed + rejected`); when every candidate is rejected, sets `stopped_reason="all_candidates_rejected"` and `best_value=NaN`. Updated `tests/integration/test_optimization_budget.py::test_constraint_rejections_counted_in_budget` to reflect the new contract.
6. `BayesianOptimizerHook.optimize` now wires `gp_minimize(callback=_early_stop_cb)` so the search actually terminates when the executed history's best meets the threshold. `best_value` is computed from the executed history (sign-flip aware). `evaluations` reflects the executed count.
7. Validation moved to entry points: `ParameterDistribution.sample` checks `stddev > 0` for `normal`/`lognormal` and `low < high` for `uniform`; `bootstrap_confidence_interval` rejects `n_resamples <= 0`; `SensitivityAnalysis.__post_init__` rejects empty distributions. Each raises `ValueError` with the offending value in the message.
8. Bumped `<p className="phase-tag">` from `"Phase 1F"` to `"Phase 9"`. Removed "Phase 1F" from headline docstrings in `App.tsx`, `app/page.tsx`, `DiagnosticsPanel.tsx`, `SimulationList.tsx`, and `CodeViewer.tsx` (the placeholder/comment remains where the file is genuinely a Phase 1F-era artifact, but never as the rendered headline). Regression test parses `App.tsx`'s `phase-tag` element and asserts it isn't the pre-Phase-2 placeholder.

### Regression protection
- New regression tests in `tests/regression/test_phase_9_audit_findings.py` (17 tests covering all eight findings).
- Updated `tests/integration/test_optimization_budget.py::test_constraint_rejections_counted_in_budget` to reflect the executed-only `evaluations` contract.
- Eight new error patterns documented in `bugs_and_fixes/agent_error_patterns.md`:
  1. Stateful sampler whose history-clear races with engine pre-population on resume.
  2. New writer surfaces in a phase miss the locality guard the prior phase added.
  3. Example writes to one path while the API endpoint reads from another.
  4. Sentinel "best" returned alongside zero successful evaluations.
  5. Callback-driven "early stop" that only labels the result, never terminates.
  6. Boundary validation lives at sample-time, not constructor-time.
  7. UI banner / sidebar phase tag drifts behind the actual phase.

### Agent warning
- When two pieces of code (engine + sampler, importer + reviewer, etc.) both write to a shared mutable attribute on entry, neither can assume ownership of the lifecycle. Document the contract in code AND test the order of operations on resume / re-entry paths.
- Each phase that introduces a new writer surface re-introduces the locality leak. The rule is in `agent_error_patterns.md`, but agents forget. Stage the locality test alongside the gate-walk test BEFORE implementation.
- Examples that feed UI/API paths must write to the path the consumer reads. A test that exercises the round-trip catches divergences a unit test never will.
- Optimizer result shapes that use `inf`/`-inf`/`{}` as sentinels are misleading when the optimizer never executed the objective. Use `stopped_reason` as the primary signal; sentinel values are backup.
- Wrappers around third-party search routines must use the routine's callback hook for early stopping. Post-call labeling is not stopping.
- Validate user-facing data classes at construction time. Sample-time validation defers errors to a stack trace far from the offending input.
- Phase-status-flip commits include the UI's phase-tag banner edit. Add the regression test alongside the new tag.

---

## 2026-05-04: Phase 8 post-close audit — seven legitimate review findings

### Affected subsystem
- `simworkbench.backends.registry` (`BackendRegistry.set_status`, `recommend`)
- `simworkbench.backends.metadata` (`BackendMetadata.status`)
- `simworkbench.serialization.capsule` (`save_capsule` determinism stamp)
- `simworkbench.hpc.slurm` (`SlurmJob.write` locality + docstring)
- `packages/solver_backends/external_pic` (StubPICAdapter writers)
- `packages/solver_backends/cpp` (axpy in-place contract)

### Symptoms
1. **Critical:** `BackendRegistry.set_status` rewrote `configs/backends.yaml` after `require_backend_transition` but never called `consume_backend_approval`. Direct probe: `actor="human"` promoted `python_cpu` to `validated` without any token. The Phase-6/7 audit lesson "Trusting a client-supplied actor identity for a privileged check" repeated, this time at the LIBRARY level (not just the API).
2. **High:** `BackendMetadata.status: str` accepted any string. `status: totally_invalid` loaded silently and only failed when downstream code evaluated `BackendStatus(self.metadata.status)`. Contradicted the rule-20 claim "registry refuses invalid metadata".
3. **High:** `save_capsule` defaulted `determinism = True` and silently fell back to that default when `simworkbench.runtime.get_backend("cuda")` failed. CUDA capsules saved with `determinism: true` and empty warning despite `configs/backends.yaml` declaring `determinism: false`.
4. **Medium:** `BackendRegistry.recommend(spec)` returned every capability match including `planned` and `in_progress` rows, despite `selection_policy` documenting filter-to-validated/trusted. Direct probe for 2D PDE returned `cpp` (in_progress) plus `fortran`/`cuda`/`kokkos`/`petsc`/`amrex` (all planned).
5. **Medium:** `SlurmJob.write` and `StubPICAdapter.{write_input_deck, import_result}` accepted arbitrary `target` paths and wrote there without `is_under_workbench` checks. Direct probe wrote bundles + result files to `/private/tmp`.
6. **Low:** `cpp.axpy` advertised in-place mutation but called `np.ascontiguousarray(y)`, which silently copied non-contiguous `y`. The caller's strided base array was never updated; the function returned a stale buffer.
7. **Low/coherency:** `simworkbench.hpc.slurm` module docstring claimed "self-contained" bundle, but the runner explicitly required `simworkbench-core` available on the remote node via `pip install` or PYTHONPATH.

### Root cause
The Phase 8 close commit verified that the approval-token machinery, status enum, BackendRegistry, recommend(), HPC writers, and axpy wrapper all *existed*; it didn't verify that each gate fired on the negative path. Five of the seven findings are gates that were built but not wired (or wired but not enforced); two are documentation / behavioral mismatches.

### Fix
1. `BackendRegistry.set_status` calls `consume_backend_approval(name, from_status=..., to_status=...)` whenever `new_status in {VALIDATED, TRUSTED}`, regardless of `actor=`. Token absence raises `BackendApprovalError`. The library exposes NO `skip_approval` kwarg; a regression test inspects the signature.
2. `BackendMetadata.status` is now `Literal["planned", "in_progress", "validated", "trusted", "deprecated"]`. Pydantic refuses out-of-set values at load time; the registry surfaces the error with the file path.
3. `_resolve_backend_determinism(backend_name)` consults the runtime registry first, then `BackendRegistry` metadata, raises `CapsuleSaveError` when both fail. `save_capsule` calls it; CUDA capsules now correctly stamp `determinism: false` + the policy warning string.
4. `BackendRegistry.recommend(spec)` defaults `include_statuses={VALIDATED, TRUSTED}`. Callers passing `include_statuses=frozenset()` (empty) get every status; passing a custom subset works too.
5. `SlurmJob.write(target, *, require_workbench_target=True)` and `StubPICAdapter(require_workbench_target=True)` enforce the `is_under_workbench` check by default. Explicit `require_workbench_target=False` is the documented opt-out for genuinely-external destinations.
6. `cpp.axpy` raises `ValueError` for non-contiguous `x` or `y` with a clear remediation message. The `np.ascontiguousarray` call is removed; the contiguity check is the gate.
7. `simworkbench.hpc.slurm` module docstring rewritten to describe the actual contract (payload + entrypoint self-contained; runtime dep must be installed on the remote node).

### Regression protection
Every finding has at least one regression test in `tests/regression/test_phase_8_audit_findings.py` (18 tests). Each test reproduces the audit's direct probe.

### Agent error patterns added
7 new patterns at the bottom of `bugs_and_fixes/agent_error_patterns.md`:
- "Approval-token machinery built but not wired at the mutation boundary"
- "Capsule writer reads single registry then silently defaults"
- "Plain `str` field where a Literal/enum belongs"
- "Recommendation ignores the configured selection policy"
- "External-writer functions skip the locality guard exporters got right"
- "Documented in-place mutation that silently copies on strided inputs"
- "Documentation claims behavior the code can't deliver"

### Warning to future agents
The Phase 8 audit found seven gaps despite 15 gate-walk tests passing. The pattern across all seven: existence checks are necessary but not sufficient. For every gate the library declares, write a NEGATIVE probe — one that exercises the failure path the audit imagined. The library's mere ability to call `consume_backend_approval` doesn't mean `set_status` calls it; the test must exercise the bypass attempt.

---

## 2026-05-04: Phase 7 post-close audit — lifecycle gate bypass and incomplete module family

### Affected subsystem
- `packages/core/src/simworkbench/modules/`
- `packages/core/src/simworkbench/modeling/module_match.py`
- `packages/physics_modules/laser/`
- `packages/physics_modules/species/`

### Symptoms
`ModuleRegistry.set_status(..., actor="human")` could promote a module without an approval token or passing declared tests, and invalid validated metadata was hidden by `refresh()` because malformed `module.yaml` files were skipped. Phase 7B also collapsed the laser-species family into a small reference subset: plan-named modules such as `laser/absorption`, `laser/emission`, `laser/excitation`, `laser/ionization`, `laser/recombination`, `species/electron_temperature`, and `species/species_density` were missing or incomplete. Some existing module YAML files pointed at tests that did not exist. `ModuleMatcher` surfaced module lifecycle status but did not use it to prefer validated modules when scores tied.

### Root cause
The privileged gate lived partly in prose/API flow instead of the mutating registry method, and the public mutator still exposed bypass-style flags. Convention checks verified selected reference modules rather than every plan-named family member and did not assert metadata evidence paths. Registry discovery treated invalid metadata as ignorable, so a broken module could disappear from a fresh registry instead of failing the gate.

### Fix
`ModuleRegistry.set_status` now validates the target metadata before writing, consumes the single-use module approval token at the mutation boundary, requires benchmark artifacts and declared tests, and always runs those tests before `candidate → validated`. Public approval/test bypass flags were removed. Registry refresh now fails on invalid module metadata instead of skipping the file. Added `python -m simworkbench.modules.approve` to match the documented approval flow. Phase 7B plan-named laser/species modules now exist with module YAML, docs, source, tests, examples, and benchmark placeholders where validation is still pending. Stale test paths for validated and candidate modules were fixed with module-local tests. Module matching now ranks trusted/validated modules above candidates at equal scientific score.

### Regression protection
- `tests/regression/test_module_registry_promotion_gates.py`
- `tests/regression/test_phase7_module_metadata_integrity.py`
- `scripts/dev/check_repo_conventions.sh`

### Agent warning
Do not put lifecycle safety in an API wrapper while leaving the library mutator permissive. Do not add public "test fixture" flags that skip human approval or test execution on a production mutator. Do not mark a plan-named module family complete by shipping only a reference module; enumerate every name and make the convention checker assert the artifacts. Do not silently skip bad registry metadata during discovery.

## 2026-05-03: Phase 6 post-close audit (round 2) — UI typecheck broken; test gate skipped tsc

### Affected subsystem
- `apps/workbench-ui/src/components/codegen/GeneratedCodeView.tsx`
- `scripts/test/all.sh` (no UI typecheck step)

### Symptoms
The Phase 6 round-1 audit fix renamed the codegen-diff API field from `current_files` to `current_preview` (so the endpoint actually returned a diff). The TS type in `apps/workbench-ui/src/api/client.ts` was updated; the consumer at `GeneratedCodeView.tsx:255` still read `diff.current_files.length`. `npm --prefix apps/workbench-ui run typecheck` failed with TS2339; `vitest run` passed because esbuild/swc strips types instead of checking them; the round-1 close commit landed broken on `main`.

### Root cause
The repo's hard-gate test runner (`scripts/test/all.sh`) ran `lint.sh` + `unit.sh` + `integration.sh` + `regression.sh` + `validation.sh` + `performance.sh` — every Python check — but did not invoke `tsc --noEmit`. The TS package's `package.json build` script chained `tsc --noEmit && vite build`, so a build would have failed; `all.sh` never built. Convention checker covered the existence of every existing test script but didn't require a UI test step.

### Fix
- Updated `GeneratedCodeView.tsx` to render the diff lists (added/removed/changed) from the new shape — this also closed the "Diff endpoint that doesn't compute a diff" pattern leak that had reached the UI (the panel was reporting "Current tree carries N file(s)" instead of showing the actual diff entries).
- Added `scripts/test/ui.sh` that `cd`s into `apps/workbench-ui/` and runs `npm run typecheck` then `npm test`. Wired into `scripts/test/all.sh`.
- Convention checker asserts `scripts/test/ui.sh` exists + is executable (435 → 436).
- New Vitest test `renders the diff lists (added/removed/changed) when the diff endpoint reports them` — mounts the panel with a mocked diff response and asserts each bucket's rows appear in the DOM.

### Regression protection
- `scripts/test/ui.sh` runs as part of `scripts/test/all.sh`. Type drift between FastAPI body schemas and the TS API client now fails the gate.
- New Vitest test pins the expected DOM shape for the diff panel.
- New error pattern at the bottom of `agent_error_patterns.md`: "Test gate runs unit tests but not the typechecker".

### Agent error patterns added
1 new pattern at the bottom of `bugs_and_fixes/agent_error_patterns.md`:
- "Test gate runs unit tests but not the typechecker"

### Warning to future agents
`vitest run` is **not** a typechecker. esbuild/swc strips types instead of checking them. Always run the explicit `tsc --noEmit` step before considering UI work green. After this fix, `bash scripts/test/all.sh` runs both — but if you change the test wiring, preserve the typecheck step. Same applies to any future TS package: it gets its own `scripts/test/<pkg>.sh` that runs typecheck before vitest, wired into `all.sh`.

---

## 2026-05-03: Phase 6 post-close audit — eight legitimate review findings

### Affected subsystem
- `simworkbench.codegen.validation_run` (Phase 6E)
- `simworkbench.runtime.python_cpu` (Phase 1, exposed by Phase 6 codegen path)
- `simworkbench.api.server` — `/api/tools/{name}/status`, `/api/runs`, `/api/capsules/{name}/codegen/diff`
- `simworkbench.serialization.bulk_data` + `simworkbench.serialization.capsule` (HDF5 round-trip)
- `simworkbench.serialization.exporters.archive`
- `simworkbench.codegen.generator` (regeneration cleanup)
- `apps/workbench-ui/src/components/codegen/GeneratedCodeView.tsx` (editor)

### Symptoms
1. **Critical:** `ValidationRunner.run` reloaded `model_spec.yaml` and ran `Runner` directly — never imported `<capsule>/src/generated/experiment.py`. Corrupting the generated file with invalid Python returned `incomplete` with no failure.
2. **Critical:** One-participant interactions with non-placeholder `paper:` coefficients silently no-op'd. The backend skipped them BEFORE coefficient validation fired (`if len(species) < 2: continue`).
3. **High:** `POST /api/tools/{name}/status` accepted `actor=human` from the body. Any caller (including the autonomous agent) could promote a tool to `validated` by claiming to be a human.
4. **Medium:** `POST /api/runs` returned HTTP 500 on malformed `RunConfig` inputs (e.g. `max_steps=0`, malformed `end_time`). The constructor lived outside the try/except.
5. **Medium:** HDF5 metadata stored only `placeholder_used: bool`. HDF5-only capsule reload returned `placeholders=[]` — the names were lost.
6. **Medium:** `export_archive` walked `<capsule>` with `rglob` after creating the destination zip. A target inside the capsule (e.g. `<capsule>/exports/<capsule>.zip`) captured itself.
7. **Medium:** `/api/capsules/{name}/codegen/diff` returned `{previous, current_files}` only — no real diff. The gate-walk test asserted only that two keys existed in the response.
8. **Low:** `CodeGenerator.generate` overwrote files but never deleted orphans. Stale `src/generated/` artifacts lingered through regeneration into export.
9. **Low:** Phase 6D plan said "Generated Code Viewer **and Editor**". The shipped UI was a list/action panel — no inline editor for `user_edits/`.

### Root cause
The Phase 6 close commit verified file presence + the sixteen behavioral checks but did not (a) corrupt the generated artifact and re-run validation, (b) iterate every interaction arity through the runtime, (c) test the API's privileged path with a credential bypass, (d) round-trip an HDF5-only capsule, (e) self-export to an archive inside the source, (f) actually compute the diff endpoint's claim, (g) regenerate after dropping a spec field, or (h) word-audit the plan deliverable description against the shipped panel. Each failure mode is a behavioral check the Phase 6 close was missing — eight new patterns now in `agent_error_patterns.md` and four new behavioral checks (#17–#24 in `CLAUDE.md → Phase Gate Procedure → Closing a phase`).

### Fix
1. `ValidationRunner` now uses `runpy.run_path` against `<capsule>/src/generated/experiment.py`, calls its `run()` function, and surfaces every exception as `validation_status: failed` with the exception text in `failure`.
2. `python_cpu.RatePopulationBackend.initialize` validates coefficient sources for every interaction BEFORE the arity branch, then implements decay (arity 1) AND conversion (arity 2) AND rejects arity 3+ explicitly.
3. `ToolStatusBody.actor` is removed entirely. The API hard-codes `actor="agent"` for agent-allowed transitions; human-only transitions consume a single-use approval token written by `simworkbench.tools.grant_approval` (or `python -m simworkbench.tools.approve`). The token lives at `<repo>/local_cache/tool_approvals/<name>__<from>-to-<to>.approval` and is read+deleted on use.
4. `start_run` now wraps `load_modelspec_yaml`, `Experiment.from_model_spec`, and `RunConfig(...)` in try/except — every `ValueError` / Pydantic `ValidationError` returns 400.
5. `_coerce_attr` now stores `list[str]` as a vlen-string array. `save_capsule` writes `placeholders: list[str]` to HDF5 metadata; `load_capsule` reads it back (sidecar fills in only when HDF5 doesn't carry the field).
6. `export_archive` validates `archive.relative_to(capsule)` raises BEFORE creating the destination, with a defense-in-depth `path.resolve() == archive_resolved` exclude in the rglob walk.
7. `/codegen/diff` runs the generator into a temp capsule under `temp_runs/`, computes `added`/`removed`/`changed`/`unchanged` against the prior manifest, and tears down the temp tree before returning.
8. `CodeGenerator.generate` now reads the prior manifest, computes orphans, and removes them through `_remove_under_sandbox` (same allowed-roots / off-limits checks as `sandboxed_write`). `CodeGenerationResult.removed_files` lists what was cleaned.
9. `GeneratedCodeView` gains a Path/Contents textarea + Save button bound to `apiClient.writeUserEdit`. New backend endpoint `POST /api/capsules/{name}/user_edits/{path:path}` calls `simworkbench.codegen.user_edit_write` — a separate library function that accepts paths under `user_edits/` ONLY (paper_sources/, provenance/, src/generated/ are refused).

### Regression protection
- `tests/regression/test_validation_runner_executes_generated_code.py` — corrupts `experiment.py` with invalid Python; asserts `validation_status: failed` with `SyntaxError` in `failure`.
- `tests/regression/test_interaction_validation_fires_for_all_arity.py` — sends arity-1 with `paper:` (raises), arity-1 with `placeholder:` (runs), arity-2 with `paper:` (raises), arity-3 (raises).
- `tests/integration/test_api_server.py::test_set_tool_status_rejects_unauthorized_agent_promotion` — POST without approval → 403; POST with grant → 200; second POST → 403 (single-use). Plus `test_set_tool_status_ignores_actor_from_body` — posting `actor=human` → 403.
- `tests/regression/test_run_config_400_not_500.py` — `max_steps=0` / malformed `end_time` / unknown YAML path each → 400, never 500.
- `tests/regression/test_capsule_hdf5_only_preserves_placeholders.py` — strips JSON sidecar; reload preserves `placeholders` byte-for-byte.
- `tests/regression/test_archive_does_not_contain_itself.py` — refuses target inside source; canonical export does not contain its own filename.
- `tests/regression/test_codegen_cleanup_and_diff.py` — orphan file removed on regenerate; `/diff` returns added/removed/changed; `/diff` does not mutate disk.
- `tests/regression/test_user_edits_editor_endpoint.py` — POST writes under `user_edits/`; library refuses `paper_sources/`, `provenance/`, `src/generated/`, and path-escape.

### Agent error patterns added
8 new patterns at the bottom of `bugs_and_fixes/agent_error_patterns.md`:
- "Validation runs the source-of-truth, not the generated artifact"
- "Validation rule fires after a permissive early-exit"
- "Trusting a client-supplied actor identity for a privileged check"
- "Diff endpoint that doesn't compute a diff"
- "Archive contains its own destination"
- "Serializer drops semantic fields when writing the canonical format"
- "Generator skips cleanup, leaving stale artifacts"
- "UI calls itself an editor while shipping a viewer"

### Warning to future agents
The Phase Gate Procedure's behavioral checks now span twenty-four entries (was sixteen). Read 17–24 before any Phase 7+ close — they catch the modes that pass existence checks while shipping broken behavior. The pattern this audit reinforces: *every plan verb maps to a real artifact, a real test, and a real corrupt-the-input regression*. "It compiled" / "the test passed" / "the convention checker is green" are necessary, not sufficient.

---

## 2026-05-03: Phase 5 post-close audit — four legitimate review findings

### Affected subsystem
Phase 5 ModelSpec generation + module mapping (commit `e886ede`). The Phase 5 close passed all twelve behavioral checks but a user audit found four gaps the checks didn't cover.

### Symptoms
1. **Critical: Phase 5 review gate publicly bypassable.** `POST /api/proposals` accepted `require_reviewed: false` in the body; the UI exposed a checkbox that flipped the same flag. A direct probe with the bypass wrote `model_spec.yaml` and `experiment_proposal.md` from agent-only interpretation, in violation of plan §Phase 4's hard rule.
2. **High: Phase 5 only checked `edited_by` on structured rows.** The four interpretation Markdown files (`paper_summary.md`, `assumptions.md`, `validity_domain.md`, `implementation_plan.md`) carry the agent's "needs human review" / "AGENT DRAFT" banner. The generator's `_enforce_human_review` walked equations + parameters but never opened the Markdown. A capsule with signed rows + banner-bearing Markdown was accepted.
3. **High: ModuleMatcher's `unit_compat` was a parse-check, not a dimensionality-check.** A fake module declaring a single `second`-dimensioned output scored `unit_compat=1.0` for a species-density ModelSpec. The check verified that every module-output unit parsed cleanly, not that it was dimensionally what the spec needed.
4. **High cross-phase safety drift: `security_sandbox` disabled.** `agents.yaml` declares the role as "Always-on once any agent is enabled". Phases 4+5 enabled four other roles; `security_sandbox.enabled` stayed `false`. The rule was prose; no code read or enforced it.

### Root cause
Four new failure modes:

- *Hard rule made optional via a client-controlled API parameter* — issue 1.
- *Validating one input shape but not all input shapes the rule covers* — issue 2.
- *Compatibility checks that pattern-match instead of validating dimensionality* — issue 3.
- *Cross-cutting safety rule encoded in a comment but not enforced in code* — issue 4.

### Fix
- `ProposalBody` no longer accepts `require_reviewed`. The endpoint hard-codes `True`. UI checkbox removed; `apiClient.createProposal(capsule)` no longer accepts the flag. Regression test posts the bypass attempt, asserts 400, AND verifies no artifacts land on disk.
- `_enforce_human_review` now also walks the four interpretation Markdown documents and refuses any that still contain `"needs human review"` or `"agent draft"`. Regression test plants the banner in `assumptions.md` and asserts the generator refuses.
- `ModuleMatcher.unit_compat` rewritten: `_required_output_dims(spec)` returns the dims the consumer needs (number density for species), `unit_compat = n_required_covered / len(required)`. Parses-but-wrong-dim → 0. Regression test creates a fake module whose only output is `second` and asserts `unit_compat < 1.0`.
- `agents.yaml` flips `security_sandbox.enabled` to `true`. New `tests/regression/test_security_sandbox_enforcement.py` reads the YAML and asserts: if any non-sandbox role is enabled, `security_sandbox` MUST be enabled too.

### Regression protection
- `test_phase_5_gate_walk.py::test_phase_5_api_rejects_require_reviewed_bypass`
- `test_phase_5_gate_walk.py::test_phase_5_refuses_when_interpretation_markdown_still_has_review_banner`
- `test_module_retrieval.py::test_unit_compat_rejects_dimensionally_incompatible_outputs`
- `test_security_sandbox_enforcement.py` (3 tests)

### Agent warning — sixteen behavioral checks
The Phase Gate Procedure's twelve checks didn't catch any of these four issues. Four new checks join the list:

- **#13. Hard rules don't take a client-controlled flag.** Every "must hold" rule is enforced inside the library, not by trusting a request-body field. UI controls don't expose toggles for security checks.
- **#14. Mixed-shape rules cover every shape.** When a rule applies to "every interpretation artifact" (or any union-of-shapes set), enumerate the shapes and assert the check has a branch per shape.
- **#15. Compatibility checks compare against the consumer's contract.** Don't accept "parses cleanly" or "is non-empty" as compatibility. Compute the consumer's required shape and check coverage of THAT.
- **#16. Cross-cutting "always-on" prose has a regression test.** Each cross-cutting invariant has a test that reads the relevant state and fails when the invariant drifts.

Phases 1, 2, 3, 4, and 5 each shipped an incomplete close. Sixteen behavioral checks now — four more than before.

---

## 2026-05-03: Phase 4 post-close audit (round 2) — PDF success path + scope drift

### Affected subsystem
Phase 4 paper ingestion. The first audit (commit `48263d5`) added `extract_text(pdf_path)` and a structured `TextExtractionError` with a clean message. A second audit found the failure path was correct but the success path was unimplemented.

### Symptoms
1. **PDF import returned HTTP 500.** `pypdf` was missing from `packages/core/pyproject.toml` and from the venv. The API endpoint caught only `PaperIngestionError`, not `TextExtractionError`. A direct `POST /api/papers/import` with a `.pdf` returned an uncaught traceback.
2. **Docs/status drift on PDF scope.** Milestone said PDFs were in 4A scope; `agent_workflows.tsx` said "Markdown today; PDF support is a Phase 4+ extension"; README's Phase 4 banner didn't mention `extracted_text.md` / `extracted_tables.json` / `extracted_figures.json` at all.

### Root cause
- *Shipping the structured error without shipping the success path* — issue 1. The agent built the error path and treated that as feature support. Three things make a feature work: dep installed, error propagated, success-path test. Only the error message landed.
- The status drift is the existing *Duplicated phase status across nearby paragraphs* pattern applied to scope claims (PDF supported here, not supported there) instead of completion status.

### Fix
- Added `pypdf>=4.0,<6.0` as a hard dep in `packages/core/pyproject.toml`. Reinstalled in venv (`pypdf-5.9.0`).
- API's `import_paper` endpoint now catches `(PaperIngestionError, TextExtractionError)` together, surfacing both as 400 with the error message in the body.
- New 600-byte hand-rolled PDF fixture at `tests/fixtures/phase_4_paper/sample.pdf` containing the text "Phase 4 PDF fixture". New gate-walk test `test_phase_4_gate_walk_pdf_import_success_path` posts the PDF to the API, asserts 200, and asserts `extracted_text.md` contains the embedded text.
- README banner updated to list `extracted_text.md`, `extracted_tables.json`, `extracted_figures.json`, and PDF support; `agent_workflows.tsx` updated to say "Markdown and PDF" with a complete Outputs list.

### Regression protection
- `tests/integration/test_phase_4_gate_walk.py::test_phase_4_gate_walk_pdf_import_success_path` — happy-path PDF import end-to-end through the API.
- `tests/unit/test_text_extraction.py::test_extract_text_from_pdf_raises_when_pypdf_missing` (existing) — failure-path complement.
- Together: every "supports PDF" claim has both a success-path test and a failure-path test.

### Agent warning — twelfth behavioral check
The Phase Gate Procedure expands from 11 → **12 behavioral checks**. New:

**#12. Success path runs, not just the structured failure.** For every "supports X" claim:
1. The dep is in `pyproject.toml` and installed by `scripts/dev/install.sh`.
2. Every `raise <StructuredError>` has a matching `try / except` at the API boundary AND a test asserting the documented status code (NOT a 500).
3. A happy-path test exercises the success path with a real fixture. For binary formats, hand-roll the smallest valid file.

A clean error path is necessary but never sufficient — the success path must actually run, and a test must prove it.

---

## 2026-05-03: Phase 4 post-close audit — three legitimate review findings

### Affected subsystem
Phase 4 paper ingestion at commit `6b5fd77`. The Phase 4 close passed all nine behavioral checks (gate-walk test written first, default checker 394/394, etc.) but a user audit found three gaps the nine checks didn't cover.

### Symptoms
1. **Workstream 4A's task list was 2/6 implemented.** Plan §Phase 4 / 4A enumerates: (1) Import PDFs, (2) Store papers locally, (3) Extract text, (4) Extract tables, (5) Extract figures metadata, (6) Preserve source files. Only (2) and (6) shipped — `PaperImporter` did `shutil.copy2` + `read_text(encoding="utf-8")` and called the result good. No `extracted_text.md`, no `extracted_tables.json`, no `extracted_figures.json`, no PDF entry point. The gate-walk test asserted "paper imported" via the file-copied check, which made the verb feel complete.
2. **`InterpretationView` was read-only.** The "Allow edits" verb covers equations + parameters + interpretation. The backend's `apply_edit` accepted `artifact="interpretation"` (and a unit test exercised it), but the UI never wired up an Edit button for the four interpretation Markdown documents. A reviewer using only the UI couldn't edit `assumptions.md` or `paper_summary.md`.
3. **API boundary trusted client-supplied `reviewer`.** UI required a reviewer name; backend accepted `reviewer=""` and recorded `agent=reviewer:` in `provenance/agent_trace.md`. curl / agents / scripts that bypass the UI corrupted the audit trail with no resistance.

### Root cause
Three new agent failure modes:

- *Skipping workstream task bullets when the gate-verb walk seems satisfied* — issue 1. The ninth check covers gate verbs; it doesn't enforce task-bullet coverage. A verb with five sub-tasks was satisfied at the verb level after one sub-task shipped.
- *Treating multi-target verbs as done when one target is implemented* — issue 2. The verb "edit" applied to three artifact kinds; two had UI surfaces; the third silently lacked one.
- *Validating at the UI but not at the API boundary* — issue 3. The classic defense-in-depth gap: UI guards a field, backend trusts whatever the client sent.

### Fix
A single follow-up commit:

- New module `simworkbench.ingestion.text_extraction` with `extract_text` (Markdown identity + optional `pypdf` for PDF), `extract_tables` (Markdown pipe-tables), `extract_figures` (Markdown image refs + nearby caption). `pypdf` is optional with a structured `TextExtractionError` when missing — never silently stub PDF text.
- `PaperImporter.ingest` now writes `extracted_text.md`, `extracted_tables.json`, `extracted_figures.json` alongside the existing equations/parameters/interpretation outputs. `IngestionArtifacts` exposes the new paths. `read_extracted` surfaces them to the API. Provenance notes record the new counts.
- `tests/unit/test_text_extraction.py` covers all three extractors plus the PDF-without-pypdf failure path. The gate-walk test now asserts each new artifact exists with expected content from the fixture (which now includes a real Markdown table and image+caption).
- `InterpretationView` rewritten with an inline Edit button per Markdown section; reviewer name required (UI side), and the backend validates strictly at the boundary. `PaperReview` passes `capsule` + `onEdited` through.
- `PaperImporter.apply_edit` rejects empty/whitespace `reviewer` at the library boundary with `PaperIngestionError`. The API endpoint surfaces this as 400. New regression `test_phase_4_gate_walk_api_edit_refuses_empty_reviewer`. New positive test `test_phase_4_gate_walk_api_edit_interpretation_artifact`.

### Regression protection
Each new pattern has a Detection section. Concrete tests added:
- `tests/unit/test_text_extraction.py` — eight tests for text/tables/figures + the structured PDF error.
- `test_phase_4_gate_walk.py::test_phase_4_gate_walk_end_to_end_library` extended to assert every task-bullet artifact lands on disk.
- `test_phase_4_gate_walk.py::test_phase_4_gate_walk_api_edit_refuses_empty_reviewer` asserts boundary validation.
- `test_phase_4_gate_walk.py::test_phase_4_gate_walk_api_edit_interpretation_artifact` exercises the third edit target.

### Agent warning
The Phase Gate Procedure expands to **eleven** behavioral checks with these two additions:

- **#10. Workstream task-bullet walk.** For each workstream NX, copy the `Tasks:` bullet list from plan §Phase N / NX into a checklist; tick each bullet only when an artifact + test ships. The ninth check (gate-verb walk) covers verbs; the tenth covers each verb's sub-tasks.
- **#11. Boundary validation parity.** For every API endpoint accepting user input, send empty/whitespace/malformed values and assert 400. UI validation is necessary but never sufficient — every layer that accepts an input validates it.

Phases 1, 2, 3, and 4 each shipped a false / incomplete close. The pattern across all four: the agent treated some narrower-than-the-plan completeness criterion as evidence of meeting the plan.

---

## 2026-05-02: Phase 3 false close — five legitimate review findings

### Affected subsystem
Repository-wide. Phase 3 close at commit `c7040c1` claimed Phase 3 complete; a user audit identified five issues — one critical security issue (path traversal), and four behavioral gaps where the Phase 3 gate verbs ("test, register, **use it in an experiment**, export") had no implementation despite the convention checker passing 358/358. The gate, the convention checker, ruff, all tests, and both build scripts were green.

### Symptoms
1. **Phase 3 gate's verbs were not implemented.** Plan §Phase 3 says "create, **test**, document, register, **use it in an experiment**, and **export** a tool." The Phase 3D UI shipped only `list / view-docs / status`; there was no edit, run-tests, import, export, execute, or experiment-binding code path. The plan's gate criterion never had an integration test that walked the verbs end-to-end.
2. **Path traversal in `register_from_template`.** A `target_name="../../_phase3_escape_probe"` got past the `is_under_workbench(root)` check (which validated only `root`, not the resolved `target`) and created a directory outside the registry root before any name-shaped validation fired.
3. **Template registration produced non-loadable tools.** `register_from_template` rewrote `tool.yaml`'s `name:` but left `src/tool.py`'s `name = "TEMPLATE"` literal. `RegisteredTool.load_class()` then refused the mismatch, so every tool registered through the canonical template flow was unloadable.
4. **Lifecycle promotion not gated on scientific state.** Plan §9.5 says `validated` requires "Passes tests and benchmark cases". `set_status(..., ToolStatus.VALIDATED, actor="human")` only checked the actor + transition rule. A candidate tool with `validation.tests: []` was accepted as validated; the rule the label represented was never checked at the moment the label was written.
5. **Output contracts declared but not enforced.** A `BaseTool` subclass declaring `outputs: [peaks, peak_count]` could `return ToolOutput({"wrong": 1})` and `execute()` accepted it. Inputs were validated; outputs were not. The first downstream consumer would fail with a `KeyError` instead of a structured contract violation.

### Root cause
Five new agent failure modes, each now logged in `agent_error_patterns.md`:

- *Implementing the gate's verbs you can see, not the verbs the plan listed* — issue 1. The agent enumerated the file paths from the milestone hint (`ToolList`, `ToolDetail`, `ToolDocs`, `ToolStatus`) and built convention-checker assertions for them, then implemented exactly what the assertions covered. The plan's enumerated **verbs** (test, register, use-in-experiment, export) were skipped because they didn't appear as file paths. This is a stronger, gate-specific form of *Implementing the agent's checklist instead of the plan's deliverable list*.
- *Path traversal via unvalidated user-controlled component in destination paths* — issue 2.
- *Cross-check on registered artifact that ignores half its identity* — issue 3.
- *Lifecycle promotion that checks the actor but not the artifact's scientific state* — issue 4.
- *Validating inputs but not outputs at scientific boundaries* — issue 5.

The deeper meta-pattern: **the eight behavioral checks added after the Phase 2 false close don't include a "verb-walk" check**. They check existence of files, status sync, build success, and so on — but they don't enumerate the plan's gate-clause verbs and exercise each one. The Phase 3 close passed all eight checks while four of the five Phase 3 verbs had no implementation. The check list needs a ninth check.

### Fix
A single follow-up commit (this one) addresses all five:

- New gate-walk integration test: `tests/integration/test_phase_3_gate_walk.py` exercises every verb end-to-end (create-via-template → run-tests → execute → export → import-external → use-in-experiment via `Experiment.tool_refs` and `apply_tools`). Six tests, one per verb.
- Backend gains four new endpoints: `POST /api/tools/{name}/run-tests`, `POST /api/tools/{name}/execute`, `POST /api/tools/{name}/export`, `POST /api/tools/import`. Each one has integration coverage in the gate-walk file.
- UI's `ToolDetail` adds Run-tests and Export buttons; `ToolList` adds an Import-external form. Vitest test count unchanged for now (the gate-walk tests live on the Python side; the UI behaviour is verified by the Python integration tests against a real Vite-bundle-equivalent backend client).
- `Experiment` gains a `tool_refs: list[ToolReference]` field; `simworkbench.tools.apply_tools(experiment, diagnostics)` resolves each reference, pulls the named diagnostics, runs the tool through `RegisteredTool.execute` (which now validates outputs), and returns a dict keyed by tool name. This is the "use in an experiment" gate verb.
- `register_from_template` validates `target_name` syntactically AND verifies the resolved `target.relative_to(root)` BEFORE any filesystem touch. Two regression tests (`test_register_from_template_refuses_path_traversal`, `test_register_from_template_yields_loadable_tool`).
- `register_from_template` also rewrites `name = "TEMPLATE"` in the entrypoint module so the class identity matches the metadata. The integration test asserts the registered tool actually instantiates and `cls.name == target_name`.
- `ToolRegistry.set_status(name, ToolStatus.VALIDATED, ...)` requires `validation.tests` non-empty AND runs pytest on those tests before flipping the label. Two regression tests (`test_set_status_validated_requires_declared_tests`, `test_set_status_validated_runs_tests_and_refuses_failures`).
- `RegisteredTool.execute(**kwargs)` validates the returned `ToolOutput` against `metadata.outputs`; missing declared keys raise `ToolRegistryError`. One regression test.

### Regression protection
Each of the five patterns has a Detection section. Concrete tests added:
- `tests/integration/test_phase_3_gate_walk.py` — six end-to-end tests, one per Phase 3 verb. This is the canonical gate-walk file; future phases that name verbs in their gate get one too (`test_phase_N_gate_walk.py`).
- `tests/integration/test_tool_registry.py::test_register_from_template_refuses_path_traversal` — eight forbidden names, all rejected before any filesystem touch.
- `tests/integration/test_tool_registry.py::test_register_from_template_yields_loadable_tool` — register a template; immediately call `entry.load_class()`; assert `cls.name == target_name`.
- `tests/integration/test_tool_registry.py::test_set_status_validated_requires_declared_tests` — empty tests list raises `LifecycleError` with `validation.tests is empty`.
- `tests/integration/test_tool_registry.py::test_set_status_validated_runs_tests_and_refuses_failures` — declare a deliberately-failing test, assert promotion raises `LifecycleError` with `validation tests failed`.
- `tests/integration/test_tool_registry.py::test_registered_tool_execute_validates_declared_outputs` — write a tool that drops a declared port, assert `RegisteredTool.execute()` raises with `missing declared`.

### Agent warning
The Phase Gate Procedure's eight behavioral checks now have a **ninth: gate-clause verb walk**. Before any close commit, read the plan's `## Phase Gate` paragraph for the phase, extract every verb, and confirm each one has:

1. A real implementation (not a stub).
2. A user-facing surface (UI button / API endpoint / library function).
3. A test in `tests/integration/test_phase_N_gate_walk.py` that exercises the verb end-to-end on a real artifact and asserts the user-observable result.

The convention checker's existence assertions cover deliverable artifacts. The eight existing behavioral checks cover **structural** behaviors (status sync, build success, source-tree cleanliness). The new ninth check covers the **verbs** the plan promises a user can do. A close that skips it ships another false close.

Phases 1, 2, and 3 each had a false close. The pattern across all three: the agent treated the existence of named entities as evidence of the gate criteria being satisfied. The fix is the same each time — read the plan's gate paragraph as the source of truth, not the milestone hint.

---

## 2026-05-02: Phase 2 false close — six legitimate review findings

### Affected subsystem
Repository-wide. Phase 2 close at commit `d88db3e` claimed Phase 2 complete; user review identified seven outstanding issues spanning capsule reload, `save_capsule`'s use of the Phase 2B writers, `CapsuleValidator`'s required-files list, the exporters' destruct-before-guard ordering, the Capsule UI's code viewer, the diagnostics API JSON fallback, and the source-aggregate hash's subtree set. Plus the README's two-place phase-status string drifted, and the build scripts emitted `.js` files into the source tree.

### Symptoms
1. **Reload was a stub.** `scripts/dev/run_capsule.sh` still printed `Capsule loading is scheduled for Phase 2.` and exited 2. README:239 documents this script as the reload entrypoint, so the Phase 2 gate ("portable, inspectable, **reloadable**, exportable") was unmet.
2. **`save_capsule` ignored the Phase 2B writers.** `provenance.lock` was a hand-rolled minimal dict (didn't validate as `ProvenanceLock` — `load_lock()` raised); `environment.yaml` was never written; `agent_trace.md` was overwritten on each save instead of appended via `AgentTraceWriter`. Phase 2B writers existed and had unit tests, but no producer actually invoked them.
3. **`CapsuleValidator` accepted broken Phase 2 capsules.** `REQUIRED_FILES` listed `results/diagnostics.json` (legacy) but not `results/diagnostics.h5` (Phase 2A canonical), and didn't require `provenance/environment.yaml` (Phase 2B). Deleting `diagnostics.h5` left the validator green.
4. **Exporters destructively `rmtree`d the destination before checking source/target overlap.** `export_capsule(capsule, capsule, kinds=("code",))` deleted `<capsule>/src/generated` before raising. The notebook exporter embedded `Path('/Users/.../capsule.lxp')` as a literal — exports were not portable.
5. **`CapsuleCodeView` never showed any code.** It fetched `src/generated/__index__` from the file endpoint, which only serves files, so the call always returned 404 and the panel stayed empty. The convention checker's existence assertion was satisfied because the component file existed.
6. **`/api/capsules/{name}/diagnostics` JSON fallback returned the wrong shape.** It returned the whole capsule JSON sidecar (`run_id`, `state`, `elapsed_seconds`, `placeholders`, `diagnostics`, ...) as `series`, leaking metadata keys into the UI's series table.
7. **`SourceRegistry.DEFAULT_SUBTREES` didn't include `paper_sources/`.** Editing `paper_sources/paper.txt` did not shift the capsule's identity hash — silent break of the provenance chain after a paper edit.

Plus: README:5 said "Phase 2 complete" while README:33 said "In progress (2A, 2B, 2C, 2D open)"; `scripts/build/ui.sh` and `scripts/docs/build.sh` failed (the former emitted `.js` into `src/`, the latter had no local `tsc`). Vitest was picking up the leaked `.js` test duplicates.

### Root cause
Six new agent failure modes, each now logged in `agent_error_patterns.md`:

- *Convention-checker existence ≠ phase-gate behavior* — issues 1, 5. The checker proved files existed; nobody proved the gate-criterion behaviors worked end-to-end.
- *Building writers without wiring producers* — issue 2. Phase 2B's writers had unit tests; the producer that should have called them did not.
- *Schema drift between writers and validators* — issue 3. Phase 2A made HDF5 canonical; the validator's required list didn't follow.
- *Destructive-before-guard in exporters* — issue 4 (first half).
- *Embedding absolute paths in exported artifacts* — issue 4 (second half).
- *Build script emits compile artifacts into the source tree* — the `.js` leak.
- *Duplicated phase status across nearby paragraphs* — README:5 vs README:33.

Issue 6 (diagnostics API JSON fallback) is a plain wiring bug in the JSON-sidecar-shape contract; issue 7 is a narrow `DEFAULT_SUBTREES` omission. Both were caught by the audit grepping the actual user-facing surface, not the convention checker.

### Fix
A single follow-up commit (this one) addresses all seven:

- `scripts/dev/run_capsule.sh` becomes a real implementation calling `load_capsule` + `Runner`. Smoke test at `tests/integration/test_run_capsule_script.py`.
- `save_capsule` calls `ProvenanceLock` + `write_lock`, `write_environment`, `AgentTraceWriter(...).append(...)`. The hand-rolled `_write_toml`/`_toml_value` helpers are deleted.
- `CapsuleValidator.REQUIRED_FILES` adds `results/diagnostics.h5` and `provenance/environment.yaml`; `RECOMMENDED_FILES` (new) holds `results/diagnostics.json` (warning-only sidecar). Three new validator tests assert the new requirements.
- Exporters validate the entire plan before any `rmtree`. Notebook uses `Path('..') / 'results'` instead of an absolute path. Tests assert the source survives a self-export attempt and that no absolute path appears in the notebook source.
- New `GET /api/capsules/{name}/tree?subtree=<path>` endpoint enumerates files. `CapsuleCodeView` calls it, groups by `src/generated`, `src/user_edits`, `src/kernels`, and lets the user click a file to view it.
- `/api/capsules/{name}/diagnostics` JSON fallback returns `payload["diagnostics"]` (or the payload itself if no `diagnostics` key) — never the whole sidecar.
- `SourceRegistry.DEFAULT_SUBTREES` includes `paper_sources/`. New regression test asserts editing `paper_sources/paper.txt` shifts the aggregate hash.
- README's status-table line flipped to **Complete**; build scripts use `tsc --noEmit && vite build`; tsconfig sets `noEmit: true`; `.gitignore` carries defensive rules for `apps/*/src/**/*.js` and `docs_site/src/**/*.js`.

### Regression protection
Each new pattern has a Detection section. Concrete tests added:
- `tests/integration/test_run_capsule_script.py` exercises the reload script end-to-end and asserts the script is not the Phase-0 stub.
- `tests/unit/test_capsule_validator.py` adds `test_validator_requires_diagnostics_h5`, `test_validator_requires_environment_yaml`, `test_validator_warns_on_missing_diagnostics_json_sidecar`.
- `tests/unit/test_export_code.py::test_export_code_refuses_self_overwrite` and the matching test in `test_export_data.py` assert source-survival after a self-export attempt.
- `tests/unit/test_export_notebook.py::test_notebook_uses_relative_capsule_path` asserts no absolute path leaks into the notebook source.
- `tests/integration/test_api_server.py` adds `test_get_capsule_diagnostics_json_fallback` and `test_get_capsule_tree_lists_src_files`.
- `tests/unit/test_provenance_sources.py::test_paper_sources_in_default_aggregate_hash`.

### Agent warning
A close commit must verify gate-criterion *behavior*, not just existence. The eight checks for any future close:

1. Every plan §Phase-N gate criterion exercised end-to-end on a real artifact (save → load → run → export → fork → reload).
2. Every documented script path runs successfully on a typical input — `grep -rn "scheduled for Phase" scripts/` returns only stubs in not-yet-opened phases.
3. Every writer that landed in this phase has an integration test proving the producer actually invokes it (round-trip the producer's output through the writer's `load_*`).
4. Every new validator field corresponds to a producer field that was added in the same workstream — diff the validator and producer commits.
5. Every exporter validates the full plan before any destructive op; tests assert source-survival on self-export.
6. Every UI panel that promises to show X has a test that asserts X is in the rendered output, not just that the component file exists.
7. README + CLAUDE.md + milestone + timeline all agree on phase status — `grep -nE "Phase NN" <files>` reads every match.
8. `scripts/build/*.sh` succeeds; the source tree has no `.js` or `.d.ts` artifacts after the build.

A close commit that skips any of these is rolled back, the new patterns are re-read, and the work is finished. Phases 1 and 2 each shipped a false-close — the third has one less excuse.

---

## 2026-05-02: Phase 1 false close — seven legitimate review findings

### Affected subsystem
Repository-wide. Phase 1 close at commit `37132a5` claimed Phase 1 complete; user review identified seven outstanding issues spanning the convention checker, the runtime checkpoint guard, the API server, the `python_cpu` backend's placeholder handling, ruff cleanliness, status sync, and the plan's Phase Gate items.

### Symptoms
1. Phase Gate items 4 and 5 (capsule save / reload) marked Phase-2-deferred without ADR authority. Plan §1772 lists both as Phase 1 close requirements; close commit silently narrowed the contract.
2. Default convention checker still showed 148 checks — same as before any 1C/1D/1E/1F work landed. Completed deliverables remained inside the `--include-open-workstreams` opt-in branch and never ratcheted into the hard gate.
3. `simworkbench.runtime.checkpoint.checkpoint_dir()` ran `mkdir(parents=True, exist_ok=True)` *before* `write_checkpoint()`'s `is_under_workbench()` guard. Regression tests passed because they only asserted the exception, not the absence of `/tmp/checkpoints/` and `~/elsewhere/checkpoints/` on disk.
4. The example ModelSpec flags its rate constant as a placeholder (`coefficient_sources: ["placeholder: ..."]`), but `RunSummary.placeholder_used` always returned False. The `python_cpu` backend used the same `1.0/s` default for placeholder *and* unsourced rates — silent fabrication risk per `agent_error_patterns.md` "Silently inventing missing physical coefficients".
5. `_RUNS` was module-global in `packages/core/src/simworkbench/api/server.py`. `create_app()`'s docstring claimed isolation but the registry leaked across apps. Reordering `test_start_run_executes_simple_rate_equations` before `test_runs_list_initially_empty` flipped the latter from passing to failing.
6. CLAUDE.md "Phase-Specific Operational Notes" still said "Phase 1 has not started" and "Workstreams 1C-1F are pending". The milestone top header said "Complete" but the per-workstream subsections still showed `☐ Open` checkboxes for 1C/1D/1E/1F.
7. `ruff check` produced 28 violations across `packages/core/src/`, `packages/physics_modules/`, and `tests/`. AGENTS.md "Code Style and Module Boundaries" requires ruff clean; the close commit ran pytest + the convention checker but never ran ruff.

### Root cause
Six separate but related agent failure modes, each now logged in `agent_error_patterns.md` as a named pattern:

- *Unilaterally redefining a Phase Gate item during the close* — issue 1.
- *Closing a workstream without promoting its assertions from opt-in to default* — issue 2.
- *Side-effecting before validating* — issue 3.
- *API factory advertises isolation while sharing module-global state* — issue 5.
- *Status-sync that misses CLAUDE.md and per-workstream subsections* — issue 6.
- *Skipping the linter the repo rules require* — issue 7.

Issue 4 (placeholder coefficient handling) is a recurrence of the existing pattern *Silently inventing missing physical coefficients* combined with insufficient API surfacing; the agent treated "placeholder is OK because it's flagged in the YAML" as sufficient when the runtime needs to (a) refuse unsourced non-placeholder rates and (b) propagate `placeholder_used` through the API to the UI.

### Fix
A series of follow-up commits, each addressing one issue in isolation:
- Commit X (this one): reopen Phase 1 status, log this bugfix, add the six new patterns to `agent_error_patterns.md`.
- Subsequent commits: checkpoint guard order, placeholder surfacing + non-fabrication, API state isolation, ruff cleanup + lint script, capsule save/reload (Phase Gate items 4-5), opt-in→default promotion, status sync.
- Final close commit when all seven issues are green AND the default checker covers every Phase 1 entity.

### Regression protection
Each of the six patterns has a Detection section. Where a regression test is feasible:
- Issue 2: convention checker self-check verifies default-mode count is non-decreasing across workstream closes.
- Issue 3: regression test asserts `Path("/tmp/checkpoints").exists()` is False after a refusal — not just that the exception was raised.
- Issue 5: integration test creates two app instances, registers state in one, asserts the other doesn't see it.
- Issue 7: `scripts/test/all.sh` calls `scripts/test/lint.sh` (new) which runs ruff.

### Agent warning
A "close" commit is the moment to be most paranoid, not least. Six checks the agent must run before a close commit:
1. Every plan §Phase-N gate item ticked (or paired with an Accepted ADR deferring it).
2. Default convention checker count strictly higher than at workstream open.
3. Ruff clean.
4. Status grep across README, AGENTS, CLAUDE, program_development, docs_site, apps yields zero contradictory references.
5. Side-effect-before-validate grep clean (any new `mkdir` / `open(..., "w")` in workbench code preceded by a guard).
6. Module-global mutable state grep clean in API factories.

A close commit that skips any of these is rolled back, the patterns are re-read, and the work is finished.

## 2026-05-02: Per-app and per-package `build/` outputs were not gitignored

### Affected subsystem
`.gitignore` (root-level), discovered while opening Workstream 1F.

### Symptoms
`git check-ignore -v apps/workbench-ui/build/foo.js` reported the path was **not** matched by any ignore rule. Same for `packages/core/build/foo.py`. Once the UI ships and its build tool emits to `apps/workbench-ui/build/` (some tools — Astro/CRA — do), those outputs would be staged by accident.

### Root cause
The earlier `build/` → `/build/` fix anchored the rule to the repository root to stop it swallowing `scripts/build/` — correct, but it left every per-app and per-package `build/` directory unprotected. The `bugs_and_fixes/agent_error_patterns.md` "Bare gitignore globs" pattern explicitly prescribes the full fix:
> Anchor build-output ignores to where they are produced:
> - `/build/` for top-level outputs
> - `apps/*/build/` for per-app outputs
> - `packages/*/build/` for per-package Python build artifacts (if used)

The first bullet was applied earlier; the other two were not. The Workstream 1F open ran the bug-memory grep procedure, which surfaced the pattern, then ran `git check-ignore -v apps/workbench-ui/build/foo.js` and confirmed the gap.

### Fix
Added `apps/*/build/` and `packages/*/build/` to `.gitignore` directly below `/build/`. Reality-test reconfirms: `apps/workbench-ui/build/foo.js` and `packages/core/build/foo.py` are now ignored, while `scripts/build/ui.sh` and `scripts/build/.gitkeep` remain tracked.

Caught and fixed as part of the Workstream 1F open commit.

### Regression protection
- `scripts/dev/check_repo_conventions.sh` extended with a "build/ output ignore tiers" section that probes `apps/workbench-ui/build/`, `packages/core/build/`, and `/build/` and asserts each is matched by an ignore rule. Cross-references the existing source-paths-not-ignored regression which asserts `scripts/build/ui.sh` is NOT ignored. Both regressions live in the default checker so a future overly-narrow change shows up immediately.

### Agent warning
When you anchor a `build/` ignore, do not stop at `/build/`. The pattern requires `/build/` AND `apps/*/build/` AND `packages/*/build/` together — root-anchored alone leaves per-app and per-package outputs exposed. After any `.gitignore` change, run `git check-ignore -v` against probes in every directory tier (`apps/<name>/build/`, `packages/<name>/build/`, `/build/`, `scripts/build/<name>`) before commit.

## 2026-05-02: Open workstream TODOs broke the default test gate

### Affected subsystem
`scripts/dev/check_repo_conventions.sh`, `scripts/test/all.sh`, Phase 1 milestone tracking.

### Symptoms
Opening Phase 1 Workstreams 1C, 1D, and 1E inserted intentionally failing TODO assertions into the default convention checker. As a result, `./scripts/test/all.sh` failed before running pytest even though the implemented 1A/1B unit and integration tests were green. The TODO backlog also under-covered the plan: the 1C progress test was missing, the `run_backend.sh` Phase-0 stub satisfied only the generic executable check, and the 1D module template source/test files were not asserted.

### Root cause
The checker mixed two different concepts: hard repository invariants for completed work and intentionally failing assertions for open implementation backlog. Because `scripts/test/all.sh` calls the default checker, expected TODO failures became normal test failures. The workstream-opening checklist also counted grouped prose instead of every named file/assertion.

### Fix
Split the convention checker into default hard-gate mode and opt-in open-workstream mode. `scripts/dev/check_repo_conventions.sh` now passes for completed repository invariants, while `scripts/dev/check_repo_conventions.sh --include-open-workstreams` exposes the 1C/1D/1E backlog. Added missing opt-in assertions for `tests/unit/test_runtime_progress.py`, the real `scripts/dev/run_backend.sh` implementation, and `packages/physics_modules/templates/module_template/{src/__init__.py,tests/test_template.py}`. Updated README, docs, milestone notes, `AGENTS.md`, and `CLAUDE.md`.

### Regression protection
- `tests/regression/test_convention_checker_modes.py` asserts that default checker mode passes while opt-in mode reports the current corrected Phase 1 backlog.
- `scripts/test/all.sh` continues to call only default checker mode before running pytest.

### Agent warning
Do not put intentionally failing workstream TODO assertions in the default checker path. The default convention checker is the hard gate for completed work; open backlog belongs behind `--include-open-workstreams` and must not break the normal test runner.

## 2026-05-02: Phase 1A/1B gate overstated implementation completeness

### Affected subsystem
`packages/core/src/simworkbench/{model_spec,experiment,serialization,units}/`, `scripts/test/`.

### Symptoms
Phase 1 Workstreams 1A and 1B were documented around ModelSpec and units, but verification found plan-level gaps:

- Workstream 1A had ModelSpec but not `Experiment`, `RunConfig`, `DiagnosticConfig`, `BackendConfig`, or experiment save/load.
- ModelSpec unit enforcement only covered typed `Quantity` fields; raw floats passed through flexible dictionaries such as `fields.initialization` and `interactions.valid_regime`.
- Several plan §8.2 ModelSpec validation rules were missing: missing species, unknown equation references, missing coefficient sources, unsupported backends, unknown validity-regime keys, missing spatial bounds, and missing spatial boundary conditions.
- `scripts/test/*.sh` used ambient `python`, so tests failed outside an activated `.venv` even though the repo-local virtualenv had the required dependencies.
- README status text still described Phase 0 while the phase table showed Phase 1 in progress.

### Root cause
The convention checker and milestone notes verified file presence and the ModelSpec slice, not the complete Workstream 1A deliverable list or behavioral validator coverage. Flexible `dict[str, Any]` fields created a unit-validation escape hatch. Test wrappers assumed the user's shell had already activated the repo virtualenv.

### Fix
Implemented `simworkbench.experiment` with `Experiment`, `RunConfig`, `DiagnosticConfig`, and `BackendConfig`. Added `simworkbench.serialization` experiment YAML save/load helpers. Hardened ModelSpec validators for flexible parameter dictionaries and the missing plan §8.2 checks listed above. Updated test wrappers to prefer `.venv/bin/python`. Synced README, docs, milestone, timeline, convention checker, and regression records.

Commit: `f90a56a` (`Complete Phase 1A core model and harden units validation`).

### Regression protection
- `tests/unit/test_modelspec.py` now covers raw numeric bypasses, missing species, unknown equation refs, missing coefficient sources, unsupported backends, unknown validity-regime keys, and missing spatial bounds/boundary conditions.
- `tests/unit/test_experiment.py` covers core experiment/config models.
- `tests/integration/test_experiment_save_load.py` covers experiment YAML save/load.
- `scripts/dev/check_repo_conventions.sh` now asserts the new implementation/test files and test-wrapper virtualenv behavior.

### Agent warning
Do not treat one slice of a workstream as the full workstream. Translate every named plan deliverable into implementation and tests. Avoid `dict[str, Any]` at scientific boundaries unless it has recursive validation that rejects raw physical numbers.

## 2026-05-02: Phase 0 gate false positive for missing skeleton files

### Affected subsystem
Repository bootstrap / convention checker / development history.

### Symptoms
Phase 0 was marked complete even though several plan-required or README-advertised artifacts were missing:

- milestone files existed only for Phase 0-5 and several filenames did not match plan phase numbers;
- `apps/workbench-ui/package.json`, `apps/workbench-ui/tsconfig.json`, `packages/core/pyproject.toml`, and `packages/core/src/simworkbench/__init__.py` were absent despite the plan's initial tree;
- README-documented wrapper scripts such as `scripts/docs/dev.sh`, `scripts/docs/build.sh`, and `scripts/test/all.sh` did not exist;
- `README.md` still marked Phase 0 as in progress while the milestone/timeline marked it complete.

### Root cause
The Phase 0 convention checker verified broad directories and a small milestone subset, but did not verify the full plan-matching skeleton, executable documented scripts, or Phase 0-10 milestone coverage. Documentation and milestone status drifted after the gate was marked as passed.

### Fix
Added the missing Phase 0 package skeleton files, documented command wrappers, and plan-matching milestone files for Phase 0 through Phase 10. Removed stale Phase 2-5 milestone filenames. Extended `scripts/dev/check_repo_conventions.sh` to verify the missing package files, executable scripts, and all Phase 0-10 milestone files. Updated README, docs-site pages, development timeline, and bug-memory records to reflect the corrected gate.

Commit: `11e04f1` (`Fix Phase 0 bootstrap gate coverage`).

### Regression protection
- `scripts/dev/check_repo_conventions.sh` now checks all corrected artifacts and passes with 116 checks.
- `bugs_and_fixes/regression_tests.md` cross-lists this convention checker guard.

### Agent warning
Do not mark a phase gate complete from directory-level checks alone. Check the exact deliverables named by the plan, README command paths, and development-history naming rules.

## 2026-05-02: Bare `build/` ignore rule swallowed `scripts/build/`

### Affected subsystem
`.gitignore` (root-level)

### Symptoms
Files placed under `scripts/build/` (intended location of build scripts per the planned §19 commands like `scripts/build/ui.sh`) were silently ignored by git. `git check-ignore` traced the match to `.gitignore:18:build/`. The convention checker still passed because it only verified directory existence, not that the directory's *contents* were trackable.

### Root cause
The plan §3.2 specifies a bare `build/` ignore rule, intended for top-level Node/Vite build output. As written, `build/` matches every directory named `build` anywhere in the tree — including `scripts/build/`, which we explicitly use for build scripts.

Once a directory is ignored, gitignore's negation rules cannot re-include files inside it: "It is not possible to re-include a file if a parent directory of that file is excluded." So a simple `!scripts/build/` does not solve it.

### Fix
Replaced `build/` with `/build/` in `.gitignore`, anchoring the rule to the repository root. Added an inline comment explaining why and warning future agents not to reintroduce a bare `build/`. Top-level Node/Vite/Python build artifacts still get ignored; `scripts/build/`, `packages/<x>/build/`, and any other nested `build/` directory remain trackable.

Commit: `db040b6` (`Bootstrap Phase 0: governance, docs, bug memory, and autonomous git`).

### Regression protection
- Added `scripts/build/.gitkeep` so the directory is staged.
- Documented the trap in `agent_error_patterns.md` (entry: "Bare gitignore globs that conflict with project directories").
- Extended `scripts/dev/check_repo_conventions.sh` to verify representative source paths under `scripts/build/`, `scripts/dev/`, `scripts/test/`, `scripts/docs/`, `packages/physics_modules/`, `apps/workbench-ui/`, and `docs_site/` are not gitignored.

### Agent warning
Do not generalize a `build/` ignore rule across the whole tree. Project directories whose name happens to be `build` exist deliberately. Anchor build-output ignores to the place they are produced, or use specific patterns like `apps/*/build/`.

## 2026-05-07: Layer-3 Group C audit findings (9 issues)

### Affected subsystem
`packages/secure_core/src/{audit,sandbox,workers,outbound}/`

### Symptoms
Post-Group-C review surfaced 9 real issues: 2 critical, 6 high, 1 medium.

1. **Critical** — `scripts/test/security.sh` was a stub; v4 §29 sandbox tests #38–43 / #67 (network-egress probes, syscall block, quota trips) had no implementation. ADR-0009 requires real gVisor probes; the spec-level invariants we ship don't substitute for them, but no spec-level coverage existed either.
2. **Critical** — `SandboxRunner.runJob` transitioned the run to `running` BEFORE calling `runtime.launch`. A spec-rejection or container-spawn failure left the run stuck in `running` with no live container — the state machine had no way back without operator intervention.
3. **High** — `validateLaunchSpec` only checked mount **target** paths; it permitted any absolute mount **source**. A miswired runner could bind-mount `/etc` (or `/`!) read-only into the sandbox.
4. **High** — `uploadRoute` passed `claims.run_id` as `storage_reservations.requested_by`. The schema FK targets `users.id`, so every successful worker upload would fail at the DB INSERT.
5. **High** — Worker upload + sandbox-violation audits emitted `actorType: "worker"` with `actorUserId: null`, but the L1.7 logger refused null user_id for any actor type other than `unauthenticated`. Every worker-originated audit row would throw.
6. **High** — `uploadRoute` reserved bytes against `declared_size` but used `maxUploadBytes` as the streaming cap. A worker could declare 1 KiB and stream up to 200 MiB — bypass of the stored-byte quota once the FK was fixed.
7. **High** — `artifact_kind === "archive"` uploads wrote bytes directly + committed the reservation without ever calling `extractArchive`. ADR-0012 step 6 requires archive validation through the §9.4.11–13 zip/symlink defense before commit.
8. **High** — `AuditDbWriter.prevHashGetter` and `AuditChainVerifier.fetchFrom` ordered chain rows by `created_at`, but `operator_events` has no `created_at` column (uses `started_at` per v4 §12). Operator chain SQL would fail.
9. **Medium** — `SafeFetcher` resolved the host once for the SSRF check, then handed the URL to the native `fetch` which re-resolves. A name-server flapping between public and private answers could return a public IP at validate-time and a private IP at connect-time (DNS rebinding).

### Root cause
Cross-cutting: the L3 sub-agents implemented their slices in isolation and didn't catch contract drift across boundaries. The L1.7 logger constraint, the `users.id` FK on `storage_reservations`, the `operator_events` column shape, and the ADR-0012 archive-validation step are all upstream-of-L3 contracts the workers and sandbox sub-agents needed to honor — they were either never read or partially read.

### Fix
1. **§29 spec-level invariants shipped.** `packages/secure_core/test/security/sandbox.test.ts` covers v4 §29 #38, #39, #40, #41, #42, #43, #67 at the runtime-spec layer (no `--privileged`, network=none default-deny, UDS proxy gating, mount allowlist, env strip). Live-runtime probes (six tests) are env-gated on `PLASMAWORK_RUNSC_PROBES=1` for the gVisor CI lane. `scripts/test/security.sh` now actually runs `vitest run test/security` instead of exiting 0 with a stub message.
2. **Runner ordering.** `runJob` now `runtime.launch`s first; on launch failure transitions `queued → failed` and emits `sandbox.violation { denied_reason: "spec_refused" }`. Only after a successful launch does it transition to `running`.
3. **Mount source allowlist.** `validateLaunchSpec` accepts `SpecValidationOptions { allowedSourceRoots }` and refuses sources outside the allowlist with new reasons `mount_source_not_absolute`, `mount_source_traversal`, `mount_source_not_allowed`. `RunscSandboxRuntime` and `StubSandboxRuntime` accept `allowedSourceRoots` and pass it to every `validateLaunchSpec` call.
4. **`requested_by_user_id` on `WorkerClaims`.** L3.8 token issuer now requires `run.requestedByUserId` at issuance and pins it in the claims. `uploadRoute` uses `claims.requested_by_user_id` for the storage reservation's `requested_by` and for every worker-originated audit's `actor_user_id` — the FK target is real, accountability is preserved.
5. **L1.7 logger relaxation.** Constraint changed from a strict bidirectional `actor_user_id === null ⇔ actor_type === 'unauthenticated'` to: `unauthenticated` MUST be null; `human`/`ai_agent`/`operator` MUST be non-null; `worker` MAY be null (system-issued worker events) or non-null (run-bound worker events). Schema's nullable column already permits this; the logger no longer adds a stricter constraint.
6. **Streaming cap = declared.** `ByteLimitTransform` is constructed with `Number(declared)`, not `maxUploadBytes`. Declared size > maxUploadBytes refuses up front with `oversize`. A worker that under-declares hits the byte cap on the wire.
7. **Archive validation routed through L2.11.** When `kind === "archive"`, after the streaming write completes, `extractArchive` validates the file (zip or tar inferred from artifact_name suffix). On any rejection: archive deleted, reservation released, `worker.upload_denied { archive_unsafe }` emitted.
8. **Operator column fix.** `AuditDbWriter.prevHashGetter` selects `started_at` for `operator`, `created_at` for the others. `AuditChainVerifier.fetchFrom` does the same in its boundary SELECT. The downstream `fetchAllOperator` already used `started_at` — the bug was strictly in the `created_at`-assuming code paths.
9. **DNS-rebinding TOCTOU closed.** `SafeFetcher.fetch` builds a one-off `undici.Agent` per request whose `connect.lookup` returns the IP the SsrfGuard validated. The fetcher passes the agent as the `dispatcher` extension to `fetch`. Native re-resolution of the host name is bypassed; SNI / Host header preserved.

### Regression protection
- 7 §29 spec-level invariants land in `test/security/sandbox.test.ts`; the CI gate (`scripts/test/security.sh`) refuses to pass without them.
- Convention checker grew 1051 → 1054 with assertions that the security suite exists and is wired (`vitest run test/security`).
- 3 new sandbox-runtime tests pin the mount allowlist (`mount_source_not_allowed`, `mount_source_traversal`, hermetic-only empty-allowlist).
- The L1.7 logger constraint test was already covered by the L3.5 storage-reservation sweep emission; the new shape (worker + null) now passes that gate.

### Agent warning
- L3 sub-agents must read the L1.7 audit-actor constraint AND the L1.8 schema FK targets before emitting audits or inserting rows that reference users.
- `validateLaunchSpec` callers MUST pass `allowedSourceRoots` (production) or accept hermetic-only enforcement (empty allowlist).
- Never transition a run to a "live" state before the live thing is actually live. Order of state changes matters when failures land between them.
- Streaming-write byte caps must be derived from the smaller of declared and configured-max; never use the bigger value as the cap.

## 2026-05-07: Layer-3 Group C round-2 audit (4 findings)

### Affected subsystem
`packages/secure_core/{src/workers,test/security,test/sandbox,test/workers}`, `scripts/test/security.sh`, `CLAUDE.md`, `scripts/test/secure_core.sh`

### Symptoms
A second-pass audit caught residue from round-1: live runsc probes still surfaced "not implemented" failures when env-gated; archive uploads leaked extracted files + bypassed quota for the extracted bytes; the most-sensitive code paths lacked direct regression tests; some docs still called the security script a stub.

1. **High** — `PLASMAWORK_RUNSC_PROBES=1 scripts/test/security.sh` failed on 6 `expect.fail("not implemented (Layer 5)")` lines in `test/security/sandbox.test.ts`. The env-gate was meant to enable real probes; instead it surfaced placeholders that always failed.
2. **High** — `uploadRoute` extracted archives to `${destinationPath}.extracted` but the rejection path only unlinked the archive, leaving the `.extracted` tree on disk; on success the reservation was committed for the archive's declared bytes only, while the extracted bytes (real disk usage) were never accounted for. A worker shipping a small zip-bomb that expands past quota would write past the reservation invisibly.
3. **Medium** — No direct regression tests for: `SandboxRunner` launch-before-running ordering (audit fix #2), `workerUploadRoute` requested-by FK target (#4), declared-size streaming cap (#6), archive rejection cleanup (#7), worker audit actor identity (#5).
4. **Minor** — `CLAUDE.md:120` and `scripts/test/secure_core.sh:9` still described `scripts/test/security.sh` as a stub, contradicting the round-1 fix that wired it to a real test runner.

### Root cause
Round-1 prioritized landing fixes; this round addresses the gaps the fixes themselves opened. The `expect.fail` placeholders existed because real gVisor probes need a Linux + runsc CI lane that doesn't exist yet — but `expect.fail` makes the env-gate worse than useless. The archive-extraction fix routed validation through `extractArchive` but didn't update the quota model to account for the additional disk footprint. Regression coverage of the round-1 fixes was implicit (caller code exercises the fixed paths) but not direct.

### Fix
1. **Live probes detect runsc presence.** `detectRunscAvailable()` checks `PLASMAWORK_RUNSC_PROBES=1` AND a successful `spawnSync('runsc', ['--version'])`. Both true → probes enabled; either false → `it.skipIf` skips them. Probe bodies are now `it.todo` markers (no `expect.fail`); a future PR ships gVisor in CI and replaces each todo with a real probe one at a time. `scripts/test/security.sh` no longer fails on dev hosts even with `PLASMAWORK_RUNSC_PROBES=1` set.
2. **Archive quota + cleanup.** On rejection: `rm -rf` the `.extracted` directory in addition to unlinking the archive. On success: after `extractArchive` returns `{filesWritten, bytesWritten}`, `reserveBytes(extractedBytes)` is called against the workspace quota — extracted disk usage is charged on top of the archive's original reservation. If the second reservation fails (quota exhausted by extraction), the archive + `.extracted` tree are removed and the original reservation is released; `worker.upload_denied { quota_exceeded }` emitted.
3. **Direct regression tests.** New `test/sandbox/runner.test.ts` (3 cases) pins launch-before-running ordering: spec-rejection path transitions `queued → failed` only (never running), spawn-failure path same, happy path order is `running → completed`. New `test/workers/uploadRoute.test.ts` (7 cases) pins FK target = `claims.requested_by_user_id` (not `run_id`); audit `actorUserId` matches; underdeclared bytes rejected mid-stream as `oversize`; `declared_size > maxUploadBytes` rejected up front (no reservation attempted); zip-slip archive rejected with `archive_unsafe`, archive + `.extracted` dir unlinked, reservation released; clean zip success extracts and charges extracted bytes via a second `reserveBytes` call.
4. **Stale docs corrected.** `CLAUDE.md` security-checks block updated to describe what `security.sh` actually does (runs §29 spec-level invariants + env-gated live-runtime probes). `scripts/test/secure_core.sh` header comment updated to match.

### Regression protection
- 11 new tests across `test/sandbox/runner.test.ts` + `test/workers/uploadRoute.test.ts` — each maps to a numbered audit fix.
- Convention checker grew 1054 → 1062 with assertions for: `detectRunscAvailable` presence in security.test, the new test files exist, and they grep-pin the §-fix concepts (`requested_by_user_id`, `declared_size`, `archive_unsafe`, `extracted`).
- `PLASMAWORK_RUNSC_PROBES=1 scripts/test/security.sh` now exits 0 on dev hosts (no spurious failures); when a real runsc lands in CI, the `it.todo` reports surface what's missing without breaking the build.

### Agent warning
- `expect.fail("not implemented")` is worse than `it.todo`. Either implement the test or mark it as a todo — never plant a guaranteed-fail in an env-gated path.
- When an upload writes A and then derives B from A, the quota reservation must cover both. Charging only A and leaving B uncharged is a quota bypass disguised as an accounting question.
- Cleanup paths must remove EVERY artifact the failed code path created. `unlink(archive)` without `rm -rf(.extracted)` leaks. The cleanup should mirror the creation set.
- Round-1 fixes need round-2 verification: each substantive fix should land with at least one direct regression test before the audit cycle closes.
