/**
 * L2.10 safeOpen — symlink-safe traversal tests.
 *
 * Pins v4 §9.4.1–§9.4.4: per-component `O_NOFOLLOW` walk, final
 * `fs.realpath` + component-array containment compare. Real
 * filesystem fixtures (no mocks) so the ELOOP/ENOTDIR behavior we
 * rely on is exercised against the real kernel.
 */

import { promises as fsPromises } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PathInvalidError } from "../../src/errors/shapes.js";
import {
  isStrictSubpath,
  safeOpenPath,
  SAFE_OPEN_FLAGS,
} from "../../src/paths/safeOpen.js";

let TMP_ROOT: string;
let WORKSPACE_ROOT: string;

beforeAll(async () => {
  TMP_ROOT = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "secure-core-l210-safeopen-"),
  );
  WORKSPACE_ROOT = path.join(TMP_ROOT, "ws");
  await fsPromises.mkdir(WORKSPACE_ROOT, { recursive: true });
});

afterAll(async () => {
  await fsPromises.rm(TMP_ROOT, { recursive: true, force: true });
});

describe("isStrictSubpath", () => {
  it("returns true for a real descendant", () => {
    expect(isStrictSubpath("/a/b", "/a/b/c")).toBe(true);
    expect(isStrictSubpath("/a/b", "/a/b/c/d")).toBe(true);
  });

  it("returns false for a sibling whose name shares the prefix", () => {
    expect(isStrictSubpath("/a/b", "/a/bbq")).toBe(false);
  });

  it("returns false for equal paths (strict)", () => {
    expect(isStrictSubpath("/a/b", "/a/b")).toBe(false);
  });

  it("returns false for an ancestor", () => {
    expect(isStrictSubpath("/a/b", "/a")).toBe(false);
  });
});

describe("safeOpenPath — read mode", () => {
  it("opens an existing file inside the workspace root", async () => {
    const filePath = path.join(WORKSPACE_ROOT, "data.txt");
    await fsPromises.writeFile(filePath, "hello", "utf8");

    const result = await safeOpenPath({
      root: WORKSPACE_ROOT,
      relativePath: "data.txt",
      mode: "read",
    });

    expect(result.fd).not.toBeNull();
    expect(typeof result.fd).toBe("number");
    expect(result.canonicalPath.endsWith("data.txt")).toBe(true);

    // Cleanup: caller closes the fd (per §9.3 contract).
    await fsPromises.open("/dev/null", "r").then((h) => h.close());
    if (result.fd !== null) {
      const { close } = await import("node:fs");
      await new Promise<void>((res, rej) =>
        close(result.fd as number, (err) => (err ? rej(err) : res())),
      );
    }
  });
});

describe("safeOpenPath — write mode", () => {
  it("creates a new file inside the workspace root", async () => {
    const result = await safeOpenPath({
      root: WORKSPACE_ROOT,
      relativePath: "fresh.txt",
      mode: "write",
    });

    expect(result.fd).not.toBeNull();
    expect(result.canonicalPath.endsWith("fresh.txt")).toBe(true);

    // The file should now exist.
    const stat = await fsPromises.stat(path.join(WORKSPACE_ROOT, "fresh.txt"));
    expect(stat.isFile()).toBe(true);

    if (result.fd !== null) {
      const { close } = await import("node:fs");
      await new Promise<void>((res, rej) =>
        close(result.fd as number, (err) => (err ? rej(err) : res())),
      );
    }
  });

  it("rejects traversal before creating a file outside the workspace", async () => {
    const outsidePath = path.join(TMP_ROOT, "outside-created.txt");
    await fsPromises.rm(outsidePath, { force: true });

    await expect(
      safeOpenPath({
        root: WORKSPACE_ROOT,
        relativePath: "../outside-created.txt",
        mode: "write",
      }),
    ).rejects.toMatchObject({
      code: "PATH_INVALID",
      details: { reason: "dot_or_dotdot" },
    });

    await expect(fsPromises.stat(outsidePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("safeOpenPath — verify mode", () => {
  it("returns fd: null and does not create the file", async () => {
    const beforeListing = await fsPromises.readdir(WORKSPACE_ROOT);
    const result = await safeOpenPath({
      root: WORKSPACE_ROOT,
      relativePath: "not-yet.txt",
      mode: "verify",
    });
    expect(result.fd).toBeNull();
    expect(result.canonicalPath.endsWith("not-yet.txt")).toBe(true);
    const afterListing = await fsPromises.readdir(WORKSPACE_ROOT);
    expect(afterListing).toEqual(beforeListing);
  });

  it("verifies the workspace root itself when relativePath is empty", async () => {
    const result = await safeOpenPath({
      root: WORKSPACE_ROOT,
      relativePath: "",
      mode: "verify",
    });
    expect(result.fd).toBeNull();
    // realpath may differ from the literal path on darwin (/tmp →
    // /private/tmp); compare via realpath round-trip instead.
    const realRoot = await fsPromises.realpath(WORKSPACE_ROOT);
    expect(result.canonicalPath).toBe(realRoot);
  });
});

describe("safeOpenPath — symlink rejection", () => {
  it("rejects a path whose mid-component is a symlink", async () => {
    const subDir = path.join(WORKSPACE_ROOT, "sub-symlink");
    // Create a parent dir and a symlink inside it pointing to /etc.
    await fsPromises.mkdir(subDir, { recursive: true });
    const linkPath = path.join(subDir, "link");
    try {
      await fsPromises.symlink("/etc", linkPath);
    } catch {
      // Symlink creation may fail on restricted filesystems; skip.
      return;
    }

    await expect(
      safeOpenPath({
        root: WORKSPACE_ROOT,
        relativePath: "sub-symlink/link/passwd",
        mode: "verify",
      }),
    ).rejects.toMatchObject({
      code: "PATH_INVALID",
      details: { reason: "symlink_or_non_directory" },
    });
  });

  it("rejects a directory-shaped symlink mid-path with O_NOFOLLOW", async () => {
    const realDir = path.join(WORKSPACE_ROOT, "real-dir");
    await fsPromises.mkdir(realDir, { recursive: true });
    const linkPath = path.join(WORKSPACE_ROOT, "linked-dir");
    try {
      await fsPromises.symlink(realDir, linkPath);
    } catch {
      return;
    }

    await expect(
      safeOpenPath({
        root: WORKSPACE_ROOT,
        relativePath: "linked-dir/file.txt",
        mode: "verify",
      }),
    ).rejects.toBeInstanceOf(PathInvalidError);
  });

  it("rejects a final-component symlink pointing outside via outside_root", async () => {
    // Place the symlink as the LEAF; verify-mode walks all PARENTS
    // with O_NOFOLLOW (none here), realpaths the candidate, and
    // detects the array mismatch as outside_root.
    const escapeTarget = path.join(TMP_ROOT, "outside.txt");
    await fsPromises.writeFile(escapeTarget, "leak", "utf8");
    const linkPath = path.join(WORKSPACE_ROOT, "escape-leaf");
    try {
      await fsPromises.symlink(escapeTarget, linkPath);
    } catch {
      return;
    }

    await expect(
      safeOpenPath({
        root: WORKSPACE_ROOT,
        relativePath: "escape-leaf",
        mode: "verify",
      }),
    ).rejects.toMatchObject({
      code: "PATH_INVALID",
      details: { reason: "outside_root" },
    });
  });
});

describe("SAFE_OPEN_FLAGS", () => {
  it("re-exports the O_NOFOLLOW + O_CREAT constants tests assert against", () => {
    expect(typeof SAFE_OPEN_FLAGS.O_NOFOLLOW).toBe("number");
    expect(typeof SAFE_OPEN_FLAGS.O_CREAT).toBe("number");
    expect(typeof SAFE_OPEN_FLAGS.O_EXCL).toBe("number");
    expect(typeof SAFE_OPEN_FLAGS.O_RDONLY).toBe("number");
    expect(typeof SAFE_OPEN_FLAGS.O_WRONLY).toBe("number");
  });
});
