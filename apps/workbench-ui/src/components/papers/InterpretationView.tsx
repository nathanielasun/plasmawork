/**
 * Phase 4 — InterpretationView: renders the four agent-generated
 * markdown artifacts (paper_summary, assumptions, validity_domain,
 * implementation_plan) AND lets a reviewer edit each one in place.
 *
 * The verb "Allow edits" applies to every editable artifact kind, not
 * just equations + parameters. Carries the post-Phase-4-close pattern
 * "Treating multi-target verbs as done when one target is implemented".
 */
import { useState } from "react";
import { apiClient, type PaperInterpretation } from "../../api/client";

interface Props {
  capsule: string;
  interpretation: PaperInterpretation;
  onEdited?: () => void;
}

const SECTIONS: Array<{ slug: keyof PaperInterpretation; label: string; index: number }> = [
  { slug: "paper_summary", label: "paper_summary.md", index: 0 },
  { slug: "assumptions", label: "assumptions.md", index: 1 },
  { slug: "validity_domain", label: "validity_domain.md", index: 2 },
  { slug: "implementation_plan", label: "implementation_plan.md", index: 3 },
];

export default function InterpretationView({
  capsule,
  interpretation,
  onEdited,
}: Props) {
  const [editingSlug, setEditingSlug] = useState<keyof PaperInterpretation | null>(
    null,
  );
  const [draft, setDraft] = useState<string>("");
  const [reviewer, setReviewer] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = (slug: keyof PaperInterpretation) => {
    setEditingSlug(slug);
    setDraft(interpretation[slug] || "");
    setError(null);
  };
  const cancelEdit = () => {
    setEditingSlug(null);
    setDraft("");
    setError(null);
  };
  const saveEdit = async () => {
    if (!editingSlug) return;
    if (!reviewer.trim()) {
      setError("Reviewer name required.");
      return;
    }
    const section = SECTIONS.find((s) => s.slug === editingSlug);
    if (!section) return;
    setBusy(true);
    try {
      await apiClient.editPaperArtifact(capsule, {
        artifact: "interpretation",
        index: section.index,
        field: "body",
        value: draft,
        reviewer: reviewer.trim(),
      });
      setEditingSlug(null);
      onEdited?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3>Interpretation artifacts</h3>
      <p className="muted">
        Plan §Phase 4 hard rule: every artifact below is draft and
        requires human review before it feeds Phase 5 ModelSpec
        generation. Edits are tracked in <code>provenance/agent_trace.md</code>.
      </p>
      {SECTIONS.map(({ slug, label }) => (
        <details key={slug}>
          <summary>
            <code>{label}</code>
          </summary>
          {editingSlug === slug ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(10, draft.split("\n").length)}
                style={{ width: "100%", fontFamily: "monospace" }}
              />
              <p>
                <label>
                  Reviewer:{" "}
                  <input
                    type="text"
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    placeholder="your name"
                  />
                </label>{" "}
                <button type="button" onClick={saveEdit} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>{" "}
                <button type="button" onClick={cancelEdit} disabled={busy}>
                  Cancel
                </button>
                {error && <span className="placeholder"> {error}</span>}
              </p>
            </>
          ) : (
            <>
              <pre>
                <code>{interpretation[slug] || "(empty)"}</code>
              </pre>
              <p>
                <button type="button" onClick={() => startEdit(slug)}>
                  Edit
                </button>
              </p>
            </>
          )}
        </details>
      ))}
    </section>
  );
}
