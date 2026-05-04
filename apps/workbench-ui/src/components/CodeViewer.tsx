/**
 * CodeViewer — read-only viewer for capsule code.
 *
 * Per AGENTS.md "Adding Internal Tools and Simulation Modules" + agent_error
 * patterns "Overwriting <capsule>/src/user_edits/": this viewer is **read-only
 * for `<capsule>/src/user_edits/`**. The workbench shell UI never offers an edit
 * affordance for that subtree. Edits to `src/generated/` would land via a
 * future regeneration flow that produces a diff under `src/generated/.pending/`.
 */
import { useState } from "react";

export default function CodeViewer() {
  const [path, setPath] = useState("examples/simple_rate_equations/model.yaml");
  const [readonly] = useState(true); // workbench shell is read-only.

  return (
    <article>
      <h2>Code Viewer</h2>
      <p className="placeholder">
        workbench shell skeleton: file content fetching is wired to the backend in
        workbench shell+. The viewer is intentionally read-only; <code>user_edits/</code>{" "}
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
        <code>{`# ${path} — readonly: ${readonly}\n# Backend file fetch lands in workbench shell+.`}</code>
      </pre>
    </article>
  );
}
