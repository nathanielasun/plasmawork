# ADR-0014: Workbench Authentication Gateway

## Status
Accepted

## Date
2026-05-09

## Context

Phase 0.5 secure-core (ADR-0008 through ADR-0013) shipped a complete
TypeScript identity / session / CSRF / audit / approval / capability stack
as a *library*: route plugins, services, and middleware are exported from
`packages/secure_core/`, but no host composes them. Meanwhile the Python
FastAPI workbench at `packages/core/src/simworkbench/api/server.py`
exposes ~61 endpoints under `/api` with **zero** auth, single-tenant
filesystem state, and no per-user / per-workspace isolation. The
substrate is correct; nobody can use it.

The user wants a multi-tenant deployment posture:

- **Shared internal tools** — validated/trusted tools every user can call.
- **Shared public experiments** — capsules any user can read, fork, run.
- **Private sandboxed experiments per user** — a workspace only the
  owner sees.
- **A root admin account** bootstrapped via `.env.auth`, used for ongoing
  development and management of all non-root accounts.
- **A canonical authentication `.env` file** so any future security-side
  modification is gated on its presence.

Cross-cutting constraint from ADR-0008: secure-core is TypeScript-first.
Its middleware contract (v4 §6.2), its allowlist input schemas (§4.1),
and its approval token API (§16) are written as TypeScript router code
and Drizzle schemas. Porting that contract into FastAPI would tax every
review with a continuous TS↔Python translation. Reusing it requires a
TypeScript host process.

## Decision

Adopt a **Fastify auth gateway** in front of the existing FastAPI
workbench.

- The new gateway lives at `apps/workbench-gateway/` and composes
  secure-core's exported route plugins (login, auth, bootstrap,
  workspaces, capsules, runs, tools, operator, security-dashboard).
- The FastAPI workbench moves to a loopback-only port and trusts
  HMAC-signed `X-Workbench-*` headers from the gateway.
- The gateway is the public entry; the FastAPI process is unreachable
  from the network.

### Decisions baked into the gateway

- **Three seeded workspaces** (created by the bootstrap adapter, not by
  ad-hoc admin action):
  - `_platform` — synthetic capability anchor; only the seeded admin is
    a member; gives the admin platform-level capabilities without
    polluting any user-visible workspace.
  - `shared-internal-tools` — admin is `WorkspaceAdmin`; ordinary users
    join with read access for system tooling.
  - `shared-public-experiments` — admin is `WorkspaceAdmin`; ordinary
    users join with read access for public capsules.
  - `private-{8-char-hex}` — per-user, lazily created on first login.
- **Filesystem isolation by workspace slug** — capsules live under
  `simulation_capsules/{slug}/`, runs under `temp_runs/{slug}/`, imports
  under `temp_imports/{slug}/`. Path resolution uses the
  `simulation_capsules_root_for(slug)` helper family in
  `packages/core/src/simworkbench/paths/`.
- **Three-defense gateway-FastAPI handoff**:
  1. **HMAC-signed `X-Workbench-*` headers** — always on. Seven headers
     (`User-Id`, `Workspace-Id`, `Workspace-Slug`, `Roles`, `Request-Id`,
     `Issued-At`, `Signature`) are HMAC-SHA256-signed with
     `WORKBENCH_GATEWAY_HANDOFF_SECRET` and constant-time-compared on
     the FastAPI side.
  2. **Loopback bind** — `scripts/dev/run_backend.py` pins
     `DEFAULT_HOST = "127.0.0.1"` and the convention checker keeps that
     literal in place. A different host on the network cannot reach
     FastAPI; another process on the same host could, but the HMAC
     refuses unsigned traffic.
  3. **URL slug cross-check** — opt-in via the
     `slug_prefixed_paths` constructor argument on
     `WorkbenchHandoffMiddleware`. Defaults to empty: today's gateway
     strips the slug from the URL via `preRewrite` before proxying, so
     there is no slug to cross-check yet. The flag turns the third
     defense on once FastAPI adopts `/api/{slug}/{rest}` routes.
- **Username-primary identity** — `users.username` is the login
  identifier; `email` is optional metadata used only for recovery
  notifications. Recovery flows accept username; if the user has no
  email of record (every seeded admin), the request 202s but no email
  is sent, with the same anti-enumeration shape.
- **`user_credentials` sidecar table** — keyed 1:1 by `user_id`, holds
  the Argon2id hash, algorithm, hash-update timestamp, failed-attempt
  counter, and lockout. Keeps `users` an identity-only table.
- **`.env.auth` at the repo root** is the canonical config. Committed:
  `.env.auth.example`. Gitignored: `.env.auth` (and any per-package
  copy). The gateway loader fails closed at startup if any required
  variable is missing or shorter than its security floor.
- **Bootstrap is one-shot, sealed by a WORM marker** — the
  `BOOTSTRAP_ALLOWED=1` flag combined with a configured
  `WORKBENCH_BOOTSTRAP_WORM_PROVIDER` (s3 in production, fake only for
  single-node dev) gates the route's registration. After a successful
  bootstrap the WORM marker is written and the route disappears even on
  process restart. Re-bootstrap is intentionally hard; lost-admin
  recovery is a manual operator runbook, not an env-flag override.

## Alternatives considered

- **Port secure-core to Python / FastAPI dependencies.** Considered.
  Rejected. Re-expressing v4 §6.2 middleware ordering as a FastAPI DI
  graph means every reviewer mentally re-translates the contract per
  endpoint, which is the exact pattern §6.2 forbids. ADR-0008 already
  captured this trade-off.
- **Retrofit auth into the existing FastAPI server (Shape B).**
  Considered. Rejected. Every existing handler would grow auth,
  workspace scoping, capability checks, approval gates, and audit
  emission in lockstep with a security rebuild — the
  partially-applied-invariant failure mode the implementation plan
  explicitly warns against.
- **Run secure-core standalone and have the UI call it directly,
  delete FastAPI.** Considered. Rejected. The Python workbench owns the
  scientific runtime (capsules, ModelSpec, runner, sweep engine,
  validation). Porting that to TypeScript is months of work; the
  gateway gets us a multi-tenant deployment posture in one PR.
- **Trust same-host process boundaries instead of HMAC.** Considered.
  Rejected. Loopback bind alone defends against the network but not
  against a colocated process. The HMAC + loopback combination is the
  cheapest layered defense; either alone is insufficient.
- **Build a code-level break-glass for lost-admin recovery.**
  Considered. Rejected. A break-glass env var would be the most-stolen
  string in the deployment and would make the WORM seal a lie.
  Lost-admin recovery is a deliberate operator runbook (delete the WORM
  marker, manually disable the lost admin row, re-run bootstrap).

## Consequences

**Positive**

- The Phase 0.5 secure-core library finally has a host. Login, session,
  CSRF, audit, approval, and capability checks now run against real
  HTTP traffic.
- The FastAPI workbench keeps its scientific responsibilities; the
  gateway owns auth, workspace authorization, and the audit boundary.
- Two-process architecture lets the gateway be deployed behind a
  hardened reverse proxy without touching the scientific runtime.
- `.env.auth` is one canonical config; the loader's fail-closed posture
  catches every misconfiguration at startup.

**Negative**

- Two processes to start, two ports, two log streams. Local development
  needs both `scripts/dev/run_backend.sh` (FastAPI) and the gateway
  start script.
- HMAC is shared-secret. Rotating
  `WORKBENCH_GATEWAY_HANDOFF_SECRET` requires restarting both
  processes; either side ahead of the other rejects all in-flight
  requests for the duration.
- Re-bootstrap is intentionally hard. A lost admin is an operator
  outage, not a self-service recovery.

**Neutral**

- Capsule paths gain a workspace prefix. Existing
  `simulation_capsules/{name}/` directories become
  `simulation_capsules/shared-public-experiments/{name}/` by default.
- The bare `simulation_capsules_root()` family in `simworkbench.paths`
  is now reserved for tooling and tests; route handlers must use the
  workspace-scoped `_for(slug)` helpers.

## Implementation notes

- **Bootstrap walkthrough** lives in
  `docs_site/src/content/authentication.tsx` and the
  `README.md` "Authentication" section. Lost-admin recovery is in
  `LIMITATIONS.md`.
- **Migration `0004_username_and_user_credentials.sql`** ships the
  schema rework: `users.username` (case-insensitive unique index),
  optional `users.email`, and the new `user_credentials` table.
- **Trust-proxy posture** for `req.ip` resolution in the gateway is
  `WORKBENCH_GATEWAY_TRUST_PROXY` — empty/unset by default so a direct
  client cannot rotate `X-Forwarded-For` to bypass per-IP rate limits.
- **WORM provider** is configured via
  `WORKBENCH_BOOTSTRAP_WORM_PROVIDER` (`s3` for production, `fake` for
  single-node dev). The compose layer refuses to start with the
  in-memory fake when `BOOTSTRAP_ALLOWED=1`, so a deployment that
  forgets the provider fails loudly instead of silently allowing a
  DB-restore-induced re-bootstrap.
- **Convention-checker assertions** added alongside this ADR's
  `Accepted` flip cover the gateway directory, `.env.auth.example`,
  the FastAPI auth middleware presence, the `users.username` schema
  reference, and the `user_credentials` migration.
- **Open follow-ups** (tracked in `--include-open-workstreams`):
  WebAuthn / TOTP enrollment for the platform admin (Phase 0.5
  deferred). HMAC-signed pagination cursors on audit-events + operator
  routes closed 2026-05-09 (commit `b0222cb`). Workspace-scoped
  imported-tool registries are the next slice in flight.

## Slug cross-check posture (resolved 2026-05-10)

This ADR's original Decision section listed three production
defenses for the gateway → FastAPI handoff: HMAC over the 7
forwarded headers, loopback-only FastAPI bind, and a URL-path slug
cross-check (the `slug_prefixed_paths` opt-in in
`packages/core/src/simworkbench/api/auth_middleware.py`). The
post-shipment audit + the Phase 0.5 close review surfaced an
ambiguity: the gateway's `preRewrite` callback in
`apps/workbench-gateway/src/proxy/workbenchProxy.ts` strips the
URL slug before forwarding to FastAPI (so today's flat
`/api/{rest}` FastAPI routes still match). The strip means
**there is no slug at the FastAPI side to cross-check**;
`slug_prefixed_paths=()` (the empty default) makes the cross-check
a runtime no-op.

The resolved posture, dated 2026-05-10:

- **Production defenses are HMAC + loopback bind.** Both are
  active by default. HMAC verification rejects any
  same-host process that lacks the shared secret; the loopback
  bind keeps off-host access at the network layer. These two
  defenses are sufficient for the threat model the ADR's
  original Decision section describes.
- **The slug cross-check is opt-in / no-op until URLs change.**
  It exists in the code as a tested, deployable feature, but it
  fires only when (a) the gateway stops stripping the slug in
  `preRewrite`, AND (b) the FastAPI configuration sets
  `slug_prefixed_paths=("/api",)`. Both flips happen together;
  one without the other is a regression.
- **The trade-off was an explicit choice.** Activating the
  cross-check requires refactoring ~30 FastAPI route URLs from
  `/api/foo` to `/api/{slug}/foo` (and updating every existing
  test that asserts on those URLs). The cost is ~600 lines + a
  multi-commit migration; the threat-model gain over HMAC alone
  is "even if a same-host attacker learns the HMAC secret, they
  still need to forge a URL slug that matches the asserted
  workspace_slug". That gain is meaningful but speculative;
  HMAC + loopback are sufficient for the deployments this ADR
  was originally written for.
- **Revisit triggers.** Pick up the URL refactor when (a) a
  new same-host attack surface lands (e.g. unprivileged Linux
  containers sharing a kernel namespace with the gateway), or
  (b) the FastAPI URLs grow workspace-aware semantics that
  benefit from the slug being part of the route shape.

The decision is reversible. The opt-in surface
(`slug_prefixed_paths=()` default) is preserved exactly so that
flipping it back on requires a deliberate config change rather
than a re-architecture.

## References

- `secure_multi_user_scaffolding_plan_v4.md` §4.1, §6.1/§6.2, §11, §16,
  §22.1, §29.
- ADR-0008 — secure-core language and layout.
- ADR-0010 — WORM anchor provider (the gateway's bootstrap WORM is the
  same primitive in `bootstrap/marker.json` form).
- ADR-0013 — secure multi-user foundation (this ADR is the host that
  composes the foundation).
- `program_development/phase_05_security_implementation_plan.md` §1, §7.
- `apps/workbench-gateway/src/env.ts` — env loader, source of truth for
  required variables.
- `packages/core/src/simworkbench/api/auth_middleware.py` — FastAPI side
  of the HMAC handoff.
- `apps/workbench-gateway/src/proxy/handoffSigner.ts` — gateway side of
  the HMAC handoff.
- `apps/workbench-gateway/src/bootstrap/dbAdapter.ts` — seeded workspace
  names (`_platform`, `shared-internal-tools`,
  `shared-public-experiments`).
