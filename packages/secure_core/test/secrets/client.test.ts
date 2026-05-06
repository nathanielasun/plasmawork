/**
 * SecretsClient — Phase 0.5 Layer-1 (L1.6) tests.
 *
 * Pins the four ADR-0011 negative-path probes plus the local-provider
 * happy path, cache semantics, and the AWS-stub behaviour.
 *
 * The whole suite captures `console.log` and `console.error` and, on
 * teardown, asserts the cleartext sentinel never appears anywhere in
 * the captured output. That single assertion catches future
 * regressions where someone adds a "helpful" log line that prints a
 * secret.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  SecretsClient,
  SecretNotAllowedError,
  type SecretRotatedEvent,
} from "../../src/secrets/client.js";
import { RedactedSecret } from "../../src/secrets/redacted.js";
import type { SecretName } from "../../src/secrets/allowlist.js";

const CLEARTEXT = "hunter2";
const ROTATED_CLEARTEXT = "correct horse battery staple";

interface Captured {
  log: string[];
  error: string[];
}

function captureConsole(): {
  captured: Captured;
  restore: () => void;
} {
  const originalLog = console.log;
  const originalError = console.error;
  const captured: Captured = { log: [], error: [] };
  console.log = (...args: unknown[]) => {
    captured.log.push(args.map((a) => String(a)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    captured.error.push(args.map((a) => String(a)).join(" "));
  };
  return {
    captured,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

function assertNoCleartextLeak(captured: Captured, needles: string[]): void {
  const all = [...captured.log, ...captured.error].join("\n");
  for (const needle of needles) {
    expect(all).not.toContain(needle);
  }
}

let tmpRoot: string;
let secretsDir: string;
let secretsFile: string;
let consoleCapture: ReturnType<typeof captureConsole>;
const envBackup: Record<string, string | undefined> = {};

const ENV_KEYS = [
  "SIMWORKBENCH_REPO_ROOT",
  "PLASMAWORK_SECRETS_PROVIDER",
  "PLASMAWORK_SECRETS_LOCAL_PATH",
  "AWS_REGION",
];

beforeEach(() => {
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];

  tmpRoot = mkdtempSync(resolve(tmpdir(), "secure-core-secrets-"));
  // Sentinel files so repoRoot() locates this temp dir, not the real repo.
  writeFileSync(resolve(tmpRoot, "AGENTS.md"), "test fixture\n");
  writeFileSync(resolve(tmpRoot, "CLAUDE.md"), "test fixture\n");
  secretsDir = resolve(tmpRoot, "local_cache", "secrets");
  mkdirSync(secretsDir, { recursive: true });
  secretsFile = resolve(secretsDir, "secrets.local.json");
  writeFileSync(
    secretsFile,
    JSON.stringify({ "db.password.app": CLEARTEXT }, null, 2),
    { mode: 0o600 },
  );
  // mkdtempSync may inherit a more permissive umask; chmod explicitly.
  chmodSync(secretsFile, 0o600);

  process.env.SIMWORKBENCH_REPO_ROOT = tmpRoot;
  process.env.PLASMAWORK_SECRETS_PROVIDER = "local";
  delete process.env.PLASMAWORK_SECRETS_LOCAL_PATH;

  consoleCapture = captureConsole();
});

afterEach(() => {
  // Final assertion: nothing logged during this test exposed cleartext.
  assertNoCleartextLeak(consoleCapture.captured, [
    CLEARTEXT,
    ROTATED_CLEARTEXT,
  ]);
  consoleCapture.restore();

  rmSync(tmpRoot, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

describe("SecretsClient — allowlist refusal", () => {
  it("throws SecretNotAllowedError before touching the provider", async () => {
    // Point at a path that DOES NOT EXIST. If the allowlist check
    // fired first, we get SecretNotAllowedError. If the provider was
    // reached first, we'd get an ENOENT-shaped error.
    process.env.PLASMAWORK_SECRETS_LOCAL_PATH = resolve(
      tmpRoot,
      "no-such-file.json",
    );
    const client = new SecretsClient();
    await expect(
      client.getSecret("not.allowed" as unknown as SecretName),
    ).rejects.toBeInstanceOf(SecretNotAllowedError);
    try {
      await client.getSecret("not.allowed" as unknown as SecretName);
    } catch (e) {
      expect((e as SecretNotAllowedError).code).toBe("secret.not_allowed");
    }
  });
});

describe("SecretsClient — local provider happy path", () => {
  it("returns a RedactedSecret whose reveal() yields cleartext", async () => {
    const client = new SecretsClient();
    const secret = await client.getSecret("db.password.app");
    expect(secret).toBeInstanceOf(RedactedSecret);
    expect(secret.reveal()).toBe(CLEARTEXT);
  });

  it("redacts in JSON.stringify and string interpolation", async () => {
    const client = new SecretsClient();
    const secret = await client.getSecret("db.password.app");
    const json = JSON.stringify({ s: secret });
    expect(json).toContain("<redacted:");
    expect(json).not.toContain(CLEARTEXT);
    const interp = `secret is ${secret}`;
    expect(interp).toContain("<redacted:");
    expect(interp).not.toContain(CLEARTEXT);
  });
});

describe("SecretsClient — cache semantics", () => {
  it("returns the cached value within TTL even after the file changes", async () => {
    const client = new SecretsClient({ cacheTtlMs: 60_000 });
    const first = await client.getSecret("db.password.app");
    expect(first.reveal()).toBe(CLEARTEXT);

    // Mid-test: change the file. Cache should still serve old value.
    writeFileSync(
      secretsFile,
      JSON.stringify({ "db.password.app": ROTATED_CLEARTEXT }, null, 2),
      { mode: 0o600 },
    );
    chmodSync(secretsFile, 0o600);

    const cached = await client.getSecret("db.password.app");
    expect(cached.reveal()).toBe(CLEARTEXT);

    client.invalidateCache("db.password.app");

    const fresh = await client.getSecret("db.password.app");
    expect(fresh.reveal()).toBe(ROTATED_CLEARTEXT);
  });
});

describe("SecretsClient — file-mode refusal", () => {
  it("refuses to read a secrets file with mode 0o644", async () => {
    chmodSync(secretsFile, 0o644);
    const client = new SecretsClient();
    await expect(client.getSecret("db.password.app")).rejects.toThrow(
      /permissions/i,
    );
  });
});

describe("SecretsClient — rotateSecret (local provider)", () => {
  it("writes new value, invalidates cache, emits secret.rotated", async () => {
    const events: SecretRotatedEvent[] = [];
    const client = new SecretsClient({
      onRotated: (e) => events.push(e),
    });

    const before = await client.getSecret("db.password.app");
    expect(before.reveal()).toBe(CLEARTEXT);

    await client.rotateSecret("db.password.app", ROTATED_CLEARTEXT);

    expect(events).toHaveLength(1);
    expect(events[0]?.audit_event).toBe("secret.rotated");
    expect(events[0]?.name).toBe("db.password.app");
    expect(events[0]?.provider).toBe("local");
    expect(typeof events[0]?.at).toBe("string");

    const after = await client.getSecret("db.password.app");
    expect(after.reveal()).toBe(ROTATED_CLEARTEXT);
  });
});

describe("SecretsClient — AWS provider stub", () => {
  it("throws the documented 'not yet wired' error on getSecret", async () => {
    process.env.PLASMAWORK_SECRETS_PROVIDER = "aws";
    process.env.AWS_REGION = "us-west-2";
    const client = new SecretsClient();
    await expect(client.getSecret("db.password.app")).rejects.toThrow(
      /AWS provider not yet wired/,
    );
  });

  it("startup banner names the region but contains no secret", async () => {
    process.env.PLASMAWORK_SECRETS_PROVIDER = "aws";
    process.env.AWS_REGION = "us-west-2";
    new SecretsClient();
    const banner = consoleCapture.captured.error.join("\n");
    expect(banner).toContain("provider=aws");
    expect(banner).toContain("us-west-2");
    expect(banner).not.toContain(CLEARTEXT);
  });
});
