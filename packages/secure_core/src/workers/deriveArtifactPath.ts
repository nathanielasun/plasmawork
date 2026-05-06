/**
 * Worker artifact path derivation — ADR-0012 step 2 / Phase 0.5 L3.9.
 *
 * The single authorized function for computing where a worker-uploaded
 * artifact lands. The endpoint NEVER accepts a worker-supplied path
 * component beyond `artifactName`; that component is sanitized
 * through L2.10's `WorkspacePathBuilder` which already enforces v4
 * §9.4 (component regex, no `..`, no symlink escape, etc.).
 *
 *   workspaces/<workspaceId>/temp_runs/<runId>/<artifactKind>/<artifactName>
 *
 * `artifactKind` is a closed enum aligned with v4 §10.2 / ADR-0012:
 *   results | plots | validation | provenance | archive
 */

import {
  WorkspacePathBuilder,
  type WorkspaceSubpath,
} from "../paths/builder.js";
import { SecureCoreError } from "../errors/shapes.js";

export const ARTIFACT_KINDS = [
  "results",
  "plots",
  "validation",
  "provenance",
  "archive",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_KIND_SET: ReadonlySet<ArtifactKind> = Object.freeze(
  new Set(ARTIFACT_KINDS),
);

export function isArtifactKind(v: unknown): v is ArtifactKind {
  return typeof v === "string" && ARTIFACT_KIND_SET.has(v as ArtifactKind);
}

export interface DeriveArtifactPathOptions {
  readonly workspaceId: string;
  readonly runId: string;
  readonly artifactKind: ArtifactKind;
  readonly artifactName: string;
  readonly builder: WorkspacePathBuilder;
}

/**
 * Returns the absolute canonical destination path. Throws
 * `WORKER_UPLOAD_DENIED { reason: "path_traversal" }` if the
 * artifactName fails the §9.4 component check, or if the resolved
 * path would escape the per-run mount root.
 *
 * Caller-controlled fields go through the builder's relativePath
 * argument; the subpath enum + workspaceId / runId prefix are
 * server-derived.
 */
export async function deriveArtifactPath(
  opts: DeriveArtifactPathOptions,
): Promise<string> {
  if (!isArtifactKind(opts.artifactKind)) {
    throw new SecureCoreError(
      "WORKER_UPLOAD_DENIED",
      "Unknown artifact kind.",
      { reason: "path_traversal", artifactKind: opts.artifactKind },
    );
  }
  const subpath: WorkspaceSubpath = "temp_runs";
  const relativePath = `${opts.runId}/${opts.artifactKind}/${opts.artifactName}`;
  try {
    return await opts.builder.build({
      workspaceId: opts.workspaceId,
      subpath,
      relativePath,
    });
  } catch {
    // Map every PathInvalidError / containment failure to
    // worker.upload_denied{reason: "path_traversal"} per ADR-0012
    // step 8. The builder's audit emission already happened.
    throw new SecureCoreError(
      "WORKER_UPLOAD_DENIED",
      "Artifact destination rejected.",
      { reason: "path_traversal" },
    );
  }
}
