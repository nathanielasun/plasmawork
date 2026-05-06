/**
 * Symlink-safe path traversal — Phase 0.5 Layer-2 (L2.10 helper).
 *
 * Implements v4 §9.4.1–§9.4.4. The plan prefers Linux's `openat2` with
 * `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`. Node 24 does not expose
 * `openat2`, so we use the §9.4.4 fallback: walk each path component
 * from the workspace root downward with `O_NOFOLLOW`, then canonicalize
 * the candidate via `fs.realpath` and compare component arrays — never
 * `startsWith` — against the realpathed root.
 *
 * Residual TOCTOU window (documented per §9.4.4):
 *
 *   Between the per-component O_NOFOLLOW walk and the final
 *   `fs.realpath` + array compare, an attacker with workspace-write
 *   access could swap a directory for a symlink. The window is small
 *   and gated by membership; we accept it at this layer because the
 *   only callers that pass user-controlled segments are middleware-
 *   protected routes. When Node ships an `openat2` binding the walk
 *   loop is the single seam to upgrade.
 *
 * Verify mode supports the builder use case "where will this file go"
 * — the leaf may not yet exist. We walk every parent component with
 * O_NOFOLLOW (raising on ELOOP / ENOTDIR), canonicalize the deepest
 * existing prefix, and append the remaining components for the
 * containment check. A symlink at the leaf still resolves through
 * `fs.realpath`, so a final-component link pointing outside the root
 * is detected by the array compare and surfaces as `outside_root`.
 */

import {
  close as fsCloseCb,
  constants as fsConstants,
  open as fsOpenCb,
  promises as fsPromises,
} from "node:fs";
import * as path from "node:path";

import { PathInvalidError } from "../errors/shapes.js";

/**
 * Promise-shaped raw `fs.open` returning the bare fd. We avoid
 * `fsPromises.open` here because that wraps the fd in a `FileHandle`
 * that would auto-close when the handle is GC'd; callers receive only
 * the fd integer per the §9.3 contract and must close it themselves.
 */
function openRawFd(
  filePath: string,
  flags: number,
  mode: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    fsOpenCb(filePath, flags, mode, (err, fd) => {
      if (err) reject(err);
      else resolve(fd);
    });
  });
}

function closeRawFd(fd: number): Promise<void> {
  return new Promise((resolve, reject) => {
    fsCloseCb(fd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Re-exported `O_*` constants the caller (or a test) may need to
 * reproduce the open-flag behavior. Kept narrow so the surface is
 * obvious from the import line.
 */
export const SAFE_OPEN_FLAGS = Object.freeze({
  O_RDONLY: fsConstants.O_RDONLY,
  O_WRONLY: fsConstants.O_WRONLY,
  O_CREAT: fsConstants.O_CREAT,
  O_NOFOLLOW: fsConstants.O_NOFOLLOW,
});

export type SafeOpenMode = "read" | "write" | "verify";

export interface SafeOpenOptions {
  /** Absolute, already-canonical workspace root. */
  readonly root: string;
  /** Already validated by `classifyRelativePath`. */
  readonly relativePath: string;
  readonly mode: SafeOpenMode;
}

export interface SafeOpenResult {
  /** Absolute canonical path of the resolved candidate. */
  readonly canonicalPath: string;
  /** Open file descriptor for read/write modes; `null` in verify mode. */
  readonly fd: number | null;
}

/**
 * Split an absolute POSIX-or-Windows path into a component array.
 * `path.sep`-agnostic so the helper is portable; the secure_core
 * deployment target is POSIX, but tests on darwin and linux both run
 * here and the shape is identical either way.
 */
function splitPath(absolute: string): string[] {
  const normalized = path.normalize(absolute);
  const parts = normalized.split(path.sep).filter((p) => p.length > 0);
  // On Windows a leading drive letter survives the split; we keep it
  // because the comparison is array-equality and either both sides
  // share the prefix or both don't.
  return parts;
}

/**
 * Strict subpath: every component of `parent` is a prefix of
 * `candidate`'s component array AND `candidate` has at least one extra
 * component. Equality is `false` (not a strict descendant).
 */
export function isStrictSubpath(parent: string, candidate: string): boolean {
  const parentParts = splitPath(parent);
  const candidateParts = splitPath(candidate);
  if (candidateParts.length <= parentParts.length) {
    return false;
  }
  return parentParts.every((p, i) => p === candidateParts[i]);
}

/**
 * Resolve the deepest existing prefix of an absolute path. Used in
 * verify mode to canonicalize the parent chain when the leaf does
 * not yet exist.
 *
 * Returns `{ existingReal, remaining }` where `existingReal` is the
 * realpathed prefix and `remaining` is the array of trailing
 * components that did not yet exist on disk.
 */
async function realpathDeepestExisting(
  absolute: string,
): Promise<{ existingReal: string; remaining: string[] }> {
  const parts = splitPath(absolute);
  const root = path.parse(path.normalize(absolute)).root;
  for (let take = parts.length; take >= 0; take -= 1) {
    const candidate = root + parts.slice(0, take).join(path.sep);
    try {
      const real = await fsPromises.realpath(candidate);
      return { existingReal: real, remaining: parts.slice(take) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        continue;
      }
      throw err;
    }
  }
  // Should be unreachable: filesystem root always exists.
  throw new PathInvalidError("Resolved path outside workspace.", {
    reason: "outside_root",
  });
}

/**
 * Walk parent components of `target` from `root` downward, each
 * step opened with `O_NOFOLLOW`. Closes every fd it opens.
 *
 * Throws `PathInvalidError({ reason: "symlink_or_non_directory" })`
 * on ELOOP, ENOTDIR, or any non-directory `stat`. ENOENT is allowed
 * for the LAST element of `components` only (verify mode + write mode
 * may target a not-yet-existing leaf parent).
 */
async function walkParentsNoFollow(
  root: string,
  components: string[],
): Promise<void> {
  let current = root;
  for (let i = 0; i < components.length; i += 1) {
    const next = path.join(current, components[i] as string);
    let handle;
    try {
      handle = await fsPromises.open(
        next,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ELOOP") {
        throw new PathInvalidError("Path traversal blocked.", {
          reason: "symlink_or_non_directory",
        });
      }
      if (code === "ENOTDIR") {
        throw new PathInvalidError("Path traversal blocked.", {
          reason: "symlink_or_non_directory",
        });
      }
      if (code === "ENOENT") {
        // Parent does not exist yet — that's allowed for write/verify
        // because the builder may be asked "where will this go".
        return;
      }
      throw err;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory()) {
        throw new PathInvalidError("Path traversal blocked.", {
          reason: "symlink_or_non_directory",
        });
      }
    } finally {
      await handle.close();
    }
    current = next;
  }
}

/**
 * The single safe-open entry point. Routes use it for read/write;
 * the workspace path builder uses it in `verify` mode to confirm
 * containment before returning a path string.
 */
export async function safeOpenPath(
  opts: SafeOpenOptions,
): Promise<SafeOpenResult> {
  if (!path.isAbsolute(opts.root)) {
    throw new PathInvalidError("Resolved path outside workspace.", {
      reason: "outside_root",
    });
  }

  // Canonicalize the root once so symlinks in the parent chain (e.g.
  // /var → /private/var on darwin) don't cause a spurious mismatch.
  let realRoot: string;
  try {
    realRoot = await fsPromises.realpath(opts.root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new PathInvalidError("Resolved path outside workspace.", {
        reason: "outside_root",
      });
    }
    throw err;
  }

  // Empty relativePath means "the root itself"; in verify mode that's
  // legal (e.g. subpathRoot lookups). Read/write require a leaf.
  const rel = opts.relativePath;
  const components = rel.length === 0 ? [] : rel.split("/");
  if (rel.length > 0 && components.some((c) => c.length === 0)) {
    // classifyRelativePath should have caught this; defense-in-depth.
    throw new PathInvalidError("Path component invalid.", {
      reason: "empty",
    });
  }

  const candidate = path.join(realRoot, ...components);

  if (opts.mode === "verify") {
    // Walk every parent component with O_NOFOLLOW, then realpath the
    // deepest existing prefix and array-compare.
    const parents = components.slice(0, Math.max(components.length - 1, 0));
    await walkParentsNoFollow(realRoot, parents);
    const { existingReal, remaining } =
      await realpathDeepestExisting(candidate);
    const finalReal =
      remaining.length === 0
        ? existingReal
        : path.join(existingReal, ...remaining);
    if (
      finalReal !== realRoot &&
      !isStrictSubpath(realRoot, finalReal)
    ) {
      throw new PathInvalidError("Resolved path outside workspace.", {
        reason: "outside_root",
      });
    }
    return { canonicalPath: finalReal, fd: null };
  }

  if (components.length === 0) {
    // Read/write must target a leaf inside the root.
    throw new PathInvalidError("Path component invalid.", {
      reason: "empty",
    });
  }

  // Walk parents (every component except the last) with O_NOFOLLOW.
  const parents = components.slice(0, components.length - 1);
  await walkParentsNoFollow(realRoot, parents);

  const flags =
    opts.mode === "read"
      ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
      : fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW;

  let fd: number;
  try {
    fd = await openRawFd(candidate, flags, 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new PathInvalidError("Path traversal blocked.", {
        reason: "symlink_or_non_directory",
      });
    }
    throw err;
  }

  // Final containment check: realpath the candidate (now that the
  // leaf exists) and array-compare against the realpathed root.
  let finalReal: string;
  try {
    finalReal = await fsPromises.realpath(candidate);
  } catch (err) {
    await closeRawFd(fd);
    throw err;
  }
  if (!isStrictSubpath(realRoot, finalReal)) {
    await closeRawFd(fd);
    throw new PathInvalidError("Resolved path outside workspace.", {
      reason: "outside_root",
    });
  }

  return { canonicalPath: finalReal, fd };
}
