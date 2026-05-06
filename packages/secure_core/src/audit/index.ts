/**
 * Audit subsystem barrel — Phase 0.5 Layer-1 (L1.7) + Layer-3 (L3.1).
 *
 * Re-exports the typed audit logger (L1.7), the Postgres-backed writer
 * + chain-tip reader (L3.1), and the chain verifier (L3.1) so a
 * Layer-3 caller has one import surface:
 *
 *     import {
 *       AuditLogger,
 *       AuditDbWriter,
 *       AuditChainVerifier,
 *     } from "@simworkbench/secure-core/audit";
 *
 * Cross-task: L3.2 (anchor committer) imports `AuditChainVerifier` to
 * verify the chain segment about to be anchored before pinning it to
 * external WORM.
 */

export {
  AuditLogger,
  computeAuditRowHash,
  type AuditEventInput,
  type AuditLoggerOptions,
  type AuditPrevHashGetter,
  type AuditWriter,
  type AuditActorType,
  type AuditResult,
  type PreparedAuditRow,
} from "./logger.js";

export { RedactionError, redactMetadata } from "./redaction.js";

export {
  AuditDbWriter,
  type AuditDbWriterOptions,
  type AuditLogType,
  type PreparedLogRow,
  type PreparedOperatorRow,
  type PreparedProvenanceRow,
} from "./dbWriter.js";

export {
  AuditChainVerifier,
  type AuditChainVerifierOptions,
  type VerifyFailureReason,
  type VerifyReport,
} from "./verifier.js";
