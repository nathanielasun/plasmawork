/**
 * Worker token issuance route — Phase 0.5 Layer 4 task L4.11.
 *
 * v4 §18.1: each worker invocation receives a short-lived scoped
 * credential bound to ONE run id. The orchestrator service (NOT the
 * worker itself) calls this endpoint to mint that credential at the
 * moment a worker is dispatched. The worker presents the resulting
 * token to L3.9's `POST /api/workers/uploads`; verification happens
 * there via L3.8's `verifyWorkerToken`.
 *
 *   POST /internal/workers/runs/:runId/token
 *
 * Body (Ajv schema; `additionalProperties: false`):
 *
 *   { ttl_seconds?: number }   // optional override, capped at 1 hour
 *
 * The body NEVER carries `workspace_id`, `capsule_id`,
 * `capsule_version_id`, or `requested_by_user_id` — every one of those
 * is derived server-side from the `simulation_runs` row keyed by
 * `:runId`. v4 §19.1 + §4.1 forbid client-supplied server-derived
 * fields and L3.9's same hard rule extends here.
 *
 * Refusals:
 *
 *   - run not found       → NOT_FOUND        (404)
 *   - run terminal state  → VERSION_CONFLICT (409, refuses
 *                           completed/failed/cancelled/expired so a
 *                           late orchestrator request can't issue a
 *                           token for a run that has already finished
 *                           or been killed)
 *   - ttl_seconds > 3600  → INPUT_INVALID    (400)
 *   - missing capability  → PERMISSION_DENIED (403, via L2.6
 *                           requireCapability("worker:issue_token"))
 *
 * The raw token is exposed exactly once in the response body. The
 * server stores only the SHA-256 hash at audit time (never the raw
 * token); subsequent fetches by orchestrator have no way to retrieve
 * it. Worker tokens are opaque to the server post-issuance.
 *
 * Logging hygiene: the `token` response field is NEVER passed through
 * any logger. The route returns it in the reply body and otherwise
 * holds it only on the local stack; pino's serializers don't see it.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import {
  issueWorkerToken,
  type IssuedWorkerToken,
} from "./tokenIssuer.js";
import {
  RUN_TERMINAL_STATES,
  type RunState,
} from "../runs/stateMachine.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidation } from "../routes/validation.js";
import {
  NotFoundError,
  VersionConflictError,
  InputInvalidError,
  SecureCoreError,
} from "../errors/shapes.js";

/** Hard cap. v4 §18.1: short-lived; matches `tokenIssuer` default. */
const MAX_TTL_SECONDS = 3600;

/** UUID v4 regex — same shape as the other L4 routes. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

/**
 * Server-side run lookup. The route depends ONLY on this narrow
 * surface so a production wiring can reuse the L3.6 state-machine's
 * pool while the test suite injects a pure stub.
 *
 * If L4.3's `RunQueryService` lands later, that service implements
 * this interface trivially (or this interface is replaced by it in a
 * single rename commit). The shape here is deliberately the smallest
 * thing the route needs: no list/page methods, no joins.
 */
export interface WorkerTokenRunRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly capsuleId: string;
  readonly capsuleVersionId: string;
  readonly requestedByUserId: string;
  readonly status: RunState;
}

export interface RunRecordSource {
  /**
   * Returns the run row (or `null` if no row matches). MUST NOT throw
   * for the not-found case — the route maps `null` to a NOT_FOUND
   * envelope. Errors thrown here propagate as 500 INTERNAL_ERROR.
   */
  fetchById(runId: string): Promise<WorkerTokenRunRecord | null>;
}

/**
 * Middleware bundle. Note the deliberate omission of `loadWorkspace`
 * and `enforceObjectWorkspaceScope`: the request body has NO
 * workspace_id, and the runId in the URL is not a workspace-scoped
 * resource path (the orchestrator is a system actor that operates
 * across workspaces). The workspace is derived server-side from the
 * run row via `runQueryService.fetchById` and pinned into the token.
 */
export interface WorkerTokenRouteMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  /** `worker:issue_token` capability-bound mw. */
  readonly requireWorkerIssueToken: NamedMiddleware;
}

export interface WorkerTokenRouteOptions {
  readonly workerHmacKey: Buffer;
  readonly runQueryService: RunRecordSource;
  readonly auditLogger: AuditLogger;
  readonly mw: WorkerTokenRouteMiddleware;
  /** Optional clock seam for tests. Forwarded to `issueWorkerToken`. */
  readonly now?: () => number;
}

/** Body shape — sole optional field is `ttl_seconds`. */
interface IssueTokenBody {
  ttl_seconds?: number;
}

const ISSUE_TOKEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ttl_seconds: {
      type: "integer",
      minimum: 1,
      // Schema cap mirrors the application cap so a malformed value
      // never reaches the issuer. The application also re-checks
      // (defense in depth — see handler).
      maximum: MAX_TTL_SECONDS,
    },
  },
} as const;

/**
 * Fastify plugin. Registers `POST /internal/workers/runs/:runId/token`.
 * The plugin assumes the host app's error handler maps `SecureCoreError`
 * subclasses through `toHttpResponse`.
 */
export const workerTokenRoute: FastifyPluginAsync<
  WorkerTokenRouteOptions
> = async (app: FastifyInstance, opts) => {
  const { mw } = opts;
  const validateIssueToken = bodyValidation(
    ISSUE_TOKEN_SCHEMA,
    opts.auditLogger,
  );

  app.post<{
    Params: { runId: string };
    Body: IssueTokenBody;
  }>(
    "/internal/workers/runs/:runId/token",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateIssueToken,
        mw.attachAuditActor,
        mw.requireWorkerIssueToken,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }

      const runId = assertUuid(req.params.runId, "runId");

      // Application-level TTL cap (defense in depth on top of the Ajv
      // schema). A malformed runtime value still gets refused as an
      // INPUT_INVALID 400 rather than a generic 500.
      const ttlSeconds = req.body.ttl_seconds ?? MAX_TTL_SECONDS;
      if (
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds <= 0 ||
        ttlSeconds > MAX_TTL_SECONDS
      ) {
        throw new InputInvalidError("ttl_seconds out of range.", {
          ttl_seconds: ttlSeconds,
          max: MAX_TTL_SECONDS,
        });
      }

      const run = await opts.runQueryService.fetchById(runId);
      if (run === null) {
        throw new NotFoundError("Run not found.", { run_id: runId });
      }

      // Refuse terminal states. v4 §14: completed / failed / cancelled
      // / expired runs cannot accept new worker activity, so issuing a
      // token would be useless and would broaden the attack surface
      // (a late orchestrator dispatch could mint credentials for a
      // run that the user already cancelled). 409 VERSION_CONFLICT
      // mirrors the L3.6 transition-rejection envelope.
      if (RUN_TERMINAL_STATES.has(run.status)) {
        throw new VersionConflictError(
          "Run is in a terminal state; token cannot be issued.",
          { run_status: run.status },
        );
      }

      const issued: IssuedWorkerToken = issueWorkerToken({
        hmacKey: opts.workerHmacKey,
        run: {
          id: run.id,
          workspaceId: run.workspaceId,
          capsuleId: run.capsuleId,
          capsuleVersionId: run.capsuleVersionId,
          requestedByUserId: run.requestedByUserId,
        },
        ttlSeconds,
        now: opts.now,
      });

      // Audit AFTER issuance succeeds. The `tokenHash` is allowlisted
      // metadata; the raw `token` is NOT — it never passes through
      // the audit logger nor any other log surface. The orchestrator
      // (`actorType: "human"` or `"operator"` per req.auth) is the
      // accountable principal.
      await opts.auditLogger.write({
        workspaceId: run.workspaceId,
        actorUserId: req.auth.userId,
        actorType: req.auth.actorType === "unauthenticated" ? "operator" : req.auth.actorType,
        action: "worker.token_issued",
        objectType: "run",
        objectId: run.id,
        result: "succeeded",
        requestId: req.requestId,
        metadata: {
          token_hash: issued.tokenHash,
          ttl_seconds: ttlSeconds.toString(),
        },
      });

      // RFC 3339 timestamp, computed from the (unix-seconds) claim.
      const expiresAt = new Date(issued.claims.expires_at * 1000).toISOString();

      // The token is in the reply body ONLY. Do NOT log it, do NOT
      // attach it to req, do NOT include it in audit metadata.
      return reply.code(200).send({
        token: issued.raw,
        expires_at: expiresAt,
      });
    },
  );
};
