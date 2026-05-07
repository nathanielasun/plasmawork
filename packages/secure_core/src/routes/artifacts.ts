/**
 * Artifact routes — Phase 0.5 Layer 4 task L4.5.
 *
 * v4 §10.2 endpoints:
 *
 *   GET  /workspaces/:workspaceId/artifacts
 *   GET  /workspaces/:workspaceId/artifacts/:artifactId
 *   POST /workspaces/:workspaceId/artifacts/:artifactId/export
 *
 * Read endpoints skip CSRF (idempotent) and `requireApprovalIfHighRisk`.
 * The single-resource read additionally composes `enforceObjectWorkspaceScope`
 * bound to `"artifact"` (L2.7) so cross-workspace probes collapse into
 * the uniform 404 per v4 §4.4.
 *
 * The /export route is the v4 §17 high-risk action; the chain ends in
 * L2.9 `requireApprovalIfHighRisk` bound to `"artifact_export"`. The
 * approver capability for that action is `artifact:export` per
 * `HIGH_RISK_APPROVER_CAPABILITY`. The requester's capability is
 * `artifact:read` (the task plan reuses the read capability for the
 * request itself; the approval token is the privilege boundary).
 *
 * Keyset pagination: GET list mirrors L4.7's wire format — base64 of
 * `{ created_at: ISO8601, id: UUID }`. Decoding errors map to
 * INPUT_INVALID with `{ field: "cursor" }`.
 *
 * Hard rules upheld:
 *   - Routes never read `actor`, `actor_user_id`, `created_by`, or
 *     `requested_by` from `req.body` (v4 §19.1).
 *   - Body schemas are `additionalProperties: false`; UUID path
 *     params are validated via `assertUuid`.
 *   - The X-Approval-Token header is the only privilege carrier for
 *     the high-risk action (enforced by L2.9; never read by this
 *     plugin).
 *   - `expected_size_bytes` is integer, positive, and ≤ a configurable
 *     max (default 10 GiB); failures are INPUT_INVALID before any
 *     reservation is touched.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import {
  InputInvalidError,
  NotFoundError,
  SecureCoreError,
} from "../errors/shapes.js";
import type { HighRiskAction } from "../config/high_risk_actions.js";
import type {
  ArtifactKeysetCursor,
  ArtifactService,
} from "../artifacts/service.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidation } from "./validation.js";

/**
 * Default + max for `expected_size_bytes`. Spec §21 caps stored-byte
 * reservations at the workspace quota; here we additionally cap a
 * single export request at 10 GiB so a typo (`expected_size_bytes:
 * 1e18`) doesn't waste a counter slot. Configurable via
 * `ArtifactRoutesOptions.maxExportBytes`.
 */
export const DEFAULT_MAX_EXPORT_BYTES = 10 * 1024 ** 3;

/**
 * Middleware bundle the host composes into route preHandlers. Each
 * pre-bound `NamedMiddleware` is the already-constructed L2 layer
 * (e.g. `requireAuth(deps)`).
 *
 * The L2.9 factory is referenced (not pre-built) so the plugin binds
 * it to `"artifact_export"` at registration; this matches the L4.6
 * pattern.
 */
export interface ArtifactRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** L2.7 — bound to `objectKind: "artifact"`. */
  readonly enforceArtifactWorkspaceScope: NamedMiddleware;
  /** `artifact:read` capability-bound mw (list / read / request export). */
  readonly requireArtifactRead: NamedMiddleware;
  /**
   * L2.9 factory — the plugin calls it with `"artifact_export"` to
   * produce the action-bound mw for the export route. Mirrors L4.6's
   * approve-flow binding.
   */
  readonly requireApprovalIfHighRiskFactory: (
    action: HighRiskAction,
  ) => NamedMiddleware;
}

export interface ArtifactRoutesOptions {
  readonly service: ArtifactService;
  readonly auditLogger: AuditLogger;
  readonly mw: ArtifactRoutesMiddleware;
  /** Cap on `expected_size_bytes`. Default 10 GiB. */
  readonly maxExportBytes?: number;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

// ---------------------------------------------------------------------
// Body / query schemas — Ajv + additionalProperties: false (v4 §4.1).
// ---------------------------------------------------------------------

interface ListQuery {
  limit?: string;
  cursor?: string;
}

interface ExportArtifactBody {
  destination_uri: string;
  expected_size_bytes: number;
}

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[0-9]{1,4}$" },
    cursor: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

/**
 * `expected_size_bytes` is a JSON `integer`. Ajv's integer keyword
 * accepts numbers without a fractional part; we additionally check
 * positivity here. The configurable cap is enforced in the handler
 * (so a route registered with a custom `maxExportBytes` controls
 * its own ceiling without rebuilding the schema).
 */
const EXPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["destination_uri", "expected_size_bytes"],
  properties: {
    destination_uri: { type: "string", minLength: 1, maxLength: 2048 },
    expected_size_bytes: { type: "integer", minimum: 1 },
  },
} as const;

// ---------------------------------------------------------------------
// Cursor encode / decode — same wire format as L4.7.
// ---------------------------------------------------------------------

function decodeCursor(raw: string): ArtifactKeysetCursor {
  let json: string;
  try {
    json = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new InputInvalidError("Cursor decode failed.", { field: "cursor" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InputInvalidError("Cursor JSON parse failed.", {
      field: "cursor",
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputInvalidError("Cursor must be an object.", {
      field: "cursor",
    });
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.created_at !== "string" || typeof obj.id !== "string") {
    throw new InputInvalidError("Cursor missing required fields.", {
      field: "cursor",
    });
  }
  if (!UUID_V4.test(obj.id)) {
    throw new InputInvalidError("Cursor id is not a UUID.", {
      field: "cursor",
    });
  }
  const date = new Date(obj.created_at);
  if (Number.isNaN(date.getTime())) {
    throw new InputInvalidError("Cursor created_at is not a valid date.", {
      field: "cursor",
    });
  }
  return { createdAt: date, id: obj.id };
}

function encodeCursor(cursor: ArtifactKeysetCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64");
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new InputInvalidError("limit must be a positive integer.", {
      field: "limit",
    });
  }
  if (n > MAX_LIMIT) {
    throw new InputInvalidError(`limit must be <= ${MAX_LIMIT}.`, {
      field: "limit",
    });
  }
  return n;
}

export const artifactRoutes: FastifyPluginAsync<ArtifactRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;
  const maxExportBytes = opts.maxExportBytes ?? DEFAULT_MAX_EXPORT_BYTES;
  const validateExport = bodyValidation(EXPORT_SCHEMA, opts.auditLogger);

  // L2.9 is action-bound at registration time. The factory is called
  // once with `"artifact_export"`; the produced NamedMiddleware is then
  // composed with the §6.2 chain like any other middleware.
  const approvalIfHighRisk = mw.requireApprovalIfHighRiskFactory(
    "artifact_export",
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/artifacts — list
  // -------------------------------------------------------------------
  app.get<{
    Params: { workspaceId: string };
    Querystring: ListQuery;
  }>(
    "/workspaces/:workspaceId/artifacts",
    {
      schema: { querystring: QUERY_SCHEMA },
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireArtifactRead,
      ]),
    },
    async (req) => {
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const limit = parseLimit(req.query.limit);
      const cursor =
        req.query.cursor !== undefined
          ? decodeCursor(req.query.cursor)
          : undefined;
      const result = await service.listArtifacts(workspaceId, {
        limit,
        cursor,
      });
      const body: {
        artifacts: typeof result.rows;
        next_cursor?: string;
      } = { artifacts: result.rows };
      if (result.nextCursor !== null) {
        body.next_cursor = encodeCursor(result.nextCursor);
      }
      return body;
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/artifacts/:artifactId — read metadata
  // -------------------------------------------------------------------
  app.get<{
    Params: { workspaceId: string; artifactId: string };
  }>(
    "/workspaces/:workspaceId/artifacts/:artifactId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireArtifactRead,
        mw.enforceArtifactWorkspaceScope,
      ]),
    },
    async (req) => {
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const artifactId = assertUuid(req.params.artifactId, "artifactId");
      const row = await service.getArtifactOrThrow(workspaceId, artifactId);
      return { artifact: row };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/artifacts/:artifactId/export
  //   — high-risk action; X-Approval-Token enforced by L2.9.
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; artifactId: string };
    Body: ExportArtifactBody;
  }>(
    "/workspaces/:workspaceId/artifacts/:artifactId/export",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateExport,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireArtifactRead,
        mw.enforceArtifactWorkspaceScope,
        approvalIfHighRisk,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const artifactId = assertUuid(req.params.artifactId, "artifactId");

      // Belt-and-braces: Ajv already enforced `integer` + `minimum: 1`;
      // this is the configurable upper bound. INPUT_INVALID before any
      // reservation is touched.
      if (req.body.expected_size_bytes > maxExportBytes) {
        throw new InputInvalidError(
          `expected_size_bytes must be <= ${maxExportBytes}.`,
          { field: "expected_size_bytes", max: maxExportBytes },
        );
      }

      const result = await service.requestExport({
        workspaceId,
        artifactId,
        destinationUri: req.body.destination_uri,
        expectedSizeBytes: BigInt(req.body.expected_size_bytes),
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });

      return reply.code(201).send({
        export_id: result.exportId,
        reservation_id: result.reservationId,
        expires_at: result.expiresAt.toISOString(),
      });
    },
  );
};
