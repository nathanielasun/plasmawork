/**
 * Phase 6D — GeneratedCodeView.
 *
 * Shows the contents of <capsule>/src/generated/ + <capsule>/src/user_edits/
 * (always rendered as separate trees so the user can never confuse one for
 * the other) and offers three actions:
 *
 *   1. Regenerate — calls POST /api/capsules/{name}/codegen. The backend's
 *      sandbox refuses to write under user_edits/, so the button is safe to
 *      expose without a confirmation dialog.
 *   2. View diff — calls GET /api/capsules/{name}/codegen/diff and shows
 *      which files changed since the previous generation.
 *   3. Run validation — calls POST /api/capsules/{name}/validate-run, which
 *      writes <capsule>/validation/{validation_summary.md, status.yaml,
 *      plots/*.csv}.
 *
 * Carries the Phase-2 audit lesson "UI panels actually render": every
 * branch (no generated tree, listed tree, after regenerate, after diff,
 * after validation) is asserted in the matching Vitest file.
 */
import { useEffect, useState } from "react";
import {
  apiClient,
  type CapsuleEntry,
  type CodegenDiff,
  type CodegenListing,
  type CodegenRun,
} from "../../api/client";

export default function GeneratedCodeView() {
  const [capsules, setCapsules] = useState<CapsuleEntry[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [listing, setListing] = useState<CodegenListing | null>(null);
  const [diff, setDiff] = useState<CodegenDiff | null>(null);
  const [lastRun, setLastRun] = useState<CodegenRun | null>(null);
  const [validationSummaryPath, setValidationSummaryPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "regenerate" | "diff" | "validate" | "save">("");
  const [error, setError] = useState<string | null>(null);

  // 6D editor: reviewer-driven user_edits/ writes. We default to
  // ``run_overrides.py`` so the textarea doesn't start empty when a
  // first-time reviewer hasn't picked a name yet.
  const [editPath, setEditPath] = useState<string>("run_overrides.py");
  const [editContent, setEditContent] = useState<string>(
    "# Reviewer edits for <capsule>/src/user_edits/.\n"
      + "# Regeneration never overwrites this directory.\n",
  );
  const [editSaved, setEditSaved] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listCapsules()
      .then(setCapsules)
      .catch((e) => setError(String(e)));
  }, []);

  const loadListing = async (capsule: string) => {
    setError(null);
    try {
      const r = await apiClient.listCodegen(capsule);
      setListing(r);
    } catch (e) {
      setError(String(e));
    }
  };

  const onSelect = (capsule: string) => {
    setSelected(capsule);
    setListing(null);
    setDiff(null);
    setLastRun(null);
    setValidationSummaryPath(null);
    if (capsule) {
      loadListing(capsule);
    }
  };

  const regenerate = async () => {
    if (!selected) return;
    setBusy("regenerate");
    setError(null);
    try {
      const r = await apiClient.runCodegen(selected);
      setLastRun(r);
      await loadListing(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const showDiff = async () => {
    if (!selected) return;
    setBusy("diff");
    setError(null);
    try {
      const r = await apiClient.diffCodegen(selected);
      setDiff(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const validate = async () => {
    if (!selected) return;
    setBusy("validate");
    setError(null);
    try {
      const r = await apiClient.runValidation(selected);
      setValidationSummaryPath(r.summary_path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const saveUserEdit = async () => {
    if (!selected) return;
    if (!editPath.trim()) {
      setError("Pick a filename under src/user_edits/.");
      return;
    }
    setBusy("save");
    setError(null);
    setEditSaved(null);
    try {
      const r = await apiClient.writeUserEdit(selected, editPath, editContent);
      setEditSaved(r.path);
      await loadListing(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <article>
      <h2>Generated Code</h2>
      <p>
        Phase 6 generates a runnable Python experiment, configs,
        diagnostic helpers, and tests under{" "}
        <code>&lt;capsule&gt;/src/generated/</code>. The reviewer's
        edits live in <code>&lt;capsule&gt;/src/user_edits/</code>, which
        regeneration <strong>never</strong> touches — that guard is
        enforced inside the backend sandbox, not in the UI.
      </p>

      <section aria-label="Capsule selector">
        <h3>Capsule</h3>
        <p>
          <label>
            Capsule:{" "}
            <select
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
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
          <button
            type="button"
            onClick={regenerate}
            disabled={!selected || busy !== ""}
          >
            {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
          </button>{" "}
          <button
            type="button"
            onClick={showDiff}
            disabled={!selected || busy !== ""}
          >
            {busy === "diff" ? "Loading diff…" : "View diff"}
          </button>{" "}
          <button
            type="button"
            onClick={validate}
            disabled={!selected || busy !== ""}
          >
            {busy === "validate" ? "Running validation…" : "Run validation"}
          </button>
        </p>
        {error && <p className="placeholder">{error}</p>}
      </section>

      {listing && (
        <>
          <section aria-label="Generated tree">
            <h3>Generated tree</h3>
            {listing.generated_files.length === 0 ? (
              <p className="placeholder">
                No generated tree yet. Click <em>Regenerate</em> to write
                <code> src/generated/</code> from the capsule's ModelSpec.
              </p>
            ) : (
              <ul>
                {listing.generated_files.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code> ({f.size_bytes} bytes)
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="User edits tree">
            <h3>User edits tree</h3>
            {listing.user_edits_files.length === 0 ? (
              <p className="muted">
                No user edits yet. Files placed in{" "}
                <code>&lt;capsule&gt;/src/user_edits/</code> survive
                regeneration.
              </p>
            ) : (
              <ul>
                {listing.user_edits_files.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code> ({f.size_bytes} bytes)
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {lastRun && (
        <section aria-label="Last regeneration">
          <h3>Last regeneration</h3>
          <p>
            Wrote {lastRun.files_written.length} file(s); manifest at{" "}
            <code>{lastRun.manifest_path ?? "(missing)"}</code>.
          </p>
        </section>
      )}

      {diff && (
        <section aria-label="Regeneration diff">
          <h3>Regeneration diff</h3>
          {diff.previous ? (
            <p>
              Previous generation: <code>{diff.previous.generated_at}</code>{" "}
              ({diff.previous.files.length} files). Preview:{" "}
              {diff.current_preview.length} file(s) would land if you
              regenerated now.
            </p>
          ) : (
            <p className="muted">No prior generation manifest.</p>
          )}
          {diff.note && <p className="muted">{diff.note}</p>}
          {(["added", "removed", "changed"] as const).map((bucket) => {
            const rows = diff[bucket];
            if (rows.length === 0) return null;
            return (
              <section key={bucket} aria-label={`Diff ${bucket}`}>
                <h4>
                  {bucket[0].toUpperCase() + bucket.slice(1)} ({rows.length})
                </h4>
                <ul>
                  {rows.map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {diff.added.length === 0
            && diff.removed.length === 0
            && diff.changed.length === 0
            && diff.previous && (
              <p className="muted">
                No diff vs. the prior generation — regenerating would
                produce the same tree.
              </p>
            )}
        </section>
      )}

      {validationSummaryPath && (
        <section aria-label="Validation summary">
          <h3>Validation summary</h3>
          <p>
            Wrote <code>{validationSummaryPath}</code>. Open it to see the
            run's diagnostics, plots, and validation status.
          </p>
        </section>
      )}

      {selected && (
        <section aria-label="User edits editor">
          <h3>User edits editor</h3>
          <p className="muted">
            Reviewer-driven edits land under{" "}
            <code>&lt;capsule&gt;/src/user_edits/</code>. Regeneration{" "}
            <strong>never</strong> touches this subtree (the backend's{" "}
            <code>user_edit_write</code> enforces it). paper_sources/ and
            provenance/ are refused by the same library check.
          </p>
          <p>
            <label htmlFor="user-edit-path">
              Path under user_edits/:&nbsp;
            </label>
            <input
              id="user-edit-path"
              type="text"
              value={editPath}
              onChange={(e) => setEditPath(e.target.value)}
              size={40}
            />
          </p>
          <p>
            <label htmlFor="user-edit-content">Contents:</label>
          </p>
          <p>
            <textarea
              id="user-edit-content"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={10}
              cols={80}
            />
          </p>
          <p>
            <button
              type="button"
              onClick={saveUserEdit}
              disabled={!selected || busy !== ""}
            >
              {busy === "save" ? "Saving…" : "Save user edit"}
            </button>
          </p>
          {editSaved && (
            <p>
              Saved <code>{editSaved}</code>.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
