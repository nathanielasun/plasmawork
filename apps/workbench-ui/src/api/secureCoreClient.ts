/**
 * Browser client for secure-core UI-bound routes.
 *
 * The secure backend remains the enforcement point. This client only reads
 * server-derived identity, dashboard health, and route-readiness metadata so
 * the UI can present affordances without inventing authority locally.
 */

import {
  CSRF_COOKIE_NAME,
  STATE_CHANGING_METHODS,
  methodRequiresCsrf,
  readCsrfCookieValue,
} from "./csrf.js";

export type SecureActorType = "human" | "ai_agent" | "worker" | "operator";
export type AssuranceLevel = "aal1" | "aal2" | "aal3";
export type SecurityDashboardStatus = "healthy" | "warning" | "critical";
export type SecureRouteReadiness =
  | "ready"
  | "fail_closed"
  | "deployment_gated"
  | "planned";
export type SecureRouteAuth =
  | "none"
  | "session"
  | "operator_audit_read"
  | "operator_incident_investigate"
  | "operator_incident_remediate"
  | "worker_token";
export type SecureRouteCsrf = "none" | "origin" | "session";
export type SecureRouteApproval = "none" | "header_token";

export type Capability =
  | "workspace:view"
  | "workspace:manage_members"
  | "workspace:manage_settings"
  | "workspace:delete"
  | "capsule:create"
  | "capsule:read"
  | "capsule:update"
  | "capsule:fork"
  | "capsule:delete"
  | "run:create"
  | "run:cancel"
  | "run:approve_expensive"
  | "run:approve_hpc"
  | "tool:create"
  | "tool:read"
  | "tool:update"
  | "tool:request_promotion"
  | "tool:approve_promotion"
  | "tool:deprecate"
  | "artifact:read"
  | "artifact:export"
  | "approval:request"
  | "worker:issue_token"
  | "audit:read"
  | "provenance:read"
  | "session:revoke"
  | "user:disable"
  | "platform:audit_read"
  | "platform:incident_investigate"
  | "platform:incident_remediate";

export interface CurrentSessionMembership {
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly role_id: string;
  readonly role_name: string;
  readonly capabilities: readonly Capability[];
}

export interface CurrentSessionResponse {
  readonly user_id: string;
  readonly session_id: string;
  readonly actor_type: SecureActorType;
  readonly assurance_level: AssuranceLevel;
  readonly memberships: readonly CurrentSessionMembership[];
}

export interface ChainHealthSummary {
  readonly logType: string;
  readonly ok: boolean;
  readonly rowsVerified: number;
  readonly tipHash: string | null;
  readonly failureReason?: string;
  readonly latestAnchorCommittedAt: string | null;
  readonly latestExternalAnchorUri: string | null;
  readonly anchorLagMs: number | null;
  readonly status: SecurityDashboardStatus;
}

export interface SecurityCounterSummary {
  readonly name: string;
  readonly count: number;
  readonly windowMs: number;
  readonly status: SecurityDashboardStatus;
}

export interface SecurityDashboardResponse {
  readonly generatedAt: string;
  readonly status: SecurityDashboardStatus;
  readonly chains: readonly ChainHealthSummary[];
  readonly deniedAccess: readonly SecurityCounterSummary[];
  readonly sandboxViolations: readonly SecurityCounterSummary[];
}

export interface SecureCoreRouteContract {
  readonly id: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly auth: SecureRouteAuth;
  readonly csrf: SecureRouteCsrf;
  readonly approval: SecureRouteApproval;
  readonly readiness: SecureRouteReadiness;
  readonly uiSurface: string;
  readonly notes: string;
}

export interface SecureCoreErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
    readonly request_id: string;
  };
}

/**
 * Login request — Phase 0.5 / Phase F-min (2026-05-09).
 *
 * Username-primary identity. The username regex
 * ``^[A-Za-z0-9_-]{3,64}$`` matches LOGIN_SCHEMA at the gateway.
 * Email is intentionally NOT a login identifier; it is optional
 * supplementary metadata for recovery flows only.
 */
export interface LoginRequestBody {
  readonly username: string;
  readonly password: string;
}

/**
 * Login response. The raw session token is delivered ONLY as a
 * Set-Cookie (``secure_session``); the response body never carries it.
 * The CSRF token IS in the body so the SPA can cache it in memory and
 * echo it as ``X-CSRF-Token`` on every state-changing request (the
 * cookie copy is the redundant defense — v4 §7.2 double-submit).
 */
export interface LoginResponseBody {
  readonly user_id: string;
  readonly session_id: string;
  readonly assurance_level: AssuranceLevel;
  readonly csrf_token: string;
  readonly expires_at: string;
}

export interface SecureCoreClient {
  currentSession(signal?: AbortSignal): Promise<CurrentSessionResponse>;
  securityDashboard(signal?: AbortSignal): Promise<SecurityDashboardResponse>;
  /**
   * POST /auth/login — anti-enumeration. Every failure (unknown
   * username, wrong password, disabled account) surfaces as the same
   * `UNAUTHENTICATED` 401 with a generic message. Callers MUST NOT
   * branch UI behavior on the error code.
   */
  login(
    body: LoginRequestBody,
    signal?: AbortSignal,
  ): Promise<LoginResponseBody>;
  /**
   * POST /auth/logout — revokes the session and clears both cookies
   * (idempotent; succeeds even if the session is already expired).
   * Callers should redirect to the login page after this resolves.
   */
  logout(signal?: AbortSignal): Promise<void>;
}

export class SecureCoreHttpError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly requestId: string | null;

  constructor(
    message: string,
    status: number,
    code: string | null,
    requestId: string | null,
  ) {
    super(message);
    this.name = "SecureCoreHttpError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const DEFAULT_BASE_URL = import.meta.env.VITE_SECURE_CORE_BASE_URL ?? "";

function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmedBase}${path}`;
}

function isErrorEnvelope(value: unknown): value is SecureCoreErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

// CSRF helpers (CSRF_COOKIE_NAME, STATE_CHANGING_METHODS, methodRequiresCsrf,
// readCsrfCookieValue) are imported from ``./csrf.js`` so client.ts and
// secureCoreClient.ts share a single source of truth for the v4 §7.2
// double-submit defense. The names are kept available locally as
// references for the convention checker and for callers that still
// import them by name.
export { CSRF_COOKIE_NAME, STATE_CHANGING_METHODS };

async function readJson<T>(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  // Echo the CSRF token on every state-changing request. Audit fix
  // (2026-05-09): the original logout/login implementation did NOT
  // echo the token, so the gateway's CSRF middleware refused logout
  // calls and the UI's redirect-after-logout left the cookies + the
  // server session intact. Adding it here covers every state-
  // changing call this client makes — current + future.
  if (methodRequiresCsrf(init?.method)) {
    const csrfToken = readCsrfCookieValue();
    if (csrfToken.length > 0 && !("X-CSRF-Token" in headers)) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }
  const response = await fetch(joinUrl(baseUrl, path), {
    credentials: "include",
    ...(init ?? {}),
    headers,
    signal,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    if (!response.ok) {
      throw new SecureCoreHttpError(
        `Secure-core ${path} failed with HTTP ${response.status} and a non-JSON body.`,
        response.status,
        null,
        null,
      );
    }
    throw new SecureCoreHttpError(
      `Secure-core ${path} returned an invalid JSON success body.`,
      response.status,
      null,
      null,
    );
  }
  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      throw new SecureCoreHttpError(
        body.error.message,
        response.status,
        body.error.code,
        body.error.request_id,
      );
    }
    throw new SecureCoreHttpError(
      `Secure-core ${path} failed with HTTP ${response.status}.`,
      response.status,
      null,
      null,
    );
  }
  return body as T;
}

export function createSecureCoreClient(
  baseUrl: string = DEFAULT_BASE_URL,
): SecureCoreClient {
  return {
    currentSession(signal?: AbortSignal) {
      return readJson<CurrentSessionResponse>(baseUrl, "/auth/session", signal);
    },
    securityDashboard(signal?: AbortSignal) {
      return readJson<SecurityDashboardResponse>(
        baseUrl,
        "/operator/security-dashboard",
        signal,
      );
    },
    login(body: LoginRequestBody, signal?: AbortSignal) {
      return readJson<LoginResponseBody>(baseUrl, "/auth/login", signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: body.username,
          password: body.password,
        }),
      });
    },
    async logout(signal?: AbortSignal) {
      await readJson<{ status: "ok" } | null>(
        baseUrl,
        "/auth/logout",
        signal,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    },
  };
}

export const secureCoreClient = createSecureCoreClient();
