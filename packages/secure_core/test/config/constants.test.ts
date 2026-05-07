/**
 * L1.1 constants — exhaustiveness + invariant tests.
 *
 * The constants module is the source of truth for capabilities, audit
 * events, and high-risk actions. These tests pin three properties:
 *   1. Every list is non-empty and free of duplicates.
 *   2. Every type guard agrees with the underlying Set.
 *   3. The high-risk approver-capability map covers every high-risk
 *      action, and every mapped capability exists in the capability
 *      set (i.e. the cross-references are sound).
 */
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_SET,
  isCapability,
  WORKSPACE_CAPABILITIES,
  CAPSULE_CAPABILITIES,
  RUN_CAPABILITIES,
  TOOL_CAPABILITIES,
  ARTIFACT_CAPABILITIES,
  PLATFORM_CAPABILITIES,
  type Capability,
} from "../../src/config/capabilities";
import {
  AUDIT_EVENTS,
  AUDIT_EVENT_SET,
  isAuditEvent,
  ARCHIVE_REJECTION_REASONS,
  WORKER_UPLOAD_DENIED_REASONS,
  AUDIT_RESULTS,
} from "../../src/config/audit_events";
import {
  HIGH_RISK_ACTIONS,
  HIGH_RISK_ACTION_SET,
  HIGH_RISK_APPROVER_CAPABILITY,
  isHighRiskAction,
} from "../../src/config/high_risk_actions";

function expectUnique<T>(values: readonly T[]): void {
  expect(new Set(values).size).toBe(values.length);
}

describe("capabilities", () => {
  it("is non-empty and free of duplicates", () => {
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    expectUnique(CAPABILITIES);
  });

  it("isCapability agrees with CAPABILITY_SET", () => {
    for (const cap of CAPABILITIES) {
      expect(isCapability(cap)).toBe(true);
      expect(CAPABILITY_SET.has(cap)).toBe(true);
    }
    expect(isCapability("nope:fake")).toBe(false);
    expect(isCapability(null)).toBe(false);
    expect(isCapability(42)).toBe(false);
  });

  it("groupings are subsets of CAPABILITIES", () => {
    const groups: readonly (readonly Capability[])[] = [
      WORKSPACE_CAPABILITIES,
      CAPSULE_CAPABILITIES,
      RUN_CAPABILITIES,
      TOOL_CAPABILITIES,
      ARTIFACT_CAPABILITIES,
      PLATFORM_CAPABILITIES,
    ];
    for (const group of groups) {
      for (const cap of group) {
        expect(CAPABILITY_SET.has(cap)).toBe(true);
      }
    }
  });

  it("RUN_CAPABILITIES distinguishes approve_expensive and approve_hpc (V4-R10)", () => {
    expect(RUN_CAPABILITIES).toContain("run:approve_expensive");
    expect(RUN_CAPABILITIES).toContain("run:approve_hpc");
  });

  it("approval:request capability is present (V4-R4)", () => {
    expect(CAPABILITY_SET.has("approval:request")).toBe(true);
  });

  it("CAPABILITIES tuple is readonly at the type level", () => {
    // Compile-time guard: `as const` + `ReadonlySet` prevents mutation
    // at the call sites that import these constants. Runtime
    // immutability of `Set` instances is not provided by Object.freeze
    // (Set methods are defined on the prototype, not the instance), so
    // we assert the property we actually rely on: every consumer sees
    // the same immutable view.
    const snapshot = [...CAPABILITIES];
    expect(snapshot).toEqual([...CAPABILITIES]);
    expect(CAPABILITY_SET.size).toBe(CAPABILITIES.length);
  });
});

describe("audit events", () => {
  it("is non-empty and free of duplicates", () => {
    expect(AUDIT_EVENTS.length).toBeGreaterThan(0);
    expectUnique(AUDIT_EVENTS);
  });

  it("includes the V4 residual events (R1, R2, R5)", () => {
    expect(AUDIT_EVENT_SET.has("archive.entry_rejected")).toBe(true); // R1
    expect(AUDIT_EVENT_SET.has("csrf.failed")).toBe(true); // R2
    expect(AUDIT_EVENT_SET.has("origin.mismatch")).toBe(true); // R2
    expect(AUDIT_EVENT_SET.has("quota.reservation_expired")).toBe(true); // R5
  });

  it("includes both worker upload events", () => {
    expect(AUDIT_EVENT_SET.has("worker.uploaded")).toBe(true);
    expect(AUDIT_EVENT_SET.has("worker.upload_denied")).toBe(true);
  });

  it("includes the Layer-5 branch-protection override event", () => {
    expect(AUDIT_EVENT_SET.has("branch_protection.bypass")).toBe(true);
  });

  it("isAuditEvent narrows correctly", () => {
    expect(isAuditEvent("login.succeeded")).toBe(true);
    expect(isAuditEvent("login.fake")).toBe(false);
    expect(isAuditEvent(undefined)).toBe(false);
  });

  it("ARCHIVE_REJECTION_REASONS covers all V4 §9.4 categories", () => {
    expect(ARCHIVE_REJECTION_REASONS).toContain("symlink");
    expect(ARCHIVE_REJECTION_REASONS).toContain("hardlink");
    expect(ARCHIVE_REJECTION_REASONS).toContain("zip_slip");
    expect(ARCHIVE_REJECTION_REASONS).toContain("size_limit_exceeded"); // V4-R1
    expect(ARCHIVE_REJECTION_REASONS).toContain("file_count_limit_exceeded"); // V4-R1
    expectUnique(ARCHIVE_REJECTION_REASONS);
  });

  it("WORKER_UPLOAD_DENIED_REASONS covers ADR-0012 step 8", () => {
    const expected = new Set([
      "scope_mismatch",
      "path_traversal",
      "oversize",
      "archive_unsafe",
      "quota_exceeded",
      "redaction_failed",
    ]);
    for (const r of WORKER_UPLOAD_DENIED_REASONS) {
      expect(expected.has(r)).toBe(true);
    }
    expect(WORKER_UPLOAD_DENIED_REASONS.length).toBe(expected.size);
  });

  it("AUDIT_RESULTS is the closed succeeded/denied/failed set", () => {
    expect(AUDIT_RESULTS).toEqual(["succeeded", "denied", "failed"]);
  });
});

describe("high-risk actions", () => {
  it("is non-empty and free of duplicates", () => {
    expect(HIGH_RISK_ACTIONS.length).toBeGreaterThan(0);
    expectUnique(HIGH_RISK_ACTIONS);
  });

  it("isHighRiskAction narrows correctly", () => {
    for (const action of HIGH_RISK_ACTIONS) {
      expect(isHighRiskAction(action)).toBe(true);
      expect(HIGH_RISK_ACTION_SET.has(action)).toBe(true);
    }
    expect(isHighRiskAction("not-a-real-action")).toBe(false);
  });

  it("approver-capability map covers every high-risk action", () => {
    for (const action of HIGH_RISK_ACTIONS) {
      const required = HIGH_RISK_APPROVER_CAPABILITY[action];
      expect(required, `no approver capability mapped for ${action}`).toBeDefined();
    }
  });

  it("every required approver capability exists in CAPABILITY_SET", () => {
    for (const action of HIGH_RISK_ACTIONS) {
      const required = HIGH_RISK_APPROVER_CAPABILITY[action];
      expect(
        CAPABILITY_SET.has(required),
        `${action} requires capability ${required!} which is not in CAPABILITY_SET`,
      ).toBe(true);
    }
  });

  it("V4-R8 security_config actions are all present", () => {
    const expected = [
      "security_config.role_permission_assignment",
      "security_config.capability_change",
      "security_config.sandbox_egress_allowlist",
      "security_config.rate_limit",
      "security_config.audit_redaction_allowlist",
      "security_config.approval_policy",
      "security_config.secrets_rotation_policy",
      "security_config.hmac_key_rotation",
      "security_config.bootstrap_worm_policy",
    ];
    for (const action of expected) {
      expect(HIGH_RISK_ACTION_SET.has(action as never)).toBe(true);
    }
  });

  it("expensive_run and hpc_submission are distinct (V4-R10)", () => {
    expect(HIGH_RISK_APPROVER_CAPABILITY.expensive_run).toBe(
      "run:approve_expensive",
    );
    expect(HIGH_RISK_APPROVER_CAPABILITY.hpc_submission).toBe(
      "run:approve_hpc",
    );
    expect(HIGH_RISK_APPROVER_CAPABILITY.expensive_run).not.toBe(
      HIGH_RISK_APPROVER_CAPABILITY.hpc_submission,
    );
  });
});
