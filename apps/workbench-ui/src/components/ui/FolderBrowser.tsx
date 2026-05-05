/**
 * FolderBrowser — read-only tree view over the workbench's allow-listed
 * roots (`simulation_capsules`, `temp_runs`, `local_cache`, `temp_imports`,
 * `examples`).
 *
 * Replaces hand-typed paths in panels that need to point at a file or
 * directory inside the workbench. Strictly safer: the server-side
 * `/api/browse` endpoint refuses any path that escapes its root, so the
 * UI cannot accidentally invite a path-traversal attempt the way a free
 * `<input>` can.
 *
 * Lifecycle:
 *   - Each fetch is bound to an `AbortController`. Navigating fast
 *     (e.g. clicking a deep dir while the current request is in flight)
 *     cancels the prior fetch instead of letting the responses race.
 *   - The component is read-only: clicking a directory descends into
 *     it, clicking a file invokes `onSelect`. There's no write surface.
 *
 * Type discipline:
 *   - `BrowseEntry` is a discriminated union (`kind: "dir" | "file"`),
 *     so callers handle the two cases exhaustively.
 *   - `roots` and `initialRoot` use the `BrowseRoot` literal union from
 *     `client.ts` — adding a root is a single source-of-truth edit
 *     server-side, mirrored here once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiClient,
  BROWSE_ROOTS,
  type BrowseEntry,
  type BrowseResponse,
  type BrowseRoot,
} from "../../api/client";
import { Pill } from "./Pill";

export interface FolderBrowserProps {
  /** Allow-listed roots the user can switch between. Defaults to all five. */
  readonly roots?: readonly BrowseRoot[];
  /** Initial root selection. Defaults to `roots[0]`. */
  readonly initialRoot?: BrowseRoot;
  /** Initial path within the root. Empty = root itself. */
  readonly initialPath?: string;
  /** Optional filter (e.g. only show .yaml files). Directories are always shown. */
  readonly filter?: (entry: BrowseEntry) => boolean;
  /** Called when the user picks a file. */
  readonly onSelect: (entry: BrowseEntry, root: BrowseRoot) => void;
  /** Optional dismiss handler when this is rendered in a popover. */
  readonly onClose?: () => void;
}

type FetchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly response: BrowseResponse };

const ROOT_LABELS: Readonly<Record<BrowseRoot, string>> = {
  simulation_capsules: "simulation_capsules/",
  temp_runs: "temp_runs/",
  local_cache: "local_cache/",
  temp_imports: "temp_imports/",
  examples: "examples/",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FolderBrowser({
  roots = BROWSE_ROOTS,
  initialRoot,
  initialPath = "",
  filter,
  onSelect,
  onClose,
}: FolderBrowserProps): JSX.Element {
  const [root, setRoot] = useState<BrowseRoot>(initialRoot ?? roots[0]);
  const [path, setPath] = useState<string>(initialPath);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (target: { root: BrowseRoot; path: string }): void => {
      // Cancel any in-flight request before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ kind: "loading" });
      apiClient
        .browse({ root: target.root, path: target.path }, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setState({ kind: "ready", response });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          // AbortError shows up as DOMException; explicit name check.
          if (err instanceof DOMException && err.name === "AbortError") return;
          const message = err instanceof Error ? err.message : String(err);
          setState({ kind: "error", message });
        });
    },
    [],
  );

  // Fetch on mount + when root or path changes.
  useEffect(() => {
    load({ root, path });
    return () => {
      abortRef.current?.abort();
    };
  }, [root, path, load]);

  const handleRootChange = (next: BrowseRoot): void => {
    if (next === root) return;
    setRoot(next);
    setPath("");
  };

  const handleEntryClick = (entry: BrowseEntry): void => {
    if (entry.kind === "dir") {
      setPath(entry.path);
    } else {
      onSelect(entry, root);
    }
  };

  const handleUp = (): void => {
    if (state.kind === "ready" && state.response.parent_relative_path !== null) {
      setPath(state.response.parent_relative_path);
    }
  };

  const breadcrumbs = path === "" ? [] : path.split("/").filter(Boolean);

  return (
    <div className="folder-browser">
      <div className="folder-browser-header">
        <div className="segment">
          {roots.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === root ? "segment-active" : ""}
              onClick={() => handleRootChange(candidate)}
            >
              {ROOT_LABELS[candidate]}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className="text-button" onClick={onClose}>
            close
          </button>
        )}
      </div>

      <div className="folder-browser-breadcrumbs">
        <button
          type="button"
          className="text-button"
          onClick={() => setPath("")}
          disabled={path === ""}
        >
          {ROOT_LABELS[root]}
        </button>
        {breadcrumbs.map((segment, idx) => {
          const sub = breadcrumbs.slice(0, idx + 1).join("/");
          const isLast = idx === breadcrumbs.length - 1;
          return (
            <span key={sub} className="folder-browser-crumb">
              <span className="muted">/</span>
              {isLast ? (
                <span>{segment}</span>
              ) : (
                <button type="button" className="text-button" onClick={() => setPath(sub)}>
                  {segment}
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div className="folder-browser-body">
        {state.kind === "loading" && <p className="placeholder">Loading…</p>}
        {state.kind === "error" && (
          <p className="error" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && (
          <FolderBrowserList
            response={state.response}
            filter={filter}
            onUp={handleUp}
            onClick={handleEntryClick}
          />
        )}
      </div>
    </div>
  );
}

interface ListProps {
  readonly response: BrowseResponse;
  readonly filter?: (entry: BrowseEntry) => boolean;
  readonly onUp: () => void;
  readonly onClick: (entry: BrowseEntry) => void;
}

function FolderBrowserList({
  response,
  filter,
  onUp,
  onClick,
}: ListProps): JSX.Element {
  // Apply filter to FILES only — dirs always shown so the user can
  // descend even if no file at this level matches.
  const visible = response.entries.filter(
    (e) => e.kind === "dir" || !filter || filter(e),
  );

  const canGoUp = response.parent_relative_path !== null;

  return (
    <ul className="folder-browser-list">
      {canGoUp && (
        <li>
          <button type="button" className="folder-browser-row" onClick={onUp}>
            <span className="folder-browser-icon">↰</span>
            <span className="folder-browser-name">..</span>
            <span className="muted folder-browser-meta">up one level</span>
          </button>
        </li>
      )}
      {visible.length === 0 && !canGoUp && (
        <li>
          <p className="placeholder">Empty.</p>
        </li>
      )}
      {visible.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            className="folder-browser-row"
            onClick={() => onClick(entry)}
          >
            <span className="folder-browser-icon" aria-hidden>
              {entry.kind === "dir" ? "▸" : "·"}
            </span>
            <span className="folder-browser-name">{entry.name}</span>
            <span className="folder-browser-meta">
              {entry.kind === "file" ? (
                <>
                  <Pill kind="solver">file</Pill>
                  <span className="muted">{formatSize(entry.size_bytes)}</span>
                </>
              ) : (
                <Pill kind="model">dir</Pill>
              )}
            </span>
          </button>
        </li>
      ))}
      {response.truncated && (
        <li>
          <p className="placeholder">
            (entries truncated — server cap reached; refine the path to see more)
          </p>
        </li>
      )}
    </ul>
  );
}

export default FolderBrowser;
