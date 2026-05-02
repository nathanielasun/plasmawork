/**
 * DiagnosticsPanel — shows the diagnostics of the currently selected run.
 * Phase 1F: lists runs and their diagnostic keys; clicking a key fetches
 * the time series and renders summary statistics.
 */
import { useEffect, useState } from "react";
import {
  apiClient,
  type DiagnosticSeries,
  type RunSummary,
} from "../api/client";

function summarize(values: number[]): { mean: number; min: number; max: number } {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  let sum = 0;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { mean: sum / values.length, min, max };
}

export default function DiagnosticsPanel() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [series, setSeries] = useState<DiagnosticSeries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listRuns()
      .then(setRuns)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!activeRun || !activeName) {
      setSeries(null);
      return;
    }
    apiClient
      .getDiagnostic(activeRun, activeName)
      .then(setSeries)
      .catch((e) => setError(String(e)));
  }, [activeRun, activeName]);

  return (
    <article>
      <h2>Diagnostics</h2>
      {error && <p className="placeholder">Backend unavailable: {error}</p>}

      <h3>Runs</h3>
      {runs.length === 0 && <p className="placeholder">No runs yet.</p>}
      {runs.length > 0 && (
        <ul>
          {runs.map((r) => (
            <li key={r.run_id}>
              <button
                onClick={() => {
                  setActiveRun(r.run_id);
                  setActiveName(null);
                }}
              >
                {r.run_id}
              </button>{" "}
              <span>
                — {r.state} — keys: {r.diagnostics_keys.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {activeRun && (
        <>
          <h3>
            Diagnostics on <code>{activeRun}</code>
          </h3>
          <ul>
            {(runs.find((r) => r.run_id === activeRun)?.diagnostics_keys ?? [])
              .filter((n) => n !== "time_seconds")
              .map((name) => (
                <li key={name}>
                  <button onClick={() => setActiveName(name)}>{name}</button>
                </li>
              ))}
          </ul>
        </>
      )}

      {series && (
        <section>
          <h3>
            <code>{series.name}</code> series ({series.values.length} samples)
          </h3>
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
                </tbody>
              </table>
            );
          })()}
        </section>
      )}
    </article>
  );
}
