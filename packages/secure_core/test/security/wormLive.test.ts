/**
 * Live WORM/Object-Lock probes.
 *
 * These tests are deployment-gated. They require a dedicated S3-compatible
 * bucket with Object Lock enabled in COMPLIANCE mode. The default PR security
 * lane does not run them because it intentionally carries no cloud identity.
 */

import { describe, expect, it } from "vitest";
import {
  DeleteObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

import { AwsS3AnchorProvider } from "../../src/audit/s3Provider.js";

const HAS_WORM_LIVE =
  process.env.PLASMAWORK_ANCHOR_LIVE_PROBES === "1" &&
  Boolean(process.env.PLASMAWORK_ANCHOR_S3_BUCKET) &&
  Boolean(process.env.PLASMAWORK_ANCHOR_S3_REGION) &&
  Boolean(process.env.PLASMAWORK_ANCHOR_RETENTION_DAYS);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for WORM live probes`);
  }
  return value.trim();
}

function s3Config(): S3ClientConfig {
  const config: S3ClientConfig = {
    region: requireEnv("PLASMAWORK_ANCHOR_S3_REGION"),
  };
  const endpoint = process.env.PLASMAWORK_ANCHOR_S3_ENDPOINT?.trim();
  if (endpoint) {
    config.endpoint = endpoint;
    config.forcePathStyle = true;
  }
  return config;
}

function anchorUri(bucket: string, key: string, versionId: string): string {
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `s3://${encodeURIComponent(bucket)}/${encodedKey}?versionId=${encodeURIComponent(versionId)}`;
}

function uniqueKey(): string {
  const prefix =
    process.env.PLASMAWORK_ANCHOR_S3_KEY_PREFIX?.trim() ||
    "ci/live-worm-probes";
  const run = process.env.GITHUB_RUN_ID || `${Date.now()}`;
  const attempt = process.env.GITHUB_RUN_ATTEMPT || "local";
  return `${prefix}/probe-${run}-${attempt}-${randomUUID()}.json`;
}

describe.skipIf(!HAS_WORM_LIVE)("WORM/Object-Lock live probes", () => {
  it("writes a COMPLIANCE-retained object, reads the pinned version, and refuses deletion", async () => {
    const bucket = requireEnv("PLASMAWORK_ANCHOR_S3_BUCKET");
    const retentionDays = Number.parseInt(
      requireEnv("PLASMAWORK_ANCHOR_RETENTION_DAYS"),
      10,
    );
    expect(Number.isInteger(retentionDays) && retentionDays > 0).toBe(true);

    const provider = new AwsS3AnchorProvider({
      region: requireEnv("PLASMAWORK_ANCHOR_S3_REGION"),
      endpoint: process.env.PLASMAWORK_ANCHOR_S3_ENDPOINT?.trim() || undefined,
      retentionDays,
    });
    const key = uniqueKey();
    const body = Buffer.from(
      JSON.stringify({
        probe: "worm-object-lock",
        created_at: new Date().toISOString(),
        github_run_id: process.env.GITHUB_RUN_ID ?? null,
      }),
      "utf8",
    );

    const put = await provider.putObject(bucket, key, body);
    expect(put.versionId.length).toBeGreaterThan(0);

    const uri = anchorUri(bucket, key, put.versionId);
    await expect(provider.getObjectByUri(uri)).resolves.toEqual(body);

    const client = new S3Client(s3Config());
    await expect(
      client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
          VersionId: put.versionId,
        }),
      ),
    ).rejects.toBeTruthy();

    await expect(provider.getObjectByUri(uri)).resolves.toEqual(body);
  }, 120_000);
});

describe.runIf(!HAS_WORM_LIVE)("WORM/Object-Lock live probes skipped", () => {
  it("documents required environment", () => {
    expect(HAS_WORM_LIVE).toBe(false);
    expect("PLASMAWORK_ANCHOR_LIVE_PROBES").toBeTruthy();
    expect("PLASMAWORK_ANCHOR_S3_BUCKET").toBeTruthy();
    expect("PLASMAWORK_ANCHOR_S3_REGION").toBeTruthy();
    expect("PLASMAWORK_ANCHOR_RETENTION_DAYS").toBeTruthy();
  });
});
