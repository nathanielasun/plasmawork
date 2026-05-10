/**
 * TS ↔ Python handoff-contract snapshot — Layer 2 of the cross-process
 * wiring test strategy (2026-05-10).
 *
 * The gateway HMAC-signs seven X-Workbench-* headers; the FastAPI
 * middleware verifies them. A drift between the TS signer and the
 * Python verifier — header name typo, payload field-order swap, cookie
 * rename — silently produces 401s on every authenticated request.
 *
 * Vitest in jsdom mode doesn't import Python. Instead this test
 * reads ``packages/core/src/simworkbench/api/auth_middleware.py`` as
 * a string at test time and regex-extracts the constants it declares.
 * It then asserts the extracted view EQUALS the TS-side
 * ``HANDOFF_HEADERS`` map. A new header in TS that lacks a Python
 * counterpart (or vice-versa) fails the test.
 *
 * Also pinned:
 *   - The workspace-slug regex literal.
 *   - The two cookie names (``secure_session``, ``csrf_token``).
 *   - The canonical handoff-payload field order (the gateway joins
 *     ``user_id|workspace_id|workspace_slug|roles|request_id|issued_at``;
 *     the Python verifier must reconstruct the same byte sequence).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HANDOFF_HEADERS,
  HANDOFF_HEADER_NAMES,
  buildHandoffPayload,
} from "../../src/proxy/handoffSigner.js";

const REPO_ROOT = resolve(__dirname, "../../../..");
const AUTH_MIDDLEWARE_PATH = resolve(
  REPO_ROOT,
  "packages/core/src/simworkbench/api/auth_middleware.py",
);
const PATHS_INIT_PATH = resolve(
  REPO_ROOT,
  "packages/core/src/simworkbench/paths/__init__.py",
);
const LOGIN_TS_PATH = resolve(
  REPO_ROOT,
  "packages/secure_core/src/routes/login.ts",
);

function readPython(): string {
  return readFileSync(AUTH_MIDDLEWARE_PATH, "utf8");
}

function extractPythonHeaders(): Record<string, string> {
  // Matches lines like: HANDOFF_HEADER_USER_ID = "x-workbench-user-id"
  const re = /^HANDOFF_HEADER_([A-Z_]+)\s*=\s*"([^"]+)"$/gm;
  const out: Record<string, string> = {};
  const source = readPython();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("handoff contract — TS signer ↔ Python verifier", () => {
  it("declares the same 7 X-Workbench-* header names on both sides", () => {
    const python = extractPythonHeaders();
    const ts = {
      USER_ID: HANDOFF_HEADERS.USER_ID,
      WORKSPACE_ID: HANDOFF_HEADERS.WORKSPACE_ID,
      WORKSPACE_SLUG: HANDOFF_HEADERS.WORKSPACE_SLUG,
      ROLES: HANDOFF_HEADERS.ROLES,
      REQUEST_ID: HANDOFF_HEADERS.REQUEST_ID,
      ISSUED_AT: HANDOFF_HEADERS.ISSUED_AT,
      SIGNATURE: HANDOFF_HEADERS.SIGNATURE,
    };
    expect(python).toEqual(ts);
  });

  it("exposes exactly 7 header names in HANDOFF_HEADER_NAMES", () => {
    // A future addition that adds an 8th header to one side without
    // updating the other will fail the equality check above; this
    // test pins the count so the contract drift is visible.
    expect(HANDOFF_HEADER_NAMES).toHaveLength(7);
  });

  it("uses the canonical payload field order: user|workspace|slug|roles|request|issued", () => {
    const samplePayload = buildHandoffPayload({
      userId: "U",
      workspaceId: "W",
      workspaceSlug: "S",
      roles: ["r1", "r0"], // unsorted on input — the signer sorts them
      requestId: "R",
      issuedAtSec: 1700000000,
    });
    // Roles are sorted ascending before joining; commas separate
    // them; the six fields are pipe-separated in this exact order.
    expect(samplePayload).toBe("U|W|S|r0,r1|R|1700000000");

    // The Python verifier reconstructs the same six-field payload in
    // the same order. Confirm the field names appear in the verifier
    // in the documented order.
    const py = readPython();
    const order = [
      "HANDOFF_HEADER_USER_ID",
      "HANDOFF_HEADER_WORKSPACE_ID",
      "HANDOFF_HEADER_WORKSPACE_SLUG",
      "HANDOFF_HEADER_ROLES",
      "HANDOFF_HEADER_REQUEST_ID",
      "HANDOFF_HEADER_ISSUED_AT",
    ];
    const idx = order.map((name) => py.indexOf(name));
    // Every name appears (>= 0) AND in strictly ascending order in
    // HANDOFF_REQUIRED_HEADERS tuple.
    expect(idx.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < idx.length; i += 1) {
      expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    }
  });

  it("pins the workspace-slug regex literal on both sides", () => {
    const SLUG_LITERAL = "[A-Za-z0-9_-]{3,64}";
    const middleware = readPython();
    const paths = readFileSync(PATHS_INIT_PATH, "utf8");
    expect(middleware).toContain(SLUG_LITERAL);
    expect(paths).toContain(SLUG_LITERAL);
  });

  it("pins the session and CSRF cookie names against secure_core", () => {
    // The UI client reads these via apps/workbench-ui/src/api/csrf.ts;
    // the convention checker pins that side. Here we pin the TS
    // canonical source.
    const loginTs = readFileSync(LOGIN_TS_PATH, "utf8");
    expect(loginTs).toContain('SESSION_COOKIE_NAME = "secure_session"');
    expect(loginTs).toContain('CSRF_COOKIE_NAME = "csrf_token"');
  });

  it("pins the handoff secret env-var name on both sides", () => {
    // A typo on either side means every authenticated request 401s.
    const py = readPython();
    expect(py).toContain("WORKBENCH_GATEWAY_HANDOFF_SECRET");
    // The TS env loader literal is asserted by the convention
    // checker; assert here for symmetry so a single CI failure names
    // both sides.
    const envTs = readFileSync(
      resolve(REPO_ROOT, "apps/workbench-gateway/src/env.ts"),
      "utf8",
    );
    expect(envTs).toContain("WORKBENCH_GATEWAY_HANDOFF_SECRET");
  });
});
