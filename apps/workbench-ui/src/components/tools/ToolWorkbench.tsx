import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type ToolArtifactRef,
  type ToolDataMapping,
  type ToolInputSchema,
  type ToolPreviewResponse,
  type ToolRunRequest,
  type ToolRunResponse,
  type ToolSchemaResponse,
  type ToolValidationMessage,
} from "../../api/client";
import { Card, Kpi, Pill, type PillKind } from "../ui";
import ToolArtifactBrowser from "./ToolArtifactBrowser";
import ToolDataMapper from "./ToolDataMapper";
import ToolInputForm, { type ToolFormValue } from "./ToolInputForm";
import ToolOutputInspector from "./ToolOutputInspector";
import ToolRunConsole from "./ToolRunConsole";
import ToolValidationPanel from "./ToolValidationPanel";

interface ToolWorkbenchProps {
  toolName: string;
}

function statusKind(status: ToolSchemaResponse["status"]): PillKind {
  if (status === "trusted") return "trusted";
  if (status === "validated") return "validated";
  if (status === "candidate") return "candidate";
  if (status === "deprecated") return "deprecated";
  return "draft";
}

function initialValue(input: ToolInputSchema): ToolFormValue {
  if (input.kind === "bool") return Boolean(input.default);
  if (input.default === undefined || input.default === null) return "";
  if (typeof input.default === "string") return input.default;
  if (typeof input.default === "number" || typeof input.default === "boolean") {
    return String(input.default);
  }
  return JSON.stringify(input.default, null, 2);
}

function initialValues(schema: ToolSchemaResponse): Record<string, ToolFormValue> {
  return Object.fromEntries(schema.inputs.map((input) => [input.name, initialValue(input)]));
}

function initialUnits(schema: ToolSchemaResponse): Record<string, string> {
  return Object.fromEntries(
    schema.inputs
      .filter((input) => input.units)
      .map((input) => [input.name, input.units ?? ""]),
  );
}

function isEmpty(value: ToolFormValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((header) => header.trim()).filter(Boolean);
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return Object.fromEntries(
      headers.map((header, index) => {
        const cell = cells[index] ?? "";
        const numeric = Number(cell);
        return [header, cell !== "" && Number.isFinite(numeric) ? numeric : cell];
      }),
    );
  });
}

function parseJsonOrText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as unknown;
  }
  return trimmed;
}

function parseInput(input: ToolInputSchema, value: ToolFormValue | undefined): unknown {
  if (input.kind === "bool") return Boolean(value);
  if (isEmpty(value)) return "";
  const text = typeof value === "string" ? value.trim() : String(value);

  if (input.kind === "scalar") {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${input.name} must be a finite number.`);
    }
    return numeric;
  }
  if (input.kind === "array") {
    const parsed = parseJsonOrText(text);
    if (Array.isArray(parsed)) return parsed;
    return text
      .split(/[\n,]+/)
      .map((cell) => cell.trim())
      .filter(Boolean)
      .map((cell) => {
        const numeric = Number(cell);
        return Number.isFinite(numeric) ? numeric : cell;
      });
  }
  if (input.kind === "table") {
    const parsed = parseJsonOrText(text);
    if (typeof parsed !== "string") return parsed;
    return parseCsv(parsed);
  }
  return text;
}

function buildRequest(
  schema: ToolSchemaResponse,
  values: Record<string, ToolFormValue>,
  units: Record<string, string>,
  mappings: Record<string, ToolDataMapping>,
): {
  request: ToolRunRequest;
  validation: ToolValidationMessage[];
  fieldErrors: Record<string, string>;
} {
  const inputs: Record<string, unknown> = {};
  const validation: ToolValidationMessage[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const input of schema.inputs) {
    const value = values[input.name];
    if (input.required !== false && isEmpty(value)) {
      const message = `${input.name} is required.`;
      fieldErrors[input.name] = message;
      validation.push({ severity: "error", field: input.name, message });
      continue;
    }
    try {
      inputs[input.name] = parseInput(input, value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fieldErrors[input.name] = message;
      validation.push({ severity: "error", field: input.name, message });
    }
  }

  return {
    request: {
      inputs,
      units,
      data_mappings: mappings,
    },
    validation,
    fieldErrors,
  };
}

function mergeArtifacts(
  primary: readonly ToolArtifactRef[],
  secondary: readonly ToolArtifactRef[],
): ToolArtifactRef[] {
  const byId = new Map<string, ToolArtifactRef>();
  for (const artifact of [...primary, ...secondary]) {
    byId.set(artifact.artifact_id, artifact);
  }
  return [...byId.values()];
}

export default function ToolWorkbench({ toolName }: ToolWorkbenchProps) {
  const [schema, setSchema] = useState<ToolSchemaResponse | null>(null);
  const [values, setValues] = useState<Record<string, ToolFormValue>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [mappings, setMappings] = useState<Record<string, ToolDataMapping>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [clientValidation, setClientValidation] = useState<ToolValidationMessage[]>([]);
  const [preview, setPreview] = useState<ToolPreviewResponse | null>(null);
  const [run, setRun] = useState<ToolRunResponse | null>(null);
  const [artifacts, setArtifacts] = useState<ToolArtifactRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"idle" | "preview" | "run">("idle");
  const [error, setError] = useState<string | null>(null);
  const [artifactBusy, setArtifactBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setRun(null);
    setArtifacts([]);
    setFieldErrors({});
    setClientValidation([]);

    apiClient
      .getToolSchema(toolName)
      .then((nextSchema) => {
        if (cancelled) return;
        setSchema(nextSchema);
        setValues(initialValues(nextSchema));
        setUnits(initialUnits(nextSchema));
        setMappings({});
      })
      .catch((nextError) => {
        if (!cancelled) setError(String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [toolName]);

  const messages = useMemo(() => {
    return [
      ...clientValidation,
      ...(preview?.validation ?? []),
      ...(run?.validation ?? []),
    ];
  }, [clientValidation, preview, run]);

  const disabledReason = useMemo(() => {
    if (!schema) return "schema is still loading";
    if (schema.status === "deprecated") return "tool is deprecated";
    if (clientValidation.some((message) => message.severity === "error")) {
      return "input validation failed";
    }
    return null;
  }, [clientValidation, schema]);

  const prepare = useCallback(() => {
    if (!schema) return null;
    const built = buildRequest(schema, values, units, mappings);
    setFieldErrors(built.fieldErrors);
    setClientValidation(built.validation);
    return built;
  }, [mappings, schema, units, values]);

  const handlePreview = useCallback(async () => {
    const built = prepare();
    if (!built || built.validation.some((message) => message.severity === "error")) return;
    setBusy("preview");
    setError(null);
    try {
      const nextPreview = await apiClient.previewTool(toolName, built.request);
      setPreview(nextPreview);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy("idle");
    }
  }, [prepare, toolName]);

  const refreshArtifacts = useCallback(async () => {
    if (!run || run.run_id === "legacy-execute") return;
    setArtifactBusy(true);
    try {
      const listed = await apiClient.listToolArtifacts(toolName, run.run_id);
      setArtifacts((current) => mergeArtifacts(current, listed));
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setArtifactBusy(false);
    }
  }, [run, toolName]);

  const handleRun = useCallback(async () => {
    const built = prepare();
    if (!built || built.validation.some((message) => message.severity === "error")) return;
    setBusy("run");
    setError(null);
    try {
      const nextRun = await apiClient.runTool(toolName, built.request);
      setRun(nextRun);
      setArtifacts(nextRun.artifacts);
      if (nextRun.run_id !== "legacy-execute") {
        const listed = await apiClient.listToolArtifacts(toolName, nextRun.run_id);
        setArtifacts((current) => mergeArtifacts(current, listed));
      }
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy("idle");
    }
  }, [prepare, toolName]);

  if (loading) {
    return (
      <Card title="Tool workbench" subtitle="Loading tool contract for schema-bound controls.">
        <p className="placeholder">Loading schema…</p>
      </Card>
    );
  }

  if (!schema) {
    return (
      <Card title="Tool workbench" subtitle="Schema-bound controls could not be loaded.">
        <p className="error" role="alert">
          {error ?? "Unknown tool schema error."}
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Tool workbench"
      subtitle={schema.description}
      action={<Pill kind={statusKind(schema.status)}>{schema.status}</Pill>}
      className="tool-workbench"
    >
      <div className="kpi-strip">
        <Kpi label="Inputs" value={schema.inputs.length} />
        <Kpi label="Outputs" value={schema.outputs.length} />
        <Kpi label="Tool type" value={schema.type} />
      </div>

      <div className="tool-workbench-grid">
        <div className="tool-workbench-main">
          <ToolInputForm
            schema={schema}
            values={values}
            units={units}
            fieldErrors={fieldErrors}
            onValueChange={(name, value) => {
              setValues((current) => ({ ...current, [name]: value }));
              setClientValidation([]);
              setFieldErrors((current) => {
                const next = { ...current };
                delete next[name];
                return next;
              });
            }}
            onUnitChange={(name, unit) => {
              setUnits((current) => ({ ...current, [name]: unit }));
            }}
          />
          <ToolDataMapper
            schema={schema}
            mappings={mappings}
            mappingErrors={{}}
            onMappingChange={(name, mapping) => {
              setMappings((current) => ({ ...current, [name]: mapping }));
            }}
          />
        </div>

        <div className="tool-workbench-side">
          <ToolRunConsole
            preview={preview}
            run={run}
            busy={busy}
            error={error}
            disabledReason={disabledReason}
            onPreview={handlePreview}
            onRun={handleRun}
          />
          <ToolValidationPanel messages={messages} />
          <ToolArtifactBrowser
            artifacts={artifacts}
            busy={artifactBusy}
            onRefresh={run?.run_id && run.run_id !== "legacy-execute" ? refreshArtifacts : undefined}
          />
        </div>
      </div>

      <ToolOutputInspector schema={schema} run={run} />
    </Card>
  );
}
