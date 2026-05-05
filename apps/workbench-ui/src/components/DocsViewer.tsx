/**
 * DocsViewer — in-app documentation panel.
 *
 * Per AGENTS.md "Maintain program documentation inside `docs_site/`...
 * the workbench UI loads documentation from this canonical source", this
 * panel renders the docs by IFRAMING the docs_site dev server (default
 * `http://localhost:3000/`). Pages on disk live at
 * `docs_site/src/content/<slug>.tsx`; the docs server serves them at
 * `/<slug>`. Nothing is duplicated into the workbench UI bundle.
 *
 * The earlier implementation tried to dynamically import the TSX modules
 * via Vite's `@docs/` alias with `/* @vite-ignore *‍/`, which made the
 * import skip resolution at build time and 404 at runtime. That broke
 * every page. The iframe approach is structurally simpler: the docs
 * server already knows how to serve the pages, the workbench just
 * embeds it.
 *
 * Override the docs URL via `VITE_DOCS_BASE_URL` if you run the docs
 * server on a non-default port.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient, type DocsPage } from "../api/client";
import { Card, Pill } from "./ui";

const DOCS_BASE_URL: string =
  (import.meta.env.VITE_DOCS_BASE_URL as string | undefined) ??
  "http://localhost:3000";

type ServerState = "probing" | "up" | "down";

function buildPageUrl(slug: string): string {
  return `${DOCS_BASE_URL.replace(/\/$/, "")}/${slug}`;
}

function probeDocsServer(signal: AbortSignal): Promise<boolean> {
  // The docs server has no /health endpoint; a HEAD on the root
  // suffices. Use `mode: "no-cors"` so a successful network round-trip
  // doesn't fail the promise just because Vite's dev server doesn't
  // emit CORS headers for our origin. Even with no-cors we get a
  // non-throwing response when the server is reachable.
  return fetch(`${DOCS_BASE_URL}/`, {
    method: "GET",
    mode: "no-cors",
    signal,
  })
    .then(() => true)
    .catch(() => false);
}

export default function DocsViewer(): JSX.Element {
  const { slug } = useParams<{ slug?: string }>();
  const activeSlug = slug ?? "overview";
  const [pages, setPages] = useState<readonly DocsPage[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<ServerState>("probing");
  const navigate = useNavigate();
  const probeTimer = useRef<number | null>(null);

  // Fetch the page list once.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listDocsPages()
      .then((p) => {
        if (!cancelled) setPages(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPagesError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe the docs server. Re-probe every 5 s when down so the panel
  // catches up the moment the user runs `scripts/docs/dev.sh`.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const tick = (): void => {
      probeDocsServer(controller.signal).then((up) => {
        if (cancelled) return;
        setServerState(up ? "up" : "down");
        if (!up) {
          probeTimer.current = window.setTimeout(tick, 5000);
        }
      });
    };
    tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (probeTimer.current !== null) {
        window.clearTimeout(probeTimer.current);
        probeTimer.current = null;
      }
    };
  }, []);

  const iframeUrl = buildPageUrl(activeSlug);

  return (
    <article>
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Documentation</p>
            <h1 className="hero-title">Workbench docs</h1>
            <p className="hero-subtitle">
              Pages are served by the canonical{" "}
              <code>docs_site/</code> dev server at{" "}
              <code>{DOCS_BASE_URL}</code>. Per AGENTS.md, the workbench UI
              never inlines doc text — it embeds the docs server, so
              pages are kept in lockstep with the source on disk.
            </p>
          </div>
          {serverState === "up" && <Pill kind="trusted">docs server up</Pill>}
          {serverState === "down" && (
            <Pill kind="warning">docs server not reachable</Pill>
          )}
          {serverState === "probing" && <Pill kind="draft">probing…</Pill>}
        </div>
      </header>

      {pagesError && (
        <p className="error" role="alert">
          Backend pages list unavailable: {pagesError}
        </p>
      )}

      <Card title="Pages" subtitle="Click a page to load it from the docs server.">
        {pages === null && <p className="placeholder">Loading…</p>}
        {pages !== null && pages.length === 0 && (
          <p className="placeholder">No docs pages discovered.</p>
        )}
        {pages !== null && pages.length > 0 && (
          <div className="row">
            {pages.map((p) => (
              <button
                key={p.slug}
                type="button"
                className={p.slug === activeSlug ? "primary" : undefined}
                onClick={() => navigate(`/docs/${p.slug}`)}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={activeSlug}
        action={
          <a
            href={iframeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            open in new tab ↗
          </a>
        }
      >
        {serverState === "down" ? (
          <div className="card-panel">
            <p>
              <strong>Docs server is not reachable at{" "}
              <code>{DOCS_BASE_URL}</code>.</strong>
            </p>
            <p>Start it from a terminal:</p>
            <pre>
              <code>scripts/docs/dev.sh</code>
            </pre>
            <p className="muted">
              The panel re-probes every five seconds; it will swap to the
              live page automatically once the server responds. Override
              the URL by setting <code>VITE_DOCS_BASE_URL</code> when you
              run the workbench UI.
            </p>
          </div>
        ) : (
          <iframe
            key={activeSlug /* force reload on slug change */}
            title={`docs page: ${activeSlug}`}
            src={iframeUrl}
            style={{
              width: "100%",
              height: "70vh",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-card)",
            }}
          />
        )}
      </Card>
    </article>
  );
}
