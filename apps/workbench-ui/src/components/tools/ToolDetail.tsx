/**
 * ToolDetail — full view of a single tool: metadata, ports, validation tests,
 * lifecycle bar, docs, test execution, and isolated export.
 */
import { useEffect, useState } from "react";
import { apiClient, type ToolDetail as Detail, type ToolStatus as Status } from "../../api/client";
import { Card, Kpi, Pill, type PillKind } from "../ui";
import ToolStatus from "./ToolStatus";
import ToolDocs from "./ToolDocs";
import { ToolPromoteButton } from "./ToolPromoteButton";

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

function statusKind(status: Status): PillKind {
  if (status === "trusted") return "trusted";
  if (status === "validated") return "validated";
  if (status === "candidate") return "candidate";
  if (status === "deprecated") return "deprecated";
  return "draft";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isToolStatus(value: unknown): value is Status {
  return (
    value === "draft" ||
    value === "candidate" ||
    value === "validated" ||
    value === "trusted" ||
    value === "deprecated"
  );
}

function isToolPortList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((port) => {
      if (!isRecord(port)) return false;
      return typeof port.name === "string" && typeof port.type === "string";
    })
  );
}

function isToolDetail(value: unknown): value is Detail {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  const metadata = value.metadata;
  if (typeof value.name !== "string" || typeof value.directory !== "string") return false;
  if (
    typeof metadata.name !== "string" ||
    typeof metadata.version !== "string" ||
    typeof metadata.type !== "string" ||
    typeof metadata.description !== "string" ||
    typeof metadata.entrypoint !== "string" ||
    !isToolStatus(metadata.status) ||
    !isToolPortList(metadata.inputs) ||
    !isToolPortList(metadata.outputs) ||
    !isRecord(metadata.validation) ||
    !Array.isArray(metadata.validation.tests) ||
    !Array.isArray(metadata.validation.reference_cases)
  ) {
    return false;
  }
  return true;
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
      .then((nextDetail: unknown) => {
        if (!isToolDetail(nextDetail)) {
          throw new Error("Malformed tool detail response from backend.");
        }
        setDetail(nextDetail);
      })
      .catch((e) => setError(String(e)));
  }, [toolName]);

  if (error) return <p className="error" role="alert">Tool unavailable: {error}</p>;
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
    <Card
      title="Tool contract"
      subtitle={m.description}
      action={<Pill kind={statusKind(m.status)}>{m.status}</Pill>}
    >
      <div className="detail-grid">
        <span>Name</span>
        <code>{m.name}</code>
        <span>Version</span>
        <span>{m.version}</span>
        <span>Type</span>
        <span>{m.type}</span>
        <span>Entrypoint</span>
        <code>{m.entrypoint}</code>
        <span>Directory</span>
        <code>{detail.directory}</code>
      </div>

      <div className="kpi-strip">
        <Kpi label="Inputs" value={m.inputs.length} />
        <Kpi label="Outputs" value={m.outputs.length} />
        <Kpi label="Tests" value={m.validation.tests.length} />
        <Kpi label="Reference cases" value={m.validation.reference_cases.length} />
      </div>

      <Card nested title="Lifecycle" subtitle="Human-only promotions require a local approval token.">
        <ToolStatus
          toolName={toolName}
          current={m.status}
          onChanged={handleStatusChange}
        />
      </Card>

      <Card nested title="Actions" subtitle="Run validation tests or export an isolated tool archive.">
        <div className="action-row action-row-start">
          <button type="button" className="primary" onClick={runTests} disabled={testBusy}>
            {testBusy ? "Running tests…" : "Run tests"}
          </button>
          <button type="button" onClick={exportTool} disabled={exportBusy}>
            {exportBusy ? "Exporting…" : "Export .zip"}
          </button>
          <ToolPromoteButton toolName={toolName} />
        </div>
      </Card>

      {testResult && (
        <Card nested title="Test result">
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
        </Card>
      )}
      {exportResult && (
        <p className="route-card-note">
          Exported to <code>{exportResult.archive}</code>{" "}
          <span className="muted">({exportResult.size_bytes} bytes)</span>
        </p>
      )}

      <div className="dashboard-grid dashboard-grid-2">
        <Card nested title="Inputs">
          {m.inputs.length === 0 && <p className="placeholder">None.</p>}
          {m.inputs.length > 0 && (
            <div className="table-wrap">
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
                      <td>{p.units || "-"}</td>
                      <td>{p.description || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card nested title="Outputs">
          {m.outputs.length === 0 && <p className="placeholder">None.</p>}
          {m.outputs.length > 0 && (
            <div className="table-wrap">
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
            </div>
          )}
        </Card>
      </div>

      <Card nested title="Documentation">
        <ToolDocs toolName={toolName} />
      </Card>
    </Card>
  );
}
