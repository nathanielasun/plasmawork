/**
 * ToolDocs — renders the tool's README + tool.yaml side by side. Pulls
 * GET /api/tools/{name}/docs (Phase 3D).
 */
import { useEffect, useState } from "react";
import { apiClient, type ToolDocs as Docs } from "../../api/client";

interface Props {
  toolName: string;
}

export default function ToolDocs({ toolName }: Props) {
  const [docs, setDocs] = useState<Docs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDocs(null);
    setError(null);
    apiClient
      .getToolDocs(toolName)
      .then(setDocs)
      .catch((e) => setError(String(e)));
  }, [toolName]);

  if (error)
    return <p className="placeholder">Tool docs unavailable: {error}</p>;
  if (!docs) return <p className="placeholder">Loading docs…</p>;

  return (
    <article>
      <h4>README.md</h4>
      {docs.readme ? (
        <pre>
          <code>{docs.readme}</code>
        </pre>
      ) : (
        <p className="placeholder">No README.md.</p>
      )}
      <h4>tool.yaml</h4>
      <pre>
        <code>{docs.tool_yaml}</code>
      </pre>
    </article>
  );
}
