/**
 * `enforceObjectWorkspaceScope` — Phase 0.5 Layer 2 / L2.7.
 *
 * Implements v4 §10's object-scope check: when a route URL names BOTH a
 * workspace and a workspace-scoped object (capsule, run, tool, artifact,
 * approval request), the object's `workspace_id` MUST match the URL's
 * `:workspaceId`. Cross-workspace probes ("guess a UUID and append it to
 * /workspaces/X/capsules/...") MUST collapse into the same uniform 404
 * as a missing workspace per v4 §4.4 — no distinguishing message, no
 * timing leak.
 *
 * The middleware does not attach any context. Handlers re-fetch the
 * object themselves (the upstream membership/capability check has
 * already validated the caller's right to see this workspace's data;
 * the handler's own SELECT pulls the columns it needs).
 *
 * Param naming is per-route — capsule routes use `:capsuleId`, run
 * routes use `:runId`, etc. — so the factory takes both the kind and
 * the URL param name. The kind selects the table; the param name selects
 * the URL slug.
 */

import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import { NotFoundError } from "../errors/shapes.js";
import {
  approvalRequests,
  artifactFiles,
  capsules,
  simulationRuns,
  tools,
} from "../db/schema.js";
import type { SecureCorePool } from "../db/pool.js";

export type ObjectScopeKind =
  | "capsule"
  | "run"
  | "tool"
  | "artifact"
  | "approval_request";

export interface EnforceObjectScopeDeps {
  readonly pool: SecureCorePool;
  readonly objectKind: ObjectScopeKind;
  /** URL param name carrying the object's UUID v4. e.g. `"capsuleId"`. */
  readonly paramName: string;
}

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_RE.test(v);
}

const UNIFORM_NOT_FOUND_MESSAGE = "Not found.";

async function selectObjectWorkspaceId(
  pool: SecureCorePool,
  kind: ObjectScopeKind,
  objectId: string,
): Promise<string | null> {
  switch (kind) {
    case "capsule": {
      const rows = await pool.db
        .select({ workspaceId: capsules.workspaceId })
        .from(capsules)
        .where(eq(capsules.id, objectId))
        .limit(1);
      return rows[0]?.workspaceId ?? null;
    }
    case "run": {
      const rows = await pool.db
        .select({ workspaceId: simulationRuns.workspaceId })
        .from(simulationRuns)
        .where(eq(simulationRuns.id, objectId))
        .limit(1);
      return rows[0]?.workspaceId ?? null;
    }
    case "tool": {
      const rows = await pool.db
        .select({ workspaceId: tools.workspaceId })
        .from(tools)
        .where(eq(tools.id, objectId))
        .limit(1);
      // `tools.workspaceId` is nullable for platform-wide tools. A
      // platform-wide tool is NOT scoped to any workspace and so cannot
      // satisfy a workspace-scoped URL — collapse to uniform 404.
      const row = rows[0];
      if (row === undefined) return null;
      return row.workspaceId ?? null;
    }
    case "artifact": {
      const rows = await pool.db
        .select({ workspaceId: artifactFiles.workspaceId })
        .from(artifactFiles)
        .where(eq(artifactFiles.id, objectId))
        .limit(1);
      return rows[0]?.workspaceId ?? null;
    }
    case "approval_request": {
      const rows = await pool.db
        .select({ workspaceId: approvalRequests.workspaceId })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, objectId))
        .limit(1);
      return rows[0]?.workspaceId ?? null;
    }
  }
}

export function enforceObjectWorkspaceScope(
  deps: EnforceObjectScopeDeps,
): NamedMiddleware {
  const { pool, objectKind, paramName } = deps;

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    if (!req.workspace) {
      // Programmer error — composeMiddleware ordering should have run
      // loadWorkspace first. Surface as INTERNAL_ERROR rather than
      // silently passing.
      throw new Error(
        "enforceObjectWorkspaceScope: req.workspace is missing. " +
          "Compose this middleware after loadWorkspace.",
      );
    }

    const params = req.params as Record<string, string | undefined>;
    const objectId = params?.[paramName];

    // Non-UUIDv4 inputs collapse to the same uniform 404 path. We do
    // not distinguish "malformed" from "not found" or "cross-workspace".
    if (!isUuidV4(objectId)) {
      throw new NotFoundError(UNIFORM_NOT_FOUND_MESSAGE);
    }

    const objectWorkspaceId = await selectObjectWorkspaceId(
      pool,
      objectKind,
      objectId,
    );

    // §4.4 unifies "object missing" with "object in another workspace":
    // both throw the same NotFoundError. Distinguishing here would leak
    // existence of objects in workspaces the caller is not a member of.
    if (
      objectWorkspaceId === null ||
      objectWorkspaceId !== req.workspace.id
    ) {
      throw new NotFoundError(UNIFORM_NOT_FOUND_MESSAGE);
    }
  };

  return { name: "enforceObjectWorkspaceScope", handler };
}
