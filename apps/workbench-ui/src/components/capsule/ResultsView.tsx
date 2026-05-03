/**
 * ResultsView — diagnostics overview for a saved capsule. Reads the
 * ``results/diagnostics.{h5,json}`` payload via the backend (which picks
 * the format) and renders one summary row per series.
 */
import { useEffect, useState } from "react";
import { apiClient, type CapsuleDiagnostics } from "../../api/client";

interface Props {
  capsuleName: string;
}

function summarize(values: number[]): { min: number; max: number; last: number } {
  if (values.length === 0) return { min: NaN, max: NaN, last: NaN };
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, last: values[values.length - 1] };
}

export default function ResultsView({ capsuleName }: Props) {
  const [diag, setDiag] = useState<CapsuleDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getCapsuleDiagnostics(capsuleName)
      .then(setDiag)
      .catch((e) => setError(String(e)));
  }, [capsuleName]);

  if (error)
    return (
      <article>
        <h3>Results</h3>
        <p className="placeholder">Diagnostics unavailable: {error}</p>
      </article>
    );
  if (!diag) return <p className="placeholder">Loading diagnostics…</p>;

  const series = Object.entries(diag.series);

  return (
    <article>
      <h3>Results</h3>
      <p className="muted">
        Source: <code>{diag.source}</code> ({series.length} series).
      </p>
      {series.length === 0 && (
        <p className="placeholder">Capsule has no diagnostics recorded.</p>
      )}
      {series.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Series</th>
              <th>Samples</th>
              <th>Min</th>
              <th>Max</th>
              <th>Final</th>
            </tr>
          </thead>
          <tbody>
            {series.map(([name, values]) => {
              const s = summarize(values);
              return (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{values.length}</td>
                  <td>{Number.isFinite(s.min) ? s.min.toExponential(3) : "—"}</td>
                  <td>{Number.isFinite(s.max) ? s.max.toExponential(3) : "—"}</td>
                  <td>{Number.isFinite(s.last) ? s.last.toExponential(3) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </article>
  );
}
