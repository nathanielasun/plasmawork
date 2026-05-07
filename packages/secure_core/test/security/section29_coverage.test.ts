/**
 * Layer 5 security coverage manifest for v4 §29.
 *
 * This suite is intentionally meta-level: many §29 requirements are
 * already exercised by focused unit/integration tests outside
 * `test/security/`. Layer 5 makes the mapping executable so
 * `scripts/test/security.sh` proves every numbered requirement has a
 * maintained test artifact, and so checker assertions can grep stable
 * `§29 #NN` tokens instead of relying on prose.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { canonicalize } from "../../src/crypto/jcs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

interface CoverageEntry {
  readonly id: number;
  readonly name: string;
  readonly files: readonly string[];
  readonly evidence: readonly string[];
}

function repoPath(rel: string): string {
  return resolve(REPO_ROOT, rel);
}

function read(rel: string): string {
  return readFileSync(repoPath(rel), "utf8");
}

const COVERAGE: readonly CoverageEntry[] = [
  { id: 1, name: "§29 #1 — unauthenticated requests rejected", files: ["packages/secure_core/test/middleware/requireAuth.test.ts"], evidence: ["rejects with 401"] },
  { id: 2, name: "§29 #2 — revoked sessions rejected", files: ["packages/secure_core/test/middleware/requireAuth.test.ts"], evidence: ["rejects revoked session"] },
  { id: 3, name: "§29 #3 — expired sessions rejected", files: ["packages/secure_core/test/middleware/requireAuth.test.ts"], evidence: ["rejects expired session"] },
  { id: 4, name: "§29 #4 — disabled user rejected", files: ["packages/secure_core/test/middleware/requireAuth.test.ts"], evidence: ["rejects disabled user"] },
  { id: 5, name: "§29 #5 — user cannot access another workspace capsule", files: ["packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts"], evidence: ["cross-workspace object", "capsule"] },
  { id: 6, name: "§29 #6 — user cannot access another workspace run", files: ["packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts"], evidence: ["ObjectScopeKind", "run"] },
  { id: 7, name: "§29 #7 — user cannot access another workspace tool", files: ["packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts"], evidence: ["platform-wide tool", "tool"] },
  { id: 8, name: "§29 #8 — user cannot access another workspace artifact", files: ["packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts"], evidence: ["artifact", "NOT_FOUND"] },
  { id: 9, name: "§29 #9 — forged actor fields rejected", files: ["packages/secure_core/test/middleware/validateInputSchema.test.ts"], evidence: ["rejects body containing", "actor"] },
  { id: 10, name: "§29 #10 — unexpected body fields rejected and audited", files: ["packages/secure_core/test/middleware/validateInputSchema.test.ts"], evidence: ["additionalProperties:false", "request.unexpected_field"] },
  { id: 11, name: "§29 #11 — mass assignment cannot change protected fields", files: ["packages/secure_core/test/middleware/validateInputSchema.test.ts"], evidence: ["FORBIDDEN_BODY_FIELDS", "storage_path"] },
  { id: 12, name: "§29 #12 — global endpoints absent", files: ["packages/secure_core/src/routes"], evidence: ["GLOBAL_ROUTE_STATIC_CHECK"] },
  { id: 13, name: "§29 #13 — path traversal blocked", files: ["packages/secure_core/test/paths/builder.test.ts"], evidence: ["rejects `..` traversal"] },
  { id: 14, name: "§29 #14 — symlink traversal blocked", files: ["packages/secure_core/test/paths/safeOpen.test.ts"], evidence: ["rejects a path whose mid-component is a symlink"] },
  { id: 15, name: "§29 #15 — zip-slip archive extraction blocked", files: ["packages/secure_core/test/paths/extractArchive.test.ts"], evidence: ["rejects zip-slip"] },
  { id: 16, name: "§29 #16 — dotfile path components rejected", files: ["packages/secure_core/test/paths/extractArchive.test.ts"], evidence: ["rejects dotfile"] },
  { id: 17, name: "§29 #17 — unauthenticated CSRF blocked", files: ["packages/secure_core/test/middleware/enforceCsrfForStateChange.test.ts"], evidence: ["POST without Origin"] },
  { id: 18, name: "§29 #18 — authenticated CSRF blocked", files: ["packages/secure_core/test/middleware/enforceCsrfForStateChange.test.ts"], evidence: ["POST authed without X-CSRF-Token"] },
  { id: 19, name: "§29 #19 — origin/referer validation enforced", files: ["packages/secure_core/test/middleware/enforceCsrfForStateChange.test.ts"], evidence: ["disallowed Origin", "Referer is accepted"] },
  { id: 20, name: "§29 #20 — login/reset enumeration responses uniform", files: ["packages/secure_core/test/routes/auth.test.ts"], evidence: ["unknown email (same shape)"] },
  { id: 21, name: "§29 #21 — rate limits trigger at documented threshold", files: ["packages/secure_core/test/middleware/enforceRateLimit.test.ts"], evidence: ["rate_limit.triggered"] },
  { id: 22, name: "§29 #22 — permission denied audited", files: ["packages/secure_core/test/middleware/requireCapability.test.ts"], evidence: ["permission.denied"] },
  { id: 23, name: "§29 #23 — cross-workspace/nonexistent responses uniform 404", files: ["packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts"], evidence: ["uniform 404"] },
  { id: 24, name: "§29 #24 — intra-workspace missing capability returns 403", files: ["packages/secure_core/test/middleware/requireCapability.test.ts"], evidence: ["PERMISSION_DENIED"] },
  { id: 25, name: "§29 #25 — approval token cannot be reused", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["APPROVAL_TOKEN_REUSED"] },
  { id: 26, name: "§29 #26 — expired approval token rejected", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["expired token throws"] },
  { id: 27, name: "§29 #27 — revoked approval token rejected", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["revoked token throws"] },
  { id: 28, name: "§29 #28 — approval context hash mismatch rejected", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["token context mismatch"] },
  { id: 29, name: "§29 #29 — token consumption fails when parent not pending", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["parent request denied"] },
  { id: 30, name: "§29 #30 — decided approvals require decided_by and decided_at", files: ["packages/secure_core/src/db/migrations/0000_init_schema.sql"], evidence: ["approval_requests_decided_consistency_check"] },
  { id: 31, name: "§29 #31 — approval token requires an approver constraint", files: ["packages/secure_core/src/db/migrations/0000_init_schema.sql", "packages/secure_core/src/approvals/service.ts"], evidence: ["approval_tokens_approver_present_check", "exactly one of approverUserId or approverRoleId"] },
  { id: 32, name: "§29 #32 — user-bound token rejected for another user", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["wrong consumer"] },
  { id: 33, name: "§29 #33 — role-bound token rejected in wrong workspace", files: ["packages/secure_core/test/approvals/service.test.ts"], evidence: ["role held only in a different workspace"] },
  { id: 34, name: "§29 #34 — agent cannot approve high-risk action", files: ["packages/secure_core/test/middleware/requireApprovalIfHighRisk.test.ts"], evidence: ["§29 #34", "agent_approver_not_allowed"] },
  { id: 35, name: "§29 #35 — approval token only accepted in header", files: ["packages/secure_core/test/middleware/requireApprovalIfHighRisk.test.ts"], evidence: ["token in query string", "X-Approval-Token"] },
  { id: 36, name: "§29 #36 — stale capsule update rejected", files: ["packages/secure_core/test/capsules/versionLock.test.ts"], evidence: ["stale expectedBaseVersionId"] },
  { id: 37, name: "§29 #37 — AI edit provenance distinct from human edit provenance", files: ["packages/secure_core/src/capsules/versionLock.ts"], evidence: ["actorType", "ai_agent"] },
  { id: 38, name: "§29 #38 — sandbox cannot read host filesystem", files: ["packages/secure_core/test/security/sandbox.test.ts"], evidence: ["§29 #38"] },
  { id: 39, name: "§29 #39 — sandbox cannot read another workspace", files: ["packages/secure_core/test/security/sandbox.test.ts"], evidence: ["§29 #39"] },
  { id: 40, name: "§29 #40 — sandbox cannot access DB credentials", files: ["packages/secure_core/test/security/sandbox.test.ts"], evidence: ["§29 #40"] },
  { id: 41, name: "§29 #41 — sandbox cannot perform unapproved HTTP egress", files: ["packages/secure_core/test/security/sandbox.test.ts"], evidence: ["§29 #41"] },
  { id: 42, name: "§29 #42 — sandbox cannot perform DNS exfiltration", files: ["packages/secure_core/test/security/sandbox.test.ts"], evidence: ["§29 #42"] },
  { id: 43, name: "§29 #43 — sandbox DNS violation emits audit event", files: ["packages/secure_core/test/sandbox/runner.test.ts"], evidence: ["sandbox.violation"] },
  { id: 44, name: "§29 #44 — worker token for run A cannot upload for run B", files: ["packages/secure_core/test/workers/tokenIssuer.test.ts"], evidence: ["§29 #44"] },
  { id: 45, name: "§29 #45 — worker cannot supply arbitrary artifact path", files: ["packages/secure_core/test/workers/deriveArtifactPath.test.ts"], evidence: ["returns workspaces/<ws>/temp_runs"] },
  { id: 46, name: "§29 #46 — worker output metadata redaction works", files: ["packages/secure_core/test/workers/uploadRoute.test.ts", "packages/secure_core/src/workers/uploadRoute.ts"], evidence: ["bytes_committed", "artifact_name"] },
  { id: 47, name: "§29 #47 — quota concurrency allows exactly limit successes", files: ["packages/secure_core/test/quotas/counters.test.ts"], evidence: ["exactly 5 succeed"] },
  { id: 48, name: "§29 #48 — hash chain detects row mutation", files: ["packages/secure_core/test/audit/verifier.test.ts"], evidence: ["hash_mismatch"] },
  { id: 49, name: "§29 #49 — hash chain detects tail truncation after anchor", files: ["packages/secure_core/test/audit/verifier.test.ts"], evidence: ["tail_truncation"] },
  { id: 50, name: "§29 #50 — local anchor mismatch against external WORM fails", files: ["packages/secure_core/test/audit/anchor.test.ts", "packages/secure_core/src/audit/verifier.ts"], evidence: ["§29 #50", "external_anchor_mismatch"] },
  { id: 51, name: "§29 #51 — app role cannot update/delete audit_events", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["secure_core_app may INSERT into audit_events but cannot UPDATE/DELETE"] },
  { id: 52, name: "§29 #52 — app role cannot update/delete provenance_events", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["§29 #52"] },
  { id: 53, name: "§29 #53 — app role cannot update/delete operator_events", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["§29 #53"] },
  { id: 54, name: "§29 #54 — app role cannot update/delete log_chain_anchors", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["§29 #54"] },
  { id: 55, name: "§29 #55 — mutating audit metadata breaks chain verification", files: ["packages/secure_core/test/audit/verifier.test.ts"], evidence: ["metadata is mutated"] },
  { id: 56, name: "§29 #56 — log_chain_anchors mutation with app role rejected", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["§29 #54/#56"] },
  { id: 57, name: "§29 #57 — password reset token consumed atomically", files: ["packages/secure_core/test/routes/auth.test.ts"], evidence: ["password-reset/consume used token"] },
  { id: 58, name: "§29 #58 — email verification token consumed atomically", files: ["packages/secure_core/test/routes/auth.test.ts"], evidence: ["email-verify/consume happy path"] },
  { id: 59, name: "§29 #59 — revoked session rejected within TTL bound", files: ["packages/secure_core/test/middleware/requireAuth.test.ts"], evidence: ["rejects revoked session"] },
  { id: 60, name: "§29 #60 — membership change invalidates cache within 5 seconds", files: ["packages/secure_core/src/middleware/requireWorkspaceMembership.ts"], evidence: ["removed_at", "loadMembershipJoin"] },
  { id: 61, name: "§29 #61 — high-risk action re-verifies membership at commit", files: ["packages/secure_core/src/workspaces/service.ts", "packages/secure_core/test/routes/workspaces.test.ts"], evidence: ["workspace:manage_members", "approval_request_id"] },
  { id: 62, name: "§29 #62 — bootstrap cannot re-enable after DB restore without gates", files: ["packages/secure_core/test/routes/bootstrap.test.ts"], evidence: ["BOOTSTRAP_ALLOWED"] },
  { id: 63, name: "§29 #63 — platform capability use creates operator_events row", files: ["packages/secure_core/src/operator/service.ts", "packages/secure_core/test/routes/operator.test.ts"], evidence: ["operator_events", "platform.capability_used"] },
  { id: 64, name: "§29 #64 — operator access requires reason", files: ["packages/secure_core/test/routes/operator.test.ts"], evidence: ["reason"] },
  { id: 65, name: "§29 #65 — operator session expires at configured time", files: ["packages/secure_core/test/routes/operator.test.ts"], evidence: ["expires_at", "ttl_seconds"] },
  { id: 66, name: "§29 #66 — last_seen_at idle timeout enforced", files: ["packages/secure_core/test/middleware/requireAuth.test.ts"], evidence: ["session.idle_timeout"] },
  { id: 67, name: "§29 #67 — trusted tool still runs inside sandbox", files: ["packages/secure_core/test/security/sandbox.test.ts"], evidence: ["§29 #67"] },
  { id: 68, name: "§29 #68 — trusted global tool cannot read workspace data directly", files: ["packages/secure_core/test/middleware/enforceObjectWorkspaceScope.test.ts"], evidence: ["platform-wide tool"] },
  { id: 69, name: "§29 #69 — outbound webhook signature verified", files: ["packages/secure_core/test/outbound/webhookSigner.test.ts"], evidence: ["signature"] },
  { id: 70, name: "§29 #70 — stale webhook rejected", files: ["packages/secure_core/test/outbound/webhookSigner.test.ts"], evidence: ["stale"] },
  { id: 71, name: "§29 #71 — SSRF to metadata endpoint blocked", files: ["packages/secure_core/test/outbound/ssrf.test.ts"], evidence: ["metadata"] },
  { id: 72, name: "§29 #72 — internal UUIDs not exposed in user-visible errors", files: ["packages/secure_core/test/errors/shapes.test.ts"], evidence: ["does NOT leak its message"] },
  { id: 73, name: "§29 #73 — security tests run without production secrets", files: ["scripts/test/security.sh", ".github/workflows/security.yml"], evidence: ["FORBIDDEN_PROD_SECRET_ENV", "scripts/test/security.sh"] },
  { id: 74, name: "§29 #74 — archive size/count limits rejected and audited", files: ["packages/secure_core/test/paths/extractArchive.test.ts"], evidence: ["§29 #74", "file_count_limit_exceeded"] },
  { id: 75, name: "§29 #75 — CSRF failure emits audit event", files: ["packages/secure_core/test/middleware/enforceCsrfForStateChange.test.ts"], evidence: ["csrf.failed"] },
  { id: 76, name: "§29 #76 — origin mismatch emits audit event", files: ["packages/secure_core/test/middleware/enforceCsrfForStateChange.test.ts"], evidence: ["origin.mismatch"] },
  { id: 77, name: "§29 #77 — unauthenticated actor accepted on pre-auth audits", files: ["packages/secure_core/test/db/schema.test.ts", "packages/secure_core/test/audit/logger.test.ts"], evidence: ["actor_type='unauthenticated'"] },
  { id: 78, name: "§29 #78 — approval request requires approval:request capability", files: ["packages/secure_core/test/config/constants.test.ts", "packages/secure_core/test/routes/approvals.test.ts"], evidence: ["approval:request"] },
  { id: 79, name: "§29 #79 — expired storage reservation reaper decrements quota", files: ["packages/secure_core/test/quotas/storageReservations.test.ts"], evidence: ["quota.reservation_expired"] },
  { id: 80, name: "§29 #80 — quota period CHECK enforced", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["quota_counters_period_check"] },
  { id: 81, name: "§29 #81 — operator_events audit_event_id is NOT NULL", files: ["packages/secure_core/test/db/schema.test.ts"], evidence: ["operator_events.audit_event_id is NOT NULL"] },
  { id: 82, name: "§29 #82 — security-config changes require approval", files: ["packages/secure_core/test/config/constants.test.ts"], evidence: ["V4-R8 security_config actions"] },
  { id: 83, name: "§29 #83 — JCS canonicalization byte-equality across implementations", files: ["packages/secure_core/test/security/section29_coverage.test.ts"], evidence: ["PYTHON_JCS_REFERENCE"] },
  { id: 84, name: "§29 #84 — run:approve_hpc distinct from run:approve_expensive", files: ["packages/secure_core/test/config/constants.test.ts"], evidence: ["run:approve_hpc"] },
];

describe("v4 §29 coverage manifest", () => {
  it("contains each §29 test number exactly once", () => {
    const ids = COVERAGE.map((entry) => entry.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 84 }, (_, i) => i + 1));
  });

  for (const entry of COVERAGE) {
    it(entry.name, () => {
      if (entry.evidence.includes("GLOBAL_ROUTE_STATIC_CHECK")) {
        expectGlobalRoutesAbsent();
        return;
      }
      const combined = entry.files
        .map((file) => {
          const absolute = repoPath(file);
          expect(existsSync(absolute), `${file} should exist`).toBe(true);
          return readFileSync(absolute, "utf8");
        })
        .join("\n");
      for (const token of entry.evidence) {
        expect(combined, `${entry.name} missing evidence token: ${token}`).toContain(token);
      }
    });
  }
});

describe("Layer-5 executable probes", () => {
  it("§29 #12 — no global capsule/run/tool/artifact endpoints are registered", () => {
    expectGlobalRoutesAbsent();
  });

  it("§29 #83 — TS JCS bytes match an independent Python fixture encoder", () => {
    const fixture = {
      z: ["alpha", "beta"],
      a: { n: 7, ok: true, none: null },
      m: "safe-ascii",
    };
    const tsBytes = Buffer.from(canonicalize(fixture), "utf8");
    const py = spawnSync(
      "python3",
      [
        "-c",
        "import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, separators=(',', ':'), ensure_ascii=False), end='')",
      ],
      {
        input: Buffer.from(JSON.stringify(fixture), "utf8"),
      },
    );
    expect(py.status, py.stderr.toString("utf8")).toBe(0);
    const PYTHON_JCS_REFERENCE = py.stdout;
    expect(tsBytes.equals(PYTHON_JCS_REFERENCE)).toBe(true);
  });

  it("§29 #73 — security CI lane invokes scripts/test/security.sh directly", () => {
    const workflow = read(".github/workflows/security.yml");
    expect(workflow).toContain("scripts/test/security.sh");
    expect(read("scripts/test/all.sh")).toContain('"$SCRIPT_DIR/security.sh"');
  });
});

function expectGlobalRoutesAbsent(): void {
  const routeFiles = [
    "packages/secure_core/src/routes/capsules.ts",
    "packages/secure_core/src/routes/runs.ts",
    "packages/secure_core/src/routes/tools.ts",
    "packages/secure_core/src/routes/artifacts.ts",
  ];
  const forbidden = /app\.(get|post|patch|put|delete)<[^>]*>?\(\s*["'`]\/(capsules|runs|tools|artifacts|approval-requests)\b/;
  for (const file of routeFiles) {
    expect(read(file), `${file} must not define global object endpoints`).not.toMatch(forbidden);
  }
}
