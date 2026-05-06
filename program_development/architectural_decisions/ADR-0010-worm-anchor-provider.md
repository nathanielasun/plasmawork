# ADR-0010: WORM Anchor Provider for Log Chain and Bootstrap Marker

## Status
Accepted

## Date
2026-05-05

## Context

The Phase 5 security implementation plan (`program_development/phase_05_security_implementation_plan.md`, Gate G1.L0.3) requires a write-once-read-many (WORM) target that the application database credential cannot modify. Two related needs share this target:

1. **Log-chain anchors (§19.3 of `secure_multi_user_scaffolding_plan_v4.md`).** The audit (`audit_events`), provenance (`provenance_events`), and operator (`operator_events`) tables are hash-chained: each row carries `prev_hash`, `row_hash`, and a `canonicalization_version`. §19.3 requires that "the tip of each chain must be periodically committed to external WORM storage, transparency log, or monitoring system that the same database credential cannot modify," at a cadence of "every minute or every N rows, whichever occurs first." Chain verification compares local rows against the external anchor; "tail truncation after a committed anchor must fail verification" (test #49). The local anchor row mismatch against the external WORM also must fail verification (test #50). The application IAM role explicitly cannot mutate `log_chain_anchors` (test #56).

2. **Bootstrap marker (§22.1).** Initial platform-admin bootstrap requires that a WORM marker be absent before bootstrap, and present after. The plan is explicit: "A regular local sentinel file does not qualify as WORM storage," and "a database restore alone must not re-enable bootstrap" (test #62). Acceptable markers: S3 Object Lock with retention, GCS Bucket Lock, immutable cloud KMS key/version marker, equivalent write-once medium.

Both needs share the same fundamental property under test: resistance to deletion / overwrite / silent rewind by anyone holding the application's runtime credentials, including a malicious operator with a stolen DB password and shell access to the application host.

The Phase 5 reviewer flagged (L3.2) that the chosen provider's *dev mock* is the most common failure point: a local-file simulator misses the property under test entirely. The dev mock must implement Object Lock semantics, not merely the Object Lock API surface.

The plan's negative regression suite (`secure_multi_user_scaffolding_plan_v4.md` §29) pins five specific tests that this ADR's provider choice must satisfy:

- Test #48 — audit/provenance/operator hash-chain detects row mutation.
- Test #49 — hash-chain detects tail truncation after an external anchor.
- Test #50 — local anchor mismatch against the external WORM fails verification.
- Test #56 — `log_chain_anchors` mutation attempt with the application role is rejected.
- Test #62 — bootstrap cannot re-enable after a DB restore without WORM-marker absence and the env flag.

A WORM provider that cannot drive these five tests in a single development environment (production AND CI AND local-dev workstation) is unacceptable, regardless of how convincing its production posture is.

## Decision

**Primary**: AWS S3 Object Lock in **Compliance Mode** with a fixed retention period of seven years, in a dedicated bucket with versioning enabled. The bucket has Object Lock enabled at creation time (Object Lock cannot be added to an existing bucket).

**IAM split** — three roles, never collapsed:

| Role | `s3:PutObject` | `s3:GetObject` | `s3:DeleteObjectVersion` | `s3:PutBucketObjectLockConfiguration` |
|---|---|---|---|---|
| `simworkbench-app` (the application's runtime role) | denied | allowed | denied | denied |
| `simworkbench-anchor-writer` (audit-anchor process; v4 §19.3) | allowed (with `ObjectLockMode=COMPLIANCE`, `ObjectLockRetainUntilDate` ≥ now+7y) | allowed | denied | denied |
| `simworkbench-bootstrap-deployer` (deploy-time only; v4 §22.1) | allowed | allowed | denied | denied |

Explicit `Deny` on `s3:DeleteObjectVersion` and `s3:DeleteObject` is attached to all three roles regardless of bucket-policy default. Compliance Mode means even the AWS root account cannot shorten retention or delete the version before the retain-until date — this is the property that distinguishes Compliance Mode from Governance Mode and is the reason Compliance Mode is the only acceptable setting.

**Object layout**:

- Anchors: `anchors/<chain>/<rfc3339-timestamp>-<row-id>.json`, where `<chain>` is one of `audit`, `provenance`, `operator`. Object content is the canonicalized tip record (`tip_hash`, `tip_row_id`, `prev_anchor_uri`, `chain`, `committed_at`).
- Bootstrap marker: `bootstrap/marker.json`, written exactly once during initial deploy. Body: `{"bootstrapped_at": "...", "bootstrap_event_id": "...", "deployment_id": "..."}`.

**`log_chain_anchors.external_anchor_uri`** stores the full S3 URI **plus the `versionId`**: `s3://<bucket>/anchors/audit/2026-05-05T12:00:00Z-<id>.json?versionId=<id>`. The version ID is mandatory because the same key can in principle be overwritten with a new locked version; pinning the version makes "this exact bytes" unambiguous and lets the verifier `GetObject` with `VersionId=...` to retrieve the anchored content directly.

**Cadence**: anchor every minute or every 1,000 rows per chain, whichever occurs first (matches §19.3). Three chains × one anchor per minute = ~1.58M objects/year worst case; bounded by the rows-threshold to ~525,600/year per chain in the steady state.

**Dev/CI mock**: MinIO with `MINIO_OBJECT_LOCK_ENABLED=on` and a Compliance-mode bucket configured at startup. The dev/CI environment uses the same SDK call paths and the same IAM-policy structure. Local-filesystem mocks (writing to `local_cache/worm/`) are explicitly disallowed: they miss every property under test (deletion resistance, retention enforcement, version pinning).

## Alternatives Considered

| Option | Real WORM enforcement | Dev mock fidelity | Cost (steady state) | Multi-region DR | Verdict |
|---|---|---|---|---|---|
| **AWS S3 Object Lock (Compliance)** | Yes — enforced by S3 itself; root cannot shorten retention | High — MinIO implements Object Lock with the same semantics and same SDK | ~$0.023/GB-month + per-PUT; ~few KB/object × ~1.5M/yr ≈ $0.50–$5/yr storage, low PUT cost | S3 Cross-Region Replication preserves Object Lock when CRR is configured with replication of locked objects | **Selected.** |
| GCS Bucket Lock with retention policy | Yes — bucket-level locked retention policy is irrevocable once locked | Medium — `fake-gcs-server` partially implements retention; some Bucket Lock semantics are not modeled | Comparable | Multi-region buckets natively; replication of locked policy is well-understood | Strong runner-up; rejected only because dev mock fidelity is weaker than MinIO/S3 and v4 audit work is already AWS-leaning. |
| Cloud KMS immutable key version | Partial — key versions are durable but KMS is not a content store; the "marker" is a key existence claim, not a tamper-evident record | Low — emulating KMS key versions in CI is fragile | Per-API-call pricing dominates; small storage but high call volume for minute cadence is awkward | Per-key replication exists but anchor semantics don't naturally fit a KMS shape | Rejected: KMS is the wrong primitive for storing chain tips. |
| Sigstore Rekor / vendor transparency log | Strong — append-only Merkle log designed for this | Mixed — running a private Rekor instance is an extra subsystem; public Rekor leaks anchor hashes externally (not necessarily a privacy issue, but a compliance question) | Hosted Rekor: free for public log; private operation: meaningful ops cost | Rekor's own multi-region story is operator-dependent | Rejected for v1: extra subsystem, ops burden too high for the gain over Object Lock. Worth revisiting for a cross-tenant auditability story. |
| Azure Blob Immutable Storage with time-based retention policy (locked) | Yes — equivalent property to S3 Object Lock Compliance | Medium — Azurite supports immutable blobs but documentation gaps remain | Comparable to S3 | GRS / GZRS preserves immutability | Strong alternative; rejected because the rest of the v4 reference deployment leans AWS. |

The five candidates collapse into two real shapes (object-store WORM, transparency log). Among object-store WORMs, S3 + MinIO has the highest dev-mock fidelity, which directly addresses the L3.2 reviewer concern that local mocks miss the property under test.

## Consequences

### Positive

- **Real WORM enforcement at the storage layer.** The cloud provider, not the application, refuses deletes and retention shortening. Compliance Mode means even AWS root cannot bypass the retention.
- **Faithful dev mock.** MinIO with Object Lock enabled implements the same API and same enforcement semantics. CI tests of "the application role cannot delete this anchor" return 403 in dev exactly as they would in production.
- **Multi-region DR is a known story.** S3 Cross-Region Replication with `ReplicationConfiguration` preserving Object Lock is documented and supported.
- **Bootstrap marker reuses the same primitive.** No second WORM technology to operate, audit, or mock.
- **Test #50 is naturally implementable.** Mutating a local `log_chain_anchors` row's `tip_hash` while the WORM object retains the prior bytes (pinned by `versionId`) is exactly what chain verification compares.

### Negative

- **AWS lock-in.** Mitigation: the `secure_core` adapter abstracts over the SDK; GCS Bucket Lock and Azure Immutable Blob are explicitly listed as drop-in alternatives at the implementation layer. The IAM-policy shape ports to GCS IAM Conditions / Azure RBAC with mechanical translation.
- **Object accumulation.** With a 1-minute cadence across three chains, ~1.58M objects/year worst case; in practice the rows-threshold caps this nearer ~525,600/year per chain. At a few KB per object, storage cost is bounded ($1–$5/yr) but PUT cost (S3 Standard at $0.005/1k PUTs) is the dominant line: ~$8/yr/chain. Lifecycle to S3 Glacier Deep Archive after 90 days is permitted (Object Lock retention survives the storage-class transition).
- **`external_anchor_uri` must encode the version ID.** A naive implementation that stores only `s3://<bucket>/<key>` is broken: the same key can be (re)written with a new locked version under the anchor-writer role, and the verifier would fetch the wrong bytes. The schema-level invariant: `external_anchor_uri` is rejected by check constraint if it does not contain a `versionId=` segment.
- **Compliance Mode is irrevocable.** Once the bucket is locked and an object's retention is set, the retention cannot be shortened. Operational mistakes (wrong retention period, wrong bucket region, wrong object key) cannot be undone within the retention window. Mitigation: bucket creation is a deploy-time, human-reviewed step with an explicit ADR-tracked checklist, not part of any automated CI pipeline.
- **Region pinning.** Object Lock applies per-bucket; the chosen bucket region is the chain's authoritative region. Multi-region writes against multiple buckets are not supported at this layer; CRR replicates outward from the primary.

### Neutral

- The application's runtime role gains a *negative* permission rather than losing a positive one. The deploy-time bootstrap role exists only at deploy time and is rotated out before steady-state operation; CI fixtures recreate it on demand.
- The anchor-writer process is a separate small daemon (`simworkbench-anchor-writer`) co-located with the API in production but operationally independent: a compromise of the API host does not by itself give an attacker the anchor-writer credentials, since the daemon process runs under a distinct UID and a distinct IAM principal (e.g., IRSA / IAM-Roles-for-Service-Accounts on EKS, or a distinct ECS task role).
- Bucket region and account choice are operational policy, not part of this ADR. The default is "the same AWS account as the application, in the same region as the primary RDS instance"; deployments with a stronger blast-radius requirement may host the anchor bucket in a separate AWS account whose only IAM trust relationship is the anchor-writer + verifier roles.
- Operator-event anchors share the same bucket and the same IAM principals as audit and provenance anchors. The plan does not require separate buckets per chain, and operationally the per-chain split happens at the key prefix (`anchors/<chain>/...`) rather than the bucket level.

## Implementation Notes

### Backend abstraction

The single producer of WORM writes is `secure_core/src/worm/anchor_provider.ts` (TypeScript / Fastify per ADR-0008). Two implementations:

- `S3ObjectLockProvider` (production + MinIO dev/CI). Uses `@aws-sdk/client-s3` against either AWS S3 or a MinIO endpoint chosen by `WORM_S3_ENDPOINT`. Always sets `ObjectLockMode: "COMPLIANCE"`, `ObjectLockRetainUntilDate: now + retentionPeriod`.
- `MockProvider` — refused at startup unless `NODE_ENV === "test"` AND `WORM_ALLOW_LOCAL_MOCK === "true"`. Even in tests, the integration suite (`tests/integration/test_worm_anchor.ts`) exercises `S3ObjectLockProvider` against MinIO; the local mock is reserved for unit tests of code paths that do not test WORM properties themselves.

### Anchor-writer process

A small Node service running at the same logical site as the API. Reads each chain's tip from `log_chain_anchors_pending`, canonicalizes it, `PutObject`s to S3, captures the returned `VersionId`, then inserts a row into `log_chain_anchors` with `external_anchor_uri = s3://<bucket>/<key>?versionId=<id>`. The DB write is the commit point; if the WORM PUT succeeds and the DB write fails, the next iteration retries (the WORM object is harmless as orphan; verification only ever consults rows that exist).

The writer runs on a fixed timer (default 60 seconds) AND on a row-count trigger (default 1,000 rows since the last anchor for that chain). Whichever fires first wins; both are configurable per environment. The timer is ticked by a leader-elected scheduler so duplicate writers do not double-anchor; an accidental double-anchor is harmless (two distinct objects, two distinct versionIds, both pinned in their respective rows) but wastes PUTs.

The writer's `PutObject` request body is the canonicalized JSON of the tip record using RFC 8785 (JSON Canonicalization Scheme) at the same `canonicalization_version` used by the chain rows. This ensures the verifier and the writer canonicalize identically; a canonicalization-version drift is detected by step (3) of the verification path above and surfaces as `CHAIN_ANCHOR_MISMATCH` rather than a silent pass.

### Bootstrap marker

`secure_core/src/bootstrap/marker.ts` exposes `assertMarkerAbsent()` and `writeMarker(deployment_id)`. The bootstrap endpoint calls `assertMarkerAbsent()` before any DB write. After successful platform-admin creation, the deploy-time role calls `writeMarker(...)` with `ObjectLockMode=COMPLIANCE`. Subsequent bootstrap attempts: `assertMarkerAbsent()` returns object-present and the endpoint refuses (test #62).

`assertMarkerAbsent()` uses `HeadObject` rather than `ListObjects` to keep the check O(1) and to keep the IAM permission set tight (the bootstrap path needs `s3:GetObject` only, not `s3:ListBucket`). A 404 NotFound is treated as "absent and bootstrap may proceed"; any other error (network, IAM, region) is treated as "unknown" and the bootstrap endpoint refuses to register itself. Fail-closed is the only acceptable behavior here; an availability incident in WORM does not unlock bootstrap.

The marker object body includes a `deployment_id` set by the deployer at bootstrap time. A future re-deploy with a *different* `deployment_id` does not change the WORM marker (the object is locked); the new deployment reads the existing marker and learns it is operating in an already-bootstrapped fleet. There is no "rotate the marker" operation in v1.

### Dev/CI environment

`scripts/dev/start_minio.sh` brings up MinIO with `MINIO_OBJECT_LOCK_ENABLED=on`, creates the `simworkbench-worm-dev` bucket with Object Lock at create-time, configures Compliance Mode default retention (the dev retention is shortened to 1 day for CI hygiene; production retention is 7 years), and provisions the three IAM users with the policies above. CI invokes the same script. `scripts/test/security.sh` (Phase 5 IMPLEMENTATION_MANIFEST item) brings up MinIO before the security test suite runs.

Dev-only relaxation:

- The retention period in dev/CI is 1 day rather than 7 years, so dev buckets can be torn down and recreated without waiting out the retention window. This is a *retention-period* relaxation, not a *mode* relaxation: the bucket is still in Compliance Mode, so the property under test (resistance to overwrite/delete by the application role) is preserved. CI tests that exercise tail truncation, mismatch, and 403 do so against a Compliance bucket with a 1-day retention, which is sufficient to drive the property.
- Local dev workstations not running MinIO MUST set `WORM_REQUIRED=false` in `.env.local` to start the API; the API logs a structured warning at startup, and any code path that would touch the WORM provider raises a `WormProviderUnavailable` error rather than silently no-op'ing. There is no "log to a local file" fallback. The check at startup uses the same `GetBucketObjectLockConfiguration` call described above and fails closed.

### Negative-path acceptance probes (L3.2 review)

The following must each have an integration test that runs in the security suite:

1. The application role attempting `DeleteObject` on an anchor receives 403. Local row stays; chain verification still passes.
2. The application role attempting `PutObject` to overwrite an anchor key (with or without `ObjectLockMode`) receives 403. Only the anchor-writer role can write to `anchors/`.
3. A local `log_chain_anchors` row whose `tip_hash` is mutated to a value different from the bytes at the WORM object pinned by `versionId` causes chain verification (test #50) to fail with a structured error code (`CHAIN_ANCHOR_MISMATCH`).
4. Re-running bootstrap after `bootstrap/marker.json` exists in WORM causes the bootstrap endpoint to refuse with status 409 (test #62), regardless of the DB state, even after `pg_restore` of a pre-bootstrap dump.
5. Tail truncation: deleting the most recent N rows of `audit_events` after an anchor was committed, then running chain verification, fails with `CHAIN_TAIL_TRUNCATED` (test #49).
6. Bucket misconfiguration probe: at startup, the application calls `GetBucketObjectLockConfiguration` and refuses to start if the bucket is not in Compliance Mode with a non-zero retention. This guards against an operator silently flipping to Governance Mode.

### Schema constraint

The migration that introduces `log_chain_anchors` adds:

```sql
ALTER TABLE log_chain_anchors
  ADD CONSTRAINT external_anchor_uri_has_version_id
  CHECK (external_anchor_uri LIKE '%versionId=%');
```

This is a defense-in-depth check: the anchor-writer cannot accidentally land an unpinned URI even if a future SDK upgrade changes default behavior.

### Cost monitoring

A weekly job tallies `anchors/` object count per chain and emits a metric. Anomalous growth (e.g., the rows-threshold misconfigured to 1) is caught before it becomes a billing surprise. The metric is also a signal of chain activity; a chain that suddenly stops anchoring (writer outage, IAM expiry, bucket policy edit) is detected by the absence of new objects within 2 × the configured cadence.

Lifecycle policy: objects in `anchors/` transition to `GLACIER_IR` after 30 days and to `DEEP_ARCHIVE` after 90 days. Object Lock retention survives storage-class transitions; verification reads from any storage class with a small latency penalty for `DEEP_ARCHIVE` (acceptable because verification is a cold path and runs as part of incident response or periodic audit, not on the request hot path).

### Verification path (read side)

When chain verification runs (per §19.3 and tests #48 / #49 / #50), it walks each `log_chain_anchors` row in chain order and:

1. Recomputes the canonicalized tip-record bytes from the local row identified by `tip_row_id`.
2. Issues `GetObject(Bucket, Key, VersionId)` against the WORM endpoint, retrieving the bytes anchored at commit time.
3. Asserts byte-equality between (1) and (2). Mismatch raises `CHAIN_ANCHOR_MISMATCH`.
4. Walks the local rows between successive anchors, recomputes each `row_hash` from the canonicalized fields, and asserts the chain links. Any mutation of an intermediate row breaks the link (test #48). Any deletion of a row whose `row_hash` is the `prev_hash` of a still-present row breaks the chain.
5. Asserts that the highest local `id` per chain is greater-than-or-equal to the most recently anchored `tip_row_id`. A truncation that drops rows up to the last anchor (test #49) leaves the local tip below the anchor and is detected here.

Steps 1–3 are why the `versionId` matters: without it, an attacker with the anchor-writer credentials could in principle PUT a new locked version pointing at a forged tip, and verification would silently accept the new bytes. Pinning the version means verification compares against the bytes that existed at commit time.

### Operational runbook (skeleton)

The full runbook lives at `secure_core/docs/runbooks/worm.md` (created in L3.2). The skeleton:

- **Quarterly**: review S3 access logs for unexpected principals reading from the anchor bucket. Anchor reads are infrequent (verification only); a spike is an investigation trigger.
- **Per deploy**: rotate the `simworkbench-bootstrap-deployer` credential. The role exists only at deploy time and is destroyed afterward.
- **Per incident**: if the DB is restored, verification immediately runs against WORM. If verification fails, the operator does not silently re-anchor; the operator opens an incident, captures the divergence, and only then re-anchors with a chain-restart marker (a new chain-id, anchored with a comment field referencing the incident).

### Future revisitation

If a cross-tenant external auditor needs to verify chains without access to the bucket, this ADR is a candidate for a follow-up: the same anchor record is *additionally* committed to a Sigstore Rekor instance, with the Rekor entry's UUID stored in a new `external_transparency_uri` column. That is not in scope for v1 and would land as ADR-0010-amendment or a successor ADR.

If multi-cloud portability becomes a hard requirement (e.g., a customer requires GCP-only deployment), the `AnchorProvider` interface admits `GcsBucketLockProvider` and `AzureImmutableBlobProvider` implementations without changes to the calling code; only the bucket / container provisioning scripts and IAM policy templates change.
