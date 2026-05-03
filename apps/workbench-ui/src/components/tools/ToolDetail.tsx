/**
 * ToolDetail — full view of a single tool: metadata, ports, validation
 * tests, lifecycle bar (with promote button), and docs.
 */
import { useEffect, useState } from "react";
import { apiClient, type ToolDetail as Detail, type ToolStatus as Status } from "../../api/client";
import ToolStatus from "./ToolStatus";
import ToolDocs from "./ToolDocs";

interface Props {
  toolName: string;
  onStatusChanged?: () => void;
}

export default function ToolDetail({ toolName, onStatusChanged }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    apiClient
      .getTool(toolName)
      .then(setDetail)
      .catch((e) => setError(String(e)));
  }, [toolName]);

  if (error)
    return <p className="placeholder">Tool unavailable: {error}</p>;
  if (!detail) return <p className="placeholder">Loading tool…</p>;

  const m = detail.metadata;
  const handleStatusChange = (next: Status) => {
    setDetail({ ...detail, metadata: { ...m, status: next } });
    onStatusChanged?.();
  };

  return (
    <article>
      <h3>
        <code>{m.name}</code>{" "}
        <span className="muted">v{m.version} — {m.type}</span>
      </h3>
      <p>{m.description}</p>

      <ToolStatus
        toolName={toolName}
        current={m.status}
        onChanged={handleStatusChange}
      />

      <h4>Inputs</h4>
      {m.inputs.length === 0 && <p className="placeholder">None.</p>}
      {m.inputs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Units</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {m.inputs.map((p) => (
              <tr key={p.name}>
                <td><code>{p.name}</code></td>
                <td>{p.type}</td>
                <td>{p.units || "—"}</td>
                <td>{p.description || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Outputs</h4>
      {m.outputs.length === 0 && <p className="placeholder">None.</p>}
      {m.outputs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {m.outputs.map((p) => (
              <tr key={p.name}>
                <td><code>{p.name}</code></td>
                <td>{p.type}</td>
                <td>{p.description || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Documentation</h4>
      <ToolDocs toolName={toolName} />
    </article>
  );
}
