/**
 * Audit-events + provenance-events read routes — Phase 0.5 Layer 4
 * task L4.7.
 *
 * v4 §10.2:
 *
 *   GET /workspaces/:workspaceId/audit-events
 *   GET /workspaces/:workspaceId/provenance-events
 *
 * Both endpoints gate on the `audit:read` capability per v4 §12.1.3 +
 * §13. The audit-read role separation is enforced INSIDE the service
 * (the service constructor refuses any pool whose role is not
 * `audit_read`); this route plugin is responsible only for the HTTP
 * surface — auth, capability check, query-string validation, cursor
 * encoding, and shaping the response envelope.
 *
 * Read endpoints skip CSRF (idempotent) and `requireApprovalIfHighRisk`
 * (no high-risk action). The middleware bundle matches L4.1's
 * GET /members shape exactly: requireAuth → attachAuditActor →
 * loadWorkspace → enforceUniformNotFound → requireWorkspaceMembership →
 * requireAuditRead.
 *
 * Cursor encoding: the wire format is base64 of a JSON object
 * `{ created_at: ISO8601, id: UUID }`. Decoding failures map to
 * INPUT_INVALID (400), never to "we'll just ignore the cursor and start
 * over" — silently dropping a cursor would give the caller a duplicate
 * page they already saw.
 *
 * The route NEVER reads `actor`, `actor_user_id`, `user_id`, or any
 * privilege claim from the request body or query string — `req.body`
 * is not even consulted. v4 §4.1.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
} from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import {
  InputInvalidError,
  NotFoundError,
} from "../errors/shapes.js";
import type { AuditReadService, KeysetCursor } from "../audit/readService.js";

export interface AuditEventsRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** `audit:read` capability-bound mw (v4 §12.1.3 / §13). */
  readonly requireAuditRead: NamedMiddleware;
}

export interface AuditEventsRoutesOptions {
  readonly service: AuditReadService;
  readonly mw: AuditEventsRoutesMiddleware;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Ajv schema for the `?limit=&cursor=` query string.
 *
 * `additionalProperties: false` so unknown query keys are rejected
 * with INPUT_INVALID per v4 §4.1. Query params arrive as raw strings
 * (Fastify's default querystring parser does not coerce types), and
 * the test apps use Ajv with `coerceTypes: false` to keep body
 * validation strict. We declare the schema as strings with a numeric
 * `pattern` for `limit` and parse the value in the handler;
 * `parseLimit()` raises INPUT_INVALID for out-of-range values rather
 * than silently clamping, so the caller's pagination math agrees with
 * the server's.
 */
const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[0-9]{1,4}$" },
    cursor: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

interface ListQuery {
  limit?: string;
  cursor?: string;
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

/**
 * Decode the wire-format keyset cursor. Failure modes map to
 * INPUT_INVALID with a stable detail key so the caller can recognize
 * "I sent a malformed cursor" without parsing the message.
 */
function decodeCursor(raw: string): KeysetCursor {
  let json: string;
  try {
    json = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new InputInvalidError("Cursor decode failed.", {
      field: "cursor",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InputInvalidError("Cursor JSON parse failed.", {
      field: "cursor",
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
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

function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64");
}

/**
 * Parse the `?limit=` query param (already string-shape per the schema
 * regex). Out-of-range values raise INPUT_INVALID — silently clamping
 * a request that asked for `limit=500` to 200 would surprise the
 * caller, since their pagination math would then disagree with the
 * server's.
 */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
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

export const auditEventsRoutes: FastifyPluginAsync<
  AuditEventsRoutesOptions
> = async (app: FastifyInstance, opts) => {
  const { service, mw } = opts;

  const readChain = composeMiddleware([
    mw.requireAuth,
    mw.attachAuditActor,
    mw.loadWorkspace,
    mw.enforceUniformNotFound,
    mw.requireWorkspaceMembership,
    mw.requireAuditRead,
  ]);

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/audit-events
  // -------------------------------------------------------------------
  app.get<{
    Params: { workspaceId: string };
    Querystring: ListQuery;
  }>(
    "/workspaces/:workspaceId/audit-events",
    {
      schema: { querystring: QUERY_SCHEMA },
      preHandler: readChain,
    },
    async (req) => {
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const limit = parseLimit(req.query.limit);
      const cursor =
        req.query.cursor !== undefined
          ? decodeCursor(req.query.cursor)
          : undefined;
      const result = await service.listAuditEvents(workspaceId, {
        limit,
        cursor,
      });
      const body: {
        events: typeof result.rows;
        next_cursor?: string;
      } = { events: result.rows };
      if (result.nextCursor !== null) {
        body.next_cursor = encodeCursor(result.nextCursor);
      }
      return body;
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/provenance-events
  // -------------------------------------------------------------------
  app.get<{
    Params: { workspaceId: string };
    Querystring: ListQuery;
  }>(
    "/workspaces/:workspaceId/provenance-events",
    {
      schema: { querystring: QUERY_SCHEMA },
      preHandler: readChain,
    },
    async (req) => {
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const limit = parseLimit(req.query.limit);
      const cursor =
        req.query.cursor !== undefined
          ? decodeCursor(req.query.cursor)
          : undefined;
      const result = await service.listProvenanceEvents(workspaceId, {
        limit,
        cursor,
      });
      const body: {
        events: typeof result.rows;
        next_cursor?: string;
      } = { events: result.rows };
      if (result.nextCursor !== null) {
        body.next_cursor = encodeCursor(result.nextCursor);
      }
      return body;
    },
  );
};
