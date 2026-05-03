/**
 * ManifestView — renders the capsule's manifest.toml as structured sections
 * (capsule / paper / model / runtime / provenance). Phase 2D consumer of
 * GET /api/capsules/{name}.
 */
import { useEffect, useState } from "react";
import { apiClient, type CapsuleDetail } from "../../api/client";

interface Props {
  capsuleName: string;
}

function renderSection(
  title: string,
  body: Record<string, unknown> | undefined,
): JSX.Element | null {
  if (!body) return null;
  const entries = Object.entries(body);
  if (entries.length === 0) return null;
  return (
    <section key={title}>
      <h4>{title}</h4>
      <dl>
        {entries.map(([k, v]) => (
          <div key={k} className="manifest-row">
            <dt>
              <code>{k}</code>
            </dt>
            <dd>
              <code>{typeof v === "object" ? JSON.stringify(v) : String(v)}</code>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function ManifestView({ capsuleName }: Props) {
  const [detail, setDetail] = useState<CapsuleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getCapsule(capsuleName)
      .then(setDetail)
      .catch((e) => setError(String(e)));
  }, [capsuleName]);

  if (error) return <p className="placeholder">Failed to load manifest: {error}</p>;
  if (!detail) return <p className="placeholder">Loading manifest…</p>;

  if (detail.manifest_error) {
    return (
      <article>
        <h3>manifest.toml</h3>
        <p className="placeholder">manifest.toml failed to parse: {detail.manifest_error}</p>
      </article>
    );
  }
  if (!detail.manifest) {
    return (
      <article>
        <h3>manifest.toml</h3>
        <p className="placeholder">No manifest.toml present in this capsule.</p>
      </article>
    );
  }

  return (
    <article>
      <h3>manifest.toml</h3>
      {renderSection("capsule", detail.manifest.capsule as Record<string, unknown>)}
      {renderSection("paper", detail.manifest.paper as Record<string, unknown>)}
      {renderSection("model", detail.manifest.model as Record<string, unknown>)}
      {renderSection("runtime", detail.manifest.runtime as Record<string, unknown>)}
      {renderSection(
        "provenance",
        detail.manifest.provenance as Record<string, unknown>,
      )}
    </article>
  );
}
