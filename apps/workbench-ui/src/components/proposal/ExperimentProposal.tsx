/**
 * Phase 5D — ExperimentProposal: top-level proposal panel.
 *
 * Workflow:
 *   1. Pick a capsule with reviewed Phase-4 interpretation artifacts.
 *   2. Click "Generate proposal" → backend runs the full Phase 5
 *      pipeline (transform → map → analyze → propose).
 *   3. The panel renders the matches table, the gap report (five
 *      categories), and the proposal Markdown body for review.
 */
import { useEffect, useState } from "react";
import {
  apiClient,
  type CapsuleEntry,
  type ProposalResult,
} from "../../api/client";

export default function ExperimentProposal() {
  const [capsules, setCapsules] = useState<CapsuleEntry[]>([]);
  const [selectedCapsule, setSelectedCapsule] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProposalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.listCapsules().then(setCapsules).catch((e) => setError(String(e)));
  }, []);

  const generate = async () => {
    if (!selectedCapsule) {
      setError("Select a capsule first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await apiClient.createProposal(selectedCapsule);
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !result)
    return (
      <article>
        <h2>Experiment Proposal</h2>
        <p className="placeholder">{error}</p>
      </article>
    );

  return (
    <article>
      <h2>Experiment Proposal</h2>
      <p>
        Phase 5 transforms a reviewed Phase-4 interpretation into a
        validated <code>ModelSpec</code>, maps it against the physics-
        module registry, runs gap analysis, and writes{" "}
        <code>experiment_proposal.md</code> under the capsule. Plan §Phase 4
        forbids consuming agent-only interpretation; uncheck "require
        reviewer signatures" only for dry runs.
      </p>

      <section aria-label="Generate proposal">
        <h3>Generate</h3>
        <p>
          <label>
            Capsule:{" "}
            <select
              value={selectedCapsule}
              onChange={(e) => setSelectedCapsule(e.target.value)}
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
        <p className="muted">
          The backend always enforces plan §Phase 4's hard rule that
          interpretation must be human-reviewed before it can feed
          ModelSpec generation. There is no UI bypass.
        </p>
        <p>
          <button type="button" onClick={generate} disabled={busy}>
            {busy ? "Generating…" : "Generate proposal"}
          </button>
        </p>
        {error && <p className="placeholder">{error}</p>}
      </section>

      {result && (
        <>
          <section aria-label="Module matches">
            <h3>Module matches</h3>
            {result.matches.matches.length === 0 ? (
              <p className="placeholder">No matches found.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Domain</th>
                    <th>Score</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.matches.slice(0, 10).map((m) => (
                    <tr key={`${m.directory}-${m.name}`}>
                      <td><code>{m.name}</code></td>
                      <td>{m.domain}</td>
                      <td>{m.score.toFixed(2)}</td>
                      <td>{m.reasons.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.matches.unmatched_requirements.length > 0 && (
              <ul>
                {result.matches.unmatched_requirements.map((r, i) => (
                  <li key={i} className="placeholder">{r}</li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Gap analysis">
            <h3>Gap analysis</h3>
            {(
              [
                ["missing_modules", "Missing modules"],
                ["missing_data", "Missing data"],
                ["unsupported_regimes", "Unsupported regimes"],
                ["invalid_solver_choices", "Invalid solver choices"],
                ["validation_gaps", "Validation gaps"],
              ] as Array<[keyof ProposalResult["gaps"], string]>
            ).map(([key, label]) => (
              <section key={key}>
                <h4>{label}</h4>
                {result.gaps[key].length === 0 ? (
                  <p className="muted">None.</p>
                ) : (
                  <ul>
                    {result.gaps[key].map((row, i) => (
                      <li key={i}>{row}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </section>

          <section aria-label="Proposal location">
            <h3>Proposal written</h3>
            <p>
              <code>{result.proposal_path}</code> — open it in your editor
              for the full Markdown body. The ModelSpec persists at{" "}
              <code>{result.modelspec_path}</code>.
            </p>
          </section>
        </>
      )}
    </article>
  );
}
