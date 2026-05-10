/**
 * Cross-process HMAC handoff smoke — Layer 4 of the cross-process
 * wiring test strategy (2026-05-10).
 *
 * Spawns the real FastAPI workbench as a subprocess with a known
 * ``WORKBENCH_GATEWAY_HANDOFF_SECRET``, then POSTs signed handoff
 * headers DIRECTLY to FastAPI from this Node test using the gateway's
 * own ``buildHandoffHeaders`` function. This proves the contract is
 * byte-compatible end-to-end:
 *
 *   1. The gateway's HMAC-SHA256 over the canonical payload string
 *      produces bytes the Python verifier accepts.
 *   2. A wrong secret value (right env-var name) produces a 401 —
 *      the failure mode that static checks (Layer 1) can't catch.
 *   3. FastAPI's ``SIMWORKBENCH_REQUIRE_GATEWAY=1`` mode actually
 *      mounts the middleware and refuses unsigned requests.
 *
 * GATING — opt-in via PLASMAWORK_CROSS_PROCESS_SMOKE=1. Default CI
 * does not run this test because it requires:
 *   - a working ``.venv/bin/python`` with the workbench installed,
 *   - the freedom to spawn a subprocess and bind a local port.
 *
 * Local invocation:
 *   PLASMAWORK_CROSS_PROCESS_SMOKE=1 \
 *     npm --prefix apps/workbench-gateway test -- --run proxyToFastApi.test.ts
 *
 * The test runs `scripts/dev/run_backend.py` to start FastAPI. That
 * launcher pins host = 127.0.0.1 (pinned by the convention checker)
 * so this test cannot accidentally bind to a network interface.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHandoffHeaders,
  type HandoffPayload,
} from "../../src/proxy/handoffSigner.js";

const REPO_ROOT = resolve(__dirname, "../../../..");
const GATED = process.env.PLASMAWORK_CROSS_PROCESS_SMOKE === "1";

// The handoff secret used for the happy-path subprocess. Length must
// meet the gateway's minimum (32 bytes); use a deterministic literal
// that's obviously test-only.
const HAPPY_SECRET = "smoke-test-handoff-secret-" + "x".repeat(20);
const WRONG_SECRET = "smoke-test-handoff-secret-" + "y".repeat(20);

const SAMPLE_PAYLOAD = (issuedAtSec: number): HandoffPayload => ({
  userId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  workspaceSlug: "shared-public-experiments",
  roles: ["WorkspaceAdmin"],
  requestId: "33333333-3333-4333-8333-333333333333",
  issuedAtSec,
});

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolveFn, rejectFn) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectFn);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (typeof address !== "object" || address === null) {
        rejectFn(new Error("findFreePort: unexpected address"));
        return;
      }
      const port = address.port;
      srv.close((err) => {
        if (err) rejectFn(err);
        else resolveFn(port);
      });
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {
      // not yet listening
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`FastAPI on :${port} did not become ready within ${timeoutMs}ms`);
}

function resolvePython(): string {
  // Match the .venv resolution in scripts/dev/run_backend.py.
  const venv = resolve(REPO_ROOT, ".venv/bin/python");
  return venv;
}

async function spawnFastApi(opts: {
  readonly port: number;
  readonly handoffSecret: string;
}): Promise<ChildProcess> {
  const python = resolvePython();
  const proc = spawn(
    python,
    [
      "scripts/dev/run_backend.py",
      "--host",
      "127.0.0.1",
      "--port",
      String(opts.port),
      "--log-level",
      "warning",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        WORKBENCH_GATEWAY_HANDOFF_SECRET: opts.handoffSecret,
        SIMWORKBENCH_REQUIRE_GATEWAY: "1",
        // Avoid the preview sandbox surface entirely — Layer 4 only
        // exercises the auth handoff.
        WORKBENCH_PREVIEW_SANDBOX_COMMAND: "",
        WORKBENCH_PREVIEW_SANDBOX_RUNTIME: "",
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  await waitForHealth(opts.port);
  return proc;
}

function killChild(proc: ChildProcess | undefined): Promise<void> {
  if (proc === undefined || proc.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolveFn) => {
    proc.once("exit", () => resolveFn());
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 2_000);
  });
}

describe.runIf(GATED)("cross-process HMAC handoff (gated)", () => {
  let happyProc: ChildProcess | undefined;
  let wrongProc: ChildProcess | undefined;
  let happyPort: number;
  let wrongPort: number;

  beforeAll(async () => {
    happyPort = await findFreePort();
    wrongPort = await findFreePort();
    happyProc = await spawnFastApi({
      port: happyPort,
      handoffSecret: HAPPY_SECRET,
    });
    wrongProc = await spawnFastApi({
      port: wrongPort,
      handoffSecret: WRONG_SECRET,
    });
  }, 60_000);

  afterAll(async () => {
    await killChild(happyProc);
    await killChild(wrongProc);
  });

  it("FastAPI /api/health is reachable without a handoff (bypass list)", async () => {
    const r = await fetch(`http://127.0.0.1:${happyPort}/api/health`);
    expect(r.ok).toBe(true);
  });

  it("FastAPI refuses /api/runs without any handoff headers in required mode", async () => {
    // SIMWORKBENCH_REQUIRE_GATEWAY=1 means the middleware mounts and
    // workspace_slug_dep raises 401 without a valid handoff.
    const r = await fetch(`http://127.0.0.1:${happyPort}/api/runs`);
    expect(r.status).toBe(401);
  });

  it("FastAPI accepts a request signed with the matching handoff secret", async () => {
    const issuedAtSec = Math.floor(Date.now() / 1000);
    const headers = buildHandoffHeaders(SAMPLE_PAYLOAD(issuedAtSec), HAPPY_SECRET);
    const r = await fetch(`http://127.0.0.1:${happyPort}/api/runs`, { headers });
    // Anything that ISN'T 401 means the HMAC was accepted. The
    // handler may 200, 404, or 5xx depending on workspace state; the
    // contract under test is the HMAC verification.
    expect(r.status).not.toBe(401);
  });

  it("FastAPI rejects a request signed with the WRONG handoff secret", async () => {
    // Same payload, signed with the wrong secret, sent to the
    // wrong-secret FastAPI: HAPPY_SECRET signature does not match
    // WRONG_SECRET on the verifier side, so the middleware refuses.
    const issuedAtSec = Math.floor(Date.now() / 1000);
    const headers = buildHandoffHeaders(SAMPLE_PAYLOAD(issuedAtSec), HAPPY_SECRET);
    const r = await fetch(`http://127.0.0.1:${wrongPort}/api/runs`, { headers });
    expect(r.status).toBe(401);
  });

  it("FastAPI rejects a stale handoff (replay window exceeded)", async () => {
    // Issue an 'issuedAt' that's 5 minutes old. The middleware's
    // 30s replay window must reject it.
    const stale = Math.floor(Date.now() / 1000) - 300;
    const headers = buildHandoffHeaders(SAMPLE_PAYLOAD(stale), HAPPY_SECRET);
    const r = await fetch(`http://127.0.0.1:${happyPort}/api/runs`, { headers });
    expect(r.status).toBe(401);
  });
});

// Default-CI placeholder: when the gate is OFF, advertise the gate
// in test output so an operator running `npm test` locally sees it.
describe.skipIf(GATED)("cross-process HMAC handoff (skipped — gate off)", () => {
  it.skip("set PLASMAWORK_CROSS_PROCESS_SMOKE=1 to enable", () => {
    /* intentionally empty */
  });
});
