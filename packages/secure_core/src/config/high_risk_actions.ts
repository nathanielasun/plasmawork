/**
 * High-risk action constants — Phase 0.5 Layer-1 (L1.1).
 *
 * Every action that requires the §16 approval flow lives here.
 * The L2.9 `requireApprovalIfHighRisk` middleware reads this set
 * to decide whether to demand an approval token; the L4 routes
 * declare their action via this enum.
 *
 * Source: v4 §5.6, including the V4-R8 enumeration of "changing
 * security configuration" and the V4-R10 split between
 * `expensive_run` and `hpc_submission`.
 *
 * Adding a new high-risk action requires an ADR per v4 §5.6.
 */

import type { Capability } from "./capabilities.js";

export const HIGH_RISK_ACTIONS = [
  // Compute
  "expensive_run",
  "hpc_submission",

  // Module / tool registry promotion
  "trusted_module_promotion",
  "validation_status_upgrade",

  // Cross-workspace data movement
  "artifact_export",
  "destructive_delete",

  // Membership / governance
  "workspace_membership_change",
  "platform_operator_access",

  // AI / agentic
  "trusted_ai_code_acceptance",

  // Security configuration changes (V4-R8 enumeration)
  "security_config.role_permission_assignment",
  "security_config.capability_change",
  "security_config.sandbox_egress_allowlist",
  "security_config.rate_limit",
  "security_config.audit_redaction_allowlist",
  "security_config.approval_policy",
  "security_config.secrets_rotation_policy",
  "security_config.hmac_key_rotation",
  "security_config.bootstrap_worm_policy",
] as const;

export type HighRiskAction = (typeof HIGH_RISK_ACTIONS)[number];

export const HIGH_RISK_ACTION_SET: ReadonlySet<HighRiskAction> = Object.freeze(
  new Set(HIGH_RISK_ACTIONS),
);

export function isHighRiskAction(value: unknown): value is HighRiskAction {
  return (
    typeof value === "string" &&
    HIGH_RISK_ACTION_SET.has(value as HighRiskAction)
  );
}

/**
 * Map from high-risk action → required capability for the approver.
 * The §17 rule "agent cannot approve high-risk action" is enforced
 * separately by checking the approver's `actor_type === "human"` —
 * this map only covers which capability is required.
 *
 * V4-R10: HPC submission and expensive runs are gated by DISTINCT
 * capabilities; sharing one capability between them was rejected.
 */
export const HIGH_RISK_APPROVER_CAPABILITY: Readonly<
  Record<HighRiskAction, Capability>
> = Object.freeze({
  expensive_run: "run:approve_expensive",
  hpc_submission: "run:approve_hpc",
  trusted_module_promotion: "tool:approve_promotion",
  validation_status_upgrade: "tool:approve_promotion",
  artifact_export: "artifact:export",
  destructive_delete: "workspace:manage_settings",
  workspace_membership_change: "workspace:manage_members",
  platform_operator_access: "platform:incident_remediate",
  trusted_ai_code_acceptance: "tool:approve_promotion",
  "security_config.role_permission_assignment": "workspace:manage_settings",
  "security_config.capability_change": "workspace:manage_settings",
  "security_config.sandbox_egress_allowlist": "platform:incident_remediate",
  "security_config.rate_limit": "platform:incident_remediate",
  "security_config.audit_redaction_allowlist": "platform:incident_remediate",
  "security_config.approval_policy": "platform:incident_remediate",
  "security_config.secrets_rotation_policy": "platform:incident_remediate",
  "security_config.hmac_key_rotation": "platform:incident_remediate",
  "security_config.bootstrap_worm_policy": "platform:incident_remediate",
});
