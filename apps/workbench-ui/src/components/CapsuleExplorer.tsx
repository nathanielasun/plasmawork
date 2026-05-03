/**
 * CapsuleExplorer — Phase 2D capsule browser.
 *
 * Lists capsules and in-flight runs, then drills into a selected capsule
 * across six tabs (Manifest / ModelSpec / Code / Results / Validation /
 * Provenance). Each tab is its own component fetching from the Phase 2D
 * backend endpoints. The skeleton listing logic from Phase 1F is preserved
 * — the new functionality is the per-capsule detail panel.
 */
import { useEffect, useState } from "react";
import { apiClient, type CapsuleEntry } from "../api/client";
import ManifestView from "./capsule/ManifestView";
import ModelSpecView from "./capsule/ModelSpecView";
import CapsuleCodeView from "./capsule/CapsuleCodeView";
import ResultsView from "./capsule/ResultsView";
import ValidationView from "./capsule/ValidationView";
import ProvenanceView from "./capsule/ProvenanceView";

const TABS = [
  "manifest",
  "modelspec",
  "code",
  "results",
  "validation",
  "provenance",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  manifest: "Manifest",
  modelspec: "ModelSpec",
  code: "Code",
  results: "Results",
  validation: "Validation",
  provenance: "Provenance",
};

export default function CapsuleExplorer() {
  const [capsules, setCapsules] = useState<CapsuleEntry[]>([]);
  const [tempRuns, setTempRuns] = useState<CapsuleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("manifest");

  useEffect(() => {
    Promise.all([apiClient.listCapsules(), apiClient.listTempRuns()])
      .then(([caps, runs]) => {
        setCapsules(caps);
        setTempRuns(runs);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const renderTab = () => {
    if (!selected) return null;
    switch (tab) {
      case "manifest":
        return <ManifestView capsuleName={selected} />;
      case "modelspec":
        return <ModelSpecView capsuleName={selected} />;
      case "code":
        return <CapsuleCodeView capsuleName={selected} />;
      case "results":
        return <ResultsView capsuleName={selected} />;
      case "validation":
        return <ValidationView capsuleName={selected} />;
      case "provenance":
        return <ProvenanceView capsuleName={selected} />;
    }
  };

  return (
    <article>
      <h2>Capsule Explorer</h2>
      <p>
        Capsules are portable, reproducible simulation bundles
        (<code>.lxp/</code>). Phase 2 adds the canonical manifest schema, the
        validator, the export/fork system, and the inspection panels below.
      </p>

      {error && <p className="placeholder">Backend unavailable: {error}</p>}

      <h3>
        Finalized capsules <span className="placeholder">simulation_capsules/</span>
      </h3>
      {capsules.length === 0 && (
        <p className="placeholder">None yet — promote a run to create one.</p>
      )}
      {capsules.length > 0 && (
        <ul>
          {capsules.map((c) => (
            <li key={c.path}>
              <button
                type="button"
                onClick={() => setSelected(c.name)}
                className="text-button"
                aria-pressed={selected === c.name}
              >
                <code>{c.name}</code>
              </button>{" "}
              <span className="muted">— {c.path}</span>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section>
          <h3>
            Capsule: <code>{selected}</code>
          </h3>
          <nav aria-label="Capsule detail tabs">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={tab === t ? "tab tab-active" : "tab"}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </nav>
          {renderTab()}
        </section>
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
