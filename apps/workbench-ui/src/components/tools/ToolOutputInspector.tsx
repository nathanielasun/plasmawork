import {
  type ToolOutputKind,
  type ToolRunOutput,
  type ToolRunResponse,
  type ToolSchemaResponse,
} from "../../api/client";
import { Card, Kpi, Pill } from "../ui";
import ToolDiagramViewer from "./ToolDiagramViewer";

interface ToolOutputInspectorProps {
  schema: ToolSchemaResponse;
  run: ToolRunResponse | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatScalar(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(6) : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "-";
  return JSON.stringify(value);
}

function tableFromValue(value: unknown): { columns: string[]; rows: Record<string, unknown>[] } | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return { columns: ["value"], rows: [] };
    if (value.every(isRecord)) {
      const columns = Array.from(new Set(value.flatMap((row) => Object.keys(row))));
      return { columns, rows: value };
    }
    if (value.every(Array.isArray)) {
      const width = Math.max(...value.map((row) => row.length), 0);
      const columns = Array.from({ length: width }, (_, index) => `col_${index + 1}`);
      return {
        columns,
        rows: value.map((row) =>
          Object.fromEntries(columns.map((column, index) => [column, row[index]])),
        ),
      };
    }
    return {
      columns: ["index", "value"],
      rows: value.map((entry, index) => ({ index, value: entry })),
    };
  }

  if (isRecord(value) && Array.isArray(value.rows)) {
    const rows = value.rows.filter(isRecord);
    const declaredColumns = Array.isArray(value.columns)
      ? value.columns.filter((column): column is string => typeof column === "string")
      : [];
    const columns = declaredColumns.length > 0
      ? declaredColumns
      : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    return { columns, rows };
  }

  return null;
}

function renderTable(output: ToolRunOutput) {
  const table = tableFromValue(output.value);
  if (!table) {
    return (
      <pre className="tool-json-preview">
        <code>{JSON.stringify(output.value, null, 2)}</code>
      </pre>
    );
  }

  return (
    <div className="table-wrap tool-output-table">
      <table>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(table.columns.length, 1)}>No rows.</td>
            </tr>
          ) : (
            table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {table.columns.map((column) => (
                  <td key={column}>{formatScalar(row[column])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function renderOutputByKind(output: ToolRunOutput) {
  if (output.artifact_id && output.value === undefined) {
    return (
      <div className="tool-file-output">
        <Pill kind="export">{output.kind}</Pill>
        <code>{output.artifact_id}</code>
        <span className="muted">{output.mime_type ?? "artifact preview not loaded"}</span>
      </div>
    );
  }

  const kind: ToolOutputKind = output.kind;
  if (kind === "scalar") {
    return <Kpi label={output.units ? `Units: ${output.units}` : "Value"} value={formatScalar(output.value)} />;
  }
  if (kind === "table" || kind === "timeseries" || kind === "heatmap" || kind === "particle_scatter") {
    return renderTable(output);
  }
  if (kind === "diagram") {
    return <ToolDiagramViewer title={output.name} value={output.value} />;
  }
  if (kind === "file") {
    return (
      <div className="tool-file-output">
        <Pill kind="export">file</Pill>
        <code>{output.artifact_id ?? output.name}</code>
        {output.value !== undefined && (
          <pre className="tool-json-preview">
            <code>{JSON.stringify(output.value, null, 2)}</code>
          </pre>
        )}
      </div>
    );
  }
  if (kind === "report") {
    return (
      <pre className="tool-report-preview">
        <code>{typeof output.value === "string" ? output.value : JSON.stringify(output.value, null, 2)}</code>
      </pre>
    );
  }
  if (kind === "image") {
    const url = typeof output.value === "string" && output.value.startsWith("data:image/")
      ? output.value
      : null;
    return url ? (
      <img className="tool-image-preview" src={url} alt={output.name} />
    ) : (
      <pre className="tool-json-preview">
        <code>{JSON.stringify(output.value, null, 2)}</code>
      </pre>
    );
  }

  return (
    <pre className="tool-json-preview">
      <code>{JSON.stringify(output.value, null, 2)}</code>
    </pre>
  );
}

export default function ToolOutputInspector({
  schema,
  run,
}: ToolOutputInspectorProps) {
  const declared = new Set(schema.outputs.map((output) => output.name));

  return (
    <Card
      nested
      title="Output inspector"
      subtitle="Safe renderers for declared outputs. Unsupported shapes fall back to explicit JSON inspection."
      action={<Pill kind={run ? "trusted" : "draft"}>{run?.outputs.length ?? 0} outputs</Pill>}
    >
      {!run ? (
        <p className="placeholder">Execute the tool to inspect outputs.</p>
      ) : run.outputs.length === 0 ? (
        <p className="placeholder">The run completed without returned outputs.</p>
      ) : (
        <div className="tool-output-grid">
          {run.outputs.map((output) => (
            <Card
              nested
              key={output.name}
              title={output.name}
              subtitle={declared.has(output.name) ? "Declared output" : "Undeclared backend output"}
              action={<Pill kind={declared.has(output.name) ? "diagnostic" : "warning"}>{output.kind}</Pill>}
            >
              {renderOutputByKind(output)}
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}
