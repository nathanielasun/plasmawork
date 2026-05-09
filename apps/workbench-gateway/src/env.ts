/**
 * Workbench gateway environment loader — Phase 0.5 auth gateway
 * (2026-05-09).
 *
 * Reads `.env.auth` from the repo root, validates every required
 * variable, and exposes a typed `GatewayEnv` to the rest of the host.
 * Fails closed at startup if any variable is missing OR shorter than
 * its security floor; this is deliberate. The audit-fix bundle
 * (F1-F5, 2026-05-09) added the same fail-closed posture for
 * `cookieSecret` after a near-miss where an undefined secret silently
 * issued unverifiable cookies.
 *
 * `.env.auth` is the canonical authentication config. Any future
 * security-side modification of the gateway MUST update both this
 * loader and the `.env.auth.example` committed alongside, so the
 * convention checker can keep them in sync.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIN_SECRET_BYTES = 32;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface GatewayEnv {
  readonly bootstrapAllowed: string | undefined;
  readonly bootstrapCredentialHash: string;
  readonly rootAdminUserId: string;
  readonly gatewayPort: number;
  readonly backendPort: number;
  readonly cookieSecret: string;
  readonly handoffSecret: string;
  readonly frontendOrigin: string;
  readonly dbUrl: string;
  readonly dbAuditUrl: string;
}

/**
 * Parse a tiny .env-style file: `KEY=VALUE` lines, `#` comments, blank
 * lines ignored. Quotes are stripped from VALUE. We deliberately do
 * NOT depend on `dotenv` — pulling a transitive package for parsing
 * 10 lines is the wrong shape, and an inlined parser is auditable.
 */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding double or single quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFromDisk(envPath: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(envPath, "utf8"));
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(
        `loadGatewayEnv: ${envPath} does not exist. Copy .env.auth.example and fill the required values. Phase 0.5 auth gateway requires this file to be present before any security-side modification.`,
      );
    }
    throw err;
  }
}

function require(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `loadGatewayEnv: required variable ${name} is missing or empty in .env.auth. See .env.auth.example for the expected shape.`,
    );
  }
  return value;
}

function requireMinBytes(
  name: string,
  value: string | undefined,
  minBytes: number,
): string {
  const v = require(name, value);
  if (Buffer.byteLength(v, "utf-8") < minBytes) {
    throw new Error(
      `loadGatewayEnv: ${name} must be at least ${minBytes} bytes (got ${Buffer.byteLength(v, "utf-8")}). Generate via 'openssl rand -base64 32'.`,
    );
  }
  return v;
}

/**
 * Load + validate the gateway env. Throws on any missing/invalid
 * variable. Designed to run ONCE at process start; the caller passes
 * the loaded env into every middleware factory and route registration.
 */
export function loadGatewayEnv(opts?: {
  /** Override for tests. Defaults to `<repoRoot>/.env.auth`. */
  readonly envPath?: string;
  /**
   * Override the env source (for tests). When provided, the file is
   * NOT read; this map is used as the env directly.
   */
  readonly envSource?: Readonly<Record<string, string | undefined>>;
}): GatewayEnv {
  const source =
    opts?.envSource ??
    readEnvFromDisk(opts?.envPath ?? resolve(process.cwd(), ".env.auth"));

  const bootstrapCredentialHash = require(
    "BOOTSTRAP_CREDENTIAL_HASH",
    source.BOOTSTRAP_CREDENTIAL_HASH,
  );
  if (!SHA256_HEX_PATTERN.test(bootstrapCredentialHash)) {
    throw new Error(
      "loadGatewayEnv: BOOTSTRAP_CREDENTIAL_HASH must be 64 lowercase hex characters (SHA-256 of the OOB credential).",
    );
  }

  const rootAdminUserId = require(
    "ROOT_ADMIN_USER_ID",
    source.ROOT_ADMIN_USER_ID,
  );
  if (!USERNAME_PATTERN.test(rootAdminUserId)) {
    throw new Error(
      `loadGatewayEnv: ROOT_ADMIN_USER_ID must match ${USERNAME_PATTERN.source} (alphanumeric + underscore + hyphen, 3-64 chars).`,
    );
  }

  const gatewayPort = Number.parseInt(
    source.WORKBENCH_GATEWAY_PORT ?? "4000",
    10,
  );
  const backendPort = Number.parseInt(
    source.WORKBENCH_BACKEND_PORT ?? "8000",
    10,
  );
  if (!Number.isInteger(gatewayPort) || gatewayPort <= 0) {
    throw new Error(
      "loadGatewayEnv: WORKBENCH_GATEWAY_PORT must be a positive integer.",
    );
  }
  if (!Number.isInteger(backendPort) || backendPort <= 0) {
    throw new Error(
      "loadGatewayEnv: WORKBENCH_BACKEND_PORT must be a positive integer.",
    );
  }

  return {
    bootstrapAllowed: source.BOOTSTRAP_ALLOWED,
    bootstrapCredentialHash,
    rootAdminUserId,
    gatewayPort,
    backendPort,
    cookieSecret: requireMinBytes(
      "WORKBENCH_GATEWAY_COOKIE_SECRET",
      source.WORKBENCH_GATEWAY_COOKIE_SECRET,
      MIN_SECRET_BYTES,
    ),
    handoffSecret: requireMinBytes(
      "WORKBENCH_GATEWAY_HANDOFF_SECRET",
      source.WORKBENCH_GATEWAY_HANDOFF_SECRET,
      MIN_SECRET_BYTES,
    ),
    frontendOrigin: require(
      "WORKBENCH_GATEWAY_FRONTEND_ORIGIN",
      source.WORKBENCH_GATEWAY_FRONTEND_ORIGIN,
    ),
    dbUrl: require("PLASMAWORK_DB_URL", source.PLASMAWORK_DB_URL),
    dbAuditUrl: require(
      "PLASMAWORK_DB_AUDIT_URL",
      source.PLASMAWORK_DB_AUDIT_URL,
    ),
  };
}
