import { type ToolValidationMessage } from "../../api/client";
import { Card, Pill, type PillKind } from "../ui";

interface ToolValidationPanelProps {
  title?: string;
  messages: readonly ToolValidationMessage[];
}

function severityKind(severity: ToolValidationMessage["severity"]): PillKind {
  if (severity === "error") return "deprecated";
  if (severity === "warning") return "warning";
  return "validated";
}

export default function ToolValidationPanel({
  title = "Validation",
  messages,
}: ToolValidationPanelProps) {
  const errors = messages.filter((message) => message.severity === "error").length;
  const warnings = messages.filter((message) => message.severity === "warning").length;

  return (
    <Card
      nested
      title={title}
      subtitle="Schema validation, preview warnings, and run-time checks."
      action={
        <div className="token-cloud">
          <Pill kind={errors > 0 ? "deprecated" : "trusted"}>{errors} errors</Pill>
          <Pill kind={warnings > 0 ? "warning" : "validated"}>{warnings} warnings</Pill>
        </div>
      }
    >
      {messages.length === 0 ? (
        <p className="placeholder">No validation messages yet.</p>
      ) : (
        <div className="tool-validation-list" role="status" aria-live="polite">
          {messages.map((message, index) => (
            <div className={`tool-validation-row tool-validation-${message.severity}`} key={`${message.field ?? "global"}-${index}`}>
              <Pill kind={severityKind(message.severity)}>{message.severity}</Pill>
              <div className="stack-tight">
                {message.field && <code>{message.field}</code>}
                <span>{message.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
