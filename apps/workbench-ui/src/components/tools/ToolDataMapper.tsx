import {
  type ToolDataMapping,
  type ToolInputSchema,
  type ToolSchemaResponse,
} from "../../api/client";
import { Card, Pill } from "../ui";

interface ToolDataMapperProps {
  schema: ToolSchemaResponse;
  mappings: Record<string, ToolDataMapping>;
  mappingErrors: Record<string, string>;
  onMappingChange: (name: string, mapping: ToolDataMapping) => void;
}

function mapperInputs(schema: ToolSchemaResponse): ToolInputSchema[] {
  return schema.inputs.filter((input) =>
    input.kind === "table" || input.kind === "array" || input.kind === "file",
  );
}

function formatColumns(mapping: ToolDataMapping | undefined): string {
  if (!mapping?.columns) return "";
  return JSON.stringify(mapping.columns, null, 2);
}

function parseColumns(text: string): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Column map must be a JSON object.");
  }
  const columns: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error("Column map values must be strings.");
    }
    columns[key] = value;
  }
  return columns;
}

export default function ToolDataMapper({
  schema,
  mappings,
  mappingErrors,
  onMappingChange,
}: ToolDataMapperProps) {
  const inputs = mapperInputs(schema);

  return (
    <Card
      nested
      title="Data I/O mapping"
      subtitle="Bind table, array, and file inputs to managed artifacts or inline data without exposing raw server storage facts."
      action={<Pill kind={inputs.length > 0 ? "diagnostic" : "draft"}>{inputs.length} mappable</Pill>}
    >
      {inputs.length === 0 ? (
        <p className="placeholder">No table, array, or file inputs require mapping.</p>
      ) : (
        <div className="tool-data-mapper">
          {inputs.map((input) => {
            const mapping = mappings[input.name] ?? {};
            return (
              <section className="tool-data-map-row" key={input.name}>
                <div className="row-between">
                  <div className="stack-tight">
                    <strong>{input.name}</strong>
                    <span className="muted">{input.description || input.type}</span>
                  </div>
                  <Pill kind="diagnostic">{input.kind}</Pill>
                </div>
                <div className="form-grid">
                  <label>
                    <span className="eyebrow">Source artifact id</span>
                    <input
                      type="text"
                      value={mapping.source_artifact_id ?? ""}
                      onChange={(event) =>
                        onMappingChange(input.name, {
                          ...mapping,
                          source_artifact_id: event.target.value.trim() || undefined,
                        })
                      }
                      placeholder="artifact_..."
                    />
                  </label>
                  <label>
                    <span className="eyebrow">Format</span>
                    <select
                      value={mapping.format ?? "inline"}
                      onChange={(event) =>
                        onMappingChange(input.name, {
                          ...mapping,
                          format: event.target.value as ToolDataMapping["format"],
                        })
                      }
                    >
                      <option value="inline">Inline</option>
                      <option value="artifact">Artifact</option>
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span className="eyebrow">Column map JSON</span>
                  <textarea
                    rows={4}
                    value={formatColumns(mapping)}
                    onChange={(event) => {
                      try {
                        onMappingChange(input.name, {
                          ...mapping,
                          columns: parseColumns(event.target.value),
                        });
                      } catch {
                        onMappingChange(input.name, {
                          ...mapping,
                          columns: mapping.columns,
                        });
                      }
                    }}
                    placeholder="{&#10;  &quot;frequency&quot;: &quot;freq_hz&quot;&#10;}"
                  />
                </label>
                {mappingErrors[input.name] && (
                  <p className="tool-field-error" role="alert">
                    {mappingErrors[input.name]}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
