/**
 * L3.7 — sandbox runtime contract tests.
 *
 * Pure-logic. RunscSandboxRuntime is exercised by spec validation +
 * argv assembly with an injectable spawn; no real container starts.
 * StubSandboxRuntime drives the runner tests.
 */

import { describe, it, expect, vi } from "vitest";

import {
  RunscSandboxRuntime,
  StubSandboxRuntime,
  validateLaunchSpec,
  type SandboxLaunchSpec,
  type SpawnFn,
} from "../../src/sandbox/runtime.js";
import { SandboxViolationError } from "../../src/errors/shapes.js";

const BASE_LIMITS = {
  cpuQuotaMillicores: 1000,
  memBytes: 256 * 1024 * 1024,
  wallSeconds: 300,
  pidLimit: 64,
  diskBytes: 1024 * 1024 * 1024,
};

function baseSpec(over: Partial<SandboxLaunchSpec> = {}): SandboxLaunchSpec {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    rootfsPath: "/tmp/rootfs",
    readonlyMounts: [{ source: "/snapshot", target: "/capsule" }],
    writableMounts: [{ source: "/tmp/rootfs/work", target: "/work" }],
    egress: { mode: "none" },
    limits: BASE_LIMITS,
    entrypoint: ["/bin/run.sh"],
    env: { LOG_LEVEL: "info" },
    ...over,
  };
}

describe("validateLaunchSpec", () => {
  it("accepts a clean spec", () => {
    expect(validateLaunchSpec(baseSpec())).toBeNull();
  });

  it("rejects empty entrypoint", () => {
    expect(validateLaunchSpec(baseSpec({ entrypoint: [] }))).toBe(
      "empty_entrypoint",
    );
  });

  it("rejects uds_proxy mode without socketPath", () => {
    expect(
      validateLaunchSpec(
        baseSpec({ egress: { mode: "uds_proxy", socketPath: "" } }),
      ),
    ).toBe("egress_socket_missing");
  });

  it.each([
    ["cpuQuotaMillicores", 0],
    ["cpuQuotaMillicores", -1],
    ["memBytes", 0],
    ["wallSeconds", 0],
    ["pidLimit", 0],
    ["diskBytes", -100],
  ])("rejects non-positive limit %s=%i", (k, v) => {
    expect(
      validateLaunchSpec(
        baseSpec({ limits: { ...BASE_LIMITS, [k]: v } as never }),
      ),
    ).toBe("limit_non_positive");
  });

  it("rejects relative mount target", () => {
    expect(
      validateLaunchSpec(
        baseSpec({
          writableMounts: [{ source: "/x", target: "relative/dir" }],
        }),
      ),
    ).toBe("mount_target_relative");
  });

  it("rejects mount target containing ..", () => {
    expect(
      validateLaunchSpec(
        baseSpec({
          writableMounts: [{ source: "/x", target: "/work/../etc" }],
        }),
      ),
    ).toBe("mount_outside_rootfs");
  });

  it.each([
    "AWS_SECRET_ACCESS_KEY",
    "DATABASE_URL",
    "PLASMAWORK_DB_URL",
    "MY_PRIVATE_KEY",
    "GITHUB_TOKEN",
    "STRIPE_SECRET",
    "SOME_PASSWORD",
    "POSTGRES_USER",
    "PGPASSWORD",
  ])("strips forbidden env key %s", (key) => {
    expect(
      validateLaunchSpec(baseSpec({ env: { [key]: "x" } })),
    ).toBe("env_forbidden_key");
  });

  it("rejects non-absolute rootfs", () => {
    expect(validateLaunchSpec(baseSpec({ rootfsPath: "rootfs" }))).toBe(
      "rootfs_not_absolute",
    );
  });
});

describe("RunscSandboxRuntime.assembleArgv", () => {
  it("always includes --network=none", () => {
    const r = new RunscSandboxRuntime();
    const argv = r.assembleArgv(baseSpec());
    expect(argv).toContain("--network=none");
  });

  it("never includes --privileged", () => {
    const r = new RunscSandboxRuntime();
    const argv = r.assembleArgv(baseSpec());
    expect(argv.some((a) => a.includes("privileged"))).toBe(false);
  });

  it("includes --no-new-privs", () => {
    const r = new RunscSandboxRuntime();
    const argv = r.assembleArgv(baseSpec());
    expect(argv).toContain("--no-new-privs");
  });

  it("encodes mounts as bind type", () => {
    const r = new RunscSandboxRuntime();
    const argv = r.assembleArgv(baseSpec());
    expect(
      argv.some((a) => a === "--mount=type=bind,src=/snapshot,dst=/capsule,ro"),
    ).toBe(true);
    expect(
      argv.some(
        (a) => a === "--mount=type=bind,src=/tmp/rootfs/work,dst=/work",
      ),
    ).toBe(true);
  });

  it("encodes uds_proxy egress when configured", () => {
    const r = new RunscSandboxRuntime();
    const argv = r.assembleArgv(
      baseSpec({ egress: { mode: "uds_proxy", socketPath: "/run/proxy.sock" } }),
    );
    expect(argv).toContain("--egress-proxy=unix:/run/proxy.sock");
  });

  it("encodes resource limits in millicores → cores", () => {
    const r = new RunscSandboxRuntime();
    const argv = r.assembleArgv(
      baseSpec({
        limits: { ...BASE_LIMITS, cpuQuotaMillicores: 2500 },
      }),
    );
    expect(argv).toContain("--cpus=2.50");
  });
});

describe("RunscSandboxRuntime.launch", () => {
  it("refuses bad specs before reaching spawn", async () => {
    const fakeSpawn = vi.fn() as unknown as SpawnFn;
    const r = new RunscSandboxRuntime({ spawn: fakeSpawn });
    await expect(r.launch(baseSpec({ entrypoint: [] }))).rejects.toBeInstanceOf(
      SandboxViolationError,
    );
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it("calls spawn with --network=none for valid specs", async () => {
    const fakeSpawn = vi
      .fn()
      .mockReturnValue({
        once: vi.fn(),
        kill: vi.fn(),
        killed: false,
      }) as unknown as SpawnFn;
    const r = new RunscSandboxRuntime({ spawn: fakeSpawn });
    await r.launch(baseSpec());
    const fakeSpawnMock = fakeSpawn as unknown as ReturnType<typeof vi.fn>;
    const argv = fakeSpawnMock.mock.calls[0][1] as string[];
    expect(argv).toContain("--network=none");
  });
});

describe("StubSandboxRuntime", () => {
  it("records launches and refuses bad specs", async () => {
    const r = new StubSandboxRuntime();
    await expect(r.launch(baseSpec({ entrypoint: [] }))).rejects.toBeInstanceOf(
      SandboxViolationError,
    );
    expect(r.records()).toHaveLength(0);
  });

  it("returns scripted exit results", async () => {
    const r = new StubSandboxRuntime();
    const handle = await r.launch(baseSpec());
    r.setNextResult(handle.id, {
      exitCode: 1,
      terminationReason: "violation",
      violationCause: "test_inject",
    });
    const result = await r.wait(handle);
    expect(result.terminationReason).toBe("violation");
    expect(result.exitCode).toBe(1);
  });

  it("kill flips wait result to killed", async () => {
    const r = new StubSandboxRuntime();
    const handle = await r.launch(baseSpec());
    await r.kill(handle);
    const result = await r.wait(handle);
    expect(result.terminationReason).toBe("killed");
  });
});
