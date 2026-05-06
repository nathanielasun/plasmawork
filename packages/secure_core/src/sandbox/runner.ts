/**
 * Sandbox runner — Phase 0.5 Layer 3 task L3.7.
 *
 * Drives one run end-to-end through the SandboxRuntime abstraction +
 * the L3.6 RunStateMachine. Never UPDATEs `simulation_runs` directly;
 * never spawns a container without going through the runtime.
 *
 *   created → running   (via stateMachine.transition; emits run.launched)
 *   running → completed | failed | cancelled
 *
 * sandbox.violation audit fires only on `terminationReason ===
 * "violation"`; OOM and timeout are quota trips, not security
 * violations.
 */

import type { AuditLogger } from "../audit/logger.js";
import type { RunStateMachine } from "../runs/stateMachine.js";
import type { WorkspacePathBuilder } from "../paths/builder.js";
import type {
  SandboxExitResult,
  SandboxHandle,
  SandboxLaunchSpec,
  SandboxLimits,
  SandboxRuntime,
} from "./runtime.js";

export interface SandboxRunnerOptions {
  readonly runtime: SandboxRuntime;
  readonly stateMachine: RunStateMachine;
  readonly auditLogger: AuditLogger;
  readonly pathBuilder: WorkspacePathBuilder;
  readonly defaultLimits: SandboxLimits;
  /** UNIX-domain-socket path for the egress proxy. Omit for `network: none`. */
  readonly egressProxySocket?: string;
}

export interface RunJobOptions {
  readonly runId: string;
  readonly workspaceId: string;
  readonly capsuleId: string;
  readonly capsuleVersionId: string;
  /** ABSOLUTE path to the read-only capsule snapshot. */
  readonly capsuleSnapshotPath: string;
  /** Closed entrypoint. Comes from capsule manifest, validated upstream. */
  readonly entrypoint: ReadonlyArray<string>;
  /** Closed env. Forbidden keys are stripped at the runtime boundary. */
  readonly env: Readonly<Record<string, string>>;
  readonly limitsOverride?: Partial<SandboxLimits>;
  /** Server-derived; never from req.body. */
  readonly actorUserId: string | null;
  readonly requestId: string;
}

export class SandboxRunner {
  readonly #runtime: SandboxRuntime;
  readonly #stateMachine: RunStateMachine;
  readonly #auditLogger: AuditLogger;
  readonly #pathBuilder: WorkspacePathBuilder;
  readonly #defaultLimits: SandboxLimits;
  readonly #egressProxySocket?: string;
  /** runId → handle map for cancelJob. */
  readonly #handles = new Map<string, SandboxHandle>();

  public constructor(opts: SandboxRunnerOptions) {
    this.#runtime = opts.runtime;
    this.#stateMachine = opts.stateMachine;
    this.#auditLogger = opts.auditLogger;
    this.#pathBuilder = opts.pathBuilder;
    this.#defaultLimits = opts.defaultLimits;
    this.#egressProxySocket = opts.egressProxySocket;
  }

  public async runJob(opts: RunJobOptions): Promise<SandboxExitResult> {
    // 1. Compute per-run writable mount path. The builder enforces
    //    v4 §9.4 component rules.
    const tempRunRoot = await this.#pathBuilder.build({
      workspaceId: opts.workspaceId,
      subpath: "temp_runs",
      relativePath: opts.runId,
    });

    // 2. Build the launch spec. Default-deny egress; opt in via the
    //    UDS proxy socket.
    const limits: SandboxLimits = {
      ...this.#defaultLimits,
      ...opts.limitsOverride,
    };
    const spec: SandboxLaunchSpec = {
      runId: opts.runId,
      workspaceId: opts.workspaceId,
      rootfsPath: tempRunRoot,
      readonlyMounts: [
        { source: opts.capsuleSnapshotPath, target: "/capsule" },
      ],
      writableMounts: [{ source: tempRunRoot, target: "/work" }],
      egress: this.#egressProxySocket
        ? { mode: "uds_proxy", socketPath: this.#egressProxySocket }
        : { mode: "none" },
      limits,
      entrypoint: opts.entrypoint,
      env: opts.env,
    };

    // 3. Transition to running. The state machine enforces the legal
    //    transition graph and emits run.launched.
    await this.#stateMachine.transition({
      runId: opts.runId,
      workspaceId: opts.workspaceId,
      expectedFromState: "queued",
      toState: "running",
      actorUserId: opts.actorUserId,
      actorType: "human",
      requestId: opts.requestId,
    });

    let handle: SandboxHandle | null = null;
    let result: SandboxExitResult;
    try {
      handle = await this.#runtime.launch(spec);
      this.#handles.set(opts.runId, handle);
      result = await this.#runtime.wait(handle);
    } finally {
      if (handle !== null) {
        try {
          await handle.close();
        } catch {
          // already closed; ignore
        }
        this.#handles.delete(opts.runId);
      }
    }

    // 4. Map terminationReason → state transition + audit.
    switch (result.terminationReason) {
      case "completed": {
        const next = result.exitCode === 0 ? "completed" : "failed";
        await this.#stateMachine.transition({
          runId: opts.runId,
          workspaceId: opts.workspaceId,
          expectedFromState: "running",
          toState: next,
          actorUserId: opts.actorUserId,
          actorType: "human",
          requestId: opts.requestId,
          failureMessage:
            next === "failed" ? `Worker exited with code ${result.exitCode}` : undefined,
        });
        break;
      }
      case "violation": {
        await this.#auditLogger.write({
          workspaceId: opts.workspaceId,
          actorUserId: null,
          actorType: "worker",
          action: "sandbox.violation",
          result: "denied",
          requestId: opts.requestId,
          metadata: {
            denied_reason: result.violationCause ?? "unknown",
          },
        });
        await this.#stateMachine.transition({
          runId: opts.runId,
          workspaceId: opts.workspaceId,
          expectedFromState: "running",
          toState: "failed",
          actorUserId: opts.actorUserId,
          actorType: "human",
          requestId: opts.requestId,
          failureMessage: "Sandbox violation.",
        });
        break;
      }
      case "timeout":
      case "oom": {
        await this.#stateMachine.transition({
          runId: opts.runId,
          workspaceId: opts.workspaceId,
          expectedFromState: "running",
          toState: "failed",
          actorUserId: opts.actorUserId,
          actorType: "human",
          requestId: opts.requestId,
          failureMessage:
            result.terminationReason === "oom"
              ? "Run exceeded memory quota."
              : "Run exceeded wall-time quota.",
        });
        break;
      }
      case "killed": {
        // Two paths land here: cancelJob signaled, or external SIGKILL.
        // The cancel path already moved the run to cancel_requested
        // before kill; finalize to cancelled.
        await this.#stateMachine.transition({
          runId: opts.runId,
          workspaceId: opts.workspaceId,
          expectedFromState: "cancel_requested",
          toState: "cancelled",
          actorUserId: opts.actorUserId,
          actorType: "human",
          requestId: opts.requestId,
        });
        break;
      }
    }

    return result;
  }

  public async cancelJob(opts: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly reason: string;
    readonly actorUserId: string | null;
    readonly requestId: string;
  }): Promise<void> {
    const handle = this.#handles.get(opts.runId);
    // Move to cancel_requested first so the runJob completion path can
    // legally finalize as 'cancelled'.
    await this.#stateMachine.transition({
      runId: opts.runId,
      workspaceId: opts.workspaceId,
      expectedFromState: "running",
      toState: "cancel_requested",
      actorUserId: opts.actorUserId,
      actorType: "human",
      requestId: opts.requestId,
      cancellationReason: opts.reason,
    });
    if (handle !== undefined) {
      await this.#runtime.kill(handle);
    }
  }
}
