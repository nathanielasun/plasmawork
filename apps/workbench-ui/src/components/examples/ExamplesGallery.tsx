/**
 * ExamplesGallery — discoverable, one-click example runner.
 *
 * Backs `GET /api/examples` + `POST /api/examples/{name}/run`. Each
 * example is rendered as a Card with:
 *   - kind Pill (`modelspec` blue / `script` slate-ish)
 *   - description from the README's first non-heading paragraph
 *   - Run button that drives the corresponding endpoint
 *   - last-result block (run id, capsule name, summary path) once a
 *     run completes, with a link into the Capsule Explorer when the
 *     example produced a capsule
 *
 * Closes the gap the user identified: before this, "examples" lived
 * under `examples/` on disk and could only be invoked from a terminal.
 * Now they're first-class UI affordances.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiClient,
  type ExampleSummary,
  type RunExampleResponse,
} from "../../api/client";
import { Card, Pill } from "../ui";

interface RunState {
  status: "idle" | "running" | "done" | "error";
  result?: RunExampleResponse;
  error?: string;
}

const KIND_PILL: Record<ExampleSummary["kind"], { kind: "model" | "solver"; label: string }> = {
  modelspec: { kind: "model", label: "ModelSpec" },
  script: { kind: "solver", label: "Module script" },
};

export default function ExamplesGallery() {
  const [examples, setExamples] = useState<ExampleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listExamples()
      .then((rows) => {
        if (!cancelled) setExamples(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRun = async (name: string) => {
    setRuns((prev) => ({ ...prev, [name]: { status: "running" } }));
    try {
      const result = await apiClient.runExample(name);
      setRuns((prev) => ({ ...prev, [name]: { status: "done", result } }));
    } catch (e: unknown) {
      setRuns((prev) => ({
        ...prev,
        [name]: {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  };

  return (
    <article>
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Examples gallery</p>
            <h1 className="hero-title">Run an example end-to-end</h1>
            <p className="hero-subtitle">
              Each example is a real, validated workflow against the
              workbench's substrate. Click <strong>Run</strong> to
              execute on the server; results land under{" "}
              <code>temp_runs/</code> (script examples) or{" "}
              <code>simulation_capsules/</code> (ModelSpec examples)
              and link back here.
            </p>
          </div>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          Backend unavailable: {error}
        </p>
      )}

      {!error && examples === null && (
        <p className="placeholder">Loading examples…</p>
      )}

      {!error && examples?.length === 0 && (
        <p className="placeholder">
          No examples discovered under <code>examples/</code>.
        </p>
      )}

      {!error &&
        examples?.map((ex) => {
          const state = runs[ex.name];
          const pill = KIND_PILL[ex.kind];
          return (
            <Card
              key={ex.name}
              title={ex.name}
              subtitle={ex.description}
              action={<Pill kind={pill.kind}>{pill.label}</Pill>}
            >
              <div className="row" style={{ marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => handleRun(ex.name)}
                  disabled={state?.status === "running"}
                >
                  {state?.status === "running" ? "Running…" : "Run"}
                </button>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  <code>{ex.run_path}</code>
                </span>
              </div>

              {state?.status === "error" && (
                <Card nested title="Run failed">
                  <pre className="code-dark" style={{ maxHeight: "12rem" }}>
                    <code>{state.error}</code>
                  </pre>
                </Card>
              )}

              {state?.status === "done" && state.result && (
                <Card
                  nested
                  title="Run complete"
                  action={
                    <Pill kind="trusted">
                      {state.result.duration_seconds.toFixed(2)}s
                    </Pill>
                  }
                >
                  <dl className="manifest-row">
                    {state.result.run_id && (
                      <>
                        <dt>Run ID</dt>
                        <dd>
                          <code>{state.result.run_id}</code>
                        </dd>
                      </>
                    )}
                    {state.result.summary_path && (
                      <>
                        <dt>Summary</dt>
                        <dd>
                          <code>{state.result.summary_path}</code>
                        </dd>
                      </>
                    )}
                    {state.result.capsule_name && (
                      <>
                        <dt>Capsule</dt>
                        <dd>
                          <Link to={`/capsules`} state={{ select: state.result.capsule_name }}>
                            {state.result.capsule_name}
                          </Link>
                        </dd>
                      </>
                    )}
                  </dl>
                  {state.result.stdout_tail && (
                    <details style={{ marginTop: "0.75rem" }}>
                      <summary className="eyebrow">stdout tail</summary>
                      <pre className="code-dark" style={{ maxHeight: "16rem", marginTop: "0.5rem" }}>
                        <code>{state.result.stdout_tail}</code>
                      </pre>
                    </details>
                  )}
                </Card>
              )}
            </Card>
          );
        })}
    </article>
  );
}
