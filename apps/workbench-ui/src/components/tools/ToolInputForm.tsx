import {
  type ToolInputSchema,
  type ToolSchemaResponse,
} from "../../api/client";
import { Card, Pill } from "../ui";

export type ToolFormValue = string | boolean;

export interface ToolInputFormProps {
  schema: ToolSchemaResponse;
  values: Record<string, ToolFormValue>;
  units: Record<string, string>;
  fieldErrors: Record<string, string>;
  onValueChange: (name: string, value: ToolFormValue) => void;
  onUnitChange: (name: string, unit: string) => void;
}

function valueAsString(value: ToolFormValue | undefined): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return value ?? "";
}

function fieldHelp(input: ToolInputSchema): string {
  const parts = [input.kind, input.type];
  if (input.units) parts.push(input.units);
  return parts.join(" · ");
}

function renderInputControl(
  input: ToolInputSchema,
  value: ToolFormValue | undefined,
  onValueChange: (value: ToolFormValue) => void,
) {
  if (input.kind === "bool") {
    return (
      <label className="tool-checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onValueChange(event.target.checked)}
          aria-label={input.name}
        />
        <span>{input.description || "Enable this option"}</span>
      </label>
    );
  }

  if (input.kind === "enum") {
    const options = input.enum_values ?? [];
    return (
      <select
        value={valueAsString(value)}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={input.name}
      >
        <option value="">Select value</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (input.kind === "array" || input.kind === "table" || input.widget === "json") {
    return (
      <textarea
        rows={input.kind === "table" ? 8 : 5}
        value={valueAsString(value)}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={input.kind === "table" ? "[{\"column\": 1}]" : "[1, 2, 3]"}
        aria-label={input.name}
      />
    );
  }

  if (input.widget === "textarea") {
    return (
      <textarea
        rows={5}
        value={valueAsString(value)}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={input.description || input.name}
        aria-label={input.name}
      />
    );
  }

  const type = input.kind === "scalar" ? "number" : "text";
  const placeholder =
    input.kind === "file"
      ? "artifact id or local dev reference"
      : input.kind === "capsule"
        ? "capsule name"
        : input.description || input.name;

  return (
    <input
      type={type}
      value={valueAsString(value)}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      step={input.kind === "scalar" ? "any" : undefined}
      aria-label={input.name}
    />
  );
}

export default function ToolInputForm({
  schema,
  values,
  units,
  fieldErrors,
  onValueChange,
  onUnitChange,
}: ToolInputFormProps) {
  return (
    <Card
      nested
      title="Inputs"
      subtitle="Generated from the tool contract. Arrays and tables accept JSON; table fields also accept simple CSV rows."
      action={<Pill kind="model">{schema.inputs.length} ports</Pill>}
    >
      {schema.inputs.length === 0 ? (
        <p className="placeholder">This tool declares no inputs.</p>
      ) : (
        <div className="tool-input-grid">
          {schema.inputs.map((input) => (
            <div className={`tool-input-field tool-input-${input.kind}`} key={input.name}>
              <span className="tool-field-header">
                <span className="tool-field-title">
                  <code>{input.name}</code>
                  {input.required !== false && <span aria-label="required">*</span>}
                </span>
                <Pill kind={input.kind === "table" || input.kind === "array" ? "diagnostic" : "model"}>
                  {fieldHelp(input)}
                </Pill>
              </span>
              {input.description && input.kind !== "bool" && (
                <span className="tool-field-description">{input.description}</span>
              )}
              <span className="tool-field-control">
                {renderInputControl(input, values[input.name], (next) => onValueChange(input.name, next))}
              </span>
              {input.units && (
                <span className="tool-unit-row">
                  <span className="eyebrow">Units</span>
                  <input
                    type="text"
                    value={units[input.name] ?? input.units}
                    onChange={(event) => onUnitChange(input.name, event.target.value)}
                    aria-label={`${input.name} units`}
                  />
                </span>
              )}
              {fieldErrors[input.name] && (
                <span className="tool-field-error" role="alert">
                  {fieldErrors[input.name]}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
