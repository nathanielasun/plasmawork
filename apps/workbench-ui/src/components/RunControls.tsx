/**
 * RunControls — start a new run from a selected ModelSpec.
 * This legacy API path executes synchronously and returns the final run state.
 * Interactive/background run state belongs to the runtime library and the
 * secure-core workspace-scoped run surfaces.
 */
import { useState } from "react";
import { apiClient, type RunSummary } from "../api/client";
import { FolderBrowser } from "./ui";

export default function RunControls() {
  const [modelPath, setModelPath] = useState(
    "examples/simple_rate_equations/model.yaml",
  );
  const [endTime, setEndTime] = useState("100 ns");
  const [maxSteps, setMaxSteps] = useState(100);
  const [seed, setSeed] = useState(0);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  async function onStart() {
    setRunning(true);
    setError(null);
    try {
      const result = await apiClient.startRun({
        model_yaml_path: modelPath,
        end_time: endTime,
        max_steps: maxSteps,
        seed,
      });
      setLastRun(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <article>
      <h2>Run Controls</h2>
      <p>Start a new run from a ModelSpec YAML on disk.</p>

      <table>
        <tbody>
          <tr>
            <th>Model YAML</th>
            <td>
              <input
                aria-label="model-yaml-path"
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                size={50}
              />{" "}
              <button
                type="button"
                onClick={() => setBrowserOpen((v) => !v)}
              >
                {browserOpen ? "Hide" : "Browse…"}
              </button>
            </td>
          </tr>
          <tr>
            <th>End time</th>
            <td>
              <input
                aria-label="end-time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                size={20}
              />
            </td>
          </tr>
          <tr>
            <th>Max steps</th>
            <td>
              <input
                aria-label="max-steps"
                type="number"
                min={1}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value))}
              />
            </td>
          </tr>
          <tr>
            <th>Seed</th>
            <td>
              <input
                aria-label="seed"
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </td>
          </tr>
        </tbody>
      </table>

      {browserOpen && (
        <div style={{ marginBottom: "1rem" }}>
          <FolderBrowser
            roots={["examples", "simulation_capsules"]}
            initialRoot="examples"
            filter={(entry) =>
              entry.kind === "file" &&
              (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
            }
            onSelect={(entry, root) => {
              // FolderBrowser yields a path relative to the chosen root;
              // prefix with the root's directory name so the backend can
              // resolve from repo_root().
              setModelPath(`${root}/${entry.path}`);
              setBrowserOpen(false);
            }}
            onClose={() => setBrowserOpen(false)}
          />
        </div>
      )}

      <p>
        <button onClick={onStart} disabled={running}>
          {running ? "Running…" : "Start Run"}
        </button>
      </p>

      {error && <p className="placeholder">Error: {error}</p>}

      {lastRun && (
        <section>
          <h3>Last run</h3>
          <p>
            <strong>Run ID:</strong> <code>{lastRun.run_id}</code> —{" "}
            {lastRun.state} — t<sub>final</sub> ={" "}
            {lastRun.final_simulation_time.toExponential(3)} s — elapsed{" "}
            {lastRun.elapsed_seconds.toFixed(3)} s
          </p>
        </section>
      )}
    </article>
  );
}
