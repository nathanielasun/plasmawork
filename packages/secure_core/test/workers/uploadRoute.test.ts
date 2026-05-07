/**
 * L3.9 worker upload route regression tests.
 *
 * Pins post-Group-C audit fixes #4–#7:
 *   - #4: requested_by uses claims.requested_by_user_id (FK target).
 *   - #5: worker-originated audits carry the run requester's user_id.
 *   - #6: streaming cap = declared_size, not maxUploadBytes.
 *   - #7: archive uploads route through extractArchive; rejection
 *         cleans up the .extracted dir + releases reservation.
 *
 * Tests use Fastify's `app.inject()` with multipart bodies. The
 * StorageReservationService and WorkspacePathBuilder are stubbed in
 * memory so no DB or real workspace is required. extractArchive is
 * exercised end-to-end against real on-disk archives built via the
 * test-support helper.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

import {
  workerUploadRoute,
  type WorkerUploadRouteOptions,
} from "../../src/workers/uploadRoute.js";
import {
  issueWorkerToken,
  type WorkerCapability,
} from "../../src/workers/tokenIssuer.js";
import { WorkspacePathBuilder } from "../../src/paths/builder.js";
import {
  buildZipBuffer,
  buildTarBuffer,
} from "../../src/paths/buildTestArchive.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { StorageReservationService } from "../../src/quotas/storageReservations.js";

const HMAC_KEY = randomBytes(32);

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const WS_ID = "22222222-2222-4222-8222-222222222222";
const CAP_ID = "33333333-3333-4333-8333-333333333333";
const VER_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

interface AuditCall {
  action: string;
  result: string;
  actorUserId: string | null;
  actorType: string;
  workspaceId: string | null;
  metadata?: Record<string, unknown>;
}

function makeStubAuditLogger(): {
  logger: AuditLogger;
  calls: AuditCall[];
} {
  const calls: AuditCall[] = [];
  const logger = {
    async write(input: {
      action: string;
      result: string;
      actorUserId: string | null;
      actorType: string;
      workspaceId: string | null;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        workspaceId: input.workspaceId,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

interface ReservationCall {
  action: "reserveBytes" | "commitReservation" | "releaseReservation";
  workspaceId: string;
  bytes?: bigint;
  requestedBy?: string;
  reservationId?: string;
}

function makeStubReservationService(opts: {
  quotaCap: bigint;
  rejectCommitReservationId?: string;
}): {
  service: StorageReservationService;
  calls: ReservationCall[];
} {
  const calls: ReservationCall[] = [];
  let counter = 0;
  let consumed = 0n;
  const service = {
    async reserveBytes(o: {
      workspaceId: string;
      requestedBy: string;
      bytes: bigint;
      requestId: string;
    }) {
      calls.push({
        action: "reserveBytes",
        workspaceId: o.workspaceId,
        bytes: o.bytes,
        requestedBy: o.requestedBy,
      });
      if (consumed + o.bytes > opts.quotaCap) {
        throw new Error("quota exceeded");
      }
      consumed += o.bytes;
      counter += 1;
      return {
        reservationId: `res-${counter}`,
        expiresAt: new Date(Date.now() + 3600_000),
      };
    },
    async commitReservation(o: { reservationId: string; workspaceId: string }) {
      calls.push({
        action: "commitReservation",
        workspaceId: o.workspaceId,
        reservationId: o.reservationId,
      });
      if (o.reservationId === opts.rejectCommitReservationId) {
        throw new Error("commit failed");
      }
    },
    async releaseReservation(o: { reservationId: string; workspaceId: string }) {
      calls.push({
        action: "releaseReservation",
        workspaceId: o.workspaceId,
        reservationId: o.reservationId,
      });
    },
  } as unknown as StorageReservationService;
  return { service, calls };
}

describe("workerUploadRoute — L3.9 regressions (audit fixes #4–#7)", () => {
  let storageRoot: string;
  let pathBuilder: WorkspacePathBuilder;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "secure-core-upload-"));
    pathBuilder = new WorkspacePathBuilder({
      workspaceStorageRoot: storageRoot,
    });
    // The builder needs the temp_runs subpath root to exist so its
    // verify-mode realpath check succeeds.
    await mkdir(join(storageRoot, "workspaces", WS_ID, "temp_runs"), {
      recursive: true,
    });
  });

  afterAll(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  function buildApp(
    opts: Partial<WorkerUploadRouteOptions> & {
      auditLogger: AuditLogger;
      storageReservations: StorageReservationService;
    },
  ): FastifyInstance {
    const app = Fastify({ logger: false });
    app.addHook("onRequest", requireRequestId);
    app.setErrorHandler((err, req, reply) => {
      const mapped = toHttpResponse(
        err instanceof SecureCoreError ? err : err,
        req.requestId ?? "unknown",
      );
      reply.code(mapped.status).send(mapped.body);
    });
    app.register(workerUploadRoute, {
      workerHmacKey: HMAC_KEY,
      auditLogger: opts.auditLogger,
      pathBuilder,
      storageReservations: opts.storageReservations,
      maxUploadBytes: opts.maxUploadBytes ?? 10_000,
    });
    return app;
  }

  function multipartBody(
    parts: ReadonlyArray<
      | { name: string; value: string }
      | { name: string; filename: string; content: Buffer }
    >,
  ): { headers: Record<string, string>; payload: Buffer } {
    const boundary = "----TestBoundary" + Math.random().toString(36).slice(2);
    const chunks: Buffer[] = [];
    for (const p of parts) {
      chunks.push(Buffer.from(`--${boundary}\r\n`, "utf-8"));
      if ("filename" in p) {
        chunks.push(
          Buffer.from(
            `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
              `Content-Type: application/octet-stream\r\n\r\n`,
            "utf-8",
          ),
        );
        chunks.push(p.content);
      } else {
        chunks.push(
          Buffer.from(
            `Content-Disposition: form-data; name="${p.name}"\r\n\r\n`,
            "utf-8",
          ),
        );
        chunks.push(Buffer.from(p.value, "utf-8"));
      }
      chunks.push(Buffer.from("\r\n", "utf-8"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
    const payload = Buffer.concat(chunks);
    return {
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": payload.length.toString(),
      },
      payload,
    };
  }

  function tokenFor(opts: {
    capabilities?: ReadonlyArray<WorkerCapability>;
  } = {}): string {
    return issueWorkerToken({
      hmacKey: HMAC_KEY,
      run: {
        id: RUN_ID,
        workspaceId: WS_ID,
        capsuleId: CAP_ID,
        capsuleVersionId: VER_ID,
        requestedByUserId: USER_ID,
      },
      capabilities: opts.capabilities,
    }).raw;
  }

  let audit: ReturnType<typeof makeStubAuditLogger>;
  let reservations: ReturnType<typeof makeStubReservationService>;

  beforeEach(() => {
    audit = makeStubAuditLogger();
    reservations = makeStubReservationService({ quotaCap: 10_000_000n });
  });

  // -------------------------------------------------------------------
  // Audit fix #4 + #5: requested_by FK + worker actor identity
  // -------------------------------------------------------------------

  it("on success: reserves with requestedBy = claims.requested_by_user_id (FK target is users.id)", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "results" },
      { name: "artifact_name", value: "trajectory.h5" },
      { name: "declared_size", value: "100" },
      { name: "file", filename: "trajectory.h5", content: Buffer.alloc(100, 7) },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(200);
    const reserve = reservations.calls.find((c) => c.action === "reserveBytes");
    expect(reserve).toBeDefined();
    // The fix: requestedBy is the run REQUESTER's user id (FK
    // targets users.id), NOT the run id.
    expect(reserve?.requestedBy).toBe(USER_ID);
    expect(reserve?.requestedBy).not.toBe(RUN_ID);
  });

  it("on success: emits worker.uploaded with actorUserId = requested_by_user_id (no null)", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "results" },
      { name: "artifact_name", value: "out.bin" },
      { name: "declared_size", value: "10" },
      { name: "file", filename: "out.bin", content: Buffer.alloc(10) },
    ]);
    await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    const success = audit.calls.find((c) => c.action === "worker.uploaded");
    expect(success).toBeDefined();
    expect(success?.actorType).toBe("worker");
    expect(success?.actorUserId).toBe(USER_ID);
    expect(success?.actorUserId).not.toBeNull();
  });

  it("on rejection: emits worker.upload_denied with actorUserId from claims (when claims parsed)", async () => {
    // Force a path-traversal rejection by using an artifact_name with `..`.
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "results" },
      { name: "artifact_name", value: "../../etc/passwd" },
      { name: "file", filename: "x", content: Buffer.alloc(10) },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(403);
    const denied = audit.calls.find((c) => c.action === "worker.upload_denied");
    expect(denied?.metadata?.denied_reason).toBe("path_traversal");
    // Audit row carries the run requester's id even on rejection.
    expect(denied?.actorUserId).toBe(USER_ID);
    expect(denied?.actorType).toBe("worker");
  });

  // -------------------------------------------------------------------
  // Audit fix #6: declared-size streaming cap (no quota underdeclare)
  // -------------------------------------------------------------------

  it("rejects when actual bytes exceed declared_size (oversize)", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    // Worker declares 100 bytes but ships 500.
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "results" },
      { name: "artifact_name", value: "fat.bin" },
      { name: "declared_size", value: "100" },
      { name: "file", filename: "fat.bin", content: Buffer.alloc(500, 9) },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(403);
    const denied = audit.calls.find((c) => c.action === "worker.upload_denied");
    expect(denied?.metadata?.denied_reason).toBe("oversize");
  });

  it("rejects when declared_size exceeds maxUploadBytes (refuses up front)", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
      maxUploadBytes: 1000,
    });
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "results" },
      { name: "artifact_name", value: "huge.bin" },
      { name: "declared_size", value: "999999" },
      { name: "file", filename: "huge.bin", content: Buffer.alloc(50) },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(403);
    expect(
      audit.calls.find((c) => c.action === "worker.upload_denied")?.metadata
        ?.denied_reason,
    ).toBe("oversize");
    // No reservation should have been attempted past the upfront cap.
    expect(reservations.calls.find((c) => c.action === "reserveBytes")).toBeUndefined();
  });

  it("rejects malformed declared_size with a typed denial and no reservation", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "results" },
      { name: "artifact_name", value: "bad-size.bin" },
      { name: "declared_size", value: "1e6" },
      { name: "file", filename: "bad-size.bin", content: Buffer.alloc(10) },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(403);
    expect(
      reservations.calls.find((c) => c.action === "reserveBytes"),
    ).toBeUndefined();
    const denied = audit.calls.find((c) => c.action === "worker.upload_denied");
    expect(denied?.metadata?.denied_reason).toBe("oversize");
  });

  // -------------------------------------------------------------------
  // Audit fix #7: archive validation routing + rejection cleanup
  // -------------------------------------------------------------------

  it("archive (zip-slip) rejection: cleans up archive + .extracted dir + releases reservation", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    // Build a tar with a `..`-traversing entry. yazl refuses ../ at
    // write time, so we use tar (the L2.11 extractor's tar parser
    // surfaces this as zip_slip).
    const evilTar = await buildTarBuffer([
      { name: "../escape.txt", content: "compromised" },
    ]);
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "archive" },
      { name: "artifact_name", value: "evil.tar" },
      { name: "declared_size", value: evilTar.length.toString() },
      { name: "file", filename: "evil.tar", content: evilTar },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(403);
    const denied = audit.calls.find((c) => c.action === "worker.upload_denied");
    expect(denied?.metadata?.denied_reason).toBe("archive_unsafe");

    // Cleanup: the archive file itself is unlinked, AND the
    // .extracted directory is removed (no leak).
    const expectedArchive = join(
      storageRoot,
      "workspaces",
      WS_ID,
      "temp_runs",
      RUN_ID,
      "archive",
      "evil.tar",
    );
    const expectedExtractDir = `${expectedArchive}.extracted`;
    expect(existsSync(expectedArchive)).toBe(false);
    expect(existsSync(expectedExtractDir)).toBe(false);

    // Reservation released (sweep doesn't have to clean it).
    expect(
      reservations.calls.find((c) => c.action === "releaseReservation"),
    ).toBeDefined();
    expect(
      reservations.calls.find((c) => c.action === "commitReservation"),
    ).toBeUndefined();
  });

  it("archive (clean zip) success: extracted bytes are charged against quota", async () => {
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    const cleanZip = await buildZipBuffer([
      { name: "data/results.csv", content: "x,y\n1,2\n" },
    ]);
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "archive" },
      { name: "artifact_name", value: "good.zip" },
      { name: "declared_size", value: cleanZip.length.toString() },
      { name: "file", filename: "good.zip", content: cleanZip },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(200);

    // Two reservations: one for the archive's declared bytes, one
    // for the extracted bytes (extracted accounting fix).
    const reserveCalls = reservations.calls.filter(
      (c) => c.action === "reserveBytes",
    );
    expect(reserveCalls).toHaveLength(2);
    expect(reserveCalls[0].bytes).toBe(BigInt(cleanZip.length));
    expect(reserveCalls[1].bytes).toBeGreaterThan(0n);
    const commitCalls = reservations.calls.filter(
      (c) => c.action === "commitReservation",
    );
    expect(commitCalls).toHaveLength(2);
    const success = audit.calls.find((c) => c.action === "worker.uploaded");
    expect(BigInt(String(success?.metadata?.bytes_committed))).toBe(
      BigInt(cleanZip.length) + (reserveCalls[1].bytes ?? 0n),
    );

    // The .extracted dir exists and has the file.
    const extractDir = join(
      storageRoot,
      "workspaces",
      WS_ID,
      "temp_runs",
      RUN_ID,
      "archive",
      "good.zip.extracted",
    );
    const extracted = await stat(join(extractDir, "data", "results.csv"));
    expect(extracted.isFile()).toBe(true);
  });

  it("archive commit failure: cleans up archive and extracted files", async () => {
    reservations = makeStubReservationService({
      quotaCap: 10_000_000n,
      rejectCommitReservationId: "res-2",
    });
    const app = buildApp({
      auditLogger: audit.logger,
      storageReservations: reservations.service,
    });
    const cleanZip = await buildZipBuffer([
      { name: "data/results.csv", content: "x,y\n1,2\n" },
    ]);
    const body = multipartBody([
      { name: "run_id", value: RUN_ID },
      { name: "artifact_kind", value: "archive" },
      { name: "artifact_name", value: "commit-fail.zip" },
      { name: "declared_size", value: cleanZip.length.toString() },
      { name: "file", filename: "commit-fail.zip", content: cleanZip },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...body.headers, "x-worker-token": tokenFor() },
      payload: body.payload,
    });
    expect(r.statusCode).toBe(403);
    const archivePath = join(
      storageRoot,
      "workspaces",
      WS_ID,
      "temp_runs",
      RUN_ID,
      "archive",
      "commit-fail.zip",
    );
    expect(existsSync(archivePath)).toBe(false);
    expect(existsSync(`${archivePath}.extracted`)).toBe(false);
    expect(
      reservations.calls.filter((c) => c.action === "commitReservation"),
    ).toHaveLength(2);
    expect(
      audit.calls.find((c) => c.action === "worker.upload_denied")?.metadata
        ?.denied_reason,
    ).toBe("quota_exceeded");
  });
});
