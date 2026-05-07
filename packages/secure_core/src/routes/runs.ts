/**
 * Run routes — Phase 0.5 Layer 4 task L4.3.
 *
 * v4 §10.2 endpoints:
 *
 *   POST /workspaces/:workspaceId/capsules/:capsuleId/runs   (run:create)
 *   GET  /workspaces/:workspaceId/runs                       (membership)
 *   GET  /workspaces/:workspaceId/runs/:runId                (membership)
 *   POST /workspaces/:workspaceId/runs/:runId/cancel         (run:cancel)
 *
 * Capability mapping note: the v4 §13 capability literal-union has
 * `run:create` and `run:cancel` but NO `run:read`. The two GET
 * endpoints are gated by workspace membership only (mirroring
 * `GET /workspaces/:id/members` from L4.1 — also a read-of-workspace
 * resource without a dedicated capability). Adding `run:read` would
 * be an ADR-level change to `config/capabilities.ts` + every existing
 * role's permission seed; that is out of scope for L4.3.
 *
 * Read endpoints skip CSRF (idempotent). Write endpoints include the
 * full §6.2 chain via `composeMiddleware()`. Capability-bound
 * preHandlers are constructed by the registering app and passed in
 * through `RunRoutesMiddleware`.
 *
 * Hard rules upheld:
 *   - Routes never read actor identity (`actor`, `actor_user_id`,
 *     `created_by`, `requested_by`) from `req.body`. The actor is
 *     derived from the server-validated `req.auth.userId`.
 *   - Body schemas are `additionalProperties: false`; UUID path
 *     params are validated via `assertUuid`.
 *   - The cancel route looks up the run's CURRENT state, then asks the
 *     state machine to flip it to `cancel_requested` with that current
 *     state as `expectedFromState`. The conditional UPDATE inside the
 *     state machine is the race-safety net: if the state changed
 *     between our SELECT and the UPDATE, the UPDATE returns 0 rows and
 *     the state machine raises `VersionConflictError` (mapped to 409).
 *   - The create route validates the capsule via `queryService.
 *     getCapsuleForRunCreate` BEFORE calling `stateMachine.createRun`
 *     (defense-in-depth — the state machine trusts its inputs per
 *     L3.6 design).
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import {
  SecureCoreError,
  NotFoundError,
  VersionConflictError,
  InputInvalidError,
} from "../errors/shapes.js";
import {
  RUN_STATES,
  RUN_TERMINAL_STATES,
  isRunState,
  type RunStateMachine,
  type RunState,
} from "../runs/stateMachine.js";
import type {
  RunQueryService,
  RunKeysetCursor,
} from "../runs/queryService.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidation } from "./validation.js";

export interface RunRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** `run:create` capability-bound mw (POST create). */
  readonly requireRunCreate: NamedMiddleware;
  /** `run:cancel` capability-bound mw (POST cancel). */
  readonly requireRunCancel: NamedMiddleware;
}

export interface RunRoutesOptions {
  readonly stateMachine: RunStateMachine;
  readonly queryService: RunQueryService;
  readonly auditLogger: AuditLogger;
  readonly mw: RunRoutesMiddleware;
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

// ---------------------------------------------------------------------------
// Body / query schemas (additionalProperties: false everywhere)
// ---------------------------------------------------------------------------

interface CreateRunBody {
  backend: string;
  capsule_version_id?: string;
}

interface CancelRunBody {
  reason: string;
}

interface ListRunsQuery {
  status?: string;
  capsuleId?: string;
  limit?: string;
  cursor?: string;
}

const CREATE_RUN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["backend"],
  properties: {
    backend: { type: "string", enum: ["local"] },
    capsule_version_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const CANCEL_RUN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 1000 },
  },
} as const;

const LIST_RUNS_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", minLength: 1, maxLength: 100 },
    capsuleId: { type: "string", minLength: 1, maxLength: 100 },
    limit: { type: "string", pattern: "^[0-9]{1,4}$" },
    cursor: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode the wire-format keyset cursor (base64 of
 * `{ created_at: ISO8601, id: UUID }`). Failure modes map to
 * INPUT_INVALID — silently dropping the cursor would feed the caller a
 * page they already saw.
 */
function decodeCursor(raw: string): RunKeysetCursor {
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

function encodeCursor(cursor: RunKeysetCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64");
}

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

function parseStatus(raw: string | undefined): RunState | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRunState(raw)) {
    throw new InputInvalidError("status is not a valid run state.", {
      field: "status",
      allowed: RUN_STATES,
    });
  }
  return raw;
}

function parseCapsuleIdFilter(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!UUID_V4.test(raw)) {
    throw new InputInvalidError("capsuleId must be a UUID.", {
      field: "capsuleId",
    });
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { stateMachine, queryService, mw } = opts;
  const validateCreateRun = bodyValidation(CREATE_RUN_SCHEMA, opts.auditLogger);
  const validateCancelRun = bodyValidation(CANCEL_RUN_SCHEMA, opts.auditLogger);

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/capsules/:capsuleId/runs — create
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; capsuleId: string };
    Body: CreateRunBody;
  }>(
    "/workspaces/:workspaceId/capsules/:capsuleId/runs",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCreateRun,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireRunCreate,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.capsuleId, "capsuleId");

      // Defense-in-depth: validate the capsule exists in this workspace
      // and isn't soft-deleted before calling stateMachine.createRun.
      // Resolves the version (default = capsule.current_version_id;
      // refused if the body-supplied version doesn't belong to this
      // capsule) — see queryService.getCapsuleForRunCreate.
      const resolved = await queryService.getCapsuleForRunCreate({
        workspaceId: req.params.workspaceId,
        capsuleId: req.params.capsuleId,
        expectedVersionId: req.body.capsule_version_id,
      });

      const run = await stateMachine.createRun({
        workspaceId: req.params.workspaceId,
        capsuleId: resolved.capsuleId,
        capsuleVersionId: resolved.resolvedVersionId,
        backend: req.body.backend,
        requestedBy: req.auth.userId,
        requestId: req.requestId,
        // initialState defaults to "created" inside the state machine.
      });
      return reply.code(201).send({ run });
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/runs — list
  // -------------------------------------------------------------------
  app.get<{
    Params: { workspaceId: string };
    Querystring: ListRunsQuery;
  }>(
    "/workspaces/:workspaceId/runs",
    {
      schema: { querystring: LIST_RUNS_QUERY_SCHEMA },
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
      ]),
    },
    async (req) => {
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const limit = parseLimit(req.query.limit);
      const status = parseStatus(req.query.status);
      const capsuleId = parseCapsuleIdFilter(req.query.capsuleId);
      const cursor =
        req.query.cursor !== undefined
          ? decodeCursor(req.query.cursor)
          : undefined;
      const result = await queryService.listRuns(workspaceId, {
        limit,
        cursor,
        status,
        capsuleId,
      });
      const body: {
        runs: typeof result.rows;
        next_cursor?: string;
      } = { runs: result.rows };
      if (result.nextCursor !== null) {
        body.next_cursor = encodeCursor(result.nextCursor);
      }
      return body;
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/runs/:runId — read one
  // -------------------------------------------------------------------
  app.get<{ Params: { workspaceId: string; runId: string } }>(
    "/workspaces/:workspaceId/runs/:runId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
      ]),
    },
    async (req) => {
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.runId, "runId");
      const run = await queryService.getRunOrThrow(
        req.params.workspaceId,
        req.params.runId,
      );
      return { run };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/runs/:runId/cancel — cancel
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; runId: string };
    Body: CancelRunBody;
  }>(
    "/workspaces/:workspaceId/runs/:runId/cancel",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCancelRun,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireRunCancel,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.runId, "runId");

      // Read current state so we can pass it to the state machine as
      // `expectedFromState`. The conditional UPDATE inside the state
      // machine is the actual race protection — if status drifts
      // between this SELECT and the UPDATE, the state machine raises
      // VersionConflictError (mapped to 409).
      const currentState = await queryService.getRunStateForCancel(
        req.params.workspaceId,
        req.params.runId,
      );

      // Refuse early if the run is already in a terminal state. The
      // transition table inside the state machine would also refuse
      // (every terminal state has an empty outgoing-edge set), but
      // doing the check here gives the caller a precise 409
      // VERSION_CONFLICT instead of a 400 INPUT_INVALID for "illegal
      // transition" — the caller's intent is "cancel this", and from
      // their perspective the run advanced past the cancel window.
      if (RUN_TERMINAL_STATES.has(currentState)) {
        throw new VersionConflictError(
          "Run is already in a terminal state; cancel rejected.",
          {
            run_id: req.params.runId,
            actual_state: currentState,
          },
        );
      }

      // `cancel_requested` is itself non-terminal; if currentState is
      // already `cancel_requested` we'd ask the state machine to
      // transition `cancel_requested → cancel_requested`, which is not
      // in the legal-transition table. Surface that as 409 too — the
      // caller already requested cancel; nothing to do.
      if (currentState === "cancel_requested") {
        throw new VersionConflictError(
          "Run already has a cancel request in flight.",
          {
            run_id: req.params.runId,
            actual_state: currentState,
          },
        );
      }

      const actorType: "human" | "ai_agent" =
        req.auth.actorType === "ai_agent" ? "ai_agent" : "human";

      const run = await stateMachine.transition({
        runId: req.params.runId,
        workspaceId: req.params.workspaceId,
        expectedFromState: currentState,
        toState: "cancel_requested",
        actorUserId: req.auth.userId,
        actorType,
        requestId: req.requestId,
        cancellationReason: req.body.reason,
      });
      return { run };
    },
  );
};
