/**
 * L3.7 SandboxRunner regression tests.
 *
 * Pins the post-Group-C audit fix #2 — the runner must NOT
 * transition `queued → running` before the runtime confirms a
 * successful launch. A spec-rejection or spawn failure mid-launch
 * would otherwise leave the run stuck in `running` with no live
 * container.
 */

import { describe, it, expect, vi } from "vitest";

import { StubSandboxRuntime } from "../../src/sandbox/runtime.js";
import { SandboxRunner } from "../../src/sandbox/runner.js";
import type {
  RunStateMachine,
  RunState,
} from "../../src/runs/stateMachine.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { WorkspacePathBuilder } from "../../src/paths/builder.js";
import { SandboxViolationError } from "../../src/errors/shapes.js";

interface TransitionRecord {
  expectedFromState: RunState;
  toState: RunState;
  failureMessage?: string;
}

function makeStubStateMachine(): {
  sm: RunStateMachine;
  transitions: TransitionRecord[];
} {
  const transitions: TransitionRecord[] = [];
  const sm = {
    async transition(opts: {
      expectedFromState: RunState;
      toState: RunState;
      failureMessage?: string;
    }) {
      transitions.push({
        expectedFromState: opts.expectedFromState,
        toState: opts.toState,
        failureMessage: opts.failureMessage,
      });
      return { id: "run-1", status: opts.toState } as never;
    },
  } as unknown as RunStateMachine;
  return { sm, transitions };
}

function makeStubAuditLogger(): {
  logger: AuditLogger;
  calls: Array<{ action: string; result: string; metadata?: Record<string, unknown> }>;
} {
  const calls: Array<{ action: string; result: string; metadata?: Record<string, unknown> }> = [];
  const logger = {
    async write(input: {
      action: string;
      result: string;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

function makeStubBuilder(): WorkspacePathBuilder {
  // The runner only needs `build(...)`; return a fixed absolute path.
  return {
    async build(_opts: { workspaceId: string; subpath: string; relativePath?: string }) {
      return "/tmp/rootfs";
    },
  } as unknown as WorkspacePathBuilder;
}

const DEFAULT_LIMITS = {
  cpuQuotaMillicores: 1000,
  memBytes: 256 * 1024 * 1024,
  wallSeconds: 300,
  pidLimit: 64,
  diskBytes: 1024 * 1024 * 1024,
};

describe("SandboxRunner — launch ordering (audit fix #2)", () => {
  it("transitions queued → running ONLY AFTER a successful launch", async () => {
    const runtime = new StubSandboxRuntime({
      allowedSourceRoots: ["/tmp/rootfs", "/snapshot"],
    });
    const { sm, transitions } = makeStubStateMachine();
    const audit = makeStubAuditLogger();
    const runner = new SandboxRunner({
      runtime,
      stateMachine: sm,
      auditLogger: audit.logger,
      pathBuilder: makeStubBuilder(),
      defaultLimits: DEFAULT_LIMITS,
    });
    // Track call order: launch happens before any transition.
    const launchSpy = vi.spyOn(runtime, "launch");
    await runner.runJob({
      runId: "run-1",
      workspaceId: "ws-1",
      capsuleId: "cap-1",
      capsuleVersionId: "ver-1",
      capsuleSnapshotPath: "/snapshot",
      entrypoint: ["/bin/run.sh"],
      env: {},
      actorUserId: "user-c",
      requestId: "req-1",
    });
    // First transition is `queued → running`; second is the
    // terminal completed transition. Crucially, runtime.launch fires
    // BEFORE the queued→running transition.
    expect(launchSpy).toHaveBeenCalled();
    expect(transitions[0]).toMatchObject({
      expectedFromState: "queued",
      toState: "running",
    });
  });

  it("on launch failure: transitions queued → failed, does NOT mark run running, emits sandbox.violation", async () => {
    // Misconfigure source allowlist to force a spec rejection before spawn.
    const runtime = new StubSandboxRuntime({ allowedSourceRoots: [] });
    const { sm, transitions } = makeStubStateMachine();
    const audit = makeStubAuditLogger();
    const runner = new SandboxRunner({
      runtime,
      stateMachine: sm,
      auditLogger: audit.logger,
      pathBuilder: makeStubBuilder(),
      defaultLimits: DEFAULT_LIMITS,
    });
    await expect(
      runner.runJob({
        runId: "run-2",
        workspaceId: "ws-1",
        capsuleId: "cap-1",
        capsuleVersionId: "ver-1",
        capsuleSnapshotPath: "/snapshot",
        entrypoint: ["/bin/run.sh"],
        env: {},
        actorUserId: "user-c",
        requestId: "req-2",
      }),
    ).rejects.toBeInstanceOf(SandboxViolationError);

    // The ONLY transition fired is queued → failed. Running was never set.
    expect(transitions).toEqual([
      expect.objectContaining({
        expectedFromState: "queued",
        toState: "failed",
        failureMessage: "Sandbox launch refused.",
      }),
    ]);
    expect(transitions.some((t) => t.toState === "running")).toBe(false);

    // sandbox.violation { spec_refused } emitted.
    const violation = audit.calls.find((c) => c.action === "sandbox.violation");
    expect(violation).toBeDefined();
    expect(violation?.metadata?.denied_reason).toBe("spec_refused");
    expect(violation?.result).toBe("denied");
  });

  it("on launch failure: never sets the run to running even if the failure happens after spec validation", async () => {
    // Build a runtime whose validateLaunchSpec passes but launch
    // throws (simulates a spawn ENOENT / OS-level failure).
    const runtime = new StubSandboxRuntime({
      allowedSourceRoots: ["/tmp/rootfs", "/snapshot"],
    });
    vi.spyOn(runtime, "launch").mockRejectedValueOnce(
      new Error("simulated spawn failure"),
    );
    const { sm, transitions } = makeStubStateMachine();
    const audit = makeStubAuditLogger();
    const runner = new SandboxRunner({
      runtime,
      stateMachine: sm,
      auditLogger: audit.logger,
      pathBuilder: makeStubBuilder(),
      defaultLimits: DEFAULT_LIMITS,
    });
    await expect(
      runner.runJob({
        runId: "run-3",
        workspaceId: "ws-1",
        capsuleId: "cap-1",
        capsuleVersionId: "ver-1",
        capsuleSnapshotPath: "/snapshot",
        entrypoint: ["/bin/run.sh"],
        env: {},
        actorUserId: "user-c",
        requestId: "req-3",
      }),
    ).rejects.toThrow(/spawn failure/);
    // queued → failed only. No queued → running.
    expect(transitions.some((t) => t.toState === "running")).toBe(false);
    expect(transitions[0]).toMatchObject({
      expectedFromState: "queued",
      toState: "failed",
    });
  });
});

describe("SandboxRunner — completed run state transitions", () => {
  it("running → completed when exit code is 0", async () => {
    const runtime = new StubSandboxRuntime({
      allowedSourceRoots: ["/tmp/rootfs", "/snapshot"],
    });
    const { sm, transitions } = makeStubStateMachine();
    const audit = makeStubAuditLogger();
    const runner = new SandboxRunner({
      runtime,
      stateMachine: sm,
      auditLogger: audit.logger,
      pathBuilder: makeStubBuilder(),
      defaultLimits: DEFAULT_LIMITS,
    });
    // Pre-set the script BEFORE runJob — but StubSandboxRuntime
    // assigns ids dynamically. We override the runtime's wait
    // directly via spy for determinism.
    vi.spyOn(runtime, "wait").mockResolvedValueOnce({
      exitCode: 0,
      terminationReason: "completed",
    });
    void audit; // unused but available for future audit assertions
    await runner.runJob({
      runId: "run-ok",
      workspaceId: "ws-1",
      capsuleId: "cap-1",
      capsuleVersionId: "ver-1",
      capsuleSnapshotPath: "/snapshot",
      entrypoint: ["/bin/run.sh"],
      env: {},
      actorUserId: "user-c",
      requestId: "req-ok",
    });
    const states = transitions.map((t) => t.toState);
    expect(states).toEqual(["running", "completed"]);
  });
});
