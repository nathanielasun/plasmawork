/**
 * Tool service — Phase 0.5 Layer 4 task L4.4.
 *
 * Backs the v4 §10.2 tool endpoints:
 *
 *   GET    /workspaces/:workspaceId/tools                          listForWorkspace
 *   POST   /workspaces/:workspaceId/tools                          createTool
 *   GET    /workspaces/:workspaceId/tools/:toolId                  getTool
 *   PATCH  /workspaces/:workspaceId/tools/:toolId                  updateTool
 *   POST   /workspaces/:workspaceId/tools/:toolId/promote-request  requestPromotion
 *
 * v4 §10.3 — listForWorkspace returns workspace-owned tools UNION
 * global trusted tools (`workspace_id IS NULL AND status = 'trusted'`).
 *
 * v4 §17 — promote-to-`trusted` is a high-risk action gated through
 * the L4.6 approval-decide endpoint. This service exposes
 * `requestPromotion` only — it inserts a `tool_promotion_requests`
 * row with status='pending'. The actual status flip from
 * `candidate`/`validated` -> `trusted` happens through the
 * approval-decide flow that consumes a single-use approval token.
 *
 * Hard rules:
 *   - Status transitions to 'trusted' or 'validated' through the
 *     PATCH path are REFUSED. Those go through promote-request +
 *     approval-decide. (Plan §17.)
 *   - The service NEVER reads `actor*` / `created_by` from anywhere
 *     except the caller's `actorUserId` argument.
 */

import { randomUUID } from "node:crypto";

import type { SecureCorePool } from "../db/pool.js";
import type { AuditLogger } from "../audit/logger.js";
import { NotFoundError, SecureCoreError } from "../errors/shapes.js";

export interface ToolRow {
  id: string;
  workspace_id: string | null;
  name: string;
  status: string;
  created_by: string;
  created_at: Date;
}

export interface ToolWithVersionRow extends ToolRow {
  current_version: ToolVersionRow | null;
}

export interface ToolVersionRow {
  id: string;
  tool_id: string;
  workspace_id: string | null;
  version_number: number;
  content_hash: string;
  storage_path: string;
  created_by: string;
  created_at: Date;
}

export interface ToolPromotionRequestRow {
  id: string;
  workspace_id: string;
  tool_id: string;
  requested_by: string;
  status: string;
  decided_by: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface ToolServiceOptions {
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
}

export interface CreateToolOptions {
  readonly workspaceId: string;
  readonly name: string;
  readonly contentHash: string;
  readonly storagePath: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface UpdateToolOptions {
  readonly workspaceId: string;
  readonly toolId: string;
  readonly name?: string;
  readonly status?: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface RequestPromotionOptions {
  readonly workspaceId: string;
  readonly toolId: string;
  readonly targetStatus: "candidate" | "validated" | "trusted";
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * Statuses the PATCH path may NOT land on. Promotion to validated/
 * trusted is a high-risk workflow (v4 §17) — the route uses
 * promote-request + approval-decide instead. Direct PATCH is
 * refused with INPUT_INVALID + `{ reason: "use_promote_request" }`.
 */
const PATCH_FORBIDDEN_STATUSES = new Set<string>(["validated", "trusted"]);

/** Statuses the schema CHECK constraint allows. */
const ALLOWED_STATUSES = new Set<string>([
  "draft",
  "candidate",
  "validated",
  "trusted",
  "deprecated",
]);

/** Statuses the PATCH path is allowed to set (subset of ALLOWED). */
const PATCH_ALLOWED_STATUSES = new Set<string>([
  "draft",
  "candidate",
  "deprecated",
]);

export class ToolService {
  readonly #pool: SecureCorePool;
  readonly #auditLogger: AuditLogger;

  public constructor(opts: ToolServiceOptions) {
    this.#pool = opts.pool;
    this.#auditLogger = opts.auditLogger;
  }

  /**
   * v4 §10.3 — list tools visible to a workspace member: every
   * workspace-owned tool plus every global trusted tool.
   */
  public async listForWorkspace(
    workspaceId: string,
  ): Promise<readonly ToolRow[]> {
    const sqlClient = this.#pool.sql;
    const rows = await sqlClient<
      Array<{
        id: string;
        workspace_id: string | null;
        name: string;
        status: string;
        created_by: string;
        created_at: Date;
      }>
    >`
      SELECT id, workspace_id, name, status, created_by, created_at
      FROM tools
      WHERE deleted_at IS NULL
        AND (
          workspace_id = ${workspaceId}
          OR (workspace_id IS NULL AND status = 'trusted')
        )
      ORDER BY created_at ASC
    `;
    return rows;
  }

  /**
   * Get a single tool with its current (highest version_number) row.
   * Honors the §10.3 carve-out: a global trusted tool is visible to
   * any workspace member regardless of the URL's workspaceId. Any
   * other cross-workspace read returns NotFoundError (uniform 404).
   */
  public async getTool(
    workspaceId: string,
    toolId: string,
  ): Promise<ToolWithVersionRow> {
    const sqlClient = this.#pool.sql;
    const toolRows = await sqlClient<
      Array<{
        id: string;
        workspace_id: string | null;
        name: string;
        status: string;
        created_by: string;
        created_at: Date;
      }>
    >`
      SELECT id, workspace_id, name, status, created_by, created_at
      FROM tools
      WHERE id = ${toolId}
        AND deleted_at IS NULL
        AND (
          workspace_id = ${workspaceId}
          OR (workspace_id IS NULL AND status = 'trusted')
        )
      LIMIT 1
    `;
    if (toolRows.length === 0) {
      throw new NotFoundError("Tool not found.", {
        workspace_id: workspaceId,
        tool_id: toolId,
      });
    }
    const tool = toolRows[0];

    const versionRows = await sqlClient<
      Array<{
        id: string;
        tool_id: string;
        workspace_id: string | null;
        version_number: number;
        content_hash: string;
        storage_path: string;
        created_by: string;
        created_at: Date;
      }>
    >`
      SELECT id, tool_id, workspace_id, version_number, content_hash,
             storage_path, created_by, created_at
      FROM tool_versions
      WHERE tool_id = ${toolId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    return {
      ...tool,
      current_version: versionRows.length === 0 ? null : versionRows[0],
    };
  }

  /**
   * Create a workspace-scoped tool at status='draft'. Inserts the
   * `tools` row + the initial `tool_versions` row (version 1) in a
   * single tx. Audit: `tool.created`.
   */
  public async createTool(opts: CreateToolOptions): Promise<ToolRow> {
    if (typeof opts.name !== "string" || opts.name.trim().length === 0) {
      throw new SecureCoreError("INPUT_INVALID", "Tool name is required.");
    }
    if (opts.name.length > 200) {
      throw new SecureCoreError("INPUT_INVALID", "Tool name too long.");
    }
    if (
      typeof opts.contentHash !== "string" ||
      opts.contentHash.trim().length === 0
    ) {
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Tool content_hash is required.",
      );
    }
    if (
      typeof opts.storagePath !== "string" ||
      opts.storagePath.trim().length === 0
    ) {
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Tool storage_path is required.",
      );
    }

    const sqlClient = this.#pool.sql;
    const toolId = randomUUID();
    const versionId = randomUUID();
    const created: ToolRow = await sqlClient.begin(async (tx) => {
      const inserted = await tx<
        Array<{
          id: string;
          workspace_id: string | null;
          name: string;
          status: string;
          created_by: string;
          created_at: Date;
        }>
      >`
        INSERT INTO tools (id, workspace_id, name, status, created_by)
        VALUES (${toolId}, ${opts.workspaceId}, ${opts.name},
                'draft', ${opts.actorUserId})
        RETURNING id, workspace_id, name, status, created_by, created_at
      `;
      await tx`
        INSERT INTO tool_versions
          (id, tool_id, workspace_id, version_number, content_hash,
           storage_path, created_by)
        VALUES (${versionId}, ${toolId}, ${opts.workspaceId}, 1,
                ${opts.contentHash}, ${opts.storagePath}, ${opts.actorUserId})
      `;
      return inserted[0];
    });

    await this.#auditLogger.write({
      workspaceId: opts.workspaceId,
      actorUserId: opts.actorUserId,
      actorType: "human",
      action: "tool.created",
      result: "succeeded",
      objectType: "tool",
      objectId: created.id,
      requestId: opts.requestId,
    });
    return created;
  }

  /**
   * Update a tool's name and/or status. REFUSES status transitions
   * onto 'trusted' or 'validated' — those flow through promote-request
   * + approval-decide per v4 §17. Refusal surfaces as INPUT_INVALID
   * with `{ reason: "use_promote_request" }` so callers know the
   * correct path.
   *
   * Audit: `tool.updated` (and `tool.deprecated` when status flips
   * to 'deprecated').
   */
  public async updateTool(opts: UpdateToolOptions): Promise<ToolRow> {
    if (opts.name === undefined && opts.status === undefined) {
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Update requires at least one of: name, status.",
      );
    }
    if (opts.name !== undefined) {
      if (typeof opts.name !== "string" || opts.name.trim().length === 0) {
        throw new SecureCoreError("INPUT_INVALID", "Tool name is required.");
      }
      if (opts.name.length > 200) {
        throw new SecureCoreError("INPUT_INVALID", "Tool name too long.");
      }
    }
    if (opts.status !== undefined) {
      if (!ALLOWED_STATUSES.has(opts.status)) {
        throw new SecureCoreError("INPUT_INVALID", "Unknown tool status.");
      }
      if (PATCH_FORBIDDEN_STATUSES.has(opts.status)) {
        throw new SecureCoreError(
          "INPUT_INVALID",
          "Use promote-request for validated/trusted transitions.",
          { reason: "use_promote_request" },
        );
      }
      if (!PATCH_ALLOWED_STATUSES.has(opts.status)) {
        // Defence-in-depth: any future status not explicitly in the
        // PATCH-allowed set is refused too.
        throw new SecureCoreError(
          "INPUT_INVALID",
          "Status not permitted via PATCH.",
        );
      }
    }

    const sqlClient = this.#pool.sql;
    const updated: ToolRow = await sqlClient.begin(async (tx) => {
      // Refuse PATCH against global trusted tools — those need
      // platform-level capability per v4 §10.3. The route already
      // requires workspace membership, so the only way to land here
      // is a global tool surfaced via §10.3 read carve-out. Treat
      // as 404 (workspace-scoped PATCH simply doesn't see it).
      const currentRows = await tx<
        Array<{
          id: string;
          workspace_id: string | null;
          name: string;
          status: string;
          created_by: string;
          created_at: Date;
        }>
      >`
        SELECT id, workspace_id, name, status, created_by, created_at
        FROM tools
        WHERE id = ${opts.toolId}
          AND workspace_id = ${opts.workspaceId}
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (currentRows.length === 0) {
        throw new NotFoundError("Tool not found.", {
          workspace_id: opts.workspaceId,
          tool_id: opts.toolId,
        });
      }

      const newName = opts.name ?? currentRows[0].name;
      const newStatus = opts.status ?? currentRows[0].status;

      const result = await tx<
        Array<{
          id: string;
          workspace_id: string | null;
          name: string;
          status: string;
          created_by: string;
          created_at: Date;
        }>
      >`
        UPDATE tools
        SET name = ${newName}, status = ${newStatus}
        WHERE id = ${opts.toolId}
          AND workspace_id = ${opts.workspaceId}
          AND deleted_at IS NULL
        RETURNING id, workspace_id, name, status, created_by, created_at
      `;
      return result[0];
    });

    if (opts.status === "deprecated") {
      await this.#auditLogger.write({
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
        actorType: "human",
        action: "tool.deprecated",
        result: "succeeded",
        objectType: "tool",
        objectId: updated.id,
        requestId: opts.requestId,
      });
    } else {
      await this.#auditLogger.write({
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
        actorType: "human",
        action: "tool.updated",
        result: "succeeded",
        objectType: "tool",
        objectId: updated.id,
        requestId: opts.requestId,
      });
    }
    return updated;
  }

  /**
   * Insert a `tool_promotion_requests` row at status='pending'. This
   * does NOT flip the tool's status — the L4.6 approval-decide
   * endpoint, gated by a single-use high-risk approval token, is the
   * mutation boundary that does the eventual flip.
   *
   * Audit: `tool.promotion_requested`.
   */
  public async requestPromotion(
    opts: RequestPromotionOptions,
  ): Promise<ToolPromotionRequestRow> {
    if (
      opts.targetStatus !== "candidate" &&
      opts.targetStatus !== "validated" &&
      opts.targetStatus !== "trusted"
    ) {
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Promotion target_status must be candidate, validated, or trusted.",
      );
    }

    const sqlClient = this.#pool.sql;
    const inserted: ToolPromotionRequestRow = await sqlClient.begin(
      async (tx) => {
        // Confirm the tool exists in this workspace (and is not a
        // global tool — global tool promotion needs platform-level
        // capability per §10.3).
        const toolRows = await tx<{ id: string }[]>`
          SELECT id
          FROM tools
          WHERE id = ${opts.toolId}
            AND workspace_id = ${opts.workspaceId}
            AND deleted_at IS NULL
          LIMIT 1
        `;
        if (toolRows.length === 0) {
          throw new NotFoundError("Tool not found.", {
            workspace_id: opts.workspaceId,
            tool_id: opts.toolId,
          });
        }

        const requestId = randomUUID();
        const rows = await tx<
          Array<{
            id: string;
            workspace_id: string;
            tool_id: string;
            requested_by: string;
            status: string;
            decided_by: string | null;
            created_at: Date;
            decided_at: Date | null;
          }>
        >`
          INSERT INTO tool_promotion_requests
            (id, workspace_id, tool_id, requested_by, status)
          VALUES (${requestId}, ${opts.workspaceId}, ${opts.toolId},
                  ${opts.actorUserId}, 'pending')
          RETURNING id, workspace_id, tool_id, requested_by, status,
                    decided_by, created_at, decided_at
        `;
        return rows[0];
      },
    );

    await this.#auditLogger.write({
      workspaceId: opts.workspaceId,
      actorUserId: opts.actorUserId,
      actorType: "human",
      action: "tool.promotion_requested",
      result: "succeeded",
      objectType: "tool",
      objectId: opts.toolId,
      requestId: opts.requestId,
      metadata: { target_status: opts.targetStatus },
    });
    return inserted;
  }
}
