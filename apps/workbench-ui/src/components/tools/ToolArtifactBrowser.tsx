import { type ToolArtifactRef } from "../../api/client";
import { Card, Pill } from "../ui";

interface ToolArtifactBrowserProps {
  artifacts: readonly ToolArtifactRef[];
  onRefresh?: () => void;
  busy?: boolean;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function ToolArtifactBrowser({
  artifacts,
  onRefresh,
  busy,
}: ToolArtifactBrowserProps) {
  return (
    <Card
      nested
      title="Artifact browser"
      subtitle="Output references returned by the tool run. File access stays through backend artifact ids."
      action={
        onRefresh ? (
          <button type="button" onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh artifacts"}
          </button>
        ) : undefined
      }
    >
      {artifacts.length === 0 ? (
        <p className="placeholder">No artifacts returned for this run.</p>
      ) : (
        <div className="tool-artifact-list">
          {artifacts.map((artifact) => (
            <article className="tool-artifact-card" key={artifact.artifact_id}>
              <div className="row-between">
                <div className="stack-tight">
                  <strong>{artifact.name}</strong>
                  <code>{artifact.artifact_id}</code>
                </div>
                <Pill kind="export">{artifact.kind}</Pill>
              </div>
              <div className="detail-grid detail-grid-compact">
                <span>MIME</span>
                <span>{artifact.mime_type ?? "unknown"}</span>
                <span>Size</span>
                <span>{formatBytes(artifact.size_bytes)}</span>
                <span>Hash</span>
                <code>{artifact.content_hash ?? "not provided"}</code>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
