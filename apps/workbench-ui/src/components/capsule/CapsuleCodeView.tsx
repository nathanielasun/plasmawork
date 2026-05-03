/**
 * CapsuleCodeView — file picker for ``src/{generated,user_edits,kernels}/``.
 * Phase 2D consumer of GET /api/capsules/{name}/tree?subtree=src plus
 * GET /api/capsules/{name}/files/{path} (file content).
 *
 * The user_edits/ subtree is highlighted with a "user-owned" badge — this
 * carries the agent_error_patterns.md "Overwriting <capsule>/src/user_edits/"
 * pattern visibly into the UI so a user never confuses generated and human-
 * edited source.
 *
 * Regression for the post-Phase-2-close finding "Capsule UI does not
 * actually show code" — the previous version requested
 * ``src/generated/__index__`` (which the file endpoint always returns 404
 * for) and never rendered any source.
 */
import { useEffect, useState } from "react";
import { apiClient, type CapsuleTreeFile } from "../../api/client";

interface Props {
  capsuleName: string;
}

interface Bucket {
  label: string;
  prefix: string;
  badge?: string;
}

const BUCKETS: Bucket[] = [
  { label: "src/generated", prefix: "src/generated/" },
  {
    label: "src/user_edits",
    prefix: "src/user_edits/",
    badge: "user-owned — agents must not overwrite",
  },
  { label: "src/kernels", prefix: "src/kernels/" },
];

export default function CapsuleCodeView({ capsuleName }: Props) {
  const [files, setFiles] = useState<CapsuleTreeFile[] | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFiles(null);
    setActivePath(null);
    setContent(null);
    setError(null);
    apiClient
      .getCapsuleTree(capsuleName, "src")
      .then((tree) => setFiles(tree.files))
      .catch((e) => setError(String(e)));
  }, [capsuleName]);

  useEffect(() => {
    if (!activePath) return;
    setContent(null);
    apiClient
      .getCapsuleFile(capsuleName, activePath)
      .then((f) => setContent(f.content))
      .catch((e) => setError(String(e)));
  }, [capsuleName, activePath]);

  if (error)
    return (
      <article>
        <h3>Code</h3>
        <p className="placeholder">Capsule code unavailable: {error}</p>
      </article>
    );
  if (files === null) return <p className="placeholder">Loading capsule code…</p>;
  if (files.length === 0) {
    return (
      <article>
        <h3>Code</h3>
        <p className="placeholder">
          No files under <code>src/</code> in this capsule yet.
        </p>
      </article>
    );
  }

  return (
    <article>
      <h3>Code</h3>
      <p className="muted">Capsule code lives under <code>src/</code>.</p>
      {BUCKETS.map((bucket) => {
        const bucketFiles = files.filter((f) => f.path.startsWith(bucket.prefix));
        if (bucketFiles.length === 0) return null;
        return (
          <section key={bucket.prefix}>
            <h4>
              <code>{bucket.label}</code>
              {bucket.badge && (
                <>
                  {" "}
                  <span className="badge badge-warning">{bucket.badge}</span>
                </>
              )}
            </h4>
            <ul>
              {bucketFiles.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => setActivePath(f.path)}
                    className="text-button"
                    aria-pressed={activePath === f.path}
                  >
                    <code>{f.path.slice(bucket.prefix.length)}</code>
                  </button>{" "}
                  <span className="muted">({f.size_bytes} B)</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {activePath && (
        <section>
          <h4>{activePath}</h4>
          {content === null ? (
            <p className="placeholder">Loading file…</p>
          ) : (
            <pre>
              <code>{content}</code>
            </pre>
          )}
        </section>
      )}
    </article>
  );
}
