/**
 * S3 anchor provider — Phase 0.5 Layer 3 task L3.2 helper.
 *
 * The provider is the swap surface between dev tests, MinIO mocks,
 * and AWS S3 with Object Lock COMPLIANCE per ADR-0010. The
 * AnchorCommitter calls `putObject(bucket, key, body)` and depends on
 * the returned `versionId` to construct the v4 §19.3 external anchor
 * URI (the URI MUST contain `versionId=` per the L1.8 CHECK).
 */

import {
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface S3PutResult {
  /** The bucket-side version id. Used to pin the external anchor URI. */
  readonly versionId: string;
}

export interface S3AnchorProvider {
  putObject(bucket: string, key: string, body: Buffer): Promise<S3PutResult>;
}

export interface AwsS3ProviderOptions {
  readonly region: string;
  /**
   * Days the anchor object is locked from deletion. Per ADR-0010 the
   * minimum is the chain anchoring window the deployment promises.
   * Default: 365.
   */
  readonly retentionDays: number;
  /** S3-compatible endpoint (MinIO dev mock). Omit for real AWS. */
  readonly endpoint?: string;
}

/**
 * Production / MinIO-dev provider. Sets ObjectLockMode = "COMPLIANCE"
 * (ADR-0010 — RetentionPeriodMode.GOVERNANCE is rejected because root
 * users could lift it; COMPLIANCE cannot be lifted before retention
 * elapses).
 */
export class AwsS3AnchorProvider implements S3AnchorProvider {
  readonly #client: S3Client;
  readonly #retentionDays: number;

  public constructor(opts: AwsS3ProviderOptions) {
    if (!Number.isInteger(opts.retentionDays) || opts.retentionDays <= 0) {
      throw new Error(
        `AwsS3AnchorProvider: retentionDays must be a positive integer (got ${opts.retentionDays})`,
      );
    }
    const config: S3ClientConfig = { region: opts.region };
    if (opts.endpoint !== undefined) {
      config.endpoint = opts.endpoint;
      config.forcePathStyle = true;
    }
    this.#client = new S3Client(config);
    this.#retentionDays = opts.retentionDays;
  }

  public async putObject(
    bucket: string,
    key: string,
    body: Buffer,
  ): Promise<S3PutResult> {
    const retainUntil = new Date(
      Date.now() + this.#retentionDays * 24 * 60 * 60 * 1000,
    );
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retainUntil,
    });
    const res = await this.#client.send(cmd);
    if (!res.VersionId) {
      throw new Error(
        `AwsS3AnchorProvider.putObject: response missing VersionId for ${bucket}/${key}. ` +
          `Object Lock requires bucket versioning to be enabled.`,
      );
    }
    return { versionId: res.VersionId };
  }
}

/**
 * In-memory test provider. Records every PUT and returns deterministic
 * version ids. The committer's URI must still contain `versionId=`,
 * which the L1.8 CHECK constraint enforces.
 */
export class FakeS3AnchorProvider implements S3AnchorProvider {
  readonly #puts: Array<{
    bucket: string;
    key: string;
    body: Buffer;
    versionId: string;
  }> = [];
  #counter = 0;
  /** When set, the next putObject rejects with this error. Cleared after use. */
  #nextError: Error | null = null;

  public failNextPut(err: Error): void {
    this.#nextError = err;
  }

  public puts(): ReadonlyArray<{
    bucket: string;
    key: string;
    body: Buffer;
    versionId: string;
  }> {
    return this.#puts;
  }

  public async putObject(
    bucket: string,
    key: string,
    body: Buffer,
  ): Promise<S3PutResult> {
    if (this.#nextError !== null) {
      const err = this.#nextError;
      this.#nextError = null;
      throw err;
    }
    this.#counter += 1;
    const versionId = `v${this.#counter.toString().padStart(8, "0")}`;
    this.#puts.push({ bucket, key, body, versionId });
    return { versionId };
  }
}
