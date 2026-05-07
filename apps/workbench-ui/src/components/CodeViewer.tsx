/**
 * CodeViewer — read-only viewer for capsule code.
 *
 * Per AGENTS.md "Adding Internal Tools and Simulation Modules" + agent_error
 * patterns "Overwriting <capsule>/src/user_edits/": this viewer is **read-only
 * for `<capsule>/src/user_edits/`**. The workbench shell UI never offers an edit
 * affordance for that subtree. File contents are loaded through the current
 * capsule file API rather than placeholder text.
 */
import { useEffect, useState } from "react";
import {
  apiClient,
  type CapsuleEntry,
  type CapsuleTreeFile,
} from "../api/client";

function isCodePath(path: string): boolean {
  return (
    path.startsWith("src/generated/") ||
    path.startsWith("src/user_edits/") ||
    path.startsWith("src/kernels/")
  );
}

export default function CodeViewer() {
  const [capsules, setCapsules] = useState<CapsuleEntry[] | null>(null);
  const [selectedCapsule, setSelectedCapsule] = useState("");
  const [files, setFiles] = useState<CapsuleTreeFile[]>([]);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiClient
      .listCapsules()
      .then((items) => {
        if (cancelled) return;
        setCapsules(items);
        setSelectedCapsule((current) => current || items[0]?.name || "");
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedCapsule) {
      setFiles([]);
      setPath("");
      setContent("");
      return;
    }
    let cancelled = false;
    setError(null);
    setFiles([]);
    setPath("");
    setContent("");
    apiClient
      .getCapsuleTree(selectedCapsule, "src")
      .then((tree) => {
        if (cancelled) return;
        const codeFiles = tree.files.filter((f) => isCodePath(f.path));
        setFiles(codeFiles);
        setPath(codeFiles[0]?.path || "");
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCapsule]);

  useEffect(() => {
    if (!selectedCapsule || !path) {
      setContent("");
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    setError(null);
    apiClient
      .getCapsuleFile(selectedCapsule, path)
      .then((file) => {
        if (!cancelled) setContent(file.content);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCapsule, path]);

  return (
    <article>
      <h2>Code Viewer</h2>
      <p className="muted">
        Read capsule source under <code>src/generated/</code>,{" "}
        <code>src/user_edits/</code>, and <code>src/kernels/</code>. This panel
        is read-only; user edits are never overwritten from the UI.
      </p>

      {error && <p className="error">{error}</p>}
      {capsules === null && <p className="placeholder">Loading capsules…</p>}
      {capsules?.length === 0 && (
        <p className="placeholder">
          No capsules are available yet. Run an example or save a run as a
          capsule, then return here to inspect source files.
        </p>
      )}

      {capsules && capsules.length > 0 && (
        <p>
          <label>
            Capsule:&nbsp;
            <select
              aria-label="code-viewer-capsule"
              value={selectedCapsule}
              onChange={(e) => setSelectedCapsule(e.target.value)}
            >
              {capsules.map((capsule) => (
                <option key={capsule.name} value={capsule.name}>
                  {capsule.name}
                </option>
              ))}
            </select>
          </label>
        </p>
      )}

      <p>
        <label>
          File path:&nbsp;
          <select
            aria-label="code-viewer-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            disabled={files.length === 0}
          >
            {files.length === 0 ? (
              <option value="">No source files found</option>
            ) : (
              files.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path} ({file.size_bytes} B)
                </option>
              ))
            )}
          </select>
        </label>
      </p>

      {path.startsWith("src/user_edits/") && (
        <p className="badge badge-warning">
          user-owned — agents must not overwrite this file
        </p>
      )}

      <pre>
        <code>
          {loadingFile
            ? "Loading file..."
            : path
              ? content || "# File is empty."
              : "# Select a capsule source file."}
        </code>
      </pre>
    </article>
  );
}
