/**
 * DocsViewer — in-app docs panel.
 *
 * Loads pages directly from the canonical `docs_site/src/content/*.tsx`
 * source via the Vite `@docs` alias. Per AGENTS.md "Maintain program
 * documentation inside `docs_site/`... do not duplicate documentation
 * strings into the UI source — load from the canonical docs", this viewer
 * is the only place the UI renders docs and it MUST NOT inline doc text.
 *
 * If you find yourself copy-pasting docs into the UI: stop. Add the page in
 * `docs_site/src/content/` and import it here.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ComponentType } from "react";
import { apiClient, type DocsPage } from "../api/client";

// Canonical docs come from docs_site/src/content. Vite's `@docs` alias
// resolves there; we lazy-import per slug so the bundle stays modest.
async function loadDocsPage(slug: string): Promise<ComponentType | null> {
  try {
    const mod = await import(/* @vite-ignore */ `@docs/${slug}.tsx`);
    return (mod.default ?? null) as ComponentType | null;
  } catch {
    return null;
  }
}

export default function DocsViewer() {
  const { slug } = useParams<{ slug?: string }>();
  const activeSlug = slug ?? "overview";
  const [pages, setPages] = useState<DocsPage[] | null>(null);
  const [Page, setPage] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listDocsPages()
      .then((p) => !cancelled && setPages(p))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDocsPage(activeSlug).then((c) => !cancelled && setPage(() => c));
    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  return (
    <article>
      <h2>Documentation</h2>
      <p className="placeholder">
        Loaded directly from <code>docs_site/src/content/</code> — the
        canonical source. No duplication.
      </p>

      {error && <p className="placeholder">Backend unavailable: {error}</p>}

      {pages && pages.length > 0 && (
        <nav>
          <ul>
            {pages.map((p) => (
              <li key={p.slug}>
                <Link to={`/docs/${p.slug}`}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <hr />
      {Page ? (
        <Page />
      ) : (
        <p className="placeholder">
          Page <code>{activeSlug}</code> not yet rendered. Make sure{" "}
          <code>docs_site/src/content/{activeSlug}.tsx</code> exports a default
          React component.
        </p>
      )}
    </article>
  );
}
