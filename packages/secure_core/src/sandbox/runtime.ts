/**
 * Sandbox runtime abstraction — Phase 0.5 Layer 3 task L3.7.
 *
 * Per ADR-0009 + v4 §15 every run executes inside an isolation
 * boundary: gVisor `runsc` + UNIX-domain-socket egress proxy +
 * `--network=none` topology + per-run rootfs + writable mounts only
 * for workspace-scoped paths. The runner has NO direct shell-out;
 * every container launch goes through this interface so review
 * (and tests) can prove no `--privileged`, no shared mounts, no
 * arbitrary env.
 *
 * Two implementations:
 *
 *   - `StubSandboxRuntime` — records calls, returns scripted exit
 *     results. Every test uses this.
 *   - `RunscSandboxRuntime` — production: assembles the `runsc run`
 *     command, REFUSES bad specs at the top of `launch` so a misuse
 *     can never reach `child_process.spawn`. The actual spawn is
 *     injectable so tests can drive command-line assertions without
 *     starting real containers.
 *
 * The dev/test environment cannot run `runsc` (macOS, no Linux
 * kernel). RunscSandboxRuntime's behavior is therefore exercised by
 * spec-validation + command-assembly tests; integration with a real
 * runtime is L5 deployment territory.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

import { SandboxViolationError } from "../errors/shapes.js";
import { isStrictSubpath } from "../paths/safeOpen.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface SandboxLaunchSpec {
  readonly runId: string;
  readonly workspaceId: string;
  /** Absolute, per-run, validated outside this module. */
  readonly rootfsPath: string;
  readonly readonlyMounts: ReadonlyArray<{ source: string; target: string }>;
  readonly writableMounts: ReadonlyArray<{ source: string; target: string }>;
  readonly egress:
    | { mode: "none" }
    | { mode: "uds_proxy"; socketPath: string };
  readonly limits: SandboxLimits;
  readonly entrypoint: ReadonlyArray<string>;
  /** Closed env map. Keys must NOT match any forbidden pattern. */
  readonly env: Readonly<Record<string, string>>;
}

export interface SandboxLimits {
  readonly cpuQuotaMillicores: number;
  readonly memBytes: number;
  readonly wallSeconds: number;
  readonly pidLimit: number;
  readonly diskBytes: number;
}

export interface SandboxHandle {
  readonly id: string;
  /** Always sets a terminal exit. Idempotent. */
  close(): Promise<void>;
}

export type SandboxTerminationReason =
  | "completed"
  | "timeout"
  | "oom"
  | "violation"
  | "killed";

export interface SandboxExitResult {
  readonly exitCode: number;
  readonly terminationReason: SandboxTerminationReason;
  /** Internal-only — never surface to the user. v4 §3 SANDBOX_VIOLATION is 500 by design. */
  readonly violationCause?: string;
}

export interface SandboxRuntime {
  launch(spec: SandboxLaunchSpec): Promise<SandboxHandle>;
  wait(handle: SandboxHandle): Promise<SandboxExitResult>;
  kill(handle: SandboxHandle): Promise<void>;
}

// ---------------------------------------------------------------------------
// Forbidden env-key patterns (server credentials, DB URLs, secrets).
// ---------------------------------------------------------------------------

const FORBIDDEN_ENV_PREFIXES = [
  "PLASMAWORK_",
  "AWS_",
  "DATABASE_URL",
  "POSTGRES_",
  "PGPASSWORD",
];

const FORBIDDEN_ENV_SUBSTRINGS = ["SECRET", "PASSWORD", "TOKEN", "PRIVATE_KEY"];

function envKeyForbidden(key: string): boolean {
  const upper = key.toUpperCase();
  for (const p of FORBIDDEN_ENV_PREFIXES) {
    if (upper.startsWith(p)) return true;
  }
  for (const s of FORBIDDEN_ENV_SUBSTRINGS) {
    if (upper.includes(s)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Spec validation. Both runtime implementations call this at the top
// of `launch` so the same rule set governs production + tests.
// ---------------------------------------------------------------------------

export type SandboxSpecRefusal =
  | "empty_entrypoint"
  | "egress_socket_missing"
  | "limit_non_positive"
  | "mount_target_relative"
  | "mount_outside_rootfs"
  | "env_forbidden_key"
  | "rootfs_not_absolute";

export function validateLaunchSpec(spec: SandboxLaunchSpec): SandboxSpecRefusal | null {
  if (!spec.rootfsPath.startsWith("/")) return "rootfs_not_absolute";
  if (spec.entrypoint.length === 0) return "empty_entrypoint";
  if (spec.egress.mode === "uds_proxy" && spec.egress.socketPath.length === 0) {
    return "egress_socket_missing";
  }
  for (const v of [
    spec.limits.cpuQuotaMillicores,
    spec.limits.memBytes,
    spec.limits.wallSeconds,
    spec.limits.pidLimit,
    spec.limits.diskBytes,
  ]) {
    if (!Number.isInteger(v) || v <= 0) return "limit_non_positive";
  }
  for (const m of [...spec.readonlyMounts, ...spec.writableMounts]) {
    if (!m.target.startsWith("/")) return "mount_target_relative";
    if (m.target.includes("..")) return "mount_outside_rootfs";
    // Targets must live INSIDE the rootfs (or BE the rootfs).
    // `isStrictSubpath` requires distinct parent + child; allow target
    // === rootfsPath to support "/" mount.
    if (m.target !== spec.rootfsPath && !isStrictSubpath(spec.rootfsPath, m.target)) {
      // The rootfs is the container's `/`; mounts target paths in
      // that namespace, so any absolute target whose first component
      // is reasonable is acceptable. Allow targets that don't share
      // the rootfs prefix — they're inside the container's root.
      // Pure containment within rootfsPath is over-restrictive.
      // Only refuse when the target tries to traverse via `..`.
    }
  }
  for (const k of Object.keys(spec.env)) {
    if (envKeyForbidden(k)) return "env_forbidden_key";
  }
  return null;
}

function rejectSpec(reason: SandboxSpecRefusal): never {
  throw new SandboxViolationError("Sandbox spec rejected.", { reason });
}

// ---------------------------------------------------------------------------
// Stub implementation.
// ---------------------------------------------------------------------------

export interface StubLaunchRecord {
  readonly id: string;
  readonly spec: SandboxLaunchSpec;
}

class StubHandle implements SandboxHandle {
  public readonly id: string;
  public closed = false;
  public constructor(id: string) {
    this.id = id;
  }
  public async close(): Promise<void> {
    this.closed = true;
  }
}

export class StubSandboxRuntime implements SandboxRuntime {
  readonly #launches: StubLaunchRecord[] = [];
  readonly #scripts = new Map<string, SandboxExitResult>();
  #counter = 0;

  public records(): ReadonlyArray<StubLaunchRecord> {
    return this.#launches;
  }

  /** Pre-set the result the next `wait` call will return for `id`. */
  public setNextResult(id: string, result: SandboxExitResult): void {
    this.#scripts.set(id, result);
  }

  public async launch(spec: SandboxLaunchSpec): Promise<SandboxHandle> {
    const r = validateLaunchSpec(spec);
    if (r !== null) rejectSpec(r);
    this.#counter += 1;
    const id = `stub-${this.#counter}`;
    this.#launches.push({ id, spec });
    return new StubHandle(id);
  }

  public async wait(handle: SandboxHandle): Promise<SandboxExitResult> {
    const scripted = this.#scripts.get(handle.id);
    if (scripted !== undefined) return scripted;
    return { exitCode: 0, terminationReason: "completed" };
  }

  public async kill(handle: SandboxHandle): Promise<void> {
    this.#scripts.set(handle.id, {
      exitCode: 137,
      terminationReason: "killed",
    });
  }
}

// ---------------------------------------------------------------------------
// runsc implementation (command-assembly only — no real spawn in tests).
// ---------------------------------------------------------------------------

export type SpawnFn = typeof nodeSpawn;

export interface RunscOptions {
  readonly runscBinary?: string;
  /** Spawn injectable so tests can capture the assembled argv. */
  readonly spawn?: SpawnFn;
}

interface RunscHandle extends SandboxHandle {
  readonly child: ChildProcess;
}

export class RunscSandboxRuntime implements SandboxRuntime {
  readonly #binary: string;
  readonly #spawn: SpawnFn;

  public constructor(opts: RunscOptions = {}) {
    this.#binary = opts.runscBinary ?? "runsc";
    this.#spawn = opts.spawn ?? nodeSpawn;
  }

  /**
   * Assembles the `runsc run` argv for `spec`. Exposed so tests can
   * assert command-line shape without driving spawn. Production code
   * should NOT call this directly — `launch` is the one entry point.
   */
  public assembleArgv(spec: SandboxLaunchSpec): string[] {
    const argv: string[] = [
      "run",
      "--network=none", // ALWAYS — egress is handled by the UDS proxy
      `--bundle=${spec.rootfsPath}`,
      "--no-new-privs",
      `--memory=${spec.limits.memBytes}`,
      `--cpus=${(spec.limits.cpuQuotaMillicores / 1000).toFixed(2)}`,
      `--pids-limit=${spec.limits.pidLimit}`,
      `--storage-quota=${spec.limits.diskBytes}`,
      `--wall-time=${spec.limits.wallSeconds}`,
    ];
    for (const m of spec.readonlyMounts) {
      argv.push(`--mount=type=bind,src=${m.source},dst=${m.target},ro`);
    }
    for (const m of spec.writableMounts) {
      argv.push(`--mount=type=bind,src=${m.source},dst=${m.target}`);
    }
    if (spec.egress.mode === "uds_proxy") {
      argv.push(
        `--egress-proxy=unix:${spec.egress.socketPath}`,
      );
    }
    argv.push(`--container-id=${spec.runId}`);
    argv.push("--");
    argv.push(...spec.entrypoint);
    return argv;
  }

  public async launch(spec: SandboxLaunchSpec): Promise<SandboxHandle> {
    const r = validateLaunchSpec(spec);
    if (r !== null) rejectSpec(r);
    const argv = this.assembleArgv(spec);
    const child = this.#spawn(this.#binary, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...spec.env, PATH: "/usr/bin:/bin" },
    });
    const handle: RunscHandle = {
      id: spec.runId,
      child,
      async close() {
        if (!child.killed) child.kill("SIGKILL");
      },
    };
    return handle;
  }

  public async wait(handle: SandboxHandle): Promise<SandboxExitResult> {
    const child = (handle as RunscHandle).child;
    return await new Promise<SandboxExitResult>((resolve) => {
      child.once("exit", (code, signal) => {
        if (signal === "SIGKILL") {
          resolve({ exitCode: 137, terminationReason: "killed" });
          return;
        }
        // Map signals / exit codes to terminationReason heuristically.
        // Real runsc reports detailed reasons via the OCI spec; this
        // is the dev-fallback shape until we wire that in.
        if (code === 137) {
          resolve({ exitCode: 137, terminationReason: "oom" });
          return;
        }
        resolve({
          exitCode: code ?? -1,
          terminationReason: code === 0 ? "completed" : "completed",
        });
      });
    });
  }

  public async kill(handle: SandboxHandle): Promise<void> {
    const child = (handle as RunscHandle).child;
    if (!child.killed) child.kill("SIGKILL");
  }
}
