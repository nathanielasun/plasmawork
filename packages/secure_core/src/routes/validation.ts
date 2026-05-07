/**
 * Route-local validation helpers for Layer 4.
 *
 * Fastify's `schema.body` hook runs before `preHandler`, which means it can
 * reject requests before L2.3's forbidden-body scan emits the required
 * `request.unexpected_field` audit row. Body schemas for protected endpoints
 * therefore run through these helpers inside the canonical §6.2
 * `validateInputSchema` slot.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuditLogger } from "../audit/logger.js";
import { InputInvalidError } from "../errors/shapes.js";
import type { NamedMiddleware } from "../middleware/compose.js";
import { validateInputSchema } from "../middleware/validateInputSchema.js";

export function bodyValidation(
  schema: object,
  auditLogger: AuditLogger,
): NamedMiddleware {
  return validateInputSchema(schema, { auditLogger });
}

export function bodyValidationWithApprovalRequest(
  schema: object,
  auditLogger: AuditLogger,
): NamedMiddleware {
  const base = validateInputSchema(schema, { auditLogger });

  return {
    name: "validateInputSchema",
    handler: async (
      req: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      await base.handler(req, reply);
      const body = req.body as { approval_request_id?: unknown } | undefined;
      const approvalRequestId = body?.approval_request_id;
      if (
        typeof approvalRequestId !== "string" ||
        approvalRequestId.length === 0
      ) {
        throw new InputInvalidError("approval_request_id is required.", {
          field: "approval_request_id",
        });
      }
      (req.params as Record<string, unknown>).approvalRequestId =
        approvalRequestId;
    },
  };
}
