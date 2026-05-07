import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { docsPages } from "../pages/docsPages";
import type { DocPage } from "../pages/docsPages";

const DOC_SECTIONS: readonly DocPage["section"][] = [
  "Get Started",
  "Workbench Concepts",
  "Security and Operations",
];

function matchesQuery(page: DocPage, query: string): boolean {
  if (!query) return true;
  const haystack = [page.title, page.summary, page.slug, page.section]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function Sidebar() {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<readonly string[]>([
    "Get Started",
    "Workbench Concepts",
  ]);

  const normalizedQuery = query.trim().toLowerCase();
  const groupedPages = useMemo(
    () =>
      DOC_SECTIONS.map((section) => ({
        section,
        pages: docsPages.filter(
          (page) =>
            page.section === section && matchesQuery(page, normalizedQuery),
        ),
      })).filter((group) => group.pages.length > 0),
    [normalizedQuery],
  );

  const toggleSection = (section: string): void => {
    setOpenSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };

  return (
    <aside className={collapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
      <div className="sidebar-header">
        {!collapsed && (
          <h1>
            <Link to="/">Scientific Simulation Workbench</Link>
          </h1>
        )}
        <button
          type="button"
          aria-label={
            collapsed
              ? "Expand documentation sidebar"
              : "Collapse documentation sidebar"
          }
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {collapsed ? (
        <div className="sidebar-rail" aria-hidden="true" />
      ) : (
        <>
          <label className="doc-search">
            <span>Search documentation</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pages, security, capsules..."
            />
          </label>

          <nav aria-label="Documentation sections">
            {groupedPages.map(({ section, pages }) => {
              const isOpen = normalizedQuery.length > 0 || openSections.includes(section);
              return (
                <section className="doc-nav-section" key={section}>
                  <button
                    type="button"
                    className="doc-section-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(section)}
                  >
                    <span>{section}</span>
                    <strong>{pages.length}</strong>
                    <span aria-hidden="true">{isOpen ? "⌃" : "⌄"}</span>
                  </button>
                  {isOpen && (
                    <ul>
                      {pages.map((page) => (
                        <li key={page.slug}>
                          <NavLink
                            to={"/" + page.slug}
                            className={({ isActive }) =>
                              isActive ? "active" : ""
                            }
                          >
                            <span>{page.title}</span>
                            <small>{page.summary}</small>
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
            {groupedPages.length === 0 && (
              <p className="no-results">
                No documentation pages match <strong>{query}</strong>.
              </p>
            )}
          </nav>
        </>
      )}
    </aside>
  );
}
