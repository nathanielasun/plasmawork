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
  | "mount_source_not_absolute"
  | "mount_source_traversal"
  | "mount_source_not_allowed"
  | "env_forbidden_key"
  | "rootfs_not_absolute";

/**
 * Allowlist of host-path prefixes from which bind-mount SOURCES may
 * be drawn. Caller (the runner) constructs sources via the L2.10
 * `WorkspacePathBuilder`, so the SourceRoots are the workspace
 * storage roots configured at deploy time. Empty array means
 * "deny all bind mounts" (which forces the spec to have no mounts;
 * useful for hermetic-only runs).
 */
export interface SpecValidationOptions {
  readonly allowedSourceRoots: ReadonlyArray<string>;
}

function mountSourceRefusal(
  source: string,
  allowedRoots: ReadonlyArray<string>,
): SandboxSpecRefusal | null {
  if (!source.startsWith("/")) return "mount_source_not_absolute";
  if (source.includes("..")) return "mount_source_traversal";
  if (allowedRoots.length === 0) return "mount_source_not_allowed";
  for (const root of allowedRoots) {
    // Normalise both ends so a trailing slash on the allowed root
    // doesn't cause a false miss; require strict subpath OR equality.
    const r = root.endsWith("/") ? root.slice(0, -1) : root;
    if (source === r || isStrictSubpath(r, source)) {
      return null;
    }
  }
  return "mount_source_not_allowed";
}

export function validateLaunchSpec(
  spec: SandboxLaunchSpec,
  opts?: SpecValidationOptions,
): SandboxSpecRefusal | null {
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
  // Targets MUST be absolute paths inside the container's namespace
  // and MUST NOT contain `..`. Sources MUST be absolute, MUST NOT
  // contain `..`, and MUST be inside one of the allowed source roots
  // (defense in depth — the runner constructs sources through the
  // L2.10 path builder, but the runtime refuses anything that didn't
  // come through the same allowlist).
  const sourceRoots = opts?.allowedSourceRoots ?? [];
  for (const m of [...spec.readonlyMounts, ...spec.writableMounts]) {
    if (!m.target.startsWith("/")) return "mount_target_relative";
    if (m.target.includes("..")) return "mount_outside_rootfs";
    const r = mountSourceRefusal(m.source, sourceRoots);
    if (r !== null) return r;
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

export interface StubSandboxRuntimeOptions {
  /** Mount source allowlist (workspace storage roots). */
  readonly allowedSourceRoots: ReadonlyArray<string>;
}

export class StubSandboxRuntime implements SandboxRuntime {
  readonly #launches: StubLaunchRecord[] = [];
  readonly #scripts = new Map<string, SandboxExitResult>();
  readonly #allowedSourceRoots: ReadonlyArray<string>;
  #counter = 0;

  public constructor(opts: StubSandboxRuntimeOptions = { allowedSourceRoots: [] }) {
    this.#allowedSourceRoots = opts.allowedSourceRoots;
  }

  public records(): ReadonlyArray<StubLaunchRecord> {
    return this.#launches;
  }

  /** Pre-set the result the next `wait` call will return for `id`. */
  public setNextResult(id: string, result: SandboxExitResult): void {
    this.#scripts.set(id, result);
  }

  public async launch(spec: SandboxLaunchSpec): Promise<SandboxHandle> {
    const r = validateLaunchSpec(spec, {
      allowedSourceRoots: this.#allowedSourceRoots,
    });
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
  /** Mount source allowlist; required in production. */
  readonly allowedSourceRoots?: ReadonlyArray<string>;
}

interface RunscHandle extends SandboxHandle {
  readonly child: ChildProcess;
}

export class RunscSandboxRuntime implements SandboxRuntime {
  readonly #binary: string;
  readonly #spawn: SpawnFn;
  readonly #allowedSourceRoots: ReadonlyArray<string>;

  public constructor(opts: RunscOptions = {}) {
    this.#binary = opts.runscBinary ?? "runsc";
    this.#spawn = opts.spawn ?? nodeSpawn;
    this.#allowedSourceRoots = opts.allowedSourceRoots ?? [];
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
    const r = validateLaunchSpec(spec, {
      allowedSourceRoots: this.#allowedSourceRoots,
    });
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
