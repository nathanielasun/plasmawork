/**
 * ProvenanceView — surfaces the capsule's provenance triad (lock,
 * environment.yaml, agent_trace.md). Phase 2D consumer of GET
 * /api/capsules/{name}/files/provenance/*.
 *
 * agent_trace.md is rendered verbatim — the writer is append-only and the
 * UI must not invite the user to edit it. Only display.
 */
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

interface Props {
  capsuleName: string;
}

interface FilePane {
  label: string;
  path: string;
}

const FILES: FilePane[] = [
  { label: "provenance.lock", path: "provenance/provenance.lock" },
  { label: "environment.yaml", path: "provenance/environment.yaml" },
  { label: "agent_trace.md", path: "provenance/agent_trace.md" },
];

export default function ProvenanceView({ capsuleName }: Props) {
  const [contents, setContents] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(
      FILES.map((f) => apiClient.getCapsuleFile(capsuleName, f.path)),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      const errs: Record<string, string> = {};
      results.forEach((r, idx) => {
        const pane = FILES[idx];
        if (r.status === "fulfilled") {
          next[pane.path] = r.value.content;
        } else {
          errs[pane.path] = String(r.reason);
        }
      });
      setContents(next);
      setErrors(errs);
    });
    return () => {
      cancelled = true;
    };
  }, [capsuleName]);

  return (
    <article>
      <h3>Provenance</h3>
      <p className="muted">
        Append-only record of how this capsule was produced. The writer
        refuses overwrites and refuses any action targeting{" "}
        <code>src/user_edits/</code>.
      </p>
      {FILES.map((pane) => (
        <section key={pane.path}>
          <h4>
            <code>{pane.label}</code>
          </h4>
          {errors[pane.path] && (
            <p className="placeholder">Unavailable: {errors[pane.path]}</p>
          )}
          {contents[pane.path] !== undefined && (
            <pre>
              <code>{contents[pane.path]}</code>
            </pre>
          )}
        </section>
      ))}
    </article>
  );
}
