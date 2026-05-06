/**
 * Test-support helper. Not exported from any public barrel.
 *
 * Builds zip / tar buffers in-memory from a declarative entry list so
 * the L2.11 extractor tests can cover every rejection branch without
 * checking malicious binaries (`evil.zip`) into the repository.
 *
 * Why this lives in `src/` instead of `test/helpers/`:
 *   The L2.11 task contract specifies this location explicitly. The
 *   tradeoff vs `test/helpers/` is that future "no test imports from
 *   src" lint rules will need to whitelist this filename. The header
 *   marker `Test-support helper` is the documented signal for that
 *   whitelist; do NOT export anything from `src/index.ts` that
 *   transitively imports this file.
 *
 * The helper depends on `yazl` (zip writer; companion of `yauzl`) and
 * the existing `tar` package's `Pack`/`WriteEntry` API. Both are
 * deliberate test-only dependencies; production code only reads
 * archives, never writes them.
 */

import yazl from "yazl";
import * as tar from "tar";
import { PassThrough } from "node:stream";

export type TestEntryType =
  | "file"
  | "symlink"
  | "hardlink"
  | "directory"
  | "device";

export interface ZipEntry {
  readonly name: string;
  readonly content?: Buffer | string;
  readonly type?: TestEntryType;
  /** Optional explicit Unix mode override (low 16 bits). */
  readonly mode?: number;
  /** For symlink entries: the link target stored as the file body. */
  readonly linkName?: string;
}

export interface TarEntry {
  readonly name: string;
  readonly content?: Buffer | string;
  readonly type?: TestEntryType;
  readonly mode?: number;
  readonly linkName?: string;
}

const REGULAR_FILE_MODE = 0o100644;
const SYMLINK_MODE = 0o120777;
const DIRECTORY_MODE = 0o040755;
const CHAR_DEVICE_MODE = 0o020644;

function zipModeFor(entry: ZipEntry): number {
  if (entry.mode !== undefined) return entry.mode & 0xffff;
  switch (entry.type ?? "file") {
    case "symlink":
      return SYMLINK_MODE;
    case "directory":
      return DIRECTORY_MODE;
    case "device":
      return CHAR_DEVICE_MODE;
    case "file":
    case "hardlink":
    default:
      return REGULAR_FILE_MODE;
  }
}

/**
 * Build an in-memory zip buffer. Symlink entries are encoded by
 * setting the entry's external file attributes to a Unix symlink
 * mode and storing the link target as the entry body — the on-disk
 * convention zip writers use to round-trip symlinks.
 */
export async function buildZipBuffer(entries: readonly ZipEntry[]): Promise<Buffer> {
  const zip = new yazl.ZipFile();

  for (const e of entries) {
    const mode = zipModeFor(e);
    if (e.type === "directory") {
      zip.addEmptyDirectory(e.name + (e.name.endsWith("/") ? "" : "/"), { mode });
      continue;
    }
    if (e.type === "symlink") {
      const target = e.linkName ?? "";
      zip.addBuffer(Buffer.from(target, "utf8"), e.name, { mode });
      continue;
    }
    const body =
      e.content === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(e.content)
          ? e.content
          : Buffer.from(e.content, "utf8");
    zip.addBuffer(body, e.name, { mode });
  }
  zip.end();

  const chunks: Buffer[] = [];
  // yazl's `outputStream` is a Readable; collect into a Buffer.
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve());
    zip.outputStream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

function tarTypeCode(entry: TarEntry): string {
  switch (entry.type ?? "file") {
    case "symlink":
      return "2";
    case "hardlink":
      return "1";
    case "directory":
      return "5";
    case "device":
      return "3"; // CharacterDevice
    case "file":
    default:
      return "0";
  }
}

/**
 * Build an in-memory tar buffer using `tar.Pack` + `WriteEntry`-like
 * header construction. We emit raw 512-byte tar blocks ourselves
 * because the high-level `tar.create()` reads from the filesystem
 * and won't synthesize symlink/hardlink/device entries from a
 * declarative spec without on-disk equivalents.
 */
export async function buildTarBuffer(entries: readonly TarEntry[]): Promise<Buffer> {
  const blocks: Buffer[] = [];

  for (const e of entries) {
    const typeCode = tarTypeCode(e);
    const isFile = (e.type ?? "file") === "file";
    const body = isFile
      ? e.content === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(e.content)
          ? e.content
          : Buffer.from(e.content, "utf8")
      : Buffer.alloc(0);

    const header = makeUstarHeader({
      name: e.name,
      mode: e.mode ?? 0o644,
      size: body.length,
      typeCode,
      linkName: e.linkName ?? "",
    });
    blocks.push(header);
    if (body.length > 0) {
      blocks.push(body);
      const pad = (512 - (body.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }
  // Tar archives end with two zero blocks.
  blocks.push(Buffer.alloc(1024));
  // Round-trip through tar.Parser? No need; the consumer reads it.
  // Touch the import so type-only usage doesn't get tree-shaken.
  void tar.Parser;
  void PassThrough;
  return Buffer.concat(blocks);
}

interface HeaderInput {
  readonly name: string;
  readonly mode: number;
  readonly size: number;
  readonly typeCode: string;
  readonly linkName: string;
}

function makeUstarHeader(h: HeaderInput): Buffer {
  const buf = Buffer.alloc(512);
  // name: 100 bytes
  buf.write(h.name.slice(0, 100), 0, 100, "utf8");
  // mode: 8 octal-ASCII bytes (incl trailing NUL)
  writeOctal(buf, h.mode, 100, 8);
  // uid, gid: 8 each
  writeOctal(buf, 0, 108, 8);
  writeOctal(buf, 0, 116, 8);
  // size: 12
  writeOctal(buf, h.size, 124, 12);
  // mtime: 12
  writeOctal(buf, 0, 136, 12);
  // chksum placeholder spaces
  buf.write("        ", 148, 8, "ascii");
  // typeflag: 1
  buf.write(h.typeCode.charAt(0), 156, 1, "ascii");
  // linkname: 100
  buf.write(h.linkName.slice(0, 100), 157, 100, "utf8");
  // ustar magic + version
  buf.write("ustar\0", 257, 6, "ascii");
  buf.write("00", 263, 2, "ascii");
  // checksum: sum of bytes, 6 octal digits, NUL, space
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += buf[i] ?? 0;
  const chk = sum.toString(8).padStart(6, "0");
  buf.write(chk, 148, 6, "ascii");
  buf.write("\0", 154, 1, "ascii");
  buf.write(" ", 155, 1, "ascii");
  return buf;
}

function writeOctal(
  buf: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  // Octal, zero-padded to length-1 chars, then NUL.
  const s = value.toString(8).padStart(length - 1, "0");
  buf.write(s, offset, length - 1, "ascii");
  buf.write("\0", offset + length - 1, 1, "ascii");
}
