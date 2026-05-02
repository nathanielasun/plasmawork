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
    slug: "troubleshooting",
    title: "Troubleshooting",
    Component: Troubleshooting,
  },
];
