/**
 * Phase 9 / 9D — ComparisonReport panel.
 *
 * Reads a sweep capsule's `manifest.json` (produced by
 * `simworkbench.reports.ComparisonReport.write`) and renders the
 * ranked table + best-run callout. The panel is a thin viewer; the
 * heavy lifting lives in the Python reporter.
 *
 * Backend endpoint: `GET /api/comparison/{capsule}` returns the
 * manifest as JSON. The endpoint reads the manifest written by the
 * Python reporter; no business logic in the API layer.
 */
import { useEffect, useState } from "react";
import {
  apiClient,
  type CapsuleEntry,
  type ComparisonManifest,
} from "../../api/client";

export default function ComparisonReportPanel() {
  const [capsules, setCapsules] = useState<CapsuleEntry[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [manifest, setManifest] = useState<ComparisonManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient
      .listCapsules()
      .then(setCapsules)
      .catch((e) => setError(String(e)));
  }, []);

  const load = async (capsule: string) => {
    setSelected(capsule);
    setManifest(null);
    setError(null);
    if (!capsule) return;
    setBusy(true);
    try {
      const m = await apiClient.getComparisonReport(capsule);
      setManifest(m);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article>
      <h2>Comparative Reports</h2>
      <p>
        Phase 9 / 9D — view a sweep capsule's ranked comparison
        report. The Python reporter (
        <code>simworkbench.reports.ComparisonReport</code>) writes
        <code> manifest.json</code> + <code>report.md</code> under the
        capsule; this panel renders the manifest. The metric and
        ranking direction were chosen at write time.
      </p>

      <section aria-label="Capsule selector">
        <h3>Capsule</h3>
        <p>
          <label>
            Capsule:{" "}
            <select
              value={selected}
              onChange={(e) => load(e.target.value)}
              disabled={busy}
            >
              <option value="">— select capsule —</option>
              {capsules.map((c) => (
                <option key={c.path} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </p>
        {error && <p className="placeholder">{error}</p>}
      </section>

      {manifest && (
        <>
          <section aria-label="Comparison summary">
            <h3>{manifest.title}</h3>
            <ul>
              <li>
                Sweep: <code>{manifest.spec_name}</code> (id{" "}
                <code>{manifest.sweep_id}</code>)
              </li>
              <li>
                Metric: <code>{manifest.metric}</code>{" "}
                ({manifest.lower_is_better ? "lower" : "higher"} is better)
              </li>
              <li>Completed: {manifest.n_completed}</li>
              <li>Failed: {manifest.n_failed}</li>
              <li>
                Stopped reason: <code>{manifest.stopped_reason}</code>
              </li>
            </ul>
          </section>

          <section aria-label="Ranked runs">
            <h3>Ranking</h3>
            {manifest.ranking.length === 0 ? (
              <p className="placeholder">No runs completed with the metric.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    {Object.keys(manifest.ranking[0].parameters).map((p) => (
                      <th key={`p-${p}`}>{p}</th>
                    ))}
                    <th>{manifest.metric}</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.ranking.map((row) => (
                    <tr key={`r-${row.rank}`}>
                      <td>{row.rank}</td>
                      {Object.keys(row.parameters).map((p) => (
                        <td key={`v-${row.rank}-${p}`}>
                          {row.parameters[p].toFixed(6)}
                        </td>
                      ))}
                      <td>
                        {typeof row.metrics[manifest.metric] === "number"
                          ? Number(row.metrics[manifest.metric]).toFixed(6)
                          : String(row.metrics[manifest.metric])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </article>
  );
}
