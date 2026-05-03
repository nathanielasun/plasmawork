/**
 * Phase 4 — PaperReview: top-level review panel.
 *
 * Workflow:
 *   1. User picks a capsule and points at a paper file on disk.
 *   2. Click "Import" → backend ingests, runs every Phase 4 extractor,
 *      writes artifacts under <capsule>/paper_sources/, and appends one
 *      entry to provenance/agent_trace.md.
 *   3. The four sub-panels (EquationList, ParameterList, InterpretationView)
 *      load the resulting artifacts and let the human reviewer edit
 *      each row. Every edit goes through the backend so it's persisted
 *      AND provenance-tracked.
 */
import { useCallback, useEffect, useState } from "react";
import {
  apiClient,
  type CapsuleEntry,
  type PaperExtracted,
} from "../../api/client";
import EquationList from "./EquationList";
import ParameterList from "./ParameterList";
import InterpretationView from "./InterpretationView";

export default function PaperReview() {
  const [capsules, setCapsules] = useState<CapsuleEntry[]>([]);
  const [selectedCapsule, setSelectedCapsule] = useState<string>("");
  const [paperPath, setPaperPath] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<PaperExtracted | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.listCapsules().then(setCapsules).catch((e) => setError(String(e)));
  }, []);

  const refreshExtracted = useCallback(() => {
    if (!selectedCapsule) return;
    apiClient
      .getPaperExtracted(selectedCapsule)
      .then(setExtracted)
      .catch((e) => setError(String(e)));
  }, [selectedCapsule]);

  useEffect(() => {
    refreshExtracted();
  }, [refreshExtracted]);

  const importPaper = async () => {
    if (!selectedCapsule || !paperPath.trim()) {
      setImportStatus("Select a capsule and provide a paper path.");
      return;
    }
    setImporting(true);
    setImportStatus(null);
    try {
      const r = await apiClient.importPaper(selectedCapsule, paperPath.trim());
      setImportStatus(`Imported ${r.paper_imported}.`);
      refreshExtracted();
    } catch (e) {
      setImportStatus(`Import failed: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  if (error)
    return <p className="placeholder">Backend unavailable: {error}</p>;

  return (
    <article>
      <h2>Paper Review</h2>
      <p>
        Phase 4 — Agent-Assisted Paper Ingestion. Imports a paper into a
        capsule's <code>paper_sources/</code>, runs the equation /
        parameter / interpretation extractors, and surfaces the results
        for human review and edit. Per plan §Phase 4: agents produce
        only interpretation artifacts in this phase; trusted simulation
        outputs come later.
      </p>

      <section aria-label="Import">
        <h3>Import paper</h3>
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
        <p>
          <label>
            Paper path:{" "}
            <input
              type="text"
              placeholder="/path/to/paper.md"
              value={paperPath}
              onChange={(e) => setPaperPath(e.target.value)}
              size={50}
            />
          </label>{" "}
          <button type="button" onClick={importPaper} disabled={importing}>
            {importing ? "Importing…" : "Import"}
          </button>
        </p>
        {importStatus && <p className="muted">{importStatus}</p>}
      </section>

      {selectedCapsule && extracted && (
        <>
          <EquationList
            capsule={selectedCapsule}
            equations={extracted.equations}
            onEdited={refreshExtracted}
          />
          <ParameterList
            capsule={selectedCapsule}
            parameters={extracted.parameters}
            onEdited={refreshExtracted}
          />
          <InterpretationView
            capsule={selectedCapsule}
            interpretation={extracted.interpretation}
            onEdited={refreshExtracted}
          />
        </>
      )}
    </article>
  );
}
