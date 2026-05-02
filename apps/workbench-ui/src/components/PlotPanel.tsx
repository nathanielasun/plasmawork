/**
 * PlotPanel — renders an inline SVG line plot of a diagnostic series.
 *
 * Phase 1F: minimal in-browser line plotter. Server-side matplotlib plotters
 * (Phase 1E `simworkbench.diagnostics.plotters`) produce publication-style
 * figures; this panel is the steering-lane equivalent (plan §12.3).
 */
import { useEffect, useState } from "react";
import {
  apiClient,
  type DiagnosticSeries,
  type RunSummary,
} from "../api/client";

const W = 720;
const H = 320;
const PADDING = 40;

function buildPath(times: number[], values: number[]): string {
  if (times.length === 0) return "";
  const xMin = times[0];
  const xMax = times[times.length - 1];
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  return values
    .map((v, i) => {
      const x = PADDING + ((times[i] - xMin) / xSpan) * (W - 2 * PADDING);
      const y = H - PADDING - ((v - yMin) / ySpan) * (H - 2 * PADDING);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function PlotPanel() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [series, setSeries] = useState<DiagnosticSeries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listRuns()
      .then(setRuns)
      .catch((e) => setError(String(e)));
  }, []);

  async function load(runId: string, name: string) {
    setError(null);
    try {
      const s = await apiClient.getDiagnostic(runId, name);
      setSeries(s);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <article>
      <h2>Plot Panel</h2>
      <p className="placeholder">
        Steering-lane line plotter. Publication-quality plots use
        <code> simworkbench.diagnostics.plotters</code> (server-side).
      </p>

      {error && <p className="placeholder">Error: {error}</p>}

      <h3>Runs and diagnostics</h3>
      {runs.length === 0 && (
        <p className="placeholder">No runs to plot. Start one in Run Controls.</p>
      )}
      <ul>
        {runs.map((r) =>
          r.diagnostics_keys
            .filter((k) => k !== "time_seconds")
            .map((name) => (
              <li key={`${r.run_id}-${name}`}>
                <button onClick={() => load(r.run_id, name)}>
                  plot <code>{name}</code> on{" "}
                  <code>{r.run_id.slice(0, 8)}</code>
                </button>
              </li>
            )),
        )}
      </ul>

      {series && series.times.length > 0 && (
        <section>
          <h3>
            <code>{series.name}</code> on <code>{series.run_id}</code>
          </h3>
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Line plot of ${series.name}`}
            style={{ border: "1px solid var(--border)", background: "#fff" }}
          >
            <line
              x1={PADDING}
              y1={H - PADDING}
              x2={W - PADDING}
              y2={H - PADDING}
              stroke="black"
            />
            <line
              x1={PADDING}
              y1={PADDING}
              x2={PADDING}
              y2={H - PADDING}
              stroke="black"
            />
            <text x={PADDING} y={H - 10} fontSize="12">
              t (s)
            </text>
            <text x={4} y={PADDING - 6} fontSize="12">
              {series.name}
            </text>
            <path
              d={buildPath(series.times, series.values)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
          </svg>
          <p>
            min ={" "}
            <code>{Math.min(...series.values).toExponential(3)}</code>; max ={" "}
            <code>{Math.max(...series.values).toExponential(3)}</code>; samples
            = {series.values.length}
          </p>
        </section>
      )}
    </article>
  );
}
