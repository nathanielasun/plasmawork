/**
 * Audit event names — Phase 0.5 Layer-1 (L1.1).
 *
 * Every audit emission goes through the typed logger
 * (`src/audit/logger.ts`); the logger refuses any event name not
 * in this set. Adding a new event requires updating this file AND
 * v4 §19.5 in the same commit.
 *
 * Source: v4 §19.5 (Required Audit Events) plus the additions from
 * V4-R1 (`archive.entry_rejected`), V4-R2 (`csrf.failed`,
 * `origin.mismatch`), V4-R5 (`quota.reservation_expired`).
 */

export const AUDIT_EVENTS = [
  // Auth + session
  "login.succeeded",
  "login.failed",
  "logout",
  "session.revoked",
  "session.idle_timeout",

  // Workspace lifecycle
  "workspace.created",
  "workspace.deleted",
  "workspace.member_added",
  "workspace.member_removed",
  "workspace.role_changed",

  // Capsule lifecycle
  "capsule.created",
  "capsule.read",
  "capsule.updated",
  "capsule.forked",
  "capsule.deleted",

  // Run lifecycle
  "run.launched",
  "run.cancelled",
  "run.completed",
  "run.failed",

  // Approval
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "approval.revoked",
  "approval.required",
  "approval.token_context_mismatch",

  // Tool lifecycle
  "tool.created",
  "tool.updated",
  "tool.promotion_requested",
  "tool.promoted",
  "tool.deprecated",

  // Artifact lifecycle
  "artifact.exported",

  // Authorization rejections (every fail-closed path)
  "permission.denied",
  "path_access.denied",

  // Sandbox + worker
  "sandbox.violation",
  "worker.upload_denied",
  "worker.uploaded",
  "worker.token_issued", // L4.11 — orchestrator-issued per-run token (v4 §18.1)

  // Platform / operator
  "platform.capability_used",
  "platform.long_session_granted",

  // Operations
  "secret.rotated",
  "branch_protection.bypass",
  "db.migration_applied",
  "bootstrap.completed",
  "log_chain.anchor_committed",
  "log_chain.verification_succeeded",
  "log_chain.verification_failed",

  // Quota + rate limit
  "quota.exceeded",
  "quota.reservation_expired", // V4-R5
  "rate_limit.triggered",

  // Browser-channel rejections (V4-R2)
  "csrf.failed",
  "origin.mismatch",

  // Schema rejections (always emit before the 400 returns)
  "request.unexpected_field",

  // Archive defenses (V4-R1)
  "archive.entry_rejected",
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export const AUDIT_EVENT_SET: ReadonlySet<AuditEvent> = Object.freeze(
  new Set(AUDIT_EVENTS),
);

export function isAuditEvent(value: unknown): value is AuditEvent {
  return typeof value === "string" && AUDIT_EVENT_SET.has(value as AuditEvent);
}

/**
 * Closed enum for `archive.entry_rejected.reason`. Each archive-entry
 * rejection emits an audit event with one of these reason codes; new
 * reasons require updating both this enum and the relevant test in
 * §29 #15 / #74.
 */
export const ARCHIVE_REJECTION_REASONS = [
  "symlink",
  "hardlink",
  "device",
  "zip_slip",
  "size_limit_exceeded",
  "file_count_limit_exceeded",
  "dotfile",
] as const;

export type ArchiveRejectionReason = (typeof ARCHIVE_REJECTION_REASONS)[number];

/**
 * Closed enum for `worker.upload_denied.reason`. Used by the
 * `POST /api/workers/uploads` handler per ADR-0012 step 8.
 */
export const WORKER_UPLOAD_DENIED_REASONS = [
  "scope_mismatch",
  "path_traversal",
  "oversize",
  "archive_unsafe",
  "quota_exceeded",
  "redaction_failed",
] as const;

export type WorkerUploadDeniedReason =
  (typeof WORKER_UPLOAD_DENIED_REASONS)[number];

/**
 * Audit-event result discriminator. Every audit row carries one of
 * these so reviewers can grep for failed-vs-succeeded breakdowns.
 */
export const AUDIT_RESULTS = [
  "succeeded",
  "denied",
  "failed",
] as const;

export type AuditResult = (typeof AUDIT_RESULTS)[number];
