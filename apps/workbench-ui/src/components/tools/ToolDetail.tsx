/**
 * ToolDetail — full view of a single tool: metadata, ports, validation
 * tests, lifecycle bar (with promote button), and docs. Phase 3 also
 * surfaces the gate verbs: run-tests, export, and a link to the
 * documentation walk-through for execute / use-in-experiment.
 */
import { useEffect, useState } from "react";
import { apiClient, type ToolDetail as Detail, type ToolStatus as Status } from "../../api/client";
import ToolStatus from "./ToolStatus";
import ToolDocs from "./ToolDocs";

interface Props {
  toolName: string;
  onStatusChanged?: () => void;
}

interface TestsResult {
  passed: boolean;
  returncode: number;
  stdout: string;
  stderr: string;
}

interface ExportResult {
  archive: string;
  size_bytes: number;
}

export default function ToolDetail({ toolName, onStatusChanged }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestsResult | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setTestResult(null);
    setExportResult(null);
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
  const runTests = async () => {
    setTestBusy(true);
    setTestResult(null);
    try {
      const r = await apiClient.runToolTests(toolName);
      setTestResult({
        passed: r.passed,
        returncode: r.returncode,
        stdout: r.stdout,
        stderr: r.stderr,
      });
    } catch (e) {
      setTestResult({
        passed: false,
        returncode: -1,
        stdout: "",
        stderr: String(e),
      });
    } finally {
      setTestBusy(false);
    }
  };
  const exportTool = async () => {
    setExportBusy(true);
    setExportResult(null);
    try {
      const r = await apiClient.exportTool(toolName);
      setExportResult({ archive: r.archive, size_bytes: r.size_bytes });
    } finally {
      setExportBusy(false);
    }
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

      <h4>Actions</h4>
      <p>
        <button type="button" onClick={runTests} disabled={testBusy}>
          {testBusy ? "Running tests…" : "Run tests"}
        </button>{" "}
        <button type="button" onClick={exportTool} disabled={exportBusy}>
          {exportBusy ? "Exporting…" : "Export (.zip)"}
        </button>
      </p>
      {testResult && (
        <section aria-label="Test result">
          <p>
            Tests:{" "}
            {testResult.passed ? (
              <strong className="status-ok">PASSED</strong>
            ) : (
              <strong className="status-error">FAILED</strong>
            )}{" "}
            <span className="muted">(exit {testResult.returncode})</span>
          </p>
          {(testResult.stdout || testResult.stderr) && (
            <pre>
              <code>{testResult.stdout + (testResult.stderr ? `\n${testResult.stderr}` : "")}</code>
            </pre>
          )}
        </section>
      )}
      {exportResult && (
        <p>
          Exported to <code>{exportResult.archive}</code>{" "}
          <span className="muted">({exportResult.size_bytes} bytes)</span>
        </p>
      )}

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
