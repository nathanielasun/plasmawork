/**
 * v4 §29 sandbox security probes — Phase 0.5 Layer-3 follow-up.
 *
 * These tests pin the security invariants ADR-0009 + v4 §15 require
 * for the sandbox runtime. They split into two categories:
 *
 *   - Spec-level tests (always-on): assert the structural invariants
 *     enforced by `validateLaunchSpec` + `RunscSandboxRuntime.assembleArgv`.
 *     These run on any dev host; they prove the runtime CANNOT
 *     produce an unsafe spec, even when stub-driven.
 *   - Live container probes (skipped on dev hosts): require a real
 *     `runsc` binary + Linux kernel. Each is an `it.skip` with the
 *     §29 number embedded; Layer 5 wires `PLASMAWORK_RUNSC_PROBES=1`
 *     to enable them in the CI lane that ships gVisor.
 *
 * Until the live probes run, this file ALONE is not evidence that
 * gVisor enforcement holds — it is evidence that the spec the
 * runtime produces would, if executed, satisfy the invariants. The
 * Layer-5 acceptance criteria require both layers green.
 */

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";

import {
  RunscSandboxRuntime,
  validateLaunchSpec,
  type SandboxLaunchSpec,
  type SpawnFn,
} from "../../src/sandbox/runtime.js";

/**
 * Live-runtime probes require both:
 *   - the operator opting in via PLASMAWORK_RUNSC_PROBES=1, AND
 *   - a working `runsc` binary on PATH.
 * Either condition false → skip with an explicit reason. This way
 * the env-gate doesn't surface "not implemented" failures on dev
 * hosts that lack gVisor.
 */
function detectRunscAvailable(): boolean {
  if (process.env.PLASMAWORK_RUNSC_PROBES !== "1") return false;
  try {
    const r = spawnSync("runsc", ["--version"], {
      stdio: "ignore",
      timeout: 2000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAVE_LIVE_PROBES = detectRunscAvailable();

const BASE_LIMITS = {
  cpuQuotaMillicores: 1000,
  memBytes: 256 * 1024 * 1024,
  wallSeconds: 300,
  pidLimit: 64,
  diskBytes: 1024 * 1024 * 1024,
};

const ALLOWED_SOURCES = ["/snapshot", "/tmp/rootfs"] as const;

function spec(over: Partial<SandboxLaunchSpec> = {}): SandboxLaunchSpec {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    rootfsPath: "/tmp/rootfs",
    readonlyMounts: [{ source: "/snapshot", target: "/capsule" }],
    writableMounts: [{ source: "/tmp/rootfs/work", target: "/work" }],
    egress: { mode: "none" },
    limits: BASE_LIMITS,
    entrypoint: ["/bin/run.sh"],
    env: {},
    ...over,
  };
}

describe("§29 sandbox spec invariants (always-on)", () => {
  it("§29 #38 — egress is default-deny (network=none) when no proxy is configured", () => {
    const r = new RunscSandboxRuntime({ allowedSourceRoots: ALLOWED_SOURCES });
    const argv = r.assembleArgv(spec());
    expect(argv).toContain("--network=none");
    expect(argv.some((a) => a.includes("--egress-proxy"))).toBe(false);
  });

  it("§29 #39 — egress only opens via UDS proxy when explicitly configured", () => {
    const r = new RunscSandboxRuntime({ allowedSourceRoots: ALLOWED_SOURCES });
    const argv = r.assembleArgv(
      spec({ egress: { mode: "uds_proxy", socketPath: "/run/proxy.sock" } }),
    );
    expect(argv).toContain("--egress-proxy=unix:/run/proxy.sock");
    // network=none stays — the proxy is the only channel.
    expect(argv).toContain("--network=none");
  });

  it("§29 #40 — no privileged flag is ever emitted", () => {
    const r = new RunscSandboxRuntime({ allowedSourceRoots: ALLOWED_SOURCES });
    const argv = r.assembleArgv(spec());
    expect(argv.some((a) => a.includes("privileged"))).toBe(false);
    expect(argv).toContain("--no-new-privs");
  });

  it("§29 #41 — DB / AWS / secret env keys are stripped before spawn", async () => {
    const fakeSpawn = vi
      .fn()
      .mockReturnValue({
        once: vi.fn(),
        kill: vi.fn(),
        killed: false,
      }) as unknown as SpawnFn;
    const r = new RunscSandboxRuntime({
      spawn: fakeSpawn,
      allowedSourceRoots: ALLOWED_SOURCES,
    });
    await expect(
      r.launch(
        spec({
          env: {
            AWS_SECRET_ACCESS_KEY: "leaked",
            DATABASE_URL: "postgres://...",
            PLASMAWORK_DB_URL: "postgres://...",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_VIOLATION" });
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it("§29 #42 — bind-mount sources outside the allowlist are refused", () => {
    expect(
      validateLaunchSpec(
        spec({ writableMounts: [{ source: "/etc", target: "/work" }] }),
        { allowedSourceRoots: ALLOWED_SOURCES },
      ),
    ).toBe("mount_source_not_allowed");
  });

  it("§29 #43 — empty allowlist forbids ALL bind mounts (hermetic-only)", () => {
    expect(
      validateLaunchSpec(spec(), { allowedSourceRoots: [] }),
    ).toBe("mount_source_not_allowed");
  });

  it("§29 #67 — wall-time limit is forwarded to runsc as --wall-time", () => {
    const r = new RunscSandboxRuntime({ allowedSourceRoots: ALLOWED_SOURCES });
    const argv = r.assembleArgv(
      spec({ limits: { ...BASE_LIMITS, wallSeconds: 60 } }),
    );
    expect(argv).toContain("--wall-time=60");
  });
});

describe("§29 sandbox live-container probes (require runsc — skipped on dev hosts)", () => {
  // Each test gates on PLASMAWORK_RUNSC_PROBES=1 AND `runsc --version`
  // succeeding. Both conditions false → `it.skip` with a clear
  // message so the env-gate doesn't surface "not implemented"
  // failures on dev hosts that lack gVisor. Marked as `it.todo` (vs
  // `expect.fail`) so the green CI lane reports honest accounting:
  // todos are visible without breaking the build, and the
  // implementing agent can flip each to a real probe one at a time.
  //
  // Layer 5 (or whichever PR ships gVisor in CI) replaces the
  // `it.todo` with a concrete container probe. The spec-level
  // invariants above already pin the argv emission for each §29
  // number — these LIVE counterparts prove gVisor enforces what we
  // ask it to.

  it.skipIf(!HAVE_LIVE_PROBES).todo(
    "§29 #38 LIVE — egress without proxy fails: container cannot reach 8.8.8.8",
  );

  it.skipIf(!HAVE_LIVE_PROBES).todo(
    "§29 #41 LIVE — DNS resolver inside sandbox returns NXDOMAIN for arbitrary hosts",
  );

  it.skipIf(!HAVE_LIVE_PROBES).todo(
    "§29 #67 LIVE — 5-minute tight loop is killed by --wall-time before exit",
  );

  it.skipIf(!HAVE_LIVE_PROBES).todo(
    "§29 #67 LIVE — fork bomb is killed by --pids-limit",
  );

  it.skipIf(!HAVE_LIVE_PROBES).todo(
    "§29 #67 LIVE — memory bomb is killed by --memory before host OOM",
  );

  it.skipIf(!HAVE_LIVE_PROBES).todo(
    "§29 #67 LIVE — 100 GB write is killed by --storage-quota",
  );
});
