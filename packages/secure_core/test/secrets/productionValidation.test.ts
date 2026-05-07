import { describe, expect, it } from "vitest";

import {
  ProductionSecretsValidationError,
  validateProductionRotationEvent,
  validateProductionSecretsConfig,
} from "../../src/secrets/productionValidation.js";

describe("production secrets validation", () => {
  it("accepts aws provider config with workload identity shape", () => {
    const result = validateProductionSecretsConfig({
      PLASMAWORK_SECRETS_PROVIDER: "aws",
      PLASMAWORK_SECRETS_AWS_PREFIX: "plasmawork/prod",
      AWS_REGION: "us-west-2",
    });
    expect(result.provider).toBe("aws");
    expect(result.requiredSecretNames).toContain("session_signing_key");
  });

  it("falls back to AWS_DEFAULT_REGION when AWS_REGION is blank", () => {
    const result = validateProductionSecretsConfig({
      PLASMAWORK_SECRETS_PROVIDER: "aws",
      PLASMAWORK_SECRETS_AWS_PREFIX: "plasmawork/prod",
      AWS_REGION: " ",
      AWS_DEFAULT_REGION: "us-east-1",
    });

    expect(result.region).toBe("us-east-1");
  });

  it("rejects local/env fallback and direct secret env vars in production", () => {
    const fixtureAccessKey = ["AKIA", "0000000000000000"].join("");
    expect(() =>
      validateProductionSecretsConfig({
        PLASMAWORK_SECRETS_PROVIDER: "env",
        PLASMAWORK_SECRETS_AWS_PREFIX: "",
        PLASMAWORK_SECRETS_LOCAL_PATH: "local_cache/secrets/secrets.local.json",
        PLASMAWORK_SECRET_DB_PASSWORD_APP: "do-not-use",
        AWS_ACCESS_KEY_ID: fixtureAccessKey,
        AWS_SESSION_TOKEN: "session-token",
      }),
    ).toThrow(ProductionSecretsValidationError);
  });

  it("requires aws rotation events to include provider version ids", () => {
    expect(() =>
      validateProductionRotationEvent({
        audit_event: "secret.rotated",
        name: "db.password.app",
        provider: "aws",
        at: "2026-05-07T00:00:00.000Z",
        version_id: "version-1",
      }),
    ).not.toThrow();

    expect(() =>
      validateProductionRotationEvent({
        audit_event: "secret.rotated",
        name: "db.password.app",
        provider: "aws",
        at: "2026-05-07T00:00:00.000Z",
      }),
    ).toThrow(/version_id/);
  });
});
