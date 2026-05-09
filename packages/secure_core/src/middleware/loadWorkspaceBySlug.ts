/**
 * `loadWorkspaceBySlug` — Phase 0.5 / Phase E2-rest (2026-05-09).
 *
 * Slug-keyed companion to ``loadWorkspace``. The workbench gateway
 * proxies requests at ``/api/:slug/...`` URLs where ``:slug`` is the
 * human-readable workspace name (``shared-public-experiments``,
 * ``private-deadbeef``) — NOT the internal UUID. This middleware
 * resolves the slug to a server-side workspace UUID + name, applying
 * the same v4 §4.4 uniform-404 contract as ``loadWorkspace``.
 *
 * The slug alphabet is ``[A-Za-z0-9_-]{3,64}`` — same as the username
 * regex in LOGIN_SCHEMA and the workspace_slug validator in
 * ``packages/core/src/simworkbench/paths/__init__.py``. Inputs outside
 * the alphabet collapse to the same 404 as a missing workspace.
 *
 * The gateway calls this BEFORE ``requireWorkspaceMembership`` so the
 * downstream membership check has a concrete `req.workspace.id` to
 * join against.
 */
import type { FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import { NotFoundError } from "../errors/shapes.js";
import { workspaces } from "../db/schema.js";
import type { SecureCorePool } from "../db/pool.js";

export interface LoadWorkspaceBySlugDeps {
  readonly pool: SecureCorePool;
  /**
   * Param key on `req.params` that holds the slug. Defaults to
   * ``"slug"`` (matches Fastify route patterns like ``/:slug/*``).
   */
  readonly slugParam?: string;
}

const DEFAULT_SLUG_PARAM = "slug";
const SLUG_RE = /^[A-Za-z0-9_-]{3,64}$/;
const UNIFORM_NOT_FOUND_MESSAGE = "Not found.";

function isSafeSlug(v: unknown): v is string {
  return typeof v === "string" && SLUG_RE.test(v);
}

export function loadWorkspaceBySlug(
  deps: LoadWorkspaceBySlugDeps,
): NamedMiddleware {
  const { pool } = deps;
  const slugKey = deps.slugParam ?? DEFAULT_SLUG_PARAM;

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    const params = req.params as Record<string, string | undefined>;
    const slug = params?.[slugKey];

    // Malformed-slug inputs collapse into the same uniform 404 as
    // "workspace doesn't exist" or "you're not a member".
    if (!isSafeSlug(slug)) {
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
        and(eq(workspaces.name, slug), isNull(workspaces.deletedAt)),
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
