/**
 * Phase 4 — InterpretationView: renders the four agent-generated
 * markdown artifacts (paper_summary, assumptions, validity_domain,
 * implementation_plan). Read-only display by default; the edit path is
 * the API's POST /api/papers/{capsule}/edit with artifact="interpretation".
 */
import type { PaperInterpretation } from "../../api/client";

interface Props {
  interpretation: PaperInterpretation;
}

const SECTIONS: Array<{ slug: keyof PaperInterpretation; label: string }> = [
  { slug: "paper_summary", label: "paper_summary.md" },
  { slug: "assumptions", label: "assumptions.md" },
  { slug: "validity_domain", label: "validity_domain.md" },
  { slug: "implementation_plan", label: "implementation_plan.md" },
];

export default function InterpretationView({ interpretation }: Props) {
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
          <pre>
            <code>{interpretation[slug] || "(empty)"}</code>
          </pre>
        </details>
      ))}
    </section>
  );
}
