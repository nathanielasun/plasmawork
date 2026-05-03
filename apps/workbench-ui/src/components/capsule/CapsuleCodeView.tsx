/**
 * CapsuleCodeView — file picker for ``src/{generated,user_edits,kernels}/``.
 * Phase 2D consumer of GET /api/capsules/{name} (subtree listing) plus
 * GET /api/capsules/{name}/files/{path} (file content).
 *
 * The user_edits/ subtree is highlighted with a "user-owned" badge — this
 * carries the agent_error_patterns.md "Overwriting <capsule>/src/user_edits/"
 * pattern visibly into the UI so a user never confuses generated and human-
 * edited source.
 */
import { useEffect, useMemo, useState } from "react";
import { apiClient, type CapsuleDetail } from "../../api/client";

interface Props {
  capsuleName: string;
}

const CODE_SUBDIRS = ["src/generated", "src/user_edits", "src/kernels"];

export default function CapsuleCodeView({ capsuleName }: Props) {
  const [detail, setDetail] = useState<CapsuleDetail | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getCapsule(capsuleName)
      .then((d) => {
        setDetail(d);
        // List src/ directly via the file API: we get top-level subtrees, not
        // a recursive listing. We render "user_edits/" as a labelled bucket.
        setFiles(d.subtrees.filter((s) => s.kind === "dir").map((s) => s.name));
      })
      .catch((e) => setError(String(e)));
  }, [capsuleName]);

  useEffect(() => {
    if (!active) return;
    apiClient
      .getCapsuleFile(capsuleName, active)
      .then((f) => setContent(f.content))
      .catch((e) => setError(String(e)));
  }, [capsuleName, active]);

  const hasSrc = useMemo(() => files.includes("src"), [files]);

  if (error) return <p className="placeholder">Failed to load: {error}</p>;
  if (!detail) return <p className="placeholder">Loading capsule code…</p>;
  if (!hasSrc) {
    return (
      <article>
        <h3>Code</h3>
        <p className="placeholder">No <code>src/</code> directory in this capsule.</p>
      </article>
    );
  }

  return (
    <article>
      <h3>Code</h3>
      <p className="muted">
        Capsule code lives under <code>src/</code>. Open one of the canonical
        subtrees:
      </p>
      <ul>
        {CODE_SUBDIRS.map((sub) => (
          <li key={sub}>
            <button
              type="button"
              onClick={() => setActive(`${sub}/__index__`)}
              className="text-button"
            >
              <code>{sub}</code>
            </button>
            {sub === "src/user_edits" && (
              <span className="badge badge-warning"> user-owned — agents must not overwrite</span>
            )}
          </li>
        ))}
      </ul>
      {active && (
        <section>
          <h4>{active}</h4>
          {content ? (
            <pre>
              <code>{content}</code>
            </pre>
          ) : (
            <p className="placeholder">
              Pick a specific file to view (single-file viewer in 2D
              skeleton — recursive listing in 2D+).
            </p>
          )}
        </section>
      )}
    </article>
  );
}
