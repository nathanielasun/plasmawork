/**
 * SimulationList — lists known runs and the example ModelSpecs.
 * Polls /api/runs on mount.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient, type RunSummary } from "../api/client";

const EXAMPLE_SPECS = [
  { name: "simple_rate_equations", path: "examples/simple_rate_equations/model.yaml" },
  { name: "molecular_dynamics", path: "examples/molecular_dynamics/run.py" },
  { name: "ising_phase_transition", path: "examples/ising_phase_transition/run.py" },
];

export default function SimulationList() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listRuns()
      .then((rs) => {
        if (!cancelled) setRuns(rs);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <article>
      <h2>Simulations</h2>
      <p>
        Phase 1F workbench. Runs land in <code>temp_runs/</code> and finalized
        capsules in <code>simulation_capsules/</code>.
      </p>

      <h3>Example ModelSpecs</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          {EXAMPLE_SPECS.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>
                <code>{s.path}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Recent runs</h3>
      {error && <p className="placeholder">Backend unavailable: {error}</p>}
      {!error && runs === null && <p className="placeholder">Loading…</p>}
      {!error && runs?.length === 0 && (
        <p className="placeholder">
          No runs yet. <Link to="/runs">Start one →</Link>
        </p>
      )}
      {!error && runs && runs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Run ID</th>
              <th>State</th>
              <th>Validation</th>
              <th>t_final (s)</th>
              <th>Elapsed (s)</th>
              <th>Diagnostics</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td>
                  <code>{r.run_id}</code>
                </td>
                <td>{r.state}</td>
                <td>
                  {r.placeholder_used ? (
                    <span
                      className="placeholder"
                      title={
                        "Run used placeholder rate constants: " +
                        r.placeholders.join(", ")
                      }
                    >
                      ⚠ exploratory ({r.placeholders.length} placeholder{r.placeholders.length === 1 ? "" : "s"})
                    </span>
                  ) : (
                    "validated"
                  )}
                </td>
                <td>{r.final_simulation_time.toExponential(3)}</td>
                <td>{r.elapsed_seconds.toFixed(3)}</td>
                <td>{r.diagnostics_keys.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
