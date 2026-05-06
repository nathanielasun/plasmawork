/**
 * `loadWorkspace` + `enforceUniformNotFound` — Phase 0.5 Layer 2 / L2.4.
 *
 * Implements the v4 §4.4 uniform-404 contract at the workspace boundary.
 * `loadWorkspace` resolves the URL-named `:workspaceId` to a server-side
 * `WorkspaceContext`. Every failure path in §4.4 — workspace not found,
 * soft-deleted, member-less, cross-workspace object, missing object —
 * returns the SAME `NotFoundError` so callers cannot distinguish via
 * timing or response shape.
 *
 * Layered enforcement:
 *
 *   - `loadWorkspace`: validates the param shape (UUID v4 per v4 §9.2),
 *     queries the workspaces table filtered by `deleted_at IS NULL`, and
 *     attaches `req.workspace` on success or throws `NotFoundError`.
 *
 *   - `enforceUniformNotFound`: a stateless guard that asserts
 *     `req.workspace` is present. If a route's `composeMiddleware`
 *     accidentally omits `loadWorkspace` upstream, this guard refuses
 *     the request with the same uniform 404 rather than letting a
 *     handler reach a workspace-less code path. The §4.4 invariant
 *     lives in this name.
 */

import type { FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import { NotFoundError } from "../errors/shapes.js";
import { workspaces } from "../db/schema.js";
import type { SecureCorePool } from "../db/pool.js";

export interface LoadWorkspaceDeps {
  readonly pool: SecureCorePool;
}

/** RFC 4122 UUID v4. v4 §9.2 pins the URL-param shape to v4 explicitly. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_RE.test(v);
}

/**
 * The single uniform-404 message. v4 §4.4 forbids surfacing whether the
 * workspace was missing, deleted, or simply not the caller's; the message
 * is constant so log / response inspection never reveals the cause.
 */
const UNIFORM_NOT_FOUND_MESSAGE = "Not found.";

export function loadWorkspace(deps: LoadWorkspaceDeps): NamedMiddleware {
  const { pool } = deps;

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    const params = req.params as Record<string, string | undefined>;
    const workspaceId = params?.workspaceId;

    // Non-UUIDv4 inputs collapse into the same uniform 404 path. We do
    // not distinguish "malformed" from "not found" in the response.
    if (!isUuidV4(workspaceId)) {
      throw new NotFoundError(UNIFORM_NOT_FOUND_MESSAGE);
    }

    const rows = await pool.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdBy: workspaces.createdBy,
      })
      .from(workspaces)
      .where(
        and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundError(UNIFORM_NOT_FOUND_MESSAGE);
    }

    req.workspace = {
      id: row.id,
      name: row.name,
      createdBy: row.createdBy,
    };
  };

  return { name: "loadWorkspace", handler };
}

/**
 * Stateless guard. If `loadWorkspace` ran successfully, `req.workspace`
 * is populated and this is a no-op. If a route's composition accidentally
 * skipped `loadWorkspace`, the guard refuses with the same uniform 404
 * so a misconfigured pipeline cannot leak access to a workspace-less
 * code path.
 */
const enforceUniformNotFoundHandler: MiddlewareHandler = async (
  req: FastifyRequest,
): Promise<void> => {
  if (!req.workspace) {
    throw new NotFoundError(UNIFORM_NOT_FOUND_MESSAGE);
  }
};

export const enforceUniformNotFound: NamedMiddleware = {
  name: "enforceUniformNotFound",
  handler: enforceUniformNotFoundHandler,
};
