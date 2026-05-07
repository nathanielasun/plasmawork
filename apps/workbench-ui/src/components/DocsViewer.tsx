/**
 * DocsViewer — in-app documentation panel.
 *
 * Pages are bundled from `docs_site/src/content/*.tsx` via Vite's
 * `import.meta.glob`, one lazy chunk per page. The navigation is a
 * documentation-style side rail: categorized, searchable, collapsible, and
 * separate from the reading column.
 *
 * Routing: `/docs` defaults to the first discovered page; `/docs/:slug`
 * activates that page. NavLink-based so right-click → open in new tab
 * and URL sharing both work.
 */
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";

type DocsModule = { default: ComponentType };

// Build-time discovery: Vite walks docs_site/src/content/ and produces
// a Record of lazy import functions. Path is relative to THIS file.
const PAGE_MODULES = import.meta.glob<DocsModule>(
  "../../../../docs_site/src/content/*.tsx",
);

const PAGE_LOADERS: Readonly<Record<string, () => Promise<DocsModule>>> = (() => {
  const out: Record<string, () => Promise<DocsModule>> = {};
  for (const [path, loader] of Object.entries(PAGE_MODULES)) {
    const match = path.match(/\/([^/]+)\.tsx$/);
    if (match) out[match[1]] = loader;
  }
  return out;
})();

const SLUGS = Object.freeze(Object.keys(PAGE_LOADERS).sort());
const DEFAULT_SLUG = SLUGS.includes("overview") ? "overview" : SLUGS[0] ?? "";
const SIDEBAR_STORAGE_KEY = "workbench:docs-sidebar-collapsed";

interface DocPageMeta {
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
}

interface DocSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly slugs: readonly string[];
}

const DOC_PAGE_META: Readonly<Record<string, DocPageMeta>> = {
  overview: {
    title: "Overview",
    summary: "What the workbench is and how the paper-to-experiment flow works.",
    keywords: ["start", "concepts", "workflow"],
  },
  installation: {
    title: "Installation",
    summary: "Install dependencies, bootstrap the repo, and verify local setup.",
    keywords: ["setup", "bootstrap", "commands"],
  },
  usage: {
    title: "Using the Workbench",
    summary: "Run the UI/backend, create experiments, and inspect results.",
    keywords: ["run", "experiment", "controls"],
  },
  os_compatibility: {
    title: "Operating System Compatibility",
    summary:
      "Supported local-development platforms, wrappers, and deployment-specific limits.",
    keywords: [
      "os",
      "platform",
      "windows",
      "macos",
      "linux",
      "shell",
      "compatibility",
    ],
  },
  architecture: {
    title: "Architecture",
    summary: "Package layout, process boundaries, and dependency direction.",
    keywords: ["packages", "api", "boundaries"],
  },
  simulation_capsules: {
    title: "Simulation Capsules",
    summary: "Portable experiment bundles, layout, exports, and lifecycle.",
    keywords: ["capsule", "lxp", "export", "provenance"],
  },
  module_development: {
    title: "Physics Module Development",
    summary: "Create validated physics modules with assumptions, tests, and examples.",
    keywords: ["physics", "modules", "validation"],
  },
  internal_tools: {
    title: "Internal Tools",
    summary: "Create, inspect, validate, import, export, and promote reusable tools.",
    keywords: ["tools", "registry", "sdk"],
  },
  validation: {
    title: "Validation",
    summary: "Validation categories, reports, status labels, and registry gates.",
    keywords: ["benchmarks", "tests", "trusted"],
  },
  agent_workflows: {
    title: "Automation Workflows",
    summary: "Paper ingestion, assisted interpretation, code generation, and review gates.",
    keywords: ["automation", "assistants", "paper", "review"],
  },
  troubleshooting: {
    title: "Troubleshooting",
    summary: "Common failure modes, logs, validation clues, and bug-memory links.",
    keywords: ["debug", "logs", "failures"],
  },
  authentication: {
    title: "Authentication",
    summary: "Server-derived identity, sessions, assurance levels, and recovery flows.",
    keywords: ["auth", "session", "identity"],
  },
  workspaces: {
    title: "Workspaces",
    summary: "Workspace-scoped object access and artifact namespace rules.",
    keywords: ["workspace", "isolation", "objects"],
  },
  roles_permissions: {
    title: "Roles and Permissions",
    summary: "Capabilities, memberships, platform roles, and authorization boundaries.",
    keywords: ["roles", "capabilities", "permissions"],
  },
  security_approvals: {
    title: "Approval Flow",
    summary: "High-risk approval requirements and token consumption rules.",
    keywords: ["approval", "tokens", "high risk"],
  },
  audit_provenance: {
    title: "Audit and Provenance",
    summary: "Append-only audit/provenance chains and verification expectations.",
    keywords: ["audit", "provenance", "chain"],
  },
  capsule_versioning: {
    title: "Capsule Versioning",
    summary: "Version protection, mutable drafts, immutable versions, and review state.",
    keywords: ["capsules", "version", "immutable"],
  },
  secure_storage: {
    title: "Secure Storage",
    summary: "Workspace-scoped storage paths, WORM anchors, and object facts.",
    keywords: ["storage", "worm", "artifacts"],
  },
  security_testing: {
    title: "Security Testing",
    summary: "Local and CI security gates, coverage assertions, and live probes.",
    keywords: ["security", "ci", "tests"],
  },
  security_operations: {
    title: "Security Operations",
    summary: "Dashboard signals, audit health, rate limits, and periodic verification.",
    keywords: ["dashboard", "operators", "monitoring"],
  },
  secure_frontend_readiness: {
    title: "Secure Frontend Readiness",
    summary: "Which secure-core surfaces are ready, disabled, or deployment-gated.",
    keywords: ["frontend", "readiness", "security"],
  },
  sandboxing: {
    title: "Sandboxing",
    summary: "Execution isolation, worker constraints, mounts, and network controls.",
    keywords: ["sandbox", "workers", "gvisor"],
  },
  operator_access: {
    title: "Operator Access",
    summary: "Operator read, investigate, and fail-closed remediation surfaces.",
    keywords: ["operator", "incident", "step up"],
  },
  agent_threat_model: {
    title: "AI and Worker Threat Model",
    summary: "Threat boundaries for AI assistants, generated code, and workers.",
    keywords: ["threat", "ai", "worker"],
  },
};

const DOC_SECTIONS: readonly DocSection[] = [
  {
    id: "start",
    title: "Get Started",
    summary: "Install, launch, and understand the system.",
    slugs: ["overview", "installation", "usage", "architecture"],
  },
  {
    id: "features",
    title: "Features",
    summary: "User-facing capability contracts and compatibility notes.",
    slugs: ["os_compatibility"],
  },
  {
    id: "workbench",
    title: "Workbench Concepts",
    summary: "Capsules, modules, tools, validation, and automation.",
    slugs: [
      "simulation_capsules",
      "module_development",
      "internal_tools",
      "validation",
      "agent_workflows",
      "troubleshooting",
    ],
  },
  {
    id: "security",
    title: "Security and Operations",
    summary: "Identity, workspaces, approvals, audit, sandboxing, and operations.",
    slugs: [
      "authentication",
      "workspaces",
      "roles_permissions",
      "security_approvals",
      "audit_provenance",
      "capsule_versioning",
      "secure_storage",
      "security_testing",
      "security_operations",
      "secure_frontend_readiness",
      "sandboxing",
      "operator_access",
      "agent_threat_model",
    ],
  },
];

function humanize(slug: string): string {
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleFor(slug: string): string {
  return DOC_PAGE_META[slug]?.title ?? humanize(slug);
}

function summaryFor(slug: string): string {
  return DOC_PAGE_META[slug]?.summary ?? "";
}

function readInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function buildSections(): readonly DocSection[] {
  const known = new Set<string>();
  const sections = DOC_SECTIONS.map((section) => {
    const slugs = section.slugs.filter((s) => s in PAGE_LOADERS);
    slugs.forEach((s) => known.add(s));
    return { ...section, slugs };
  }).filter((section) => section.slugs.length > 0);

  const uncategorized = SLUGS.filter((s) => !known.has(s));
  if (uncategorized.length === 0) return sections;
  return [
    ...sections,
    {
      id: "reference",
      title: "Reference",
      summary: "Additional generated or specialized reference pages.",
      slugs: uncategorized,
    },
  ];
}

function sectionForSlug(
  sections: readonly DocSection[],
  selectedSlug: string,
): DocSection | null {
  return sections.find((section) => section.slugs.includes(selectedSlug)) ?? null;
}

function pageMatches(
  section: DocSection,
  slug: string,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const meta = DOC_PAGE_META[slug];
  const haystack = [
    slug,
    section.title,
    section.summary,
    titleFor(slug),
    meta?.summary ?? "",
    ...(meta?.keywords ?? []),
  ].join(" ").toLowerCase();
  return haystack.includes(normalizedQuery);
}

interface PageState {
  readonly kind: "loading" | "ready" | "missing" | "error";
  readonly Component?: ComponentType;
  readonly message?: string;
}

export default function DocsViewer(): JSX.Element {
  const { slug } = useParams<{ slug?: string }>();
  const selectedSlug = slug?.replaceAll("-", "_") ?? DEFAULT_SLUG;

  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    readInitialSidebarCollapsed,
  );
  const sections = useMemo(buildSections, []);
  const activeSection = sectionForSlug(sections, selectedSlug);
  const [openSectionIds, setOpenSectionIds] = useState<readonly string[]>(() => [
    "start",
    "features",
    "workbench",
    activeSection?.id ?? "start",
  ]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // localStorage can be unavailable in locked-down browser contexts.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!activeSection) return;
    setOpenSectionIds((current) =>
      current.includes(activeSection.id)
        ? current
        : [...current, activeSection.id],
    );
  }, [activeSection]);

  useEffect(() => {
    let cancelled = false;
    const loader = PAGE_LOADERS[selectedSlug];
    if (!loader) {
      setPage({
        kind: "missing",
        message: `No docs page at docs_site/src/content/${selectedSlug}.tsx.`,
      });
      return;
    }
    setPage({ kind: "loading" });
    loader()
      .then((mod) => {
        if (cancelled) return;
        setPage({ kind: "ready", Component: mod.default });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPage({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          slugs: section.slugs.filter((s) =>
            pageMatches(section, s, normalizedQuery),
          ),
        }))
        .filter((section) => section.slugs.length > 0),
    [normalizedQuery, sections],
  );
  const visibleCount = visibleSections.reduce(
    (count, section) => count + section.slugs.length,
    0,
  );
  const activeTitle = titleFor(selectedSlug);

  const toggleSection = (id: string): void => {
    setOpenSectionIds((current) =>
      current.includes(id)
        ? current.filter((sectionId) => sectionId !== id)
        : [...current, id],
    );
  };

  // Redirects happen after hooks so the component obeys the React hook-order
  // contract under both `/docs` and `/docs/:slug`.
  if (!slug) {
    return <Navigate to={`/docs/${DEFAULT_SLUG}`} replace />;
  }
  if (selectedSlug !== slug && selectedSlug in PAGE_LOADERS) {
    return <Navigate to={`/docs/${selectedSlug}`} replace />;
  }

  return (
    <div className={`docs-page${sidebarCollapsed ? " docs-page-sidebar-collapsed" : ""}`}>
      <aside className="docs-sidebar" aria-label="Documentation navigation">
        <div className="docs-sidebar-header">
          {!sidebarCollapsed && (
            <div>
              <p className="docs-sidebar-eyebrow">Documentation</p>
              <p className="docs-sidebar-title">Workbench Manual</p>
            </div>
          )}
          <button
            type="button"
            className="docs-sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={
              sidebarCollapsed
                ? "Expand documentation sidebar"
                : "Collapse documentation sidebar"
            }
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? "›" : "‹"}
          </button>
        </div>

        {sidebarCollapsed ? (
          <div className="docs-sidebar-rail" aria-hidden="true" title={activeTitle} />
        ) : (
          <>
            <label className="docs-search">
              <span className="eyebrow">Search documentation</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages, concepts, security..."
                aria-label="Search documentation"
              />
            </label>

            <nav className="docs-sidebar-nav" aria-label="Documentation sections">
              {visibleSections.map((section) => {
                const isOpen =
                  normalizedQuery.length > 0 ||
                  openSectionIds.includes(section.id);
                return (
                  <section className="docs-nav-section" key={section.id}>
                    <button
                      type="button"
                      className="docs-section-toggle"
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={isOpen}
                    >
                      <span>
                        <strong>{section.title}</strong>
                        <small>{section.summary}</small>
                      </span>
                      <span className="docs-section-count">
                        {section.slugs.length}
                      </span>
                      <span className="docs-section-caret" aria-hidden="true">
                        {isOpen ? "⌃" : "⌄"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="docs-section-pages">
                        {section.slugs.map((s) => (
                          <NavLink
                            key={s}
                            to={`/docs/${s}`}
                            className={({ isActive }) =>
                              isActive
                                ? "docs-sidebar-link docs-sidebar-link-active"
                                : "docs-sidebar-link"
                            }
                          >
                            <span>{titleFor(s)}</span>
                            <small>{summaryFor(s)}</small>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              {visibleCount === 0 && (
                <p className="docs-no-results">
                  No documentation pages match <strong>{query}</strong>.
                </p>
              )}
            </nav>
          </>
        )}
      </aside>

      <section className="docs-main" aria-label="Documentation article">
        <header className="docs-main-header">
          <div>
            <p className="docs-main-eyebrow">
              {activeSection?.title ?? "Documentation"}
            </p>
            <h1>{activeTitle}</h1>
          </div>
        </header>

        <div className="docs-content">
        {page.kind === "loading" && (
          <p className="docs-loading">Loading…</p>
        )}
        {page.kind === "missing" && (
          <p className="docs-loading">{page.message}</p>
        )}
        {page.kind === "error" && (
          <p className="error" role="alert">
            {page.message}
          </p>
        )}
        {page.kind === "ready" && page.Component && <page.Component />}
        </div>
      </section>
    </div>
  );
}
