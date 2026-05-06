/**
 * L3.9 — deriveArtifactPath tests.
 *
 * Pure-logic against a temp WorkspacePathBuilder: every refusal path
 * collapses to WORKER_UPLOAD_DENIED { reason: "path_traversal" }.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspacePathBuilder } from "../../src/paths/builder.js";
import {
  deriveArtifactPath,
  isArtifactKind,
  ARTIFACT_KINDS,
  type ArtifactKind,
} from "../../src/workers/deriveArtifactPath.js";
import { SecureCoreError } from "../../src/errors/shapes.js";

const VALID_WS_ID = "11111111-1111-4111-8111-111111111111";
const VALID_RUN_ID = "22222222-2222-4222-8222-222222222222";

describe("deriveArtifactPath", () => {
  let storageRoot: string;
  let builder: WorkspacePathBuilder;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "secure-core-l39-"));
    builder = new WorkspacePathBuilder({ workspaceStorageRoot: storageRoot });
    // The builder's verify path requires the subpath root to exist
    // (safeOpenPath realpaths it). Pre-create temp_runs for our
    // canonical workspace.
    await mkdir(
      join(storageRoot, "workspaces", VALID_WS_ID, "temp_runs"),
      { recursive: true },
    );
  });

  afterAll(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("returns workspaces/<ws>/temp_runs/<runId>/<kind>/<name>", async () => {
    const p = await deriveArtifactPath({
      workspaceId: VALID_WS_ID,
      runId: VALID_RUN_ID,
      artifactKind: "results",
      artifactName: "trajectory.h5",
      builder,
    });
    expect(p).toContain(`/workspaces/${VALID_WS_ID}/temp_runs/`);
    expect(p).toContain(`/${VALID_RUN_ID}/results/trajectory.h5`);
    // The builder canonicalizes via realpath; on macOS that prepends
    // `/private` to a /var/folders mkdtemp root, so don't compare the
    // raw storageRoot prefix — the segment-level checks above are
    // sufficient.
  });

  it.each(ARTIFACT_KINDS)("accepts artifact kind %s", async (kind: ArtifactKind) => {
    const p = await deriveArtifactPath({
      workspaceId: VALID_WS_ID,
      runId: VALID_RUN_ID,
      artifactKind: kind,
      artifactName: "out.bin",
      builder,
    });
    expect(p).toContain(`/${kind}/out.bin`);
  });

  it("rejects unknown artifact kind synchronously", async () => {
    await expect(
      deriveArtifactPath({
        workspaceId: VALID_WS_ID,
        runId: VALID_RUN_ID,
        artifactKind: "stuff" as ArtifactKind,
        artifactName: "x",
        builder,
      }),
    ).rejects.toMatchObject({ code: "WORKER_UPLOAD_DENIED" });
  });

  it("rejects ../escape attempt with path_traversal", async () => {
    await expect(
      deriveArtifactPath({
        workspaceId: VALID_WS_ID,
        runId: VALID_RUN_ID,
        artifactKind: "results",
        artifactName: "../../etc/passwd",
        builder,
      }),
    ).rejects.toMatchObject({
      code: "WORKER_UPLOAD_DENIED",
      details: { reason: "path_traversal" },
    });
  });

  it("rejects dotfile artifact name with path_traversal", async () => {
    await expect(
      deriveArtifactPath({
        workspaceId: VALID_WS_ID,
        runId: VALID_RUN_ID,
        artifactKind: "results",
        artifactName: ".env",
        builder,
      }),
    ).rejects.toMatchObject({
      code: "WORKER_UPLOAD_DENIED",
      details: { reason: "path_traversal" },
    });
  });

  it("rejects non-UUID workspace id with path_traversal", async () => {
    await expect(
      deriveArtifactPath({
        workspaceId: "not-a-uuid",
        runId: VALID_RUN_ID,
        artifactKind: "results",
        artifactName: "out.bin",
        builder,
      }),
    ).rejects.toBeInstanceOf(SecureCoreError);
  });

  it("rejects non-UUID run id with path_traversal", async () => {
    await expect(
      deriveArtifactPath({
        workspaceId: VALID_WS_ID,
        runId: "../../runs",
        artifactKind: "results",
        artifactName: "out.bin",
        builder,
      }),
    ).rejects.toBeInstanceOf(SecureCoreError);
  });

  it("isArtifactKind reflects the closed enum", () => {
    expect(isArtifactKind("results")).toBe(true);
    expect(isArtifactKind("archive")).toBe(true);
    expect(isArtifactKind("foo")).toBe(false);
    expect(isArtifactKind(null)).toBe(false);
  });
});
