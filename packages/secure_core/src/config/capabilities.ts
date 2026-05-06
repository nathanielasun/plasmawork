/**
 * Capability constants — Phase 0.5 Layer-1 (L1.1).
 *
 * Source of truth for the capability literal-union. Every middleware,
 * route, and migration that gates on a capability MUST import from
 * here; string literals matching this set are forbidden elsewhere
 * in `src/` (lint rule).
 *
 * v4 §13 lists these capabilities; ADR-0008 pins the TypeScript
 * encoding. ADR-0011's secrets allowlist follows the same pattern
 * (frozen Set, exhaustive type derivation).
 */

export const CAPABILITIES = [
  // Workspace management
  "workspace:view",
  "workspace:manage_members",
  "workspace:manage_settings",
  "workspace:delete",

  // Capsule operations
  "capsule:create",
  "capsule:read",
  "capsule:update",
  "capsule:fork",
  "capsule:delete",

  // Run operations
  "run:create",
  "run:cancel",
  "run:approve_expensive",
  "run:approve_hpc", // distinct from approve_expensive per v4-R10

  // Tool operations
  "tool:create",
  "tool:read",
  "tool:update",
  "tool:request_promotion",
  "tool:approve_promotion",
  "tool:deprecate",

  // Artifacts
  "artifact:read",
  "artifact:export",

  // Approval requests (v4-R4 added this so the create-approval
  // endpoint has a concrete capability to gate on).
  "approval:request",

  // Audit / provenance reads
  "audit:read",
  "provenance:read",

  // Identity-management capabilities
  "session:revoke",
  "user:disable",

  // Platform-level capabilities (operator-only; never workspace-bound).
  // v4 §22.2 splits incident response into investigate vs remediate.
  "platform:audit_read",
  "platform:incident_investigate",
  "platform:incident_remediate",
] as const;

/**
 * Capability literal-union. Use this type wherever a capability
 * value is consumed; `string` is too wide and lets typos through.
 */
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Frozen Set for membership checks. Constant-time lookup; refuses
 * mutation at runtime so a buggy code path can't extend the set.
 */
export const CAPABILITY_SET: ReadonlySet<Capability> = Object.freeze(
  new Set(CAPABILITIES),
);

/**
 * Type guard: narrows an unknown string to a Capability without
 * casting. Used at trust boundaries (DB rows, external requests).
 */
export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && CAPABILITY_SET.has(value as Capability);
}

/**
 * Capability groups by surface — convenient for role definitions.
 * The role seed migrations import these so adding a capability to
 * a group propagates without per-role edits.
 */
export const WORKSPACE_CAPABILITIES = [
  "workspace:view",
  "workspace:manage_members",
  "workspace:manage_settings",
  "workspace:delete",
] as const satisfies readonly Capability[];

export const CAPSULE_CAPABILITIES = [
  "capsule:create",
  "capsule:read",
  "capsule:update",
  "capsule:fork",
  "capsule:delete",
] as const satisfies readonly Capability[];

export const RUN_CAPABILITIES = [
  "run:create",
  "run:cancel",
  "run:approve_expensive",
  "run:approve_hpc",
] as const satisfies readonly Capability[];

export const TOOL_CAPABILITIES = [
  "tool:create",
  "tool:read",
  "tool:update",
  "tool:request_promotion",
  "tool:approve_promotion",
  "tool:deprecate",
] as const satisfies readonly Capability[];

export const ARTIFACT_CAPABILITIES = [
  "artifact:read",
  "artifact:export",
] as const satisfies readonly Capability[];

export const PLATFORM_CAPABILITIES = [
  "platform:audit_read",
  "platform:incident_investigate",
  "platform:incident_remediate",
] as const satisfies readonly Capability[];
