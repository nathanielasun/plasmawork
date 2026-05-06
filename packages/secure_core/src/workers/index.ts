/**
 * Worker subsystem barrel — Phase 0.5 Layer 3 (L3.8 + L3.9).
 */

export {
  deriveArtifactPath,
  isArtifactKind,
  ARTIFACT_KINDS,
  ARTIFACT_KIND_SET,
  type ArtifactKind,
  type DeriveArtifactPathOptions,
} from "./deriveArtifactPath.js";

export {
  workerUploadRoute,
  type WorkerUploadRouteOptions,
  type WrittenArtifactInfo,
} from "./uploadRoute.js";

export {
  issueWorkerToken,
  verifyWorkerToken,
  assertWorkerTokenValid,
  isWorkerCapability,
  WORKER_CAPABILITIES,
  WORKER_CAPABILITY_SET,
  type IssueTokenOptions,
  type IssuedWorkerToken,
  type VerifyTokenOptions,
  type VerifyResult,
  type WorkerCapability,
  type WorkerClaims,
  type WorkerTokenRefusalReason,
} from "./tokenIssuer.js";
