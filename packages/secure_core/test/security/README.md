# `test/security/` — v4 §29 regression suite

This directory carries the v4 §29 "84 security tests" — the
regression set that pins every Phase 0.5 invariant. Tests are
organized by §29 number where helpful and by subsystem where the
§29 numbers cluster.

## Two layers of evidence

The tests split into two categories. Both must be green before
Phase 0.5 ships.

### 1. Spec-level invariants (always-on)

Tests that prove the structural contract — e.g. "the runtime cannot
emit `--privileged`", "the audit logger refuses non-allowlisted
metadata keys", "the workspace path builder refuses `..`". They
run on any dev host and are part of the default `npm test` lane.

### 2. Live runtime probes (env-gated)

Tests that require a real OS-level enforcer:
- `runsc` (gVisor) for sandbox network / syscall / quota probes
- A live PostgreSQL with the four secure_core_* roles for DB
  privilege probes
- An S3 / MinIO bucket with Object Lock COMPLIANCE for the WORM
  anchor invariants

Each is gated on a deployment-side env var:
- `PLASMAWORK_RUNSC_PROBES=1` for sandbox live probes
- `PLASMAWORK_TEST_DB_URL=...` for DB privilege probes
- `PLASMAWORK_ANCHOR_S3_*` for anchor probes

CI runs these on a dedicated lane that ships the relevant
runtimes; dev hosts skip them with a clear `it.skipIf` reason.

## What this directory does NOT prove

Until the live-runtime probes are wired and green:
- Spec-level tests prove the runtime would produce a safe spec, NOT
  that gVisor enforces the spec.
- The §29 #38–#43 sandbox-network-egress + #67 quota-trip tests
  are `it.todo` markers behind the runsc availability gate so the
  CI lane can surface missing live probes without making dev hosts
  fail on placeholders.

The spec-level coverage of those §29 numbers DOES catch the regress
case where someone adds an unsafe argv flag or mount path — that's
real defense-in-depth for the runtime ASSEMBLY. The live probes
catch the regress case where gVisor itself fails to enforce.
