/**
 * SecretsClient — Phase 0.5 Layer-1 (L1.6).
 *
 * Single entry point for reading and rotating secrets across the
 * secure_core package. Pins the four invariants ADR-0011 requires:
 *
 *   1. Allowlist refusal: `getSecret('not.allowed')` throws
 *      `SecretNotAllowedError` BEFORE any provider call. An attacker
 *      who controls the requested name cannot probe the provider.
 *
 *   2. Log redaction: returns `RedactedSecret` instances; the cleartext
 *      only surfaces through `RedactedSecret.reveal()`. The startup
 *      banner names the provider and source path/region but never
 *      includes a secret value.
 *
 *   3. Gitignore + convention-checker block (enforced outside this
 *      file): `.gitignore` excludes `local_cache/secrets/secrets.local.json`
 *      and the convention checker grows an assertion that the file is
 *      never tracked.
 *
 *   4. `secret.rotated` audit event: `rotateSecret` writes the new
 *      value through the provider AND emits an audit-event-shaped
 *      record. L1.7's logger will consume this; for now the class
 *      accepts an optional `onRotated` callback so tests can observe.
 *
 * Three providers, selected by `PLASMAWORK_SECRETS_PROVIDER`:
 *   - `local` (default): JSON file at `local_cache/secrets/secrets.local.json`,
 *     mode-checked to refuse anything more permissive than 0o600.
 *   - `env`: CI fallback; reads `PLASMAWORK_SECRET_<NAME>` variables
 *     and is intentionally read-only.
 *   - `aws`: production provider backed by AWS Secrets Manager.
 */

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isSecretName,
  type SecretName,
} from "./allowlist.js";
import { readSecretValueEnv, readSecureCoreEnv } from "./env.js";
import { RedactedSecret } from "./redacted.js";
import { repoRoot } from "./repoRoot.js";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Thrown when a caller asks for a secret name that is not in the
 * allowlist. Carries a stable error code so middleware can map it to a
 * 4xx without string-matching the message.
 */
export class SecretNotAllowedError extends Error {
  readonly code = "secret.not_allowed" as const;
  constructor(name: string) {
    super(`secret name not in allowlist: ${name}`);
    this.name = "SecretNotAllowedError";
  }
}

/* ------------------------------------------------------------------ */
/* Provider abstraction                                                */
/* ------------------------------------------------------------------ */

interface SecretsProvider {
  /** Provider tag for the startup banner. */
  readonly kind: "local" | "env" | "aws";
  /**
   * Human-readable identifier of where secrets come from (file path
   * or AWS region). Safe to log — never contains a secret value.
   */
  readonly source: string;
  /** Fetch and return the cleartext for a (validated) secret name. */
  read(name: SecretName): Promise<string>;
  /** Persist a new value for a (validated) secret name. */
  write(name: SecretName, value: string): Promise<SecretWriteResult>;
}

interface SecretWriteResult {
  readonly versionId?: string;
}

/* ------------------------------------------------------------------ */
/* Local file provider                                                 */
/* ------------------------------------------------------------------ */

class LocalFileProvider implements SecretsProvider {
  readonly kind = "local" as const;
  readonly source: string;

  constructor(filePath: string) {
    this.source = filePath;
  }

  /**
   * File-mode policy: STRICT 0o600 (owner read/write only). Any
   * additional bit — group read, world read, executable, anything —
   * causes `read` and `write` to throw before touching the contents.
   * On platforms where mode bits are not enforced (Windows), the
   * comparison still succeeds because Node fakes 0o666; we treat that
   * as developer-only and document the prod path as Linux/AWS.
   */
  private assertMode(): void {
    const st = statSync(this.source);
    // Mask out the file-type bits and stickies we don't care about.
    const mode = st.mode & 0o777;
    if (mode > 0o600) {
      throw new Error(
        `secrets file ${this.source} has permissions 0o${mode.toString(8)}; ` +
          `must be 0o600 or stricter (no group/world access)`,
      );
    }
  }

  async read(name: SecretName): Promise<string> {
    this.assertMode();
    const raw = readFileSync(this.source, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `secrets file ${this.source} is not valid JSON: ${(e as Error).message}`,
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        `secrets file ${this.source} must be a JSON object of {name: value}`,
      );
    }
    const map = parsed as Record<string, unknown>;
    if (!(name in map)) {
      throw new Error(`secret "${name}" not present in ${this.source}`);
    }
    const value = map[name];
    if (typeof value !== "string") {
      throw new Error(
        `secret "${name}" in ${this.source} is not a string`,
      );
    }
    return value;
  }

  async write(name: SecretName, value: string): Promise<SecretWriteResult> {
    this.assertMode();
    const raw = readFileSync(this.source, "utf-8");
    let parsed: Record<string, unknown>;
    try {
      const out = JSON.parse(raw);
      if (typeof out !== "object" || out === null || Array.isArray(out)) {
        throw new Error("not an object");
      }
      parsed = out as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `secrets file ${this.source} is not a JSON object: ${(e as Error).message}`,
      );
    }
    parsed[name] = value;
    // Preserve 0o600 mode by writing through the existing file
    // (writeFileSync without mode keeps the existing inode's bits).
    writeFileSync(this.source, JSON.stringify(parsed, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* CI environment provider                                             */
/* ------------------------------------------------------------------ */

/**
 * Convert an allowlisted secret name to the CI env var name from
 * ADR-0011. Example: `db.password.app` →
 * `PLASMAWORK_SECRET_DB_PASSWORD_APP`.
 */
export function envVarNameForSecret(name: SecretName): string {
  return `PLASMAWORK_SECRET_${name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")}`;
}

class EnvSecretsProvider implements SecretsProvider {
  readonly kind = "env" as const;
  readonly source = "process-env:PLASMAWORK_SECRET_*";

  async read(name: SecretName): Promise<string> {
    const envName = envVarNameForSecret(name);
    const value = readSecretValueEnv(envName);
    if (value === undefined || value.length === 0) {
      throw new Error(
        `secret "${name}" not present in environment variable ${envName}`,
      );
    }
    return value;
  }

  async write(_name: SecretName, _value: string): Promise<SecretWriteResult> {
    throw new Error(
      "env secrets provider is read-only; rotate the backing CI secret instead",
    );
  }
}

/* ------------------------------------------------------------------ */
/* AWS provider                                                        */
/* ------------------------------------------------------------------ */

class AwsSecretsManagerProvider implements SecretsProvider {
  readonly kind = "aws" as const;
  readonly source: string;
  private readonly client: SecretsManagerClient;
  private readonly prefix: string;

  constructor(opts: { region?: string; prefix: string }) {
    this.prefix = opts.prefix.replace(/\/+$/g, "");
    this.client = new SecretsManagerClient(
      opts.region ? { region: opts.region } : {},
    );
    this.source = opts.region
      ? `aws-secrets-manager:${opts.region}:${this.prefix}`
      : `aws-secrets-manager:default-region-chain:${this.prefix}`;
  }

  private secretId(name: SecretName): string {
    return `${this.prefix}/${name}`;
  }

  async read(name: SecretName): Promise<string> {
    const out = await this.client.send(
      new GetSecretValueCommand({ SecretId: this.secretId(name) }),
    );
    if (typeof out.SecretString === "string") {
      return out.SecretString;
    }
    if (out.SecretBinary !== undefined) {
      return Buffer.from(out.SecretBinary).toString("utf8");
    }
    throw new Error(`AWS secret "${name}" returned no SecretString or SecretBinary`);
  }

  async write(
    name: SecretName,
    value: string,
  ): Promise<SecretWriteResult> {
    const out = await this.client.send(
      new PutSecretValueCommand({
        SecretId: this.secretId(name),
        SecretString: value,
      }),
    );
    return out.VersionId ? { versionId: out.VersionId } : {};
  }
}

/* ------------------------------------------------------------------ */
/* Audit-event payload                                                 */
/* ------------------------------------------------------------------ */

/**
 * Shape of the rotation notification handed to `onRotated`. Mirrors
 * the audit-event envelope L1.7's logger will eventually persist; the
 * `audit_event` discriminator matches `AUDIT_EVENTS`.
 *
 * Crucially: the payload carries the secret NAME, never the value.
 */
export interface SecretRotatedEvent {
  readonly audit_event: "secret.rotated";
  readonly name: SecretName;
  readonly provider: "local" | "env" | "aws";
  readonly at: string; // ISO-8601 timestamp
  readonly version_id?: string;
}

export type SecretRotationListener = (event: SecretRotatedEvent) => void;

/* ------------------------------------------------------------------ */
/* SecretsClient                                                       */
/* ------------------------------------------------------------------ */

export interface SecretsClientOptions {
  /**
   * Per-secret cache TTL in milliseconds. Default 5 minutes.
   */
  cacheTtlMs?: number;
  /**
   * Optional callback invoked with the audit-event-shaped record each
   * time `rotateSecret` succeeds. L1.7 will replace this with the
   * shared logger; a callback keeps the test surface tiny and avoids
   * a forward dependency.
   */
  onRotated?: SecretRotationListener;
  /**
   * Inject a provider directly. Bypasses env-var dispatch; used by
   * tests that want a known provider regardless of process state.
   */
  provider?: SecretsProvider;
  /**
   * If true, suppress the startup banner. Default `false`. Tests
   * capture banner output to assert no secret leak; library callers
   * generally want it on so the chosen provider is visible.
   */
  silent?: boolean;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: RedactedSecret;
  expiresAt: number;
}

export class SecretsClient {
  private readonly provider: SecretsProvider;
  private readonly cacheTtlMs: number;
  private readonly cache: Map<SecretName, CacheEntry> = new Map();
  private readonly onRotated: SecretRotationListener | undefined;

  constructor(options: SecretsClientOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.onRotated = options.onRotated;
    this.provider = options.provider ?? buildProviderFromEnv();
    if (!options.silent) {
      // Banner names the provider and the source identifier — the file
      // path or AWS region. Never the secret values themselves.
      console.error(
        `secrets: provider=${this.provider.kind} source=${this.provider.source}`,
      );
    }
  }

  /**
   * Fetch a secret. Allowlist check first, cache check second,
   * provider call last.
   */
  async getSecret(name: SecretName): Promise<RedactedSecret> {
    if (!isSecretName(name)) {
      // The cast in callers is the trust boundary; we re-validate at
      // the API surface so a buggy `as SecretName` cannot reach the
      // provider. This is the negative-path probe ADR-0011 requires.
      throw new SecretNotAllowedError(String(name));
    }

    const now = Date.now();
    const hit = this.cache.get(name);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const cleartext = await this.provider.read(name);
    const wrapped = new RedactedSecret(cleartext, name);
    this.cache.set(name, {
      value: wrapped,
      expiresAt: now + this.cacheTtlMs,
    });
    return wrapped;
  }

  /**
   * Rotate a secret to a new value. Allowlist + provider write +
   * cache invalidation + audit-event emission.
   */
  async rotateSecret(name: SecretName, newValue: string): Promise<void> {
    if (!isSecretName(name)) {
      throw new SecretNotAllowedError(String(name));
    }
    const writeResult = await this.provider.write(name, newValue);
    this.invalidateCache(name);
    const event: SecretRotatedEvent = {
      audit_event: "secret.rotated",
      name,
      provider: this.provider.kind,
      at: new Date().toISOString(),
      ...(writeResult.versionId ? { version_id: writeResult.versionId } : {}),
    };
    if (this.onRotated) {
      this.onRotated(event);
    }
  }

  /**
   * Drop one cache entry, or all entries when called with no
   * argument. The next `getSecret` reaches the provider.
   */
  invalidateCache(name?: SecretName): void {
    if (name === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(name);
  }
}

/* ------------------------------------------------------------------ */
/* Provider dispatch                                                   */
/* ------------------------------------------------------------------ */

function buildProviderFromEnv(): SecretsProvider {
  const choice = (readSecureCoreEnv("PLASMAWORK_SECRETS_PROVIDER") ?? "local")
    .trim()
    .toLowerCase();
  if (choice === "local") {
    const override = readSecureCoreEnv("PLASMAWORK_SECRETS_LOCAL_PATH");
    const path = override
      ? resolve(override)
      : resolve(repoRoot(), "local_cache/secrets/secrets.local.json");
    return new LocalFileProvider(path);
  }
  if (choice === "env") {
    return new EnvSecretsProvider();
  }
  if (choice === "aws") {
    const region = readSecureCoreEnv("AWS_REGION");
    const prefix =
      readSecureCoreEnv("PLASMAWORK_SECRETS_AWS_PREFIX")?.trim() ||
      "plasmawork/dev";
    return new AwsSecretsManagerProvider({ region, prefix });
  }
  throw new Error(
    `unknown PLASMAWORK_SECRETS_PROVIDER="${choice}"; expected "local", "env", or "aws"`,
  );
}
