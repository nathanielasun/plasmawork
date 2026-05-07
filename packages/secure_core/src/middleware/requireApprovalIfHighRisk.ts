/**
 * `requireApprovalIfHighRisk` — Phase 0.5 Layer 2 task L2.9.
 *
 * The §6.2 chain's last preHandler. Routes that perform a v4 §17
 * high-risk action (capsule promotion, tool promotion, HPC run
 * approval, workspace deletion, etc.) declare the action and the
 * URL param carrying the parent approval-request id. This middleware:
 *
 *   1. Reads the raw token from the `X-Approval-Token` HEADER per
 *      v4 §16.1. The token MUST NOT appear in URL path / query string
 *      / request body — defense-in-depth grep refuses any of those.
 *   2. Calls `ApprovalService.consumeToken` (L3.3) which runs the
 *      §16.4 atomic SQL, recomputes `token_context_hash` per §16.3,
 *      and verifies the workspace-scoped approver constraint.
 *   3. On success, attaches the consumed token + request rows to
 *      `req.approvalToken` for the handler to inspect.
 *   4. On any rejection (token missing, in URL, mismatch, reuse,
 *      expiry, parent revoked, wrong consumer), audit emission
 *      happens BEFORE the throw — `ApprovalService` handles the
 *      consumption-side audit; this middleware emits
 *      `approval.required` only when the token is missing entirely.
 *
 * The action-string contract is the §13 capability map. The factory
 * validates `action ∈ HIGH_RISK_ACTIONS` synchronously at route
 * registration so a typo fails loud.
 */

import type { FastifyRequest } from "fastify";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import type { AuditLogger } from "../audit/logger.js";
import type {
  ApprovalRequestRow,
  ApprovalService,
  ApprovalTokenRow,
} from "../approvals/service.js";
import {
  HIGH_RISK_ACTION_SET,
  HIGH_RISK_APPROVER_CAPABILITY,
  type HighRiskAction,
} from "../config/high_risk_actions.js";
import {
  ApprovalRequiredError,
  ApprovalTokenInvalidError,
  SecureCoreError,
} from "../errors/shapes.js";

/** The header that carries the raw approval token (v4 §16.1). */
export const APPROVAL_TOKEN_HEADER = "x-approval-token";

/**
 * Patterns that indicate the caller put the approval token where it
 * MUST NOT be — URL path, query string, or anywhere else inspectable
 * via `req.url`. Case-insensitive substring match. Per v4 §16.1.
 */
const TOKEN_LEAK_PATTERNS = [
  "approval_token",
  "approvaltoken",
  "approval-token",
  "x_approval_token",
];

export interface RequireApprovalDeps {
  readonly action: HighRiskAction;
  readonly approvalService: ApprovalService;
  readonly auditLogger: AuditLogger;
  /** URL param carrying the approval-request id. Default `"approvalRequestId"`. */
  readonly requestIdParam?: string;
}

/** Result attached to the request on success. */
export interface ApprovalConsumeResult {
  readonly requestRow: ApprovalRequestRow;
  readonly tokenRow: ApprovalTokenRow;
}

function readHeader(req: FastifyRequest, name: string): string | null {
  const raw = req.headers[name];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
    return raw[0];
  }
  return null;
}

function pathOrQueryContainsToken(url: string | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  const lower = url.toLowerCase();
  for (const p of TOKEN_LEAK_PATTERNS) {
    if (lower.includes(p)) return true;
  }
  return false;
}

export function requireApprovalIfHighRisk(
  deps: RequireApprovalDeps,
): NamedMiddleware {
  if (!HIGH_RISK_ACTION_SET.has(deps.action)) {
    throw new Error(
      `requireApprovalIfHighRisk: '${deps.action}' is not a high-risk action. ` +
        `Add it to HIGH_RISK_ACTIONS in src/config/high_risk_actions.ts ` +
        `before guarding a route with it.`,
    );
  }
  const requiredCapability = HIGH_RISK_APPROVER_CAPABILITY[deps.action];
  const paramName = deps.requestIdParam ?? "approvalRequestId";

  const handler: MiddlewareHandler = async (req) => {
    // Defense-in-depth: token NEVER appears in URL path / query string.
    // Body fields are blocked by L2.3 forbidden-field scan; this catch
    // also fires if a caller put it in `req.url`.
    if (pathOrQueryContainsToken(req.url)) {
      await deps.auditLogger.write({
        workspaceId: req.workspace?.id ?? null,
        actorUserId: req.auth?.userId ?? null,
        actorType: req.audit?.actorType ?? "unauthenticated",
        action: "approval.required",
        result: "denied",
        requestId: req.requestId,
        metadata: {
          denied_reason: "token_in_url_or_query",
          capability: requiredCapability,
        },
      });
      throw new ApprovalRequiredError(
        "Approval token must be presented via the X-Approval-Token header.",
        { action: deps.action },
      );
    }

    const presented = readHeader(req, APPROVAL_TOKEN_HEADER);
    if (presented === null) {
      await deps.auditLogger.write({
        workspaceId: req.workspace?.id ?? null,
        actorUserId: req.auth?.userId ?? null,
        actorType: req.audit?.actorType ?? "unauthenticated",
        action: "approval.required",
        result: "denied",
        requestId: req.requestId,
        metadata: {
          denied_reason: "token_missing",
          capability: requiredCapability,
        },
      });
      throw new ApprovalRequiredError(
        "Approval token required for this action.",
        { action: deps.action },
      );
    }

    const params = req.params as Record<string, unknown> | undefined;
    const expectedRequestId =
      params && typeof params[paramName] === "string"
        ? (params[paramName] as string)
        : null;
    if (expectedRequestId === null) {
      // Programmer error — the route declared this middleware but didn't
      // include the param. Surface it loudly so route registration drift
      // doesn't masquerade as a security check.
      throw new SecureCoreError(
        "INTERNAL_ERROR",
        "requireApprovalIfHighRisk: missing approval-request URL param.",
        { paramName },
      );
    }

    if (req.auth === undefined) {
      // Should never happen — `requireAuth` runs earlier in the §6.2
      // chain. Defensive.
      throw new SecureCoreError(
        "UNAUTHENTICATED",
        "Approval consumption requires an authenticated request.",
      );
    }

    if (req.auth.actorType !== "human") {
      await deps.auditLogger.write({
        workspaceId: req.workspace?.id ?? null,
        actorUserId: req.auth.userId,
        actorType: req.auth.actorType,
        action: "approval.denied",
        result: "denied",
        requestId: req.requestId,
        metadata: {
          denied_reason: "agent_approver_not_allowed",
          capability: requiredCapability,
        },
      });
      throw new ApprovalTokenInvalidError(
        "Approval token must be consumed by a human approver.",
      );
    }

    // Membership join in L2.5 supplies the active role for THIS workspace
    // membership. Multi-role per workspace is not the current model;
    // pass the single role id through as a one-element array so the
    // service's role-bound branch can re-check workspace scope.
    const consumerRoleIds = req.membership?.roleId
      ? [req.membership.roleId]
      : [];

    const result = await deps.approvalService.consumeToken({
      presentedToken: presented,
      expectedRequestId,
      expectedAction: deps.action,
      consumerUserId: req.auth.userId,
      consumerRoleIds,
      requestId: req.requestId,
    });

    // Attach the consumed rows so the handler can read decision metadata
    // without re-querying. We avoid mutating the global FastifyRequest
    // declaration (kept in fastify_augment.ts for cross-cutting fields)
    // and use a per-route cast at the read site.
    (req as FastifyRequest & {
      approvalToken?: ApprovalConsumeResult;
    }).approvalToken = result;
  };

  return { name: "requireApprovalIfHighRisk", handler };
}
