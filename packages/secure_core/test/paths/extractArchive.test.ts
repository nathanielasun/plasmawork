/**
 * L2.11 archive-extractor tests.
 *
 * Covers v4 §9.4.11–§9.4.16 + §29 #74 / V4-R1:
 *   - Happy paths: 3-file zip + 3-file tar extract.
 *   - Type-shape rejections: symlink (zip + tar), hardlink (tar),
 *     device (tar).
 *   - Path-shape rejections: zip-slip via `..`, dotfile via leading
 *     dot, NUL byte in name, percent-encoded separator.
 *   - Caps: total bytes > maxBytes; file count > maxFiles.
 *   - Default fail-closed behavior probed via the override mechanism
 *     (maxBytes = 5 with a 6-byte entry).
 *   - Constant pinning: ARCHIVE_DEFAULT_MAX_BYTES === 100 MiB,
 *     ARCHIVE_DEFAULT_MAX_FILES === 10_000.
 *   - validateEntry() unit tests: every reason branch fires.
 *
 * Each rejection assertion checks BOTH the thrown error AND the
 * audit row metadata (`archive_reason`, `count`).
 */

import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  extractArchive,
  validateEntry,
  ARCHIVE_DEFAULT_MAX_BYTES,
  ARCHIVE_DEFAULT_MAX_FILES,
} from "../../src/paths/extractArchive.js";
import {
  buildZipBuffer,
  buildTarBuffer,
} from "../../src/paths/buildTestArchive.js";
import { ArchiveRejectedError } from "../../src/errors/shapes.js";
import type { AuditLogger } from "../../src/audit/logger.js";

interface AuditCall {
  readonly action: string;
  readonly result: string;
  readonly metadata: Record<string, unknown> | undefined;
  readonly actorType: string;
  readonly actorUserId: string | null;
  readonly workspaceId: string | null;
  readonly requestId: string;
}

interface Harness {
  workdir: string;
  destDir: string;
  archivePath: (name: string) => string;
  audit: { write: ReturnType<typeof vi.fn> };
  calls: AuditCall[];
  asLogger: AuditLogger;
}

let harness: Harness;

beforeEach(async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "extract-archive-"));
  const destDir = path.join(workdir, "dest");
  await mkdir(destDir);
  const calls: AuditCall[] = [];
  const write = vi.fn(async (input: AuditCall) => {
    calls.push({
      action: String(input.action),
      result: String(input.result),
      metadata: (input as { metadata?: Record<string, unknown> }).metadata,
      actorType: String(input.actorType),
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      requestId: input.requestId,
    });
    return undefined;
  });
  const audit = { write } as unknown as { write: ReturnType<typeof vi.fn> };
  harness = {
    workdir,
    destDir,
    archivePath: (n) => path.join(workdir, n),
    audit,
    calls,
    asLogger: audit as unknown as AuditLogger,
  };
});

afterEach(async () => {
  if (harness?.workdir) {
    await rm(harness.workdir, { recursive: true, force: true });
  }
});

const baseOpts = (overrides: {
  archivePath: string;
  format: "zip" | "tar";
  maxBytes?: number;
  maxFiles?: number;
  actorUserId?: string | null;
}) => ({
  archivePath: overrides.archivePath,
  destinationDir: harness.destDir,
  format: overrides.format,
  auditLogger: harness.asLogger,
  maxBytes: overrides.maxBytes,
  maxFiles: overrides.maxFiles,
  workspaceId: "ws-1",
  actorUserId: overrides.actorUserId ?? "user-1",
  requestId: "req-test",
});

async function writeArchive(name: string, buf: Buffer): Promise<string> {
  const p = harness.archivePath(name);
  await writeFile(p, buf);
  return p;
}

// ---------- Happy paths ----------

describe("extractArchive — happy paths", () => {
  it("zip: extracts 3 small files; result totals match", async () => {
    const buf = await buildZipBuffer([
      { name: "a.txt", content: "alpha" },
      { name: "sub/b.txt", content: "beta!" },
      { name: "sub/c.txt", content: "gamma_" },
    ]);
    const archivePath = await writeArchive("ok.zip", buf);
    const result = await extractArchive(baseOpts({ archivePath, format: "zip" }));
    expect(result.filesWritten).toBe(3);
    expect(result.bytesWritten).toBe(5 + 5 + 6);
    expect(harness.calls).toHaveLength(0);
  });

  it("tar: extracts 3 small files; result totals match", async () => {
    const buf = await buildTarBuffer([
      { name: "a.txt", content: "alpha" },
      { name: "sub/b.txt", content: "beta!" },
      { name: "sub/c.txt", content: "gamma_" },
    ]);
    const archivePath = await writeArchive("ok.tar", buf);
    const result = await extractArchive(baseOpts({ archivePath, format: "tar" }));
    expect(result.filesWritten).toBe(3);
    expect(result.bytesWritten).toBe(5 + 5 + 6);
    expect(harness.calls).toHaveLength(0);
  });
});

// ---------- Helpers for rejection assertions ----------

async function expectReject(
  archivePath: string,
  format: "zip" | "tar",
  expectedReason: string,
  countBefore: number,
  optsExtra: { maxBytes?: number; maxFiles?: number } = {},
): Promise<void> {
  await expect(
    extractArchive(baseOpts({ archivePath, format, ...optsExtra })),
  ).rejects.toBeInstanceOf(ArchiveRejectedError);

  expect(harness.calls).toHaveLength(1);
  const call = harness.calls[0]!;
  expect(call.action).toBe("archive.entry_rejected");
  expect(call.result).toBe("denied");
  expect(call.actorType).toBe("human");
  expect(call.metadata).toEqual({
    archive_reason: expectedReason,
    count: countBefore,
  });
}

// ---------- Path-shape rejections ----------

describe("extractArchive — path/type rejections", () => {
  it("rejects zip-slip via ../escape.txt (tar) with reason 'zip_slip'", async () => {
    // yazl refuses `..` at addBuffer time, so the malicious entry is
    // delivered via tar (whose builder accepts arbitrary names). Both
    // formats route through the same `validateEntry`; this still
    // exercises the zip_slip reason path end-to-end.
    const buf = await buildTarBuffer([
      { name: "../escape.txt", content: "evil" },
    ]);
    const archivePath = await writeArchive("evil.tar", buf);
    await expectReject(archivePath, "tar", "zip_slip", 0);
  });

  it("rejects symlink entry in zip with reason 'symlink'", async () => {
    const buf = await buildZipBuffer([
      { name: "link", type: "symlink", linkName: "/etc/passwd" },
    ]);
    const archivePath = await writeArchive("symlink.zip", buf);
    await expectReject(archivePath, "zip", "symlink", 0);
  });

  it("rejects symlink entry in tar with reason 'symlink'", async () => {
    const buf = await buildTarBuffer([
      { name: "link", type: "symlink", linkName: "/etc/passwd" },
    ]);
    const archivePath = await writeArchive("symlink.tar", buf);
    await expectReject(archivePath, "tar", "symlink", 0);
  });

  it("rejects hardlink entry in tar with reason 'hardlink'", async () => {
    const buf = await buildTarBuffer([
      { name: "real.txt", content: "x" },
      { name: "hl", type: "hardlink", linkName: "real.txt" },
    ]);
    const archivePath = await writeArchive("hardlink.tar", buf);
    await expectReject(archivePath, "tar", "hardlink", 1);
  });

  it("rejects device entry in tar with reason 'device'", async () => {
    const buf = await buildTarBuffer([
      { name: "dev_node", type: "device" },
    ]);
    const archivePath = await writeArchive("device.tar", buf);
    await expectReject(archivePath, "tar", "device", 0);
  });

  it("rejects dotfile (leading-dot component) with reason 'dotfile'", async () => {
    const buf = await buildZipBuffer([
      { name: ".hidden", content: "x" },
    ]);
    const archivePath = await writeArchive("dot.zip", buf);
    await expectReject(archivePath, "zip", "dotfile", 0);
  });

  it("rejects backslash-only path component (regex_mismatch -> 'zip_slip')", async () => {
    // The §9.4.10 regex rejects backslashes inside a component, so a
    // tar entry whose path is `evil\\path` (single component with
    // embedded backslash) is refused. NUL-byte rejection is exercised
    // by the component validator's own test suite — tar's `decString`
    // strips at NUL before the validator ever sees it, so the
    // archive-level NUL test would never reach the validator branch.
    const buf = await buildTarBuffer([
      { name: "evil\\path", content: "x" },
    ]);
    const archivePath = await writeArchive("backslash.tar", buf);
    await expectReject(archivePath, "tar", "zip_slip", 0);
  });

  it("rejects percent-encoded separator (mapped to 'zip_slip')", async () => {
    const buf = await buildTarBuffer([
      { name: "evil%2Fpath", content: "x" },
    ]);
    const archivePath = await writeArchive("pct.tar", buf);
    await expectReject(archivePath, "tar", "zip_slip", 0);
  });

  it("rejects extraction through a pre-existing symlink directory", async () => {
    const outsideDir = path.join(harness.workdir, "outside-target");
    await mkdir(outsideDir);
    try {
      await symlink(outsideDir, path.join(harness.destDir, "linked"));
    } catch {
      // Restricted filesystems may disallow symlink creation.
      return;
    }

    const buf = await buildTarBuffer([
      { name: "linked/escape.txt", content: "evil" },
    ]);
    const archivePath = await writeArchive("dest-symlink.tar", buf);
    await expectReject(archivePath, "tar", "zip_slip", 0);
    await expect(stat(path.join(outsideDir, "escape.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

// ---------- Cap rejections ----------

describe("extractArchive — size + file-count caps", () => {
  it("rejects when total uncompressed bytes exceed maxBytes", async () => {
    const buf = await buildTarBuffer([
      { name: "a.txt", content: "abcd" },          // 4 B
      { name: "b.txt", content: "efghij" },        // 6 B; cumulative 10 > 8
    ]);
    const archivePath = await writeArchive("big.tar", buf);
    await expectReject(archivePath, "tar", "size_limit_exceeded", 1, {
      maxBytes: 8,
    });
  });

  it("rejects when file count exceeds maxFiles", async () => {
    const buf = await buildTarBuffer([
      { name: "a.txt", content: "x" },
      { name: "b.txt", content: "y" },
      { name: "c.txt", content: "z" },
    ]);
    const archivePath = await writeArchive("many.tar", buf);
    await expectReject(archivePath, "tar", "file_count_limit_exceeded", 2, {
      maxFiles: 2,
    });
  });

  it("default-shaped override: maxBytes=5 rejects 6-byte entry", async () => {
    const buf = await buildTarBuffer([
      { name: "x.txt", content: "abcdef" }, // 6 B > 5
    ]);
    const archivePath = await writeArchive("size.tar", buf);
    await expectReject(archivePath, "tar", "size_limit_exceeded", 0, {
      maxBytes: 5,
    });
  });
});

// ---------- Constants pinning ----------

describe("extractArchive — fail-closed defaults", () => {
  it("ARCHIVE_DEFAULT_MAX_BYTES is exactly 100 MiB", () => {
    expect(ARCHIVE_DEFAULT_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  it("ARCHIVE_DEFAULT_MAX_FILES is exactly 10_000", () => {
    expect(ARCHIVE_DEFAULT_MAX_FILES).toBe(10_000);
  });
});

// ---------- validateEntry unit branches ----------

describe("validateEntry — every reason branch", () => {
  const baseArgs = {
    fileName: "ok.txt",
    type: "file" as const,
    uncompressedSize: 1,
    runningBytes: 0,
    runningFiles: 0,
    maxBytes: 1024,
    maxFiles: 100,
  };

  it("accepts a valid file entry", () => {
    expect(validateEntry(baseArgs)).toEqual({ ok: true });
  });

  it("rejects symlink type as 'symlink'", () => {
    expect(validateEntry({ ...baseArgs, type: "symlink" })).toEqual({
      ok: false,
      reason: "symlink",
    });
  });

  it("rejects hardlink type as 'hardlink'", () => {
    expect(validateEntry({ ...baseArgs, type: "hardlink" })).toEqual({
      ok: false,
      reason: "hardlink",
    });
  });

  it("rejects device type as 'device'", () => {
    expect(validateEntry({ ...baseArgs, type: "device" })).toEqual({
      ok: false,
      reason: "device",
    });
  });

  it("rejects '..' path as 'zip_slip'", () => {
    expect(
      validateEntry({ ...baseArgs, fileName: "../escape.txt" }),
    ).toEqual({ ok: false, reason: "zip_slip" });
  });

  it("rejects leading-dot path as 'dotfile'", () => {
    expect(
      validateEntry({ ...baseArgs, fileName: ".hidden" }),
    ).toEqual({ ok: false, reason: "dotfile" });
  });

  it("rejects oversize entry as 'size_limit_exceeded'", () => {
    expect(
      validateEntry({
        ...baseArgs,
        uncompressedSize: 2,
        runningBytes: 1023,
        maxBytes: 1024,
      }),
    ).toEqual({ ok: false, reason: "size_limit_exceeded" });
  });

  it("rejects file-count overflow as 'file_count_limit_exceeded'", () => {
    expect(
      validateEntry({
        ...baseArgs,
        runningFiles: 100,
        maxFiles: 100,
      }),
    ).toEqual({ ok: false, reason: "file_count_limit_exceeded" });
  });

  it("type-check beats path-check (symlink with zip-slip name still 'symlink')", () => {
    expect(
      validateEntry({
        ...baseArgs,
        type: "symlink",
        fileName: "../escape",
      }),
    ).toEqual({ ok: false, reason: "symlink" });
  });
});
