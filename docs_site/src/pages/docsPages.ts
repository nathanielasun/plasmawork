import type { ComponentType } from "react";
import Overview from "../content/overview";
import Installation from "../content/installation";
import Usage from "../content/usage";
import OperatingSystemCompatibility from "../content/os_compatibility";
import Architecture from "../content/architecture";
import ModuleDevelopment from "../content/module_development";
import InternalTools from "../content/internal_tools";
import SimulationCapsules from "../content/simulation_capsules";
import AgentWorkflows from "../content/agent_workflows";
import Validation from "../content/validation";
import Troubleshooting from "../content/troubleshooting";
import SecurityAuthentication from "../content/authentication";
import SecurityWorkspaces from "../content/workspaces";
import SecurityRolesPermissions from "../content/roles_permissions";
import SecurityApprovals from "../content/security_approvals";
import SecurityAuditProvenance from "../content/audit_provenance";
import SecurityCapsuleVersioning from "../content/capsule_versioning";
import SecurityStorage from "../content/secure_storage";
import SecurityTesting from "../content/security_testing";
import SecurityOperations from "../content/security_operations";
import SecureFrontendReadiness from "../content/secure_frontend_readiness";
import Sandboxing from "../content/sandboxing";
import OperatorAccess from "../content/operator_access";
import AgentThreatModel from "../content/agent_threat_model";

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  section:
    | "Get Started"
    | "Features"
    | "Workbench Concepts"
    | "Security and Operations";
  Component: ComponentType;
}

export const docsPages: DocPage[] = [
  {
    slug: "overview",
    title: "Overview",
    summary: "What the workbench is and how the paper-to-experiment flow works.",
    section: "Get Started",
    Component: Overview,
  },
  {
    slug: "installation",
    title: "Installation",
    summary: "Install dependencies, bootstrap the repo, and verify local setup.",
    section: "Get Started",
    Component: Installation,
  },
  {
    slug: "usage",
    title: "Using the Workbench",
    summary: "Run the UI/backend, create experiments, and inspect results.",
    section: "Get Started",
    Component: Usage,
  },
  {
    slug: "os-compatibility",
    title: "Operating System Compatibility",
    summary:
      "Supported local-development platforms, wrappers, and deployment-specific limits.",
    section: "Features",
    Component: OperatingSystemCompatibility,
  },
  {
    slug: "architecture",
    title: "Architecture",
    summary: "Package layout, process boundaries, and dependency direction.",
    section: "Get Started",
    Component: Architecture,
  },
  {
    slug: "module-development",
    title: "Physics Module Development",
    summary: "Create validated physics modules with assumptions, tests, and examples.",
    section: "Workbench Concepts",
    Component: ModuleDevelopment,
  },
  {
    slug: "internal-tools",
    title: "Internal Tools",
    summary: "Create, inspect, validate, import, export, and promote reusable tools.",
    section: "Workbench Concepts",
    Component: InternalTools,
  },
  {
    slug: "simulation-capsules",
    title: "Simulation Capsules",
    summary: "Portable experiment bundles, layout, exports, and lifecycle.",
    section: "Workbench Concepts",
    Component: SimulationCapsules,
  },
  {
    slug: "agent-workflows",
    title: "Automation Workflows",
    summary: "Paper ingestion, assisted interpretation, code generation, and review gates.",
    section: "Workbench Concepts",
    Component: AgentWorkflows,
  },
  {
    slug: "validation",
    title: "Validation",
    summary: "Validation categories, reports, status labels, and registry gates.",
    section: "Workbench Concepts",
    Component: Validation,
  },
  {
    slug: "security-authentication",
    title: "Security: Authentication",
    summary: "Server-derived identity, sessions, assurance levels, and recovery flows.",
    section: "Security and Operations",
    Component: SecurityAuthentication,
  },
  {
    slug: "security-workspaces",
    title: "Security: Workspaces",
    summary: "Workspace-scoped object access and artifact namespace rules.",
    section: "Security and Operations",
    Component: SecurityWorkspaces,
  },
  {
    slug: "security-roles-permissions",
    title: "Security: Roles and Permissions",
    summary: "Capabilities, memberships, platform roles, and authorization boundaries.",
    section: "Security and Operations",
    Component: SecurityRolesPermissions,
  },
  {
    slug: "security-approvals",
    title: "Security: Approval Flow",
    summary: "High-risk approval requirements and token consumption rules.",
    section: "Security and Operations",
    Component: SecurityApprovals,
  },
  {
    slug: "security-audit-provenance",
    title: "Security: Audit and Provenance",
    summary: "Append-only audit/provenance chains and verification expectations.",
    section: "Security and Operations",
    Component: SecurityAuditProvenance,
  },
  {
    slug: "security-capsule-versioning",
    title: "Security: Capsule Versioning",
    summary: "Version protection, mutable drafts, immutable versions, and review state.",
    section: "Security and Operations",
    Component: SecurityCapsuleVersioning,
  },
  {
    slug: "security-storage",
    title: "Security: Storage",
    summary: "Workspace-scoped storage paths, WORM anchors, and object facts.",
    section: "Security and Operations",
    Component: SecurityStorage,
  },
  {
    slug: "security-testing",
    title: "Security Testing",
    summary: "Local and CI security gates, coverage assertions, and live probes.",
    section: "Security and Operations",
    Component: SecurityTesting,
  },
  {
    slug: "security-operations",
    title: "Security Operations",
    summary: "Dashboard signals, audit health, rate limits, and periodic verification.",
    section: "Security and Operations",
    Component: SecurityOperations,
  },
  {
    slug: "secure-frontend-readiness",
    title: "Secure Frontend Readiness",
    summary: "Which secure-core surfaces are ready, disabled, or deployment-gated.",
    section: "Security and Operations",
    Component: SecureFrontendReadiness,
  },
  {
    slug: "sandboxing",
    title: "Sandboxing",
    summary: "Execution isolation, worker constraints, mounts, and network controls.",
    section: "Security and Operations",
    Component: Sandboxing,
  },
  {
    slug: "operator-access",
    title: "Operator Access",
    summary: "Operator read, investigate, and fail-closed remediation surfaces.",
    section: "Security and Operations",
    Component: OperatorAccess,
  },
  {
    slug: "agent-threat-model",
    title: "AI and Worker Threat Model",
    summary: "Threat boundaries for AI assistants, generated code, and workers.",
    section: "Security and Operations",
    Component: AgentThreatModel,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    summary: "Common failure modes, logs, validation clues, and bug-memory links.",
    section: "Workbench Concepts",
    Component: Troubleshooting,
  },
];
