/**
 * L2.10 workspace path builder — behavior tests.
 *
 * Pins:
 *   - v4 §9.1 directory pattern (8 subpaths, exact ordering).
 *   - v4 §9.2 UUID v4 workspace id rule.
 *   - v4 §9.3 builder signature (workspaceId + subpath + relative).
 *   - v4 §9.4 component-rule rejection paths and the §9.4.1–§9.4.2
 *     containment rule.
 *   - One `path_access.denied` audit row per rejection (no fan-out).
 *
 * Uses a real on-disk temp dir as the storage root so the safeOpen
 * containment check has actual directories to walk.
 */

import { promises as fsPromises } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AuditLogger, type PreparedAuditRow } from "../../src/audit/logger.js";
import { PathInvalidError } from "../../src/errors/shapes.js";
import {
  isWorkspaceSubpath,
  WorkspacePathBuilder,
  WORKSPACE_SUBPATHS,
  type WorkspaceSubpath,
} from "../../src/paths/builder.js";
import { repoRoot } from "../../src/secrets/repoRoot.js";

const VALID_WORKSPACE_ID = "0a3f2b21-4c81-4b42-9b6d-2e0f4a1c8b97"; // v4
const OTHER_WORKSPACE_ID = "11112222-3333-4abc-9def-555566667777"; // v4

let TMP_ROOT: string;
let STORAGE_ROOT: string;

interface AuditHarness {
  logger: AuditLogger;
  rows: PreparedAuditRow[];
  writerCalls: { n: number };
}

function makeAuditHarness(): AuditHarness {
  const rows: PreparedAuditRow[] = [];
  const writerCalls = { n: 0 };
  let prevHash: string | null = null;
  const logger = new AuditLogger({
    writer: async (row) => {
      writerCalls.n += 1;
      rows.push(row);
      prevHash = row.row_hash;
    },
    prevHashGetter: async () => prevHash,
  });
  return { logger, rows, writerCalls };
}

beforeAll(async () => {
  TMP_ROOT = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "secure-core-l210-builder-"),
  );
  STORAGE_ROOT = path.join(TMP_ROOT, "storage");
  // Pre-create both workspace directories with all 8 subpaths so the
  // verify-mode walk has a directory tree to canonicalize against.
  for (const wsId of [VALID_WORKSPACE_ID, OTHER_WORKSPACE_ID]) {
    for (const sub of WORKSPACE_SUBPATHS) {
      await fsPromises.mkdir(
        path.join(STORAGE_ROOT, "workspaces", wsId, sub),
        { recursive: true },
      );
    }
  }
});

afterAll(async () => {
  await fsPromises.rm(TMP_ROOT, { recursive: true, force: true });
});

describe("WORKSPACE_SUBPATHS — v4 §9.1", () => {
  it("enumerates the eight subpaths in §9.1 order", () => {
    expect(WORKSPACE_SUBPATHS).toHaveLength(8);
    expect([...WORKSPACE_SUBPATHS]).toEqual([
      "simulation_capsules",
      "temp_runs",
      "local_cache",
      "temp_imports",
      "generated_code",
      "imported_tools",
      "exported_reports",
      "audit_exports",
    ]);
  });

  it("isWorkspaceSubpath accepts every documented subpath and rejects others", () => {
    for (const s of WORKSPACE_SUBPATHS) expect(isWorkspaceSubpath(s)).toBe(true);
    expect(isWorkspaceSubpath("nope")).toBe(false);
    expect(isWorkspaceSubpath("")).toBe(false);
    expect(isWorkspaceSubpath(null)).toBe(false);
  });
});

describe("WorkspacePathBuilder.workspaceRoot / workspaceSubpathRoot", () => {
  let harness: AuditHarness;
  let builder: WorkspacePathBuilder;

  beforeEach(() => {
    harness = makeAuditHarness();
    builder = new WorkspacePathBuilder({
      workspaceStorageRoot: STORAGE_ROOT,
      auditLogger: harness.logger,
    });
  });

  it("rejects a non-UUID workspaceId via PathInvalidError", () => {
    expect(() => builder.workspaceRoot("not-a-uuid")).toThrow(PathInvalidError);
  });

  it("places every subpath under workspaces/<id>/<subpath>", () => {
    for (const sub of WORKSPACE_SUBPATHS) {
      const root = builder.workspaceSubpathRoot(VALID_WORKSPACE_ID, sub);
      expect(root).toBe(
        path.join(STORAGE_ROOT, "workspaces", VALID_WORKSPACE_ID, sub),
      );
    }
  });

  it("defaults to <repo>/local_cache/workspaces/<id> without duplicating workspaces", () => {
    const defaultBuilder = new WorkspacePathBuilder({});
    expect(defaultBuilder.workspaceRoot(VALID_WORKSPACE_ID)).toBe(
      path.join(repoRoot(), "local_cache", "workspaces", VALID_WORKSPACE_ID),
    );
  });
});

describe("WorkspacePathBuilder.build — happy path", () => {
  let harness: AuditHarness;
  let builder: WorkspacePathBuilder;

  beforeEach(() => {
    harness = makeAuditHarness();
    builder = new WorkspacePathBuilder({
      workspaceStorageRoot: STORAGE_ROOT,
      auditLogger: harness.logger,
    });
  });

  it("returns the subpath root unchanged when relativePath is undefined", async () => {
    const result = await builder.build({
      workspaceId: VALID_WORKSPACE_ID,
      subpath: "simulation_capsules",
    });
    const expected = await fsPromises.realpath(
      path.join(
        STORAGE_ROOT,
        "workspaces",
        VALID_WORKSPACE_ID,
        "simulation_capsules",
      ),
    );
    expect(result).toBe(expected);
    expect(harness.writerCalls.n).toBe(0);
  });

  it("returns the subpath root unchanged when relativePath is empty string", async () => {
    const result = await builder.build({
      workspaceId: VALID_WORKSPACE_ID,
      subpath: "temp_runs",
      relativePath: "",
    });
    const expected = await fsPromises.realpath(
      path.join(STORAGE_ROOT, "workspaces", VALID_WORKSPACE_ID, "temp_runs"),
    );
    expect(result).toBe(expected);
  });

  it("resolves a leaf path under the subpath root", async () => {
    const result = await builder.build({
      workspaceId: VALID_WORKSPACE_ID,
      subpath: "generated_code",
      relativePath: "run-01/output.json",
    });
    const subRoot = await fsPromises.realpath(
      path.join(
        STORAGE_ROOT,
        "workspaces",
        VALID_WORKSPACE_ID,
        "generated_code",
      ),
    );
    expect(result).toBe(path.join(subRoot, "run-01", "output.json"));
  });
});

describe("WorkspacePathBuilder.build — component rejections", () => {
  let harness: AuditHarness;
  let builder: WorkspacePathBuilder;

  beforeEach(() => {
    harness = makeAuditHarness();
    builder = new WorkspacePathBuilder({
      workspaceStorageRoot: STORAGE_ROOT,
      auditLogger: harness.logger,
    });
  });

  it.each<[string, string, string]>([
    ["nul_byte", "data\0.txt", "nul_byte"],
    ["percent_encoded_separator", "foo%2Fbar", "percent_encoded_separator"],
    ["dot_or_dotdot", "..", "dot_or_dotdot"],
    ["leading_dot", ".env", "leading_dot"],
    ["trailing_dot_or_space", "foo.", "trailing_dot_or_space"],
    ["regex_mismatch", "weird$char", "regex_mismatch"],
  ])(
    "rejects %s with PathInvalidError + a single path_access.denied row",
    async (_label, relativePath, expectedReason) => {
      await expect(
        builder.build({
          workspaceId: VALID_WORKSPACE_ID,
          subpath: "local_cache",
          relativePath,
        }),
      ).rejects.toBeInstanceOf(PathInvalidError);

      expect(harness.writerCalls.n).toBe(1);
      const row = harness.rows[0];
      expect(row).toBeDefined();
      expect(row?.action).toBe("path_access.denied");
      expect(row?.result).toBe("denied");
      expect(row?.metadata?.["rejected_field"]).toBe("relative_path");
      expect(row?.metadata?.["denied_reason"]).toBe(expectedReason);
    },
  );

  it("rejects `..` traversal anywhere in the path", async () => {
    await expect(
      builder.build({
        workspaceId: VALID_WORKSPACE_ID,
        subpath: "simulation_capsules",
        relativePath: "valid/../escape",
      }),
    ).rejects.toMatchObject({ code: "PATH_INVALID" });
    expect(harness.writerCalls.n).toBe(1);
  });

  it("rejects an invalid workspaceId at build()", async () => {
    await expect(
      builder.build({
        workspaceId: "not-a-uuid",
        subpath: "simulation_capsules",
      }),
    ).rejects.toBeInstanceOf(PathInvalidError);
  });

  it("does not double-emit when both workspaceId and relativePath are bad — workspaceId rejection wins", async () => {
    // workspace id is checked first → exactly one audit row, with
    // denied_reason 'invalid_workspace_id'.
    await expect(
      builder.build({
        workspaceId: "still-not-a-uuid",
        subpath: "local_cache",
        relativePath: "..",
      }),
    ).rejects.toBeInstanceOf(PathInvalidError);
    // Audit emission for invalid_workspace_id is fire-and-forget
    // (void), so we wait a tick for it to flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(harness.writerCalls.n).toBe(1);
    expect(harness.rows[0]?.metadata?.["denied_reason"]).toBe(
      "invalid_workspace_id",
    );
  });
});

describe("WorkspacePathBuilder.build — symlink containment", () => {
  it("rejects a relative path whose leaf is a symlink pointing outside the workspace", async () => {
    // Build a fresh storage tree for this test so the symlink is
    // isolated from the suite-level fixtures.
    const localStorage = path.join(TMP_ROOT, "sym-storage");
    const subRoot = path.join(
      localStorage,
      "workspaces",
      VALID_WORKSPACE_ID,
      "simulation_capsules",
    );
    await fsPromises.mkdir(subRoot, { recursive: true });
    const escapeTarget = path.join(TMP_ROOT, "escape-target.txt");
    await fsPromises.writeFile(escapeTarget, "leak", "utf8");
    const linkPath = path.join(subRoot, "leaf-link");
    try {
      await fsPromises.symlink(escapeTarget, linkPath);
    } catch {
      // CI sandbox without symlink permission — skip rather than fail.
      return;
    }

    const harness = makeAuditHarness();
    const builder = new WorkspacePathBuilder({
      workspaceStorageRoot: localStorage,
      auditLogger: harness.logger,
    });

    await expect(
      builder.build({
        workspaceId: VALID_WORKSPACE_ID,
        subpath: "simulation_capsules",
        relativePath: "leaf-link",
      }),
    ).rejects.toMatchObject({
      code: "PATH_INVALID",
    });
    expect(harness.writerCalls.n).toBe(1);
    expect(harness.rows[0]?.metadata?.["denied_reason"]).toBe("outside_root");
  });
});

describe("WorkspacePathBuilder — non-WorkspaceSubpath input", () => {
  it("refuses an unknown subpath with denied_reason='invalid_subpath'", async () => {
    const harness = makeAuditHarness();
    const builder = new WorkspacePathBuilder({
      workspaceStorageRoot: STORAGE_ROOT,
      auditLogger: harness.logger,
    });
    await expect(
      builder.build({
        workspaceId: VALID_WORKSPACE_ID,
        // Cast required to model a caller that bypassed the type system
        // via `JSON.parse` or similar — defense-in-depth.
        subpath: "totally_made_up" as unknown as WorkspaceSubpath,
      }),
    ).rejects.toBeInstanceOf(PathInvalidError);
    await new Promise((r) => setTimeout(r, 5));
    expect(harness.writerCalls.n).toBe(1);
    expect(harness.rows[0]?.metadata?.["denied_reason"]).toBe("invalid_subpath");
  });
});
