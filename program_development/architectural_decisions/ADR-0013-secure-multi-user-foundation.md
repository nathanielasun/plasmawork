# ADR-0013: Secure Multi-User Foundation

## Status
Accepted

## Date
2026-05-07

## Context

The secure-core Layer 5 workstream needs a single architectural record
that ties the secure multi-user foundation together for documentation,
review, and future implementation gates. Earlier Layer-0 ADRs made
individual decisions:

- ADR-0008 chose the secure-core package boundary, TypeScript stack,
  Fastify, Drizzle, and Postgres.
- ADR-0009 chose the sandbox runtime posture and execution isolation
  requirements.
- ADR-0010 chose the external WORM anchor provider shape for
  tamper-evident logs.
- ADR-0011 chose the secrets-management boundary and redaction posture.
- ADR-0012 chose server-mediated worker artifact uploads.

Those decisions are necessary but not sufficient as a user-facing
foundation. The system also needs durable documentation for the threat
model, workspace isolation, capability list, approval flow, sandbox,
audit chain, operator access, and security testing posture. This ADR
records the shared foundation without exposing exploit-ready probe
commands, production endpoint names, provider internals, or deployment
secret identifiers.

## Decision

Adopt secure-core as the canonical multi-user security foundation for
the Scientific Simulation Workbench. The foundation consists of
server-derived identity, workspace-scoped authorization, capability
checks, high-risk human approvals, sandboxed execution, server-derived
storage paths, tamper-evident audit/provenance/operator chains, and
required security regression coverage.

The following documentation pages are the public docs surface for this
foundation:

- `docs_site/src/content/authentication.tsx`
- `docs_site/src/content/workspaces.tsx`
- `docs_site/src/content/roles_permissions.tsx`
- `docs_site/src/content/security_approvals.tsx`
- `docs_site/src/content/audit_provenance.tsx`
- `docs_site/src/content/capsule_versioning.tsx`
- `docs_site/src/content/secure_storage.tsx`
- `docs_site/src/content/security_testing.tsx`
- `docs_site/src/content/sandboxing.tsx`
- `docs_site/src/content/operator_access.tsx`
- `docs_site/src/content/agent_threat_model.tsx`

The docs site registry (`docs_site/src/pages/docsPages.ts`) must expose
each page so the workbench documentation UI can reach it.

## Foundation Rules

1. **Identity is server-derived.** Request bodies cannot provide actor,
   owner, role, approval, workspace, lifecycle, storage, timestamp, or
   hash facts. Protected handlers derive those values from authenticated
   session context and database records.

2. **Workspaces are the tenant boundary.** Capsules, runs, artifacts,
   tools, approvals, audit reads, and worker outputs are resolved
   through workspace-scoped references. Storage paths are built by the
   server.

3. **Capabilities are explicit.** Roles are collections of capabilities.
   Capability checks happen at the API boundary and again inside
   services that commit privilege-bearing mutations.

4. **High-risk actions require durable human approval.** Approval
   request creation, approval decision, token issuance, and token
   consumption are separate steps. Tokens are context-bound,
   single-use, time-limited, and consumed before side effects.

5. **Execution remains sandboxed.** Generated code, imported tools,
   workers, and trusted tools run inside the sandbox. Trust can expand
   reviewed permissions within policy, but cannot bypass isolation.

6. **Auditability is tamper-evident.** Audit, provenance, and operator
   event streams are hash-chained, externally anchored, redacted, and
   protected from application-role update or deletion.

7. **Operator access is constrained.** Platform capabilities are
   separate from workspace roles, reason-bound, time-limited, and
   recorded in both audit and operator streams.

8. **Security tests are merge gates.** Authentication, authorization,
   workspace isolation, approval, sandbox, worker, quota, audit-chain,
   operator, and CI-secret tests are required once the corresponding
   secure-core implementation is active.

## Alternatives considered

- **Document only the individual Layer-0 ADRs.** Rejected. The
  individual ADRs explain technology choices, but they do not give
  users or reviewers one coherent foundation for how the pieces enforce
  multi-user security.

- **Put all security docs on one large page.** Rejected. Authentication,
  workspace isolation, permissions, approvals, audit, storage, sandbox,
  operator access, and testing have different audiences and update
  cadences. Separate pages make drift easier to spot.

- **Expose operational probe details in the public docs.** Rejected.
  Security documentation should explain guarantees and review criteria,
  not provide exploit-ready commands, production endpoint inventories,
  provider internals, or deployment secret names.

## Consequences

- **Positive:** Reviewers get a stable map from plan requirements to
  docs pages, and future implementation work has a single ADR to cite
  for the cross-cutting security foundation.

- **Positive:** The docs site can present secure-core concepts before
  UI integration lands, reducing the chance that capability or approval
  behavior is treated as an implementation detail.

- **Negative:** Documentation must stay synchronized with every future
  change to secure-core behavior, capability names, approval policy,
  sandbox guarantees, or audit semantics.

- **Neutral:** This ADR records the secure-core foundation and Layer-5
  integration surface. It does not replace deployment runbooks or
  environment-specific live probe lanes.

## Implementation notes

Layer 5 implementation work must keep these pages and this ADR aligned
with the active secure-core behavior. `scripts/test/security.sh`,
`scripts/test/all.sh`, `.github/workflows/security.yml`, and
`packages/secure_core/test/security/section29_coverage.test.ts` are the
Layer-5 hard-gate surface. UI integration remains a later layer and
should treat these docs as the canonical conceptual model for navigation,
approval inbox behavior, audit views, and operator-facing panels.
