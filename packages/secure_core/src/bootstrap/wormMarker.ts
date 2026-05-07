/**
 * Bootstrap WORM marker — Phase 0.5 Layer 4 task L4.9.
 *
 * v4 §22.1 requires the bootstrap gate to consult a WORM (write-once /
 * compliance-locked) marker whose presence proves a prior bootstrap
 * completed. A regular local sentinel file does NOT qualify; acceptable
 * markers are S3 Object Lock, GCS Bucket Lock, an immutable cloud KMS
 * marker, or equivalent. Database restore alone must not re-enable
 * bootstrap, hence the marker lives outside the application database.
 *
 * ADR-0010 fixes our production marker mode to S3 Object Lock with
 * COMPLIANCE retention. The same `S3Client` reused from
 * `audit/s3Provider.ts` underlies the production implementation; this
 * module owns the marker semantics (key layout, presence probe, JSON
 * payload shape) without re-implementing any S3 plumbing.
 *
 * The interface is the seam: the bootstrap service depends on the
 * abstract `BootstrapWormMarkerProvider`, never on S3 directly. Tests
 * inject `FakeWormMarkerProvider`. Production wires `S3WormMarkerProvider`.
 */

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

/**
 * Payload written to the marker the moment bootstrap succeeds. The
 * `admin_user_id` ties the marker to the row that landed in `users`,
 * `completed_at` is a server-generated RFC 3339 UTC timestamp, and
 * `request_id` correlates with the bootstrap audit row.
 */
export interface BootstrapMarkerPayload {
  readonly admin_user_id: string;
  readonly completed_at: string;
  readonly request_id: string;
}

/**
 * Abstract surface every backend (S3, GCS, in-memory test) implements.
 *
 *   - `isBootstrapped()` is the gate-side probe: returns `true` exactly
 *     when a successful bootstrap previously committed a marker. The
 *     bootstrap endpoint refuses to register and refuses to act when
 *     this returns `true`.
 *   - `recordBootstrap()` is the success-side commit: writes the marker
 *     ONCE (the storage backend MUST refuse overwrite — for S3 we use
 *     Object Lock with COMPLIANCE retention, see ADR-0010).
 *
 * Contract:
 *   - `recordBootstrap` MUST be safe to call exactly once per process
 *     lifetime; storage backends reject re-writes (S3 Object Lock
 *     does this transparently; the in-memory test impl raises).
 *   - `isBootstrapped` MUST return synchronous-of-storage truth — i.e.
 *     it queries the live store, not a cached value.
 */
export interface BootstrapWormMarkerProvider {
  isBootstrapped(): Promise<boolean>;
  recordBootstrap(payload: BootstrapMarkerPayload): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory test provider
// ---------------------------------------------------------------------------

/**
 * Test provider. Records the marker payload in-process and exposes
 * inspector helpers. Refuses to record twice — mirrors the S3 Object
 * Lock contract so a test that accidentally double-bootstraps fails
 * loudly, instead of silently appearing to succeed.
 */
export class FakeWormMarkerProvider implements BootstrapWormMarkerProvider {
  #payload: BootstrapMarkerPayload | null;

  public constructor(initial?: BootstrapMarkerPayload) {
    this.#payload = initial ?? null;
  }

  public async isBootstrapped(): Promise<boolean> {
    return this.#payload !== null;
  }

  public async recordBootstrap(payload: BootstrapMarkerPayload): Promise<void> {
    if (this.#payload !== null) {
      throw new Error(
        "FakeWormMarkerProvider.recordBootstrap: marker already present (Object Lock would also refuse)",
      );
    }
    this.#payload = payload;
  }

  /** Test-only inspector. Returns the recorded payload, if any. */
  public peek(): BootstrapMarkerPayload | null {
    return this.#payload;
  }
}

// ---------------------------------------------------------------------------
// AWS S3 production provider
// ---------------------------------------------------------------------------

export interface S3WormMarkerOptions {
  readonly region: string;
  readonly bucket: string;
  /** Key path inside the bucket. Defaults to `bootstrap/marker.json`. */
  readonly key?: string;
  /**
   * Days the marker is locked. Per ADR-0010 we use COMPLIANCE retention;
   * minimum is one year so a transient operator can't pivot the gate
   * by waiting out a short retention. Default: 3650 (10 years).
   */
  readonly retentionDays?: number;
  /** S3-compatible endpoint (MinIO dev mock). Omit for real AWS. */
  readonly endpoint?: string;
}

const DEFAULT_KEY = "bootstrap/marker.json";
const DEFAULT_RETENTION_DAYS = 3650;

/**
 * Production provider. Stores the marker as a JSON object under
 * `s3://<bucket>/<key>` with `ObjectLockMode = "COMPLIANCE"` and a long
 * retention. `isBootstrapped` probes via `HeadObject` and translates a
 * 404 into "not present"; any other error propagates so a transient S3
 * outage cannot silently re-enable bootstrap (gate fails closed per
 * v4 §22.1 and CLAUDE.md "fail closed and document the blocker").
 */
export class S3WormMarkerProvider implements BootstrapWormMarkerProvider {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #key: string;
  readonly #retentionDays: number;

  public constructor(opts: S3WormMarkerOptions) {
    if (typeof opts.bucket !== "string" || opts.bucket.length === 0) {
      throw new Error("S3WormMarkerProvider: bucket is required");
    }
    const retention = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    if (!Number.isInteger(retention) || retention <= 0) {
      throw new Error(
        `S3WormMarkerProvider: retentionDays must be a positive integer (got ${retention})`,
      );
    }
    const config: S3ClientConfig = { region: opts.region };
    if (opts.endpoint !== undefined) {
      config.endpoint = opts.endpoint;
      config.forcePathStyle = true;
    }
    this.#client = new S3Client(config);
    this.#bucket = opts.bucket;
    this.#key = opts.key ?? DEFAULT_KEY;
    this.#retentionDays = retention;
  }

  public async isBootstrapped(): Promise<boolean> {
    try {
      await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: this.#key }),
      );
      return true;
    } catch (err) {
      if (err instanceof S3ServiceException) {
        const status = err.$metadata.httpStatusCode;
        if (status === 404 || err.name === "NotFound") return false;
      }
      // Any other error (auth, network, throttle) MUST propagate. Fail
      // closed: the bootstrap gate refuses on error, never opens.
      throw err;
    }
  }

  public async recordBootstrap(payload: BootstrapMarkerPayload): Promise<void> {
    const retainUntil = new Date(
      Date.now() + this.#retentionDays * 24 * 60 * 60 * 1000,
    );
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.#key,
        Body: Buffer.from(JSON.stringify(payload), "utf8"),
        ContentType: "application/json",
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: retainUntil,
      }),
    );
  }
}
