/**
 * Secret-name allowlist — Phase 0.5 Layer-1 (L1.6).
 *
 * Source of truth for the set of secret identifiers the workbench is
 * permitted to read. Every call to `SecretsClient.getSecret` checks the
 * requested name against this set BEFORE contacting any provider, so an
 * attacker who controls the requested name cannot probe the provider
 * for arbitrary keys.
 *
 * ADR-0011 §Context lists the initial allowlist. Adding a member here
 * is the load-bearing step — provisioning the secret in AWS Secrets
 * Manager or in the local dev file is downstream of the allowlist
 * change.
 *
 * Pattern matches `config/capabilities.ts`: literal-union derived from
 * a `const` tuple, frozen membership Set, type guard at trust
 * boundaries.
 */

export const SECRET_NAMES = [
  // Database role passwords (one per Postgres role per ADR-0008 §pool).
  "db.password.app",
  "db.password.audit_read",
  "db.password.anchor_writer",

  // Approval / session / CSRF / webhook signing keys.
  "approval_hmac_key",
  "audit_ip_hmac_key",
  "audit_ua_hmac_key",
  "session_signing_key",
  "csrf_hmac_key",
  "webhook_signing_key",

  // Worker key wrapping (per-run worker tokens are derived).
  "worker_master_key",

  // OIDC client credential (sso login).
  "oidc.client_secret",

  // External anchor writer (WORM provider) AWS credentials.
  "aws.anchor_writer.access_key_id",
  "aws.anchor_writer.secret_access_key",
] as const;

/**
 * Literal-union of allowed secret names. Use this type wherever a
 * secret name is consumed; `string` is too wide.
 */
export type SecretName = (typeof SECRET_NAMES)[number];

/**
 * Frozen Set for membership checks. Constant-time lookup; refuses
 * mutation at runtime.
 */
export const SECRET_NAME_SET: ReadonlySet<SecretName> = Object.freeze(
  new Set(SECRET_NAMES),
);

/**
 * Type guard: narrows an unknown value to a SecretName without casting.
 */
export function isSecretName(value: unknown): value is SecretName {
  return typeof value === "string" && SECRET_NAME_SET.has(value as SecretName);
}
