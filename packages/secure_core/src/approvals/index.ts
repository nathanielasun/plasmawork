/**
 * Approval system barrel — Phase 0.5 Layer-3 (L3.3).
 *
 * Re-exports the public surface of the approval service. The §16
 * lifecycle (request → issue → consume, with deny / revoke side-paths)
 * lives in `service.ts`; this barrel exists so callers can write
 * `import { ApprovalService } from "@simworkbench/secure-core/approvals"`
 * without reaching for the file directly.
 */

export {
  ApprovalService,
  type ApprovalServiceOptions,
  type ApprovalRequestRow,
  type ApprovalTokenRow,
  type RequestApprovalOptions,
  type IssueTokenOptions,
  type ConsumeTokenOptions,
  type DecideRequestOptions,
  ApprovalRequiredError,
  ApprovalTokenInvalidError,
  SecureCoreError,
} from "./service.js";
