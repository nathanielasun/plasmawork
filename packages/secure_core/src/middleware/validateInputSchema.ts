/**
 * `validateInputSchema` — Phase 0.5 Layer 2.
 *
 * Two defenses in one middleware:
 *
 *   1. v4 §4.1 forbidden-body scan. Independent of any route schema, the
 *      middleware refuses request bodies that contain server-derived
 *      fields (`actor`, `actor_user_id`, `user_id`, `created_by`,
 *      `updated_by`, `approved_by`, `workspace_id`, `status`,
 *      `storage_path`). These fields are derived from `req.auth`, the
 *      URL params, or an out-of-band approval token and MUST never be
 *      accepted from the body. The scan runs BEFORE the route's Ajv
 *      schema so even a non-strict schema catches them, and emits a
 *      `request.unexpected_field` audit row before the 400 returns.
 *
 *   2. JSON Schema validation via Ajv. The route hands the middleware a
 *      JSON Schema (Ajv-compatible). The schema is compiled once and
 *      cached by reference — passing the same schema object on later
 *      calls reuses the compiled validator. `additionalProperties:
 *      false` is the expected default in route schemas; any extra
 *      property surfaces as `UNEXPECTED_FIELD`, malformed types as
 *      `INPUT_INVALID`.
 *
 * Both layers emit `request.unexpected_field` (or `INPUT_INVALID` for
 * malformed types) before throwing so the audit trail captures the
 * rejection regardless of the matching error envelope.
 *
 * The middleware is intentionally tolerant about non-object bodies: if
 * `req.body` is `undefined` or a primitive (e.g. a route that accepts
 * a JSON array, or a route with no body), the forbidden-key scan
 * silently passes and Ajv's schema is the sole arbiter of the body's
 * shape.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import {
  InputInvalidError,
  UnexpectedFieldError,
} from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";
import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";

/**
 * v4 §4.1 forbidden body fields. Stored lowercased; the scan is
 * case-insensitive so that `Actor`, `ACTOR`, etc. are all rejected.
 *
 * `workspace_id` is on the list because the workspace is derived from
 * the URL (`/api/workspaces/:workspace_id/...`) — accepting it from the
 * body opens a confused-deputy path where two ids disagree.
 *
 * `status` is on the list because every status mutation is gated by a
 * dedicated lifecycle endpoint (e.g. `POST .../promote`) that derives
 * the new status server-side. A body field would let any caller bypass
 * the lifecycle gate.
 */
export const FORBIDDEN_BODY_FIELDS: readonly string[] = Object.freeze([
  "actor",
  "actor_user_id",
  "user_id",
  "created_by",
  "updated_by",
  "approved_by",
  "workspace_id",
  "status",
  "storage_path",
]);

const FORBIDDEN_BODY_FIELDS_LOWER: ReadonlySet<string> = new Set(
  FORBIDDEN_BODY_FIELDS.map((f) => f.toLowerCase()),
);

/**
 * Return the first forbidden field present at the top level of `body`,
 * or `null` if the body has none. Case-insensitive match.
 *
 * Top-level only — nested object validation is the route schema's job.
 * The §4.1 forbidden list is specifically about the body envelope, not
 * arbitrary nested structure (though most route schemas use
 * `additionalProperties: false` which catches deeper drift too).
 */
export function containsForbiddenField(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (FORBIDDEN_BODY_FIELDS_LOWER.has(key.toLowerCase())) {
      return key;
    }
  }
  return null;
}

/**
 * Singleton Ajv instance. The settings match the IMPLEMENTATION_MANIFEST
 * §3 contract: surface the first error (cheaper, sufficient for a 400),
 * never strip extra fields silently (they must be reported), and never
 * fill defaults at the validation boundary (defaults are a service-layer
 * concern that runs after authorization).
 */
const ajv = new Ajv({
  allErrors: false,
  removeAdditional: false,
  useDefaults: false,
  strict: false,
});

/**
 * Compile cache. Routes register a small number of schemas at module
 * load; the WeakMap keyed on the schema object itself avoids storing
 * the schema's text and avoids leaking compiled validators if a route
 * plugin is unloaded.
 */
const COMPILE_CACHE: WeakMap<object, ValidateFunction> = new WeakMap();

function getValidator(schema: object): ValidateFunction {
  let validator = COMPILE_CACHE.get(schema);
  if (validator === undefined) {
    validator = ajv.compile(schema);
    COMPILE_CACHE.set(schema, validator);
  }
  return validator;
}

interface ValidateInputSchemaDeps {
  readonly auditLogger: AuditLogger;
}

/**
 * Decide whether an Ajv error is "extra field" (UNEXPECTED_FIELD) vs
 * "malformed shape" (INPUT_INVALID). The Ajv 8 `additionalProperties`
 * keyword fires whenever a schema with `additionalProperties: false`
 * sees a property the schema didn't declare. Other keywords (`type`,
 * `enum`, `pattern`, `required`, `minimum`, etc.) are shape failures.
 */
function isUnexpectedFieldError(err: ErrorObject): boolean {
  return err.keyword === "additionalProperties";
}

function unexpectedFieldName(err: ErrorObject): string | null {
  // Ajv stashes the offending property on `params.additionalProperty`.
  if (
    err.params !== null &&
    typeof err.params === "object" &&
    "additionalProperty" in err.params &&
    typeof (err.params as { additionalProperty: unknown }).additionalProperty ===
      "string"
  ) {
    return (err.params as { additionalProperty: string }).additionalProperty;
  }
  return null;
}

async function emitUnexpectedField(
  deps: ValidateInputSchemaDeps,
  req: FastifyRequest,
  field: string,
): Promise<void> {
  const audit = req.audit;
  // The audit logger refuses `actorUserId === null` for any actor type
  // other than `unauthenticated`; mirror its precondition so an unauth'd
  // request emits cleanly.
  const actorType = audit?.actorType ?? "unauthenticated";
  const actorUserId =
    actorType === "unauthenticated" ? null : audit?.actorUserId ?? null;
  await deps.auditLogger.write({
    workspaceId: req.workspace?.id ?? null,
    actorUserId,
    actorType,
    action: "request.unexpected_field",
    result: "denied",
    requestId: req.requestId,
    metadata: { rejected_field: field },
  });
}

export function validateInputSchema(
  schema: object,
  deps: ValidateInputSchemaDeps,
): NamedMiddleware {
  // Compile eagerly so a malformed schema fails route registration, not
  // the first request that touches the route.
  const validator = getValidator(schema);

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    // §4.1 forbidden-body scan first — independent of the schema, so a
    // route schema with `additionalProperties: true` (e.g. for a free-form
    // metadata blob) still rejects the server-derived names.
    const forbidden = containsForbiddenField(req.body);
    if (forbidden !== null) {
      await emitUnexpectedField(deps, req, forbidden);
      throw new UnexpectedFieldError("Body contains forbidden field.", {
        field: forbidden,
      });
    }

    // Defer entirely to the schema for non-object bodies (arrays,
    // primitives, undefined). Ajv handles them.
    const valid = validator(req.body);
    if (valid === true) {
      return;
    }

    const ajvErrors = validator.errors ?? [];
    if (ajvErrors.length === 0) {
      // Validator returned false but produced no errors — Ajv guarantees
      // this can't happen, but treat it as INPUT_INVALID for safety.
      throw new InputInvalidError("Request body failed validation.");
    }

    const first = ajvErrors[0];
    if (isUnexpectedFieldError(first)) {
      const field = unexpectedFieldName(first) ?? "unknown";
      await emitUnexpectedField(deps, req, field);
      throw new UnexpectedFieldError("Body contains unexpected field.", {
        field,
      });
    }

    // Malformed-type / required / enum / pattern / etc. — INPUT_INVALID.
    const path = first.instancePath === "" ? "(root)" : first.instancePath;
    throw new InputInvalidError("Request body failed validation.", {
      path,
      reason: first.message ?? "schema_violation",
    });
  };

  return { name: "validateInputSchema", handler };
}
