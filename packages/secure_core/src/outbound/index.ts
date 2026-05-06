/**
 * Outbound subsystem barrel — Phase 0.5 Layer 3 (L3.10).
 *
 * SSRF-safe URL guard + fetcher + outbound webhook signer per v4 §26.
 */

export {
  SsrfGuard,
  classifyIp,
  type Resolver,
  type SsrfCheckResult,
  type SsrfGuardOptions,
  type SsrfRefusalReason,
} from "./ssrf.js";

export {
  SafeFetcher,
  makePinnedLookup,
  type SafeFetcherOptions,
  type SafeFetchOptions,
} from "./fetcher.js";

export {
  signWebhook,
  verifyWebhook,
  assertWebhookValid,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type SignWebhookOptions,
  type SignedWebhookHeaders,
  type VerifyWebhookOptions,
  type WebhookVerifyResult,
} from "./webhookSigner.js";
