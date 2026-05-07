/**
 * Centralized environment access for secure_core.
 *
 * Layer-1 review rule: production code outside the secrets package
 * does not read `process.env` directly. Callers import this helper so
 * environment names remain closed and auditable in one place.
 */

export const SECURE_CORE_ENV_VARS = [
  "AWS_REGION",
  "BOOTSTRAP_ALLOWED",
  "BOOTSTRAP_CREDENTIAL_HASH",
  "PLASMAWORK_ANCHOR_PROVIDER",
  "PLASMAWORK_ANCHOR_RETENTION_DAYS",
  "PLASMAWORK_ANCHOR_S3_BUCKET",
  "PLASMAWORK_ANCHOR_S3_ENDPOINT",
  "PLASMAWORK_ANCHOR_S3_KEY_PREFIX",
  "PLASMAWORK_ANCHOR_S3_REGION",
  "PLASMAWORK_ARCHIVE_MAX_BYTES",
  "PLASMAWORK_ARCHIVE_MAX_FILES",
  "PLASMAWORK_DB_URL",
  "PLASMAWORK_DB_URL_ANCHOR_WRITER",
  "PLASMAWORK_DB_URL_APP",
  "PLASMAWORK_DB_URL_AUDIT_READ",
  "PLASMAWORK_DB_URL_MIGRATOR",
  "PLASMAWORK_SECRETS_AWS_PREFIX",
  "PLASMAWORK_SECRETS_LOCAL_PATH",
  "PLASMAWORK_SECRETS_PROVIDER",
  "SECURE_CORE_LOG_LEVEL",
  "SIMWORKBENCH_REPO_ROOT",
] as const;

export type SecureCoreEnvVar = (typeof SECURE_CORE_ENV_VARS)[number];

export function readSecureCoreEnv(name: SecureCoreEnvVar): string | undefined {
  return process.env[name];
}

export function readSecretValueEnv(envName: string): string | undefined {
  if (!envName.startsWith("PLASMAWORK_SECRET_")) {
    throw new Error(
      `invalid secret-value environment variable "${envName}"; expected PLASMAWORK_SECRET_*`,
    );
  }
  return process.env[envName];
}
