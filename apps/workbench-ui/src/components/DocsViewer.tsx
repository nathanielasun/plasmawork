/**
 * DocsViewer — in-app documentation panel.
 *
 * Pages are bundled from `docs_site/src/content/*.tsx` via Vite's
 * `import.meta.glob`, one lazy chunk per page. The user-facing surface
 * is intentionally minimal: a horizontal nav of page links, then the
 * page body. No architectural exposition, no probe, no iframe.
 *
 * Routing: `/docs` defaults to the first discovered page; `/docs/:slug`
 * activates that page. NavLink-based so right-click → open in new tab
 * and URL sharing both work.
 */
import { useEffect, useState } from "react";
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

function humanize(slug: string): string {
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface PageState {
  readonly kind: "loading" | "ready" | "missing" | "error";
  readonly Component?: ComponentType;
  readonly message?: string;
}

export default function DocsViewer(): JSX.Element {
  const { slug } = useParams<{ slug?: string }>();
  // No slug in URL → redirect to the default page so the user has
  // a stable URL they can bookmark / share.
  if (!slug) {
    return <Navigate to={`/docs/${DEFAULT_SLUG}`} replace />;
  }

  const [page, setPage] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const loader = PAGE_LOADERS[slug];
    if (!loader) {
      setPage({
        kind: "missing",
        message: `No docs page at docs_site/src/content/${slug}.tsx.`,
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
  }, [slug]);

  return (
    <div className="docs-page">
      <nav className="docs-nav" aria-label="Documentation pages">
        {SLUGS.map((s) => (
          <NavLink
            key={s}
            to={`/docs/${s}`}
            className={({ isActive }) =>
              isActive ? "docs-nav-link docs-nav-active" : "docs-nav-link"
            }
          >
            {humanize(s)}
          </NavLink>
        ))}
      </nav>

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
    </div>
  );
}
