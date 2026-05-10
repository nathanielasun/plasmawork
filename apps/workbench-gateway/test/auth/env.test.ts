/**
 * Workbench gateway env loader — Phase 0.5 (2026-05-09).
 *
 * Pins:
 *   - Required variables are required (throws on missing).
 *   - Secret-byte minimums are enforced at load time.
 *   - ROOT_ADMIN_USER_ID matches the alphanumeric pattern.
 *   - BOOTSTRAP_CREDENTIAL_HASH must be 64-hex.
 *   - .env.auth file missing → friendly error naming the path.
 */

import { describe, it, expect } from "vitest";

import { loadGatewayEnv } from "../../src/env.js";

const STRONG_SECRET = "Aa!23456789012345678901234567890123456"; // 38 bytes
const VALID_HEX = "a".repeat(64);

const STRONG_SECRET_2 = "Bb!23456789012345678901234567890123456"; // 38 bytes
const VALID_SOURCE: Record<string, string> = {
  BOOTSTRAP_ALLOWED: "1",
  BOOTSTRAP_CREDENTIAL_HASH: VALID_HEX,
  ROOT_ADMIN_USER_ID: "rootadmin42x9k",
  WORKBENCH_GATEWAY_PORT: "4000",
  WORKBENCH_BACKEND_PORT: "8000",
  WORKBENCH_GATEWAY_COOKIE_SECRET: STRONG_SECRET,
  WORKBENCH_GATEWAY_HANDOFF_SECRET: STRONG_SECRET,
  WORKBENCH_INTERNAL_AUDIT_SECRET: STRONG_SECRET_2,
  WORKBENCH_GATEWAY_FRONTEND_ORIGIN: "https://app.plasmawork.test",
  PLASMAWORK_DB_URL: "postgres://x",
  PLASMAWORK_DB_AUDIT_URL: "postgres://y",
};

describe("loadGatewayEnv", () => {
  it("returns a typed env object when every required variable is set", () => {
    const env = loadGatewayEnv({ envSource: VALID_SOURCE });
    expect(env.bootstrapCredentialHash).toBe(VALID_HEX);
    expect(env.rootAdminUserId).toBe("rootadmin42x9k");
    expect(env.gatewayPort).toBe(4000);
    expect(env.backendPort).toBe(8000);
    expect(env.cookieSecret).toBe(STRONG_SECRET);
    expect(env.handoffSecret).toBe(STRONG_SECRET);
    expect(env.internalAuditSecret).toBe(STRONG_SECRET_2);
    expect(env.frontendOrigin).toBe("https://app.plasmawork.test");
  });

  it("defaults gatewayHost to 127.0.0.1 (loopback) when WORKBENCH_GATEWAY_HOST is unset", () => {
    const env = loadGatewayEnv({ envSource: VALID_SOURCE });
    expect(env.gatewayHost).toBe("127.0.0.1");
  });

  it("honors WORKBENCH_GATEWAY_HOST=0.0.0.0 for production behind a TLS terminator", () => {
    const env = loadGatewayEnv({
      envSource: { ...VALID_SOURCE, WORKBENCH_GATEWAY_HOST: "0.0.0.0" },
    });
    expect(env.gatewayHost).toBe("0.0.0.0");
  });

  it.each([
    "BOOTSTRAP_CREDENTIAL_HASH",
    "ROOT_ADMIN_USER_ID",
    "WORKBENCH_GATEWAY_COOKIE_SECRET",
    "WORKBENCH_GATEWAY_HANDOFF_SECRET",
    "WORKBENCH_INTERNAL_AUDIT_SECRET",
    "WORKBENCH_GATEWAY_FRONTEND_ORIGIN",
    "PLASMAWORK_DB_URL",
    "PLASMAWORK_DB_AUDIT_URL",
  ])("throws when %s is missing", (varName) => {
    const source: Record<string, string | undefined> = { ...VALID_SOURCE };
    source[varName] = undefined;
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      new RegExp(varName),
    );
  });

  it("throws when WORKBENCH_GATEWAY_COOKIE_SECRET is shorter than 32 bytes", () => {
    const source = { ...VALID_SOURCE, WORKBENCH_GATEWAY_COOKIE_SECRET: "short" };
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      /at least 32 bytes/,
    );
  });

  it("throws when WORKBENCH_GATEWAY_HANDOFF_SECRET is shorter than 32 bytes", () => {
    const source = {
      ...VALID_SOURCE,
      WORKBENCH_GATEWAY_HANDOFF_SECRET: "short",
    };
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      /at least 32 bytes/,
    );
  });

  it("throws when WORKBENCH_INTERNAL_AUDIT_SECRET is shorter than 32 bytes", () => {
    const source = {
      ...VALID_SOURCE,
      WORKBENCH_INTERNAL_AUDIT_SECRET: "short",
    };
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      /at least 32 bytes/,
    );
  });

  it("throws when BOOTSTRAP_CREDENTIAL_HASH is not 64 hex chars", () => {
    const source = { ...VALID_SOURCE, BOOTSTRAP_CREDENTIAL_HASH: "abcd" };
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      /64 lowercase hex/,
    );
  });

  it("throws when ROOT_ADMIN_USER_ID violates the alphanumeric pattern", () => {
    const source = { ...VALID_SOURCE, ROOT_ADMIN_USER_ID: "with spaces!" };
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      /alphanumeric/,
    );
  });

  it("rejects a too-short ROOT_ADMIN_USER_ID", () => {
    const source = { ...VALID_SOURCE, ROOT_ADMIN_USER_ID: "ab" };
    expect(() => loadGatewayEnv({ envSource: source })).toThrowError(
      /alphanumeric/,
    );
  });

  it("emits a friendly error if the .env.auth file is missing", () => {
    expect(() =>
      loadGatewayEnv({ envPath: "/tmp/definitely-does-not-exist-.env.auth" }),
    ).toThrowError(/does not exist/);
  });
});
