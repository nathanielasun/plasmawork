/**
 * Repository-root locator — Phase 0.5 Layer-1 (L1.6 helper).
 *
 * The local secrets provider resolves its file path against the
 * repository root, not against the secure_core package or the current
 * working directory. Walking up from `import.meta.url` looking for the
 * sentinel pair (`AGENTS.md` + `CLAUDE.md`) finds the correct anchor
 * regardless of where the import landed (deep nested test, built
 * artifact, etc.).
 *
 * Tests can override the lookup by setting `SIMWORKBENCH_REPO_ROOT`,
 * which is how the test suite isolates itself from the real
 * `local_cache/` directory.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the repository root by walking up from this module's file
 * location until both `AGENTS.md` and `CLAUDE.md` are present in a
 * single directory. Honors `SIMWORKBENCH_REPO_ROOT` for tests.
 *
 * Throws if no such directory is found before reaching the filesystem
 * root — the workbench cannot run without a known anchor for path
 * resolution.
 */
export function repoRoot(): string {
  const override = process.env.SIMWORKBENCH_REPO_ROOT;
  if (override) {
    if (!existsSync(override) || !statSync(override).isDirectory()) {
      throw new Error(
        `SIMWORKBENCH_REPO_ROOT="${override}" is not an existing directory`,
      );
    }
    return resolve(override);
  }

  const start = dirname(fileURLToPath(import.meta.url));
  let current = start;

  // Bound the climb so a misconfigured deployment fails loudly instead
  // of looping forever on a symlink cycle.
  for (let i = 0; i < 64; i++) {
    const agents = resolve(current, "AGENTS.md");
    const claude = resolve(current, "CLAUDE.md");
    if (existsSync(agents) && existsSync(claude)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `repoRoot(): no directory containing both AGENTS.md and CLAUDE.md found above ${start}; set SIMWORKBENCH_REPO_ROOT to override`,
  );
}
