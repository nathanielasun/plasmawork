import type { ComponentType } from "react";
import Overview from "../content/overview";
import Installation from "../content/installation";
import Usage from "../content/usage";
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
import Sandboxing from "../content/sandboxing";
import OperatorAccess from "../content/operator_access";
import AgentThreatModel from "../content/agent_threat_model";

export interface DocPage {
  slug: string;
  title: string;
  Component: ComponentType;
}

export const docsPages: DocPage[] = [
  { slug: "overview", title: "Overview", Component: Overview },
  { slug: "installation", title: "Installation", Component: Installation },
  { slug: "usage", title: "Usage", Component: Usage },
  { slug: "architecture", title: "Architecture", Component: Architecture },
  {
    slug: "module-development",
    title: "Module Development",
    Component: ModuleDevelopment,
  },
  { slug: "internal-tools", title: "Internal Tools", Component: InternalTools },
  {
    slug: "simulation-capsules",
    title: "Simulation Capsules",
    Component: SimulationCapsules,
  },
  {
    slug: "agent-workflows",
    title: "Agent Workflows",
    Component: AgentWorkflows,
  },
  { slug: "validation", title: "Validation", Component: Validation },
  {
    slug: "security-authentication",
    title: "Security: Authentication",
    Component: SecurityAuthentication,
  },
  {
    slug: "security-workspaces",
    title: "Security: Workspaces",
    Component: SecurityWorkspaces,
  },
  {
    slug: "security-roles-permissions",
    title: "Security: Roles and Permissions",
    Component: SecurityRolesPermissions,
  },
  {
    slug: "security-approvals",
    title: "Security: Approval Flow",
    Component: SecurityApprovals,
  },
  {
    slug: "security-audit-provenance",
    title: "Security: Audit and Provenance",
    Component: SecurityAuditProvenance,
  },
  {
    slug: "security-capsule-versioning",
    title: "Security: Capsule Versioning",
    Component: SecurityCapsuleVersioning,
  },
  {
    slug: "security-storage",
    title: "Security: Storage",
    Component: SecurityStorage,
  },
  {
    slug: "security-testing",
    title: "Security Testing",
    Component: SecurityTesting,
  },
  { slug: "sandboxing", title: "Sandboxing", Component: Sandboxing },
  {
    slug: "operator-access",
    title: "Operator Access",
    Component: OperatorAccess,
  },
  {
    slug: "agent-threat-model",
    title: "Agent Threat Model",
    Component: AgentThreatModel,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    Component: Troubleshooting,
  },
];
