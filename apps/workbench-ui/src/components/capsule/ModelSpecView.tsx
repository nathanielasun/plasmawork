/**
 * ModelSpecView — shows the capsule's model/model_spec.yaml verbatim.
 * Phase 2D consumer of GET /api/capsules/{name}/files/model/model_spec.yaml.
 *
 * This is read-only — editing the model spec is a Phase 1A responsibility
 * (load_yaml / save_experiment) and is exposed elsewhere in the workbench.
 */
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

interface Props {
  capsuleName: string;
}

export default function ModelSpecView({ capsuleName }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getCapsuleFile(capsuleName, "model/model_spec.yaml")
      .then((file) => setContent(file.content))
      .catch((e) => setError(String(e)));
  }, [capsuleName]);

  if (error) {
    return (
      <article>
        <h3>ModelSpec</h3>
        <p className="placeholder">model_spec.yaml unavailable: {error}</p>
      </article>
    );
  }
  if (content === null) return <p className="placeholder">Loading ModelSpec…</p>;

  return (
    <article>
      <h3>ModelSpec</h3>
      <p className="muted">
        <code>model/model_spec.yaml</code> — read-only.
      </p>
      <pre>
        <code>{content}</code>
      </pre>
    </article>
  );
}
