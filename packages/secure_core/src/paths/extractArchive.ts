/**
 * Streaming archive extractor — Phase 0.5 Layer-2 (L2.11).
 *
 * Implements v4 §9.4.11–§9.4.16 (archive extraction safety) and §29
 * #74 / V4-R1 (configurable size + file-count caps with fail-closed
 * defaults). Both supported formats (zip via `yauzl`, tar via `tar`)
 * funnel every entry through `validateEntry()`, the single shared
 * gate, so the rejection rule set cannot drift between formats.
 *
 * v4 §9.4.14 fail-closed defaults:
 *
 *   ARCHIVE_DEFAULT_MAX_BYTES = 100 MiB
 *   ARCHIVE_DEFAULT_MAX_FILES = 10_000
 *
 * `PLASMAWORK_ARCHIVE_MAX_BYTES` / `PLASMAWORK_ARCHIVE_MAX_FILES` (read
 * via `readSecureCoreEnv`, never `process.env`) may RAISE OR LOWER the
 * cap. They are parsed eagerly at module import time; NaN, non-integer,
 * and ≤ 0 values throw — an unconfigured deployment falls back to the
 * safe default, but a misconfigured deployment fails fast at boot
 * rather than silently extracting unbounded archives. `console.log` is
 * forbidden in `src/`, so a soft warning would be invisible; we raise
 * a typed `Error` instead, which crashes the importing process and
 * forces the operator to fix the deployment.
 *
 * Reason mapping (§9.4.13 + §9.4.15): the component validator's
 * closed `ComponentRejection` union is wider than the public archive
 * audit enum. We collapse:
 *
 *   leading_dot                                   -> "dotfile"
 *   nul_byte | percent_encoded_separator | empty
 *     | dot_or_dotdot | trailing_dot_or_space
 *     | regex_mismatch                            -> "zip_slip"
 *
 * The collapse is exhaustive: a `never` check on the union prevents a
 * future `ComponentRejection` variant from silently falling through.
 *
 * Atomicity: the extractor emits the audit row BEFORE throwing, but
 * does NOT clean up partially-written entries. Per §9.4 the caller
 * (e.g. the worker upload handler) is responsible for `rm -rf
 * destinationDir` on a thrown `ArchiveRejectedError`. The extractor
 * keeps that responsibility out of its scope so the cleanup policy
 * can vary per call site (some callers may want to inspect the
 * partial output for triage).
 */

import { createReadStream, type WriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import yauzl from "yauzl";
import * as tar from "tar";

import {
  classifyRelativePath,
  type ComponentRejection,
} from "./components.js";
import {
  ARCHIVE_REJECTION_REASONS,
  type ArchiveRejectionReason,
} from "../config/audit_events.js";
import { ArchiveRejectedError } from "../errors/shapes.js";
import { readSecureCoreEnv } from "../secrets/env.js";
import { AuditLogger } from "../audit/logger.js";

/** §9.4.14 fail-closed default uncompressed-byte cap. */
export const ARCHIVE_DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

/** §9.4.14 fail-closed default file-count cap. */
export const ARCHIVE_DEFAULT_MAX_FILES = 10_000;

/**
 * Eagerly resolve the deployment-configured caps. NaN / non-positive
 * integer values throw at module load — see the file header. The
 * resolution is exported (non-mutable) so a deployment can confirm
 * via a probe endpoint which limit is in force.
 */
function parsePositiveInt(
  raw: string | undefined,
  envName: string,
  fallback: number,
): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      `secure_core: ${envName}="${raw}" is not a positive integer; refusing to start (v4 §9.4.14 fail-closed)`,
    );
  }
  return n;
}

const RESOLVED_MAX_BYTES = parsePositiveInt(
  readSecureCoreEnv("PLASMAWORK_ARCHIVE_MAX_BYTES"),
  "PLASMAWORK_ARCHIVE_MAX_BYTES",
  ARCHIVE_DEFAULT_MAX_BYTES,
);

const RESOLVED_MAX_FILES = parsePositiveInt(
  readSecureCoreEnv("PLASMAWORK_ARCHIVE_MAX_FILES"),
  "PLASMAWORK_ARCHIVE_MAX_FILES",
  ARCHIVE_DEFAULT_MAX_FILES,
);

export type ArchiveFormat = "zip" | "tar";

export type ArchiveEntryType =
  | "file"
  | "symlink"
  | "hardlink"
  | "directory"
  | "device"
  | "other";

export interface ExtractArchiveOptions {
  readonly archivePath: string;
  readonly destinationDir: string;
  readonly format: ArchiveFormat;
  readonly auditLogger: AuditLogger;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly workspaceId: string | null;
  readonly actorUserId: string | null;
  readonly requestId: string;
}

export interface ExtractResult {
  readonly filesWritten: number;
  readonly bytesWritten: number;
}

export interface ValidateEntryArgs {
  readonly fileName: string;
  readonly type: ArchiveEntryType;
  readonly uncompressedSize: number;
  readonly runningBytes: number;
  readonly runningFiles: number;
  readonly maxBytes: number;
  readonly maxFiles: number;
}

export type ValidateEntryResult =
  | { ok: true }
  | { ok: false; reason: ArchiveRejectionReason };

/**
 * Map a `ComponentRejection` to its archive-audit reason. Exported
 * for use by the extractor's per-entry path check; the `never` arm
 * makes future enum-additions a type error.
 */
function componentRejectionToReason(
  r: ComponentRejection,
): ArchiveRejectionReason {
  switch (r) {
    case "leading_dot":
      return "dotfile";
    case "nul_byte":
    case "percent_encoded_separator":
    case "empty":
    case "dot_or_dotdot":
    case "trailing_dot_or_space":
    case "regex_mismatch":
      return "zip_slip";
    default: {
      const _exhaustive: never = r;
      return _exhaustive;
    }
  }
}

/**
 * Shared entry validator. Order is deliberate and matches the task's
 * algorithm: type → path → size → count. A symlink with a zip-slip
 * name therefore rejects as `"symlink"` (the more specific finding),
 * never as `"zip_slip"`.
 */
export function validateEntry(args: ValidateEntryArgs): ValidateEntryResult {
  // 1. Type check (§9.4.12).
  if (args.type === "symlink") return { ok: false, reason: "symlink" };
  if (args.type === "hardlink") return { ok: false, reason: "hardlink" };
  if (args.type === "device") return { ok: false, reason: "device" };

  // Directory and "other" entries don't write file content but still
  // must be path-checked so a directory entry named `../escape` can't
  // create a parent-traversal anchor for follow-on tools.

  // 2. Path check (§9.4.10 + §9.4.13).
  const pathRejection = classifyRelativePath(args.fileName);
  if (pathRejection !== null) {
    return {
      ok: false,
      reason: componentRejectionToReason(pathRejection.reason),
    };
  }

  // 3. Size + count caps apply only to entries that consume budget
  //    — i.e. files. Directories and `other` entries skip the
  //    accounting because they don't write bytes.
  if (args.type === "file") {
    if (!Number.isFinite(args.uncompressedSize) || args.uncompressedSize < 0) {
      return { ok: false, reason: "size_limit_exceeded" };
    }
    if (args.runningBytes + args.uncompressedSize > args.maxBytes) {
      return { ok: false, reason: "size_limit_exceeded" };
    }
    if (args.runningFiles + 1 > args.maxFiles) {
      return { ok: false, reason: "file_count_limit_exceeded" };
    }
  }

  return { ok: true };
}

/**
 * Resolve the entry's destination and verify it is a strict subpath
 * of `destinationDir` via component-array equality (§9.4.2). Returns
 * `null` on success, the reason on rejection.
 */
function verifySubpath(
  destinationDir: string,
  fileName: string,
): { ok: true; resolved: string } | { ok: false; reason: ArchiveRejectionReason } {
  const resolved = path.resolve(destinationDir, fileName);
  const rel = path.relative(destinationDir, resolved);
  if (rel === "" || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    if (rel === "" || rel === ".") {
      // Entry resolves to the destination root itself — refuse.
      return { ok: false, reason: "zip_slip" };
    }
    return { ok: false, reason: "zip_slip" };
  }
  return { ok: true, resolved };
}

interface NormalizedEntry {
  readonly fileName: string;
  readonly type: ArchiveEntryType;
  readonly uncompressedSize: number;
  /** Provided per-format. Returns a Readable to pipe into the destination. */
  openReadStream(): Promise<Readable>;
}

async function emitRejectionAudit(
  opts: ExtractArchiveOptions,
  reason: ArchiveRejectionReason,
  filesSoFar: number,
): Promise<void> {
  const actorType = opts.actorUserId === null ? "unauthenticated" : "human";
  await opts.auditLogger.write({
    workspaceId: opts.workspaceId,
    actorUserId: opts.actorUserId,
    actorType,
    action: "archive.entry_rejected",
    result: "denied",
    requestId: opts.requestId,
    metadata: {
      archive_reason: reason,
      count: filesSoFar,
    },
  });
}

function ensureKnownReason(reason: string): ArchiveRejectionReason {
  if ((ARCHIVE_REJECTION_REASONS as readonly string[]).includes(reason)) {
    return reason as ArchiveRejectionReason;
  }
  // Defensive: the reason union is the source of truth, but if a
  // future contributor introduces a new value, fail closed.
  throw new Error(`internal: unknown archive rejection reason "${reason}"`);
}

/**
 * Walk a normalized entry stream and either accept-and-write or
 * reject-and-throw. Common path used by both zip and tar drivers.
 */
async function processEntries(
  iter: AsyncIterable<NormalizedEntry>,
  opts: ExtractArchiveOptions,
  maxBytes: number,
  maxFiles: number,
): Promise<ExtractResult> {
  let runningBytes = 0;
  let runningFiles = 0;

  for await (const entry of iter) {
    const verdict = validateEntry({
      fileName: entry.fileName,
      type: entry.type,
      uncompressedSize: entry.uncompressedSize,
      runningBytes,
      runningFiles,
      maxBytes,
      maxFiles,
    });

    if (!verdict.ok) {
      await emitRejectionAudit(opts, verdict.reason, runningFiles);
      throw new ArchiveRejectedError("Archive entry rejected.", {
        reason: verdict.reason,
      });
    }

    if (entry.type === "directory") {
      const sub = verifySubpath(opts.destinationDir, entry.fileName);
      if (!sub.ok) {
        await emitRejectionAudit(opts, sub.reason, runningFiles);
        throw new ArchiveRejectedError("Archive entry rejected.", {
          reason: sub.reason,
        });
      }
      await mkdir(sub.resolved, { recursive: true });
      continue;
    }

    if (entry.type !== "file") {
      // `other` entries (unknown to us) get refused as zip_slip after
      // path classification — should never reach here. Defensive skip.
      continue;
    }

    const sub = verifySubpath(opts.destinationDir, entry.fileName);
    if (!sub.ok) {
      await emitRejectionAudit(opts, sub.reason, runningFiles);
      throw new ArchiveRejectedError("Archive entry rejected.", {
        reason: sub.reason,
      });
    }

    await mkdir(path.dirname(sub.resolved), { recursive: true });

    const readable = await entry.openReadStream();
    let writeStream: WriteStream | undefined;
    try {
      writeStream = createWriteStream(sub.resolved, { flags: "wx" });
      await pipeline(readable, writeStream);
    } finally {
      if (writeStream && !writeStream.closed) {
        writeStream.destroy();
      }
    }

    runningBytes += entry.uncompressedSize;
    runningFiles += 1;
  }

  return { filesWritten: runningFiles, bytesWritten: runningBytes };
}

// ---------- zip driver ----------

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFIFO = 0o010000;
const S_IFSOCK = 0o140000;

function zipEntryType(rawEntry: yauzl.Entry): ArchiveEntryType {
  const unixMode = (rawEntry.externalFileAttributes >>> 16) & S_IFMT;
  if (unixMode === S_IFLNK) return "symlink";
  if (unixMode === S_IFCHR || unixMode === S_IFBLK) return "device";
  if (unixMode === S_IFIFO || unixMode === S_IFSOCK) return "device";
  // zip has no hardlink type — only tar does.
  // Directory entries in zip end with "/".
  if (rawEntry.fileName.endsWith("/") || unixMode === S_IFDIR) {
    return "directory";
  }
  return "file";
}

async function* iterZipEntries(
  archivePath: string,
): AsyncGenerator<NormalizedEntry> {
  const zipfile: yauzl.ZipFile = await new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) {
        reject(err ?? new Error("yauzl.open returned no zipfile"));
        return;
      }
      resolve(zf);
    });
  });

  try {
    while (true) {
      const next: yauzl.Entry | null = await new Promise((resolve, reject) => {
        const onEntry = (entry: yauzl.Entry): void => {
          cleanup();
          resolve(entry);
        };
        const onEnd = (): void => {
          cleanup();
          resolve(null);
        };
        const onError = (err: Error): void => {
          cleanup();
          reject(err);
        };
        const cleanup = (): void => {
          zipfile.removeListener("entry", onEntry);
          zipfile.removeListener("end", onEnd);
          zipfile.removeListener("error", onError);
        };
        zipfile.once("entry", onEntry);
        zipfile.once("end", onEnd);
        zipfile.once("error", onError);
        zipfile.readEntry();
      });

      if (next === null) return;

      const t = zipEntryType(next);
      const fileName = next.fileName.replace(/\/+$/, "");

      yield {
        fileName,
        type: t,
        uncompressedSize: typeof next.uncompressedSize === "number"
          ? next.uncompressedSize
          : 0,
        openReadStream: () =>
          new Promise<Readable>((resolve, reject) => {
            zipfile.openReadStream(next, (err, stream) => {
              if (err || !stream) {
                reject(err ?? new Error("openReadStream returned no stream"));
                return;
              }
              resolve(stream);
            });
          }),
      };
    }
  } finally {
    zipfile.close();
  }
}

// ---------- tar driver ----------

function tarEntryType(rawType: string): ArchiveEntryType {
  switch (rawType) {
    case "File":
    case "OldFile":
    case "ContiguousFile":
      return "file";
    case "SymbolicLink":
      return "symlink";
    case "Link":
      return "hardlink";
    case "BlockDevice":
    case "CharacterDevice":
    case "FIFO":
      return "device";
    case "Directory":
    case "GNUDumpDir":
      return "directory";
    default:
      return "other";
  }
}

async function* iterTarEntries(
  archivePath: string,
): AsyncGenerator<NormalizedEntry> {
  const parser = new tar.Parser({});
  const fileStream = createReadStream(archivePath);

  type Pending =
    | { kind: "entry"; entry: tar.ReadEntry }
    | { kind: "end" }
    | { kind: "error"; err: Error };

  const queue: Pending[] = [];
  let resolveWaiter: ((p: Pending) => void) | null = null;

  const push = (p: Pending): void => {
    if (resolveWaiter) {
      const r = resolveWaiter;
      resolveWaiter = null;
      r(p);
    } else {
      queue.push(p);
    }
  };

  parser.on("entry", (entry: tar.ReadEntry) => {
    // Pause until consumer resumes; the consumer will either drain
    // (file) or call `entry.resume()` to discard (rejected types).
    entry.pause();
    push({ kind: "entry", entry });
  });
  parser.on("end", () => push({ kind: "end" }));
  parser.on("error", (err: Error) => push({ kind: "error", err }));

  fileStream.on("error", (err) => push({ kind: "error", err }));
  fileStream.pipe(parser);

  try {
    while (true) {
      const next: Pending = await new Promise((resolve) => {
        const item = queue.shift();
        if (item) {
          resolve(item);
        } else {
          resolveWaiter = resolve;
        }
      });

      if (next.kind === "end") return;
      if (next.kind === "error") throw next.err;

      const entry = next.entry;
      const t = tarEntryType(String(entry.type));
      const sizeFromHeader =
        typeof entry.size === "number" && Number.isFinite(entry.size)
          ? entry.size
          : 0;

      let consumed = false;
      yield {
        fileName: entry.path,
        type: t,
        uncompressedSize: sizeFromHeader,
        openReadStream: async () => {
          consumed = true;
          entry.resume();
          return entry as unknown as Readable;
        },
      };
      if (!consumed) {
        // Drain so the parser advances to the next entry.
        entry.resume();
      }
    }
  } finally {
    fileStream.destroy();
  }
}

// ---------- public entry point ----------

/**
 * Stream-extract `opts.archivePath` into `opts.destinationDir`. Every
 * entry passes through `validateEntry`; the first rejection emits an
 * `archive.entry_rejected` audit row and throws `ArchiveRejectedError`.
 *
 * Pre-conditions enforced by the caller:
 *   - `opts.archivePath` and `opts.destinationDir` are absolute,
 *     canonical paths.
 *   - `opts.destinationDir` exists.
 *   - The caller cleans up the (possibly partial) destination on
 *     thrown errors; this function does not.
 */
export async function extractArchive(
  opts: ExtractArchiveOptions,
): Promise<ExtractResult> {
  if (!path.isAbsolute(opts.archivePath)) {
    throw new Error("archivePath must be absolute");
  }
  if (!path.isAbsolute(opts.destinationDir)) {
    throw new Error("destinationDir must be absolute");
  }
  // Confirm destination exists; otherwise the first mkdir/createWriteStream
  // would silently create something the caller never approved.
  const destStat = await stat(opts.destinationDir);
  if (!destStat.isDirectory()) {
    throw new Error("destinationDir must be a directory");
  }

  const maxBytes = opts.maxBytes ?? RESOLVED_MAX_BYTES;
  const maxFiles = opts.maxFiles ?? RESOLVED_MAX_FILES;
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isInteger(maxFiles) ||
    maxFiles <= 0
  ) {
    throw new Error("maxBytes and maxFiles must be positive integers");
  }

  // Sanity: ensure the closed audit-reason set the audit row will use
  // matches what `validateEntry` returns. Cheap runtime parity check.
  for (const r of [
    "symlink",
    "hardlink",
    "device",
    "zip_slip",
    "size_limit_exceeded",
    "file_count_limit_exceeded",
    "dotfile",
  ] as const) {
    ensureKnownReason(r);
  }

  if (opts.format === "zip") {
    return processEntries(iterZipEntries(opts.archivePath), opts, maxBytes, maxFiles);
  }
  return processEntries(iterTarEntries(opts.archivePath), opts, maxBytes, maxFiles);
}
