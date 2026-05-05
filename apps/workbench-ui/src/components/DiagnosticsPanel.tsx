/**
 * DiagnosticsPanel — surfaces every run the backend knows about, in-memory
 * and on-disk alike.
 *
 * Backend contract:
 *   - GET /api/runs merges in-memory `runs` with `temp_runs/<id>/summary.json`,
 *     so script-driven examples (ising, MD, laser_species, pde_wave) appear
 *     here without any extra wiring.
 *   - GET /api/runs/{id}/diagnostics/{name} falls back to disk when the run
 *     is purely on-disk; tabular runs (list-of-dict shape) get their
 *     numeric columns exposed as `<table>.<column>` keys, with an integer
 *     index time axis (the python_cpu shape carries a real time axis).
 */
import { useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type DiagnosticSeries,
  type RunSummary,
} from "../api/client";
import { Card, Pill } from "./ui";

type Stats = {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly samples: number;
};

function summarize(values: readonly number[]): Stats {
  if (values.length === 0) {
    return { mean: 0, min: 0, max: 0, samples: 0 };
  }
  let sum = 0;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { mean: sum / values.length, min, max, samples: values.length };
}

function deriveKindLabel(runId: string): string {
  // Best-effort label from the run_id prefix the example scripts emit.
  const dash = runId.indexOf("-");
  if (dash <= 0) return "run";
  const prefix = runId.slice(0, dash);
  return prefix;
}

export default function DiagnosticsPanel(): JSX.Element {
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [series, setSeries] = useState<DiagnosticSeries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listRuns()
      .then((rs) => setRuns(rs))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!activeRun || !activeName) {
      setSeries(null);
      return;
    }
    apiClient
      .getDiagnostic(activeRun, activeName)
      .then(setSeries)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [activeRun, activeName]);

  // Sort newest-first when run_ids carry a uuid suffix; alphabetical
  // descending is a good approximation in the absence of a real
  // mtime field on the summary.
  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.run_id.localeCompare(a.run_id)),
    [runs],
  );

  const activeSummary =
    activeRun !== null
      ? sortedRuns.find((r) => r.run_id === activeRun) ?? null
      : null;

  return (
    <article>
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Diagnostics</p>
            <h1 className="hero-title">All runs the backend knows about</h1>
            <p className="hero-subtitle">
              Both in-memory runs (started via the API) and script-driven
              runs (Examples gallery → temp_runs/&lt;id&gt;/summary.json)
              appear here. Pick a run to see its diagnostic keys; pick a
              key to see min / max / mean.
            </p>
          </div>
          <Pill kind="solver">{runs.length} runs</Pill>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <Card title="Runs" subtitle="Click a run to inspect its diagnostics.">
        {sortedRuns.length === 0 && (
          <p className="placeholder">
            No runs yet. Use the <strong>Examples</strong> tab to launch one.
          </p>
        )}
        {sortedRuns.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sortedRuns.map((r) => {
              const isActive = r.run_id === activeRun;
              return (
                <li key={r.run_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveRun(r.run_id);
                      setActiveName(null);
                    }}
                    className={isActive ? "primary" : undefined}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      marginBottom: "0.4rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <Pill kind="model">{deriveKindLabel(r.run_id)}</Pill>
                    <code>{r.run_id}</code>
                    <span className="muted">— {r.state}</span>
                    {r.placeholder_used && (
                      <Pill kind="exploratory">
                        {r.placeholders.length} placeholder
                        {r.placeholders.length === 1 ? "" : "s"}
                      </Pill>
                    )}
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {r.diagnostics_keys.length} diagnostic key
                      {r.diagnostics_keys.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {activeRun !== null && activeSummary !== null && (
        <Card
          title={`Diagnostic keys on ${activeRun}`}
          subtitle={
            activeSummary.diagnostics_keys.length === 0
              ? "This run reports scalar metrics only — no time-series or tabular diagnostic data."
              : "Click a key to see min / max / mean."
          }
        >
          {activeSummary.diagnostics_keys.length > 0 && (
            <div className="row">
              {activeSummary.diagnostics_keys
                .filter((n) => n !== "time_seconds")
                .map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setActiveName(name)}
                    className={name === activeName ? "primary" : undefined}
                  >
                    <code>{name}</code>
                  </button>
                ))}
            </div>
          )}
        </Card>
      )}

      {series !== null && (
        <Card
          title={series.name}
          subtitle={`${series.values.length} samples`}
          action={<Pill kind="diagnostic">{deriveKindLabel(series.run_id)}</Pill>}
        >
          {(() => {
            const s = summarize(series.values);
            return (
              <table>
                <tbody>
                  <tr>
                    <th>min</th>
                    <td>{s.min.toExponential(4)}</td>
                  </tr>
                  <tr>
                    <th>max</th>
                    <td>{s.max.toExponential(4)}</td>
                  </tr>
                  <tr>
                    <th>mean</th>
                    <td>{s.mean.toExponential(4)}</td>
                  </tr>
                  <tr>
                    <th>samples</th>
                    <td>{s.samples}</td>
                  </tr>
                </tbody>
              </table>
            );
          })()}
        </Card>
      )}
    </article>
  );
}
