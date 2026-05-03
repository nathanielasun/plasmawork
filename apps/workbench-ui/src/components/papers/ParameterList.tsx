/**
 * Phase 4 — ParameterList: extracted parameters with the missing-units
 * warning highlighted. Editing the unit field persists to disk and
 * appends to provenance.
 */
import { useState } from "react";
import { apiClient, type PaperParameter } from "../../api/client";

interface Props {
  capsule: string;
  parameters: PaperParameter[];
  onEdited?: () => void;
}

export default function ParameterList({ capsule, parameters, onEdited }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [reviewer, setReviewer] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setDraft(parameters[i].unit);
    setError(null);
  };
  const saveEdit = async () => {
    if (editingIdx === null) return;
    if (!reviewer.trim()) {
      setError("Reviewer name required.");
      return;
    }
    try {
      // Editing the unit field also clears missing_units; do it as two
      // sequential edits via the API so each one is provenance-tracked.
      await apiClient.editPaperArtifact(capsule, {
        artifact: "parameters",
        index: editingIdx,
        field: "unit",
        value: draft,
        reviewer: reviewer.trim(),
      });
      await apiClient.editPaperArtifact(capsule, {
        artifact: "parameters",
        index: editingIdx,
        field: "missing_units",
        value: !draft.trim(),
        reviewer: reviewer.trim(),
      });
      setEditingIdx(null);
      onEdited?.();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section>
      <h3>Parameters</h3>
      {parameters.length === 0 ? (
        <p className="placeholder">No parameters extracted.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Status</th>
              <th>Line</th>
              <th>Edited by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((p, i) => (
              <tr key={`${p.name}-${i}`}>
                <td><code>{p.name}</code></td>
                <td>{String(p.value)}</td>
                <td>
                  {editingIdx === i ? (
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  ) : (
                    p.unit || <span className="placeholder">missing</span>
                  )}
                </td>
                <td>
                  {p.missing_units ? (
                    <span className="badge badge-warning">missing units</span>
                  ) : (
                    <span className="badge badge-validated">ok</span>
                  )}
                </td>
                <td>{p.source_line}</td>
                <td>{p.edited_by || <span className="muted">—</span>}</td>
                <td>
                  {editingIdx === i ? (
                    <button type="button" onClick={saveEdit}>
                      Save
                    </button>
                  ) : (
                    <button type="button" onClick={() => startEdit(i)}>
                      Edit unit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editingIdx !== null && (
        <p>
          <label>
            Reviewer:{" "}
            <input
              type="text"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="your name"
            />
          </label>
          {error && <span className="placeholder"> {error}</span>}
        </p>
      )}
    </section>
  );
}
