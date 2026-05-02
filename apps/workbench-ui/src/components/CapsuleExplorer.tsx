/**
 * CapsuleExplorer — lists capsules under simulation_capsules/ and in-flight
 * runs under temp_runs/. Phase 1F skeleton: directory listing only.
 *
 * Full capsule manifest validation lands in Phase 2 (ADR-0002 finalizes the
 * .lxp/ format). The explorer reads what's on disk via the backend API.
 */
import { useEffect, useState } from "react";
import { apiClient, type CapsuleEntry } from "../api/client";

export default function CapsuleExplorer() {
  const [capsules, setCapsules] = useState<CapsuleEntry[]>([]);
  const [tempRuns, setTempRuns] = useState<CapsuleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiClient.listCapsules(), apiClient.listTempRuns()])
      .then(([caps, runs]) => {
        setCapsules(caps);
        setTempRuns(runs);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <article>
      <h2>Capsule Explorer</h2>
      <p>
        Capsules are portable, reproducible simulation bundles
        (<code>.lxp/</code>). The full manifest schema is finalized in Phase 2;
        this panel currently shows the directory listings only.
      </p>

      {error && <p className="placeholder">Backend unavailable: {error}</p>}

      <h3>
        Finalized capsules <span className="placeholder">simulation_capsules/</span>
      </h3>
      {capsules.length === 0 && (
        <p className="placeholder">
          None yet. Capsule promotion lands in Phase 2.
        </p>
      )}
      {capsules.length > 0 && (
        <ul>
          {capsules.map((c) => (
            <li key={c.path}>
              <code>{c.name}</code> — {c.path}
            </li>
          ))}
        </ul>
      )}

      <h3>
        In-flight runs <span className="placeholder">temp_runs/</span>
      </h3>
      {tempRuns.length === 0 && <p className="placeholder">None.</p>}
      {tempRuns.length > 0 && (
        <ul>
          {tempRuns.map((r) => (
            <li key={r.path}>
              <code>{r.name}</code> — {r.path}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
