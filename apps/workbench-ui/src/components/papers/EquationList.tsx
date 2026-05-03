/**
 * Phase 4 — EquationList: review-and-edit panel for extracted equations.
 *
 * Edits go through the backend's POST /api/papers/{capsule}/edit so
 * every change is persisted AND appended to provenance/agent_trace.md.
 */
import { useState } from "react";
import { apiClient, type PaperEquation } from "../../api/client";

interface Props {
  capsule: string;
  equations: PaperEquation[];
  onEdited?: () => void;
}

export default function EquationList({ capsule, equations, onEdited }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [reviewer, setReviewer] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setDraft(equations[i].text);
    setError(null);
  };
  const saveEdit = async () => {
    if (editingIdx === null) return;
    if (!reviewer.trim()) {
      setError("Reviewer name required.");
      return;
    }
    try {
      await apiClient.editPaperArtifact(capsule, {
        artifact: "equations",
        index: editingIdx,
        field: "text",
        value: draft,
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
      <h3>Equations</h3>
      {equations.length === 0 ? (
        <p className="placeholder">No equations extracted.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Text</th>
              <th>Line</th>
              <th>Confidence</th>
              <th>Edited by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {equations.map((eq, i) => (
              <tr key={eq.id}>
                <td><code>{eq.id}</code></td>
                <td>
                  {editingIdx === i ? (
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    <code>{eq.text}</code>
                  )}
                </td>
                <td>{eq.source_line}</td>
                <td>{eq.confidence.toFixed(2)}</td>
                <td>{eq.edited_by || <span className="muted">—</span>}</td>
                <td>
                  {editingIdx === i ? (
                    <button type="button" onClick={saveEdit}>
                      Save
                    </button>
                  ) : (
                    <button type="button" onClick={() => startEdit(i)}>
                      Edit
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
