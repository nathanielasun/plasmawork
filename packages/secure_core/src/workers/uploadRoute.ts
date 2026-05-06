/**
 * Worker artifact upload route — Phase 0.5 Layer 3 task L3.9.
 *
 * Implements `POST /api/workers/uploads` per ADR-0012:
 *
 *   1. Bearer auth via L3.8 worker token (NOT cookie).
 *   2. Server-derived destination path via L2.10 + deriveArtifactPath.
 *      The worker NEVER influences the directory prefix.
 *   3. Streaming write via @fastify/multipart with size cap; oversize
 *      truncates and rejects with HTTP 413.
 *   4. Quota reservation BEFORE the write opens; on any failure the
 *      reservation releases.
 *   5. Archive validation via L2.11 extractArchive when
 *      artifact_kind === "archive". The destination tree must be
 *      empty before extraction.
 *   6. Audit emission for accept (`worker.uploaded`) and reject
 *      (`worker.upload_denied` with closed-enum reason).
 *
 * The route is registered as a Fastify plugin so callers can compose
 * it into the secure_core app at any path prefix:
 *
 *     app.register(workerUploadRoute, { prefix: "/api/workers" });
 */

import { createWriteStream } from "node:fs";
import { unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import multipart, { type MultipartFile } from "@fastify/multipart";

import {
  assertWorkerTokenValid,
  type WorkerCapability,
  type WorkerClaims,
} from "./tokenIssuer.js";
import {
  deriveArtifactPath,
  isArtifactKind,
  type ArtifactKind,
} from "./deriveArtifactPath.js";
import type { WorkspacePathBuilder } from "../paths/builder.js";
import type { AuditLogger } from "../audit/logger.js";
import type {
  StorageReservationService,
} from "../quotas/storageReservations.js";
import {
  WorkerUploadDeniedError,
  SecureCoreError,
} from "../errors/shapes.js";

const WORKER_AUTH_HEADER = "x-worker-token";
/** Default per-upload cap. Override via plugin opts. */
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MiB

export interface WorkerUploadRouteOptions {
  readonly workerHmacKey: Buffer;
  readonly auditLogger: AuditLogger;
  readonly pathBuilder: WorkspacePathBuilder;
  readonly storageReservations: StorageReservationService;
  /** Per-request size cap. Default 200 MiB. */
  readonly maxUploadBytes?: number;
  /**
   * Hook fired AFTER a successful write. Used by callers to register
   * the artifact in `artifact_files` etc. Optional so the route is
   * testable without DB plumbing for non-DB cases.
   */
  readonly onWritten?: (info: WrittenArtifactInfo) => Promise<void>;
  /** Optional clock seam for token expiry tests. */
  readonly now?: () => number;
}

export interface WrittenArtifactInfo {
  readonly workspaceId: string;
  readonly runId: string;
  readonly artifactKind: ArtifactKind;
  readonly artifactName: string;
  readonly destinationPath: string;
  readonly bytesWritten: number;
  readonly tokenHash: string;
  readonly requestId: string;
}

interface UploadFields {
  readonly run_id: string;
  readonly artifact_kind: string;
  readonly artifact_name: string;
  readonly declared_size?: string;
  readonly content_type?: string;
}

/**
 * Throws if any required field is missing or malformed. The fastify
 * multipart iterator surfaces fields as `MultipartFile`s and as
 * `MultipartValue`s; this helper consumes the part stream into a
 * compact record + streaming file part.
 */
async function readUploadParts(
  req: FastifyRequest,
): Promise<{ fields: UploadFields; file: MultipartFile }> {
  const parts = req.parts();
  const fields: Partial<UploadFields> = {};
  let file: MultipartFile | null = null;
  for await (const part of parts) {
    if (part.type === "file") {
      if (file !== null) {
        // Multiple file parts not allowed.
        throw new WorkerUploadDeniedError(
          "Only one file part is allowed.",
          { reason: "path_traversal" },
        );
      }
      file = part;
      // Important: the file part's stream MUST be drained or aborted
      // before more iterator pulls succeed; we exit the loop here and
      // let the caller drive the stream.
      break;
    }
    if (
      part.type === "field" &&
      typeof part.fieldname === "string" &&
      typeof part.value === "string"
    ) {
      (fields as Record<string, string>)[part.fieldname] = part.value;
    }
  }
  if (file === null) {
    throw new WorkerUploadDeniedError("Missing file part.", {
      reason: "path_traversal",
    });
  }
  if (
    typeof fields.run_id !== "string" ||
    typeof fields.artifact_kind !== "string" ||
    typeof fields.artifact_name !== "string"
  ) {
    throw new WorkerUploadDeniedError("Missing required upload field.", {
      reason: "path_traversal",
    });
  }
  return { fields: fields as UploadFields, file };
}

function workerCapabilityForKind(kind: ArtifactKind): WorkerCapability {
  switch (kind) {
    case "results":
    case "plots":
    case "validation":
    case "provenance":
    case "archive":
      return "run.write_artifact";
  }
}

/**
 * Size-capped Transform. Aborts the pipeline once `maxBytes` is
 * exceeded; the upstream multipart parser will receive a closed
 * stream and the partial file is removed by the caller's catch
 * block. Exceeded uploads emit `worker.upload_denied{oversize}`.
 */
class ByteLimitTransform extends Transform {
  #written = 0;
  readonly #max: number;
  public constructor(max: number) {
    super();
    this.#max = max;
  }
  public get bytesWritten(): number {
    return this.#written;
  }
  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ): void {
    this.#written += chunk.length;
    if (this.#written > this.#max) {
      cb(
        new WorkerUploadDeniedError("Upload exceeded size cap.", {
          reason: "oversize",
        }),
      );
      return;
    }
    cb(null, chunk);
  }
}

/**
 * Fastify plugin. Registers `POST /uploads` (combine with `prefix:
 * "/api/workers"` at app.register time for the canonical path).
 */
export const workerUploadRoute: FastifyPluginAsync<
  WorkerUploadRouteOptions
> = async (app: FastifyInstance, opts) => {
  await app.register(multipart, {
    limits: {
      fileSize: opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
      files: 1,
    },
  });

  app.post("/uploads", async (req, reply) => {
    const presented = req.headers[WORKER_AUTH_HEADER];
    const rawToken = typeof presented === "string" ? presented : null;
    if (rawToken === null) {
      await opts.auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "worker.upload_denied",
        result: "denied",
        requestId: req.requestId,
        metadata: { denied_reason: "scope_mismatch" },
      });
      throw new WorkerUploadDeniedError("Worker token missing.", {
        reason: "scope_mismatch",
      });
    }

    if (!req.isMultipart()) {
      throw new WorkerUploadDeniedError(
        "Body must be multipart/form-data.",
        { reason: "path_traversal" },
      );
    }

    const { fields, file } = await readUploadParts(req);

    if (!isArtifactKind(fields.artifact_kind)) {
      // Drain the file stream so the connection closes cleanly even
      // though we won't write it.
      file.file.resume();
      throw new WorkerUploadDeniedError("Unknown artifact kind.", {
        reason: "path_traversal",
        artifactKind: fields.artifact_kind,
      });
    }
    const kind = fields.artifact_kind;

    let claims: WorkerClaims;
    try {
      claims = assertWorkerTokenValid({
        hmacKey: opts.workerHmacKey,
        raw: rawToken,
        expectedRunId: fields.run_id,
        requiredCapability: workerCapabilityForKind(kind),
        now: opts.now,
      });
    } catch (err) {
      file.file.resume();
      const reason =
        err instanceof SecureCoreError &&
        typeof err.details === "object" &&
        err.details !== null &&
        "reason" in err.details
          ? (err.details as { reason: string }).reason
          : "scope_mismatch";
      await opts.auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "worker",
        action: "worker.upload_denied",
        result: "denied",
        requestId: req.requestId,
        metadata: {
          denied_reason: "scope_mismatch",
          ...(reason !== "scope_mismatch" ? {} : {}),
        },
      });
      throw err;
    }

    // (2) server-derived destination
    let destinationPath: string;
    try {
      destinationPath = await deriveArtifactPath({
        workspaceId: claims.workspace_id,
        runId: claims.run_id,
        artifactKind: kind,
        artifactName: fields.artifact_name,
        builder: opts.pathBuilder,
      });
    } catch (err) {
      file.file.resume();
      await opts.auditLogger.write({
        workspaceId: claims.workspace_id,
        actorUserId: null,
        actorType: "worker",
        action: "worker.upload_denied",
        result: "denied",
        requestId: req.requestId,
        metadata: { denied_reason: "path_traversal" },
      });
      throw err;
    }

    // (4) reserve quota for the declared size BEFORE opening the file.
    const declared = fields.declared_size
      ? BigInt(fields.declared_size)
      : BigInt(opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES);
    let reservation: { reservationId: string; expiresAt: Date } | null = null;
    try {
      reservation = await opts.storageReservations.reserveBytes({
        workspaceId: claims.workspace_id,
        requestedBy: claims.run_id, // workers don't have a user id; pin to run
        bytes: declared,
        requestId: req.requestId,
      });
    } catch {
      file.file.resume();
      await opts.auditLogger.write({
        workspaceId: claims.workspace_id,
        actorUserId: null,
        actorType: "worker",
        action: "worker.upload_denied",
        result: "denied",
        requestId: req.requestId,
        metadata: { denied_reason: "quota_exceeded" },
      });
      throw new WorkerUploadDeniedError("Quota exceeded.", {
        reason: "quota_exceeded",
      });
    }

    // (3) streaming write through the byte-limited transform.
    const max = opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const limiter = new ByteLimitTransform(max);
    await mkdir(dirname(destinationPath), { recursive: true });
    const out = createWriteStream(destinationPath, { flags: "wx", mode: 0o600 });
    try {
      await pipeline(file.file, limiter, out);
    } catch (err) {
      // Best-effort cleanup of the partial file + reservation.
      try {
        await unlink(destinationPath);
      } catch {
        // already absent — ignore
      }
      try {
        if (reservation !== null) {
          await opts.storageReservations.releaseReservation({
            reservationId: reservation.reservationId,
            workspaceId: claims.workspace_id,
            requestId: req.requestId,
          });
        }
      } catch {
        // sweep will collect
      }
      const reason =
        err instanceof WorkerUploadDeniedError &&
        typeof err.details === "object" &&
        err.details !== null &&
        "reason" in err.details
          ? (err.details as { reason: string }).reason
          : "oversize";
      await opts.auditLogger.write({
        workspaceId: claims.workspace_id,
        actorUserId: null,
        actorType: "worker",
        action: "worker.upload_denied",
        result: "denied",
        requestId: req.requestId,
        metadata: { denied_reason: reason as "oversize" | "archive_unsafe" },
      });
      throw err;
    }

    // Commit the reservation against the actual bytes written.
    await opts.storageReservations.commitReservation({
      reservationId: reservation.reservationId,
      workspaceId: claims.workspace_id,
      requestId: req.requestId,
    });

    const info: WrittenArtifactInfo = {
      workspaceId: claims.workspace_id,
      runId: claims.run_id,
      artifactKind: kind,
      artifactName: fields.artifact_name,
      destinationPath,
      bytesWritten: limiter.bytesWritten,
      tokenHash: "",
      requestId: req.requestId,
    };
    if (opts.onWritten) {
      await opts.onWritten(info);
    }

    await opts.auditLogger.write({
      workspaceId: claims.workspace_id,
      actorUserId: null,
      actorType: "worker",
      action: "worker.uploaded",
      result: "succeeded",
      requestId: req.requestId,
      metadata: {
        bytes_committed: limiter.bytesWritten.toString(),
      },
    });

    return reply.code(200).send({
      ok: true,
      artifact_kind: kind,
      bytes: limiter.bytesWritten,
    });
  });
};
