# ADR-0012: Worker Artifact Upload Protocol

## Status
Proposed

## Date
2026-05-05

## Context

Phase 5 / Gate G1.L0.5 of the Security Implementation Plan
(`program_development/phase_05_security_implementation_plan.md`)
requires a decision on how a sandboxed worker delivers run artifacts
(HDF5 trajectories, plot CSVs, JSON summaries, validation reports,
zipped capsule fragments) back to the workbench server. The choice is
framed in `secure_multi_user_scaffolding_plan_v4.md` §18.2 as two
options:

- **Option A — server-mediated upload.** The worker presents its
  scoped credential (§18.1) on an authenticated server endpoint. The
  server validates the credential, derives the workspace-scoped
  storage path from `(workspace_id, run_id, artifact_metadata)`, and
  writes the bytes itself. The path is server-derived and the worker
  cannot influence it.

- **Option B — pre-signed single-use URL.** The server issues a
  single-use, time-bound, scope-bound URL pointing at an
  object-storage upload location. The worker `PUT`s directly to that
  URL. The URL is bound to a specific run, path, size limit, and
  content-type at signature time.

The relevant constraints come from §18 (Worker and Job Security), §15
(Sandbox: workers run inside the sandbox with controlled egress per
ADR-0009), §9.4 (path-traversal / zip-slip / symlink defense), §19.4
(redaction allowlist for output metadata), §19.5 (audit-event names
including `worker.upload_denied`), §21.2 (quota reservation +
release), and the §29 acceptance probes. Three §29 tests pin the
behavioral surface this ADR must satisfy:

- **#44**: a worker token bound to run A cannot upload artifacts for
  run B.
- **#45**: a worker cannot supply an arbitrary artifact path; the
  storage location is server-derived.
- **#46**: output metadata (filenames, comments, embedded provenance
  strings) flow through the redaction allowlist before reaching the
  audit log.

Typical workbench artifacts are small to medium: HDF5 trajectories
for laser/plasma runs are usually under a few hundred MB, plots are
KB-scale, and zipped capsules are typically <1 GB. Multi-GB single
objects are not the common case in the MVP.

## Decision

Adopt **Option A — server-mediated upload** as the worker artifact
upload protocol for v4 §18.2. Concretely:

1. **Single authenticated upload endpoint.** Workers `POST`
   artifacts to `POST /api/workers/uploads`. The endpoint requires
   the worker's scoped credential (§18.1). The credential carries the
   run ID it is bound to; the server rejects any credential whose run
   ID does not match the upload's declared run.

2. **Server-derived storage path.** The server computes the storage
   path from `(workspace_id, run_id, artifact_kind, artifact_name)`.
   `artifact_kind` is one of a closed enum (`results`, `plots`,
   `validation`, `provenance`, `archive`). `artifact_name` is
   sanitized through the §9.4 path-traversal defense (no `..`, no
   absolute paths, no symlinks, no dotfiles unless explicitly
   allowlisted). The worker cannot supply or influence the prefix.

3. **Streaming + backpressure.** The endpoint streams bytes to disk
   (or to the configured storage backend) without buffering the full
   payload in memory. Per-token + per-workspace rate limits cap
   concurrent in-flight upload bytes to prevent multi-tenant
   noisy-neighbor effects.

4. **Pre-write quota reservation.** Before opening the destination
   file, the server reserves the declared upload size against the
   workspace quota (§21.2). Failed writes (network drop, oversize,
   archive validation refusal) release the reservation.

5. **Size limit at the request boundary.** `Content-Length` is
   rejected if it exceeds `max_upload_size` (configurable per
   workspace tier). Streaming uploads that exceed the limit are cut
   short and the partial file is removed. Either case emits
   `worker.upload_denied`.

6. **Archive validation before extraction.** Uploads with
   `artifact_kind=archive` are validated through the §9.4.11
   zip/symlink defense before any entry is written to the workspace.
   Archive entries that resolve outside the destination, contain
   symlinks, or include dotfiles outside the allowlist cause the
   upload to fail with `worker.upload_denied`.

7. **Metadata redaction at audit time.** Output metadata (filenames,
   comments, embedded provenance strings) flows through the §19.4
   redaction allowlist before the audit event is emitted. The
   redactor strips known-secret-shaped substrings (long base64
   blobs, AWS-style keys, bearer tokens) prior to logging.

8. **Uniform audit emission.** Every accepted upload emits
   `worker.uploaded` with the redacted metadata; every rejection
   emits `worker.upload_denied` with the rejection reason
   (`scope_mismatch`, `path_traversal`, `oversize`,
   `archive_unsafe`, `quota_exceeded`, `redaction_failed`). The
   emission point is shared with the rest of the workspace audit
   pipeline (no separate code path).

## Alternatives Considered

### Option A — server-mediated upload (chosen)

The worker presents its scoped credential to an authenticated server
endpoint. The server validates, derives the path, writes the bytes,
and emits the audit event from a single code path. Application-level
middleware (auth, schema validation, redaction, audit, quota) is the
gate. Rejected for very large objects (>10 GB) where direct
object-storage upload would matter.

### Option B — pre-signed single-use URL

The server signs a URL bound to a specific run, path, size limit, and
content-type; the worker `PUT`s directly to object storage. This
removes the application server from the byte path, which is
attractive for very large artifacts. Rejected for the MVP because:

- Auditing happens at URL issuance, not at consumption. The audit
  event records "URL was signed", not "bytes were actually delivered
  with these metadata"; the §29 tests #44/#45/#46 want the latter.
- Path-traversal and archive-content defense (§9.4 zip-slip /
  symlink / dotfile) cannot be expressed in a pre-signed URL's
  constraints; the server still has to inspect the uploaded bytes,
  which means the server is in the path anyway.
- The redaction step (§19.4, test #46) still has to run server-side
  on the ingested metadata, so removing the server from the byte
  path does not remove it from the metadata path.
- Path policy changes (e.g., adding a new `artifact_kind`) require
  changing the URL signature format and propagating that to every
  running worker, instead of an isolated server-side change.
- The MVP's artifact sizes (<1 GB typical) don't make the
  application server a throughput bottleneck.

### Hybrid — Option A by default, Option B above a size threshold

Use server-mediated for the common case and pre-signed URLs only when
the declared artifact size exceeds a threshold (e.g., 5 GB). Rejected
for the MVP because it doubles the surface area to audit and test —
both protocols need the §29 #44/#45/#46 acceptance probes, both need
quota integration, both need redaction, and the threshold itself
becomes a policy that has to be tuned per-workspace. A future ADR
may revisit the hybrid once a real >10 GB artifact case appears
(e.g., full external-PIC trajectory dumps from §18.6) and once
storage moves to a dedicated object-storage tier.

## Consequences

### Positive

- The §29 acceptance probes #44, #45, and #46 are easier to verify:
  one endpoint, one auth check, one path-derivation function, one
  redaction call, one audit emission.
- Audit events are uniform with the rest of the workspace event
  stream — `worker.uploaded` and `worker.upload_denied` come from
  the same pipeline that emits `workspace.created`,
  `run.submitted`, etc.
- Path-traversal, zip-slip, symlink, and dotfile defenses live in
  one place (the upload endpoint) and reuse §9.4 helpers; no
  encoding of those defenses into URL signatures.
- Quota reservation and release sit on the same code path as the
  write, so failure modes (oversize, archive refusal) release the
  reservation deterministically.
- Worker code stays simple — one `POST` with a credential header.
  No URL handshake.

### Negative

- The application server is in the byte path. Streaming and
  backpressure are required to avoid memory spikes on large
  uploads; the upload handler must not `await request.body()` into
  memory.
- Multi-tenant noisy-neighbor risk: a slow upload on one workspace
  consumes a connection slot that affects others on the same node.
  Mitigation: per-token and per-workspace concurrency + bytes-in-
  flight rate limits.
- For the future case of >10 GB artifacts, throughput will need to
  be reconsidered. This ADR explicitly defers that to a future ADR
  rather than designing for it now.

### Neutral

- The endpoint shape (`POST /api/workers/uploads`) follows the rest
  of the v4 API; no new framework or library is introduced.
- Storage remains workspace-local on the application server's
  filesystem in the MVP. A future migration to object storage is
  compatible with Option A — the server-side write call site
  changes, the worker protocol does not.

## Implementation notes

- **Endpoint shape.** `POST /api/workers/uploads` accepts a multipart
  body with fields `run_id`, `artifact_kind` (closed enum),
  `artifact_name`, `declared_size`, `content_type`, and a streaming
  `file` part. The credential is supplied as a bearer header bound
  to a single run ID at issuance time (§18.1).
- **Path derivation.** A single helper
  `simworkbench.security.uploads.derive_artifact_path(workspace_id,
  run_id, artifact_kind, artifact_name)` is the only function
  authorized to compute the destination. The endpoint never accepts
  a worker-supplied path component beyond `artifact_name`, and that
  component is sanitized through the existing §9.4 helper.
- **Streaming.** The handler uses framework-native streaming
  (FastAPI `UploadFile.stream()` or equivalent) and writes through a
  size-limited iterator that aborts at `max_upload_size`.
- **Archive validation.** Reuses the §9.4.11 zip/symlink defense
  added during the workspace import path; the upload handler calls
  the same validator before extraction.
- **Redaction.** Reuses `simworkbench.security.redaction` (§19.4)
  for filenames, comments, and any free-text metadata that ends up
  in the audit log.
- **Audit events.** `worker.uploaded` and `worker.upload_denied`
  are added to the §19.5 event registry. Both events carry
  `(workspace_id, run_id, artifact_kind, artifact_name_redacted,
  size_bytes, reason?)`.
- **Tests** to land alongside implementation:
  - Test #44 negative path: worker token for run A presented on an
    upload for run B → 403 + `worker.upload_denied{reason="scope_
    mismatch"}`.
  - Test #45 negative path: worker uploads with
    `artifact_name="../../etc/passwd"` → 400 +
    `worker.upload_denied{reason="path_traversal"}`.
  - Test #46 redaction: worker uploads a file whose comment
    contains a token-shaped string; audit log shows the redacted
    form.
  - Archive zip-slip: worker uploads an archive whose entry path
    is `../../etc/passwd` → archive extraction refuses with
    `archive_unsafe`.
  - Oversize: worker uploads larger than `max_upload_size` → 413 +
    `worker.upload_denied{reason="oversize"}` and, if relevant,
    `quota.exceeded`.
  - Quota release: simulated mid-stream failure releases the
    pre-reserved quota.
- **Future revisit.** This ADR may be superseded if (a) artifact
  sizes routinely exceed several GB, (b) the application server
  becomes a throughput bottleneck under realistic workload, or (c)
  storage migrates to a dedicated object-storage tier. Any successor
  ADR must preserve the §29 #44/#45/#46 invariants regardless of
  protocol.
