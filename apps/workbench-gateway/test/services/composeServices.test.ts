/**
 * composeServices fail-closed tests — Phase 0.5 post-audit (2026-05-09).
 *
 * The audit caught two production-mode gaps the original
 * ``buildGatewayServices`` left open:
 *
 *   - Default WORM marker was a process-local Fake provider. A
 *     production DB restore would re-enable bootstrap because the
 *     in-memory marker doesn't survive a process restart.
 *   - The fail-closed branch only fired when bootstrap was actively
 *     allowed; deployments that ran with bootstrap disabled silently
 *     used the fake.
 *
 * The fix: ``WORKBENCH_BOOTSTRAP_WORM_PROVIDER`` is required when
 * ``BOOTSTRAP_ALLOWED=1``. The ``s3`` value pulls in the
 * ``S3WormMarkerProvider`` (production); ``fake`` is the explicit
 * dev-mode opt-in. Unset + bootstrap disabled is the safe back-compat
 * for installations that never run bootstrap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildGatewayServices } from "../../src/services/composeServices.js";
import type { GatewayEnv } from "../../src/env.js";

function baseEnv(overrides: Partial<GatewayEnv> = {}): GatewayEnv {
  return {
    bootstrapAllowed: undefined,
    bootstrapCredentialHash: "0".repeat(64),
    rootAdminUserId: "rootadmin42x9k",
    gatewayPort: 4000,
    backendPort: 8000,
    cookieSecret: "x".repeat(64),
    handoffSecret: "y".repeat(64),
    frontendOrigin: "http://localhost:3000",
    dbUrl: "postgres://stub",
    dbAuditUrl: "postgres://stub",
    trustProxy: undefined,
    bootstrapWormProvider: undefined,
    bootstrapWormS3Bucket: undefined,
    bootstrapWormS3Key: undefined,
    bootstrapWormS3Region: undefined,
    ...overrides,
  };
}

// Stub the postgres-js client so buildGatewayServices doesn't try to
// open a real connection. The compose factory only reads the SQL
// closure into other services; none of these tests exercise a real
// DB-backed code path.
function noopSql() {
  const fn = (async () => []) as unknown as Record<string, unknown>;
  fn.unsafe = async () => [];
  fn.begin = async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(fn);
  fn.end = async () => undefined;
  fn.options = { parsers: {}, serializers: {} };
  return fn as unknown as Parameters<typeof buildGatewayServices>[0]["appSql"];
}

describe("composeServices.resolveWormMarkerFromEnv", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("refuses to start with bootstrap allowed + no WORM provider configured", () => {
    expect(() =>
      buildGatewayServices({
        env: baseEnv({ bootstrapAllowed: "1" }),
        appSql: noopSql(),
        auditSql: noopSql(),
      }),
    ).toThrow(/WORKBENCH_BOOTSTRAP_WORM_PROVIDER is unset/);
  });

  it("refuses to start with provider=s3 but missing bucket/key/region", () => {
    expect(() =>
      buildGatewayServices({
        env: baseEnv({
          bootstrapAllowed: "1",
          bootstrapWormProvider: "s3",
        }),
        appSql: noopSql(),
        auditSql: noopSql(),
      }),
    ).toThrow(/WORKBENCH_BOOTSTRAP_WORM_S3_(BUCKET|KEY|REGION)/);
  });

  it("starts when bootstrap is disabled even with no WORM provider", () => {
    // Bootstrap is closed, so the marker provider is unreachable.
    const services = buildGatewayServices({
      env: baseEnv({ bootstrapAllowed: undefined }),
      appSql: noopSql(),
      auditSql: noopSql(),
    });
    expect(services.wormMarker).toBeDefined();
  });

  it("starts when provider=fake is explicitly set with bootstrap allowed (dev mode opt-in)", () => {
    const services = buildGatewayServices({
      env: baseEnv({
        bootstrapAllowed: "1",
        bootstrapWormProvider: "fake",
      }),
      appSql: noopSql(),
      auditSql: noopSql(),
    });
    expect(services.wormMarker).toBeDefined();
    expect(services.wormMarker.constructor.name).toBe(
      "FakeWormMarkerProvider",
    );
  });

  it("constructs an S3WormMarkerProvider when provider=s3 + bucket/key/region all set", () => {
    const services = buildGatewayServices({
      env: baseEnv({
        bootstrapAllowed: "1",
        bootstrapWormProvider: "s3",
        bootstrapWormS3Bucket: "test-bucket",
        bootstrapWormS3Key: "bootstrap/marker.json",
        bootstrapWormS3Region: "us-east-1",
      }),
      appSql: noopSql(),
      auditSql: noopSql(),
    });
    expect(services.wormMarker.constructor.name).toBe(
      "S3WormMarkerProvider",
    );
  });
});
