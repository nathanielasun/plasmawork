import {
  type ToolPreviewResponse,
  type ToolRunResponse,
} from "../../api/client";
import { Card, Pill, type PillKind } from "../ui";

interface ToolRunConsoleProps {
  preview: ToolPreviewResponse | null;
  run: ToolRunResponse | null;
  busy: "idle" | "preview" | "run";
  error: string | null;
  disabledReason: string | null;
  onPreview: () => void;
  onRun: () => void;
}

function statusKind(status: ToolRunResponse["status"] | "not-run"): PillKind {
  if (status === "completed") return "trusted";
  if (status === "failed" || status === "cancelled") return "deprecated";
  if (status === "running" || status === "queued") return "candidate";
  return "draft";
}

export default function ToolRunConsole({
  preview,
  run,
  busy,
  error,
  disabledReason,
  onPreview,
  onRun,
}: ToolRunConsoleProps) {
  const status = run?.status ?? "not-run";
  const logs = run?.logs ?? [];

  return (
    <Card
      nested
      title="Run console"
      subtitle="Preview validates the contract without side effects. Execute runs the tool through the backend API."
      action={<Pill kind={statusKind(status)}>{status}</Pill>}
    >
      <div className="action-row action-row-start">
        <button type="button" onClick={onPreview} disabled={busy !== "idle"}>
          {busy === "preview" ? "Previewing…" : "Preview"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={onRun}
          disabled={busy !== "idle" || disabledReason !== null}
          title={disabledReason ?? undefined}
        >
          {busy === "run" ? "Executing…" : "Execute tool"}
        </button>
        {disabledReason && <span className="muted">Disabled: {disabledReason}</span>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {preview && (
        <div className="tool-console-preview">
          <div className="row-between">
            <strong>Preview</strong>
            <Pill kind={preview.ok ? "trusted" : "deprecated"}>{preview.ok ? "valid" : "blocked"}</Pill>
          </div>
          {preview.planned_artifacts.length > 0 ? (
            <div className="token-cloud">
              {preview.planned_artifacts.map((artifact) => (
                <Pill key={artifact.artifact_id} kind="export">
                  {artifact.name} · {artifact.kind}
                </Pill>
              ))}
            </div>
          ) : (
            <p className="placeholder">No planned artifacts returned.</p>
          )}
        </div>
      )}

      <div className="tool-console-log" aria-label="Tool run log">
        {logs.length === 0 ? (
          <span className="placeholder">Run logs will appear here.</span>
        ) : (
          logs.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)
        )}
      </div>
    </Card>
  );
}
