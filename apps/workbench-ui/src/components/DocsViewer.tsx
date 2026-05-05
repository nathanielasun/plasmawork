/**
 * DocsViewer — in-app documentation panel.
 *
 * Per AGENTS.md "Maintain program documentation inside `docs_site/`...
 * the workbench UI loads documentation from this canonical source", this
 * panel pulls each page directly from `docs_site/src/content/<slug>.tsx`
 * via Vite's `import.meta.glob`. The TSX modules are bundled lazily —
 * each page is its own chunk, so the workbench startup is unaffected
 * by docs we haven't opened yet.
 *
 * History:
 *   - The first attempt used a dynamic `import()` with `@vite-ignore`,
 *     which made Vite skip alias resolution and every page 404'd at
 *     runtime.
 *   - The second attempt iframed a separate Vite server at
 *     `localhost:3000`, which worked but required a third process to
 *     be running.
 *   - This version (2026-05-05) collapses the docs back into the
 *     workbench UI bundle: one server, one process, no iframe, no
 *     probe. The canonical-source rule is still satisfied — pages
 *     literally come from `docs_site/src/content/`, just bundled
 *     into the workbench instead of served by a separate process.
 */
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Pill } from "./ui";

type DocsModule = { default: ComponentType };

// `import.meta.glob` runs at build time. Vite walks docs_site/src/content/
// and produces a Record of dynamic-import functions, one per .tsx file.
// Path is relative to THIS file (apps/workbench-ui/src/components/), so:
//   ../../../../docs_site/src/content/*.tsx
// Lazy `eager: false` means each page becomes its own code-split chunk.
const PAGE_MODULES = import.meta.glob<DocsModule>(
  "../../../../docs_site/src/content/*.tsx",
);

// Build a slug → loader map. Path looks like
//   "../../../../docs_site/src/content/overview.tsx"
// → slug = "overview". Done once at module-load time so navigation is
// instant.
const PAGE_LOADERS: Readonly<Record<string, () => Promise<DocsModule>>> = (() => {
  const out: Record<string, () => Promise<DocsModule>> = {};
  for (const [path, loader] of Object.entries(PAGE_MODULES)) {
    const match = path.match(/\/([^/]+)\.tsx$/);
    if (match) out[match[1]] = loader;
  }
  return out;
})();

const SLUGS = Object.freeze(Object.keys(PAGE_LOADERS).sort());

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
  const activeSlug = slug ?? SLUGS[0] ?? "overview";
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const loader = PAGE_LOADERS[activeSlug];
    if (!loader) {
      setPage({
        kind: "missing",
        message: `No docs page found at docs_site/src/content/${activeSlug}.tsx`,
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
  }, [activeSlug]);

  return (
    <article>
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Documentation</p>
            <h1 className="hero-title">Workbench docs</h1>
            <p className="hero-subtitle">
              Pages live at <code>docs_site/src/content/&lt;slug&gt;.tsx</code>{" "}
              and are bundled into the workbench UI lazily — one chunk per
              page. AGENTS.md "no inlined doc text" still holds: the
              workbench imports from the canonical source rather than
              copying it.
            </p>
          </div>
          <Pill kind="trusted">{SLUGS.length} pages</Pill>
        </div>
      </header>

      <Card title="Pages" subtitle="Click a page to load it.">
        {SLUGS.length === 0 && (
          <p className="placeholder">
            No docs pages discovered under{" "}
            <code>docs_site/src/content/</code>. Add a TSX file there
            and the panel will pick it up on the next reload.
          </p>
        )}
        {SLUGS.length > 0 && (
          <div className="row">
            {SLUGS.map((s) => (
              <button
                key={s}
                type="button"
                className={s === activeSlug ? "primary" : undefined}
                onClick={() => navigate(`/docs/${s}`)}
              >
                {humanize(s)}
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="docs-content">
        {page.kind === "loading" && (
          <p className="placeholder">Loading {activeSlug}…</p>
        )}
        {page.kind === "missing" && (
          <Card title={`Page not found: ${activeSlug}`}>
            <p>{page.message}</p>
          </Card>
        )}
        {page.kind === "error" && (
          <Card title={`Failed to load ${activeSlug}`}>
            <p className="error">{page.message}</p>
          </Card>
        )}
        {page.kind === "ready" && page.Component && <page.Component />}
      </div>
    </article>
  );
}
