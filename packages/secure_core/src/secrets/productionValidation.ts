import {
  SECRET_NAMES,
  isSecretName,
  type SecretName,
} from "./allowlist.js";
import type { SecretRotatedEvent } from "./client.js";

export type ProductionSecretsFailureCode =
  | "provider_not_aws"
  | "missing_aws_prefix"
  | "missing_aws_region"
  | "local_path_set"
  | "direct_secret_env_set"
  | "static_aws_credential_env_set"
  | "rotation_event_not_aws"
  | "rotation_event_missing_version"
  | "rotation_event_unknown_secret";

export interface ProductionSecretsFailure {
  readonly code: ProductionSecretsFailureCode;
  readonly message: string;
}

export class ProductionSecretsValidationError extends Error {
  public readonly failures: readonly ProductionSecretsFailure[];

  public constructor(failures: readonly ProductionSecretsFailure[]) {
    super(failures.map((f) => f.message).join("; "));
    this.name = "ProductionSecretsValidationError";
    this.failures = failures;
  }
}

export interface ProductionSecretsValidationResult {
  readonly provider: "aws";
  readonly prefix: string;
  readonly region: string;
  readonly requiredSecretNames: readonly SecretName[];
}

type EnvMap = Readonly<Record<string, string | undefined>>;

function defined(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function firstDefinedTrimmed(
  ...values: readonly (string | undefined)[]
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function directSecretEnvNames(env: EnvMap): string[] {
  return Object.keys(env).filter((name) => name.startsWith("PLASMAWORK_SECRET_"));
}

export function validateProductionSecretsConfig(
  env: EnvMap,
): ProductionSecretsValidationResult {
  const failures: ProductionSecretsFailure[] = [];
  const provider = env.PLASMAWORK_SECRETS_PROVIDER?.trim().toLowerCase();
  const prefix = env.PLASMAWORK_SECRETS_AWS_PREFIX?.trim();
  const region = firstDefinedTrimmed(env.AWS_REGION, env.AWS_DEFAULT_REGION);

  if (provider !== "aws") {
    failures.push({
      code: "provider_not_aws",
      message: "production secrets provider must be aws",
    });
  }
  if (!defined(prefix)) {
    failures.push({
      code: "missing_aws_prefix",
      message: "PLASMAWORK_SECRETS_AWS_PREFIX is required in production",
    });
  }
  if (!defined(region)) {
    failures.push({
      code: "missing_aws_region",
      message: "AWS_REGION or AWS_DEFAULT_REGION is required in production",
    });
  }
  if (defined(env.PLASMAWORK_SECRETS_LOCAL_PATH)) {
    failures.push({
      code: "local_path_set",
      message: "production must not configure PLASMAWORK_SECRETS_LOCAL_PATH",
    });
  }
  const direct = directSecretEnvNames(env);
  if (direct.length > 0) {
    failures.push({
      code: "direct_secret_env_set",
      message: `production must not expose direct secret env vars: ${direct.join(", ")}`,
    });
  }
  if (
    defined(env.AWS_ACCESS_KEY_ID) ||
    defined(env.AWS_SECRET_ACCESS_KEY) ||
    defined(env.AWS_SESSION_TOKEN)
  ) {
    failures.push({
      code: "static_aws_credential_env_set",
      message: "production must use workload identity, not static AWS key env vars",
    });
  }

  if (failures.length > 0) {
    throw new ProductionSecretsValidationError(failures);
  }

  return {
    provider: "aws",
    prefix: prefix as string,
    region: region as string,
    requiredSecretNames: SECRET_NAMES,
  };
}

export function validateProductionRotationEvent(
  event: SecretRotatedEvent,
): void {
  const failures: ProductionSecretsFailure[] = [];
  if (event.provider !== "aws") {
    failures.push({
      code: "rotation_event_not_aws",
      message: "production rotation events must come from the aws provider",
    });
  }
  if (!isSecretName(event.name)) {
    failures.push({
      code: "rotation_event_unknown_secret",
      message: `rotation event referenced non-allowlisted secret: ${event.name}`,
    });
  }
  if (!defined(event.version_id)) {
    failures.push({
      code: "rotation_event_missing_version",
      message: "aws rotation events must include provider version_id",
    });
  }
  if (failures.length > 0) {
    throw new ProductionSecretsValidationError(failures);
  }
}
