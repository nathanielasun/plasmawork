/**
 * CodeViewer — read-only viewer for capsule code.
 *
 * Per AGENTS.md "Adding Internal Tools and Simulation Modules" + agent_error
 * patterns "Overwriting <capsule>/src/user_edits/": this viewer is **read-only
 * for `<capsule>/src/user_edits/`**. The Phase 1F UI never offers an edit
 * affordance for that subtree. Edits to `src/generated/` would land via a
 * future regeneration flow that produces a diff under `src/generated/.pending/`.
 */
import { useState } from "react";

export default function CodeViewer() {
  const [path, setPath] = useState("examples/simple_rate_equations/model.yaml");
  const [readonly] = useState(true); // Phase 1F is read-only.

  return (
    <article>
      <h2>Code Viewer</h2>
      <p className="placeholder">
        Phase 1F skeleton: file content fetching is wired to the backend in
        Phase 1F+. The viewer is intentionally read-only; <code>user_edits/</code>{" "}
        is never editable from the UI.
      </p>

      <p>
        <label>
          File path:&nbsp;
          <input
            aria-label="code-viewer-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            size={60}
          />
        </label>
      </p>

      <pre>
        <code>{`# ${path} — readonly: ${readonly}\n# Backend file fetch lands in Phase 1F+.`}</code>
      </pre>
    </article>
  );
}
