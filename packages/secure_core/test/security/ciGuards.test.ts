import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deniedLicenseViolations,
  scanManyTextFiles,
  scanTextForSecretLeaks,
  workflowReferencesRepositorySecrets,
} from "../../src/security/ciGuards.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

function repoPath(path: string): string {
  return resolve(REPO_ROOT, path);
}

describe("CI security guards", () => {
  it("detects high-confidence secret material without echoing values", () => {
    const fixtureKey = ["AKIA", "1234567890ABCDEF"].join("");
    const findings = scanTextForSecretLeaks(
      "fixture.txt",
      `const key = '${fixtureKey}';`,
    );
    expect(findings).toEqual([
      { file: "fixture.txt", line: 1, rule: "aws-access-key-id" },
    ]);
  });

  it("scans tracked text files for high-confidence secret leaks", () => {
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter((path) => path.length > 0)
      .filter((path) => !path.endsWith(".png"))
      .filter((path) => !path.endsWith(".jpg"))
      .filter((path) => !path.endsWith(".pdf"));
    const files = tracked.map((path) => ({
      path,
      text: readFileSync(repoPath(path), "utf8"),
    }));
    expect(scanManyTextFiles(files)).toEqual([]);
  });

  it("keeps the default security workflow free of repository secrets", () => {
    const workflow = readFileSync(
      repoPath(".github/workflows/security.yml"),
      "utf8",
    );
    expect(workflowReferencesRepositorySecrets(workflow)).toBe(false);
  });

  it("models denied-license policy for dependency review", () => {
    expect(
      deniedLicenseViolations([
        { name: "ok", version: "1.0.0", license: "MIT" },
        { name: "bad", version: "1.0.0", license: "AGPL-3.0" },
      ]),
    ).toEqual([
      { packageName: "bad", version: "1.0.0", license: "AGPL-3.0" },
    ]);
  });
});
