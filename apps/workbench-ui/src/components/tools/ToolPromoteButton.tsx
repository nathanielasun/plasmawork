/**
 * ToolPromoteButton — Phase α.4 / α.5 (2026-05-10).
 *
 * Capability-gated button on the tool detail view. When the active
 * membership lacks ``tool:request_promotion``, the button hides
 * itself entirely (the user shouldn't see actions they can't
 * perform). When present, the button opens an inline form with a
 * target-workspace picker (drawn from the user's other memberships,
 * minus the active workspace and the synthetic ``_platform`` slug)
 * plus a justification textarea. Submit hits
 * ``apiClient.requestToolPromotion`` and reports success / failure.
 */
import { useState } from "react";

import { apiClient } from "../../api/client";
import { useSessionOptional } from "../auth/SessionContext";

export interface ToolPromoteButtonProps {
  readonly toolName: string;
  /** Override for tests. Defaults to the module-level apiClient. */
  readonly api?: Pick<typeof apiClient, "requestToolPromotion">;
}

export function ToolPromoteButton(
  props: ToolPromoteButtonProps,
): JSX.Element | null {
  const session = useSessionOptional();
  const api = props.api ?? apiClient;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    | { tag: "ok"; message: string }
    | { tag: "err"; message: string }
    | null
  >(null);

  // Capability gate. The button is invisible to anyone who doesn't
  // have tool:request_promotion. In dev mode (no SessionProvider),
  // the button stays visible so direct-TestClient development still
  // works — but the actual request will be gated by the backend's
  // role check (which is also dev-bypassed when no middleware
  // mounted, so the loop is consistent).
  const capabilities = session?.activeMembership?.capabilities ?? [];
  const hasCapability =
    session === null || capabilities.includes("tool:request_promotion");
  if (!hasCapability) return null;

  // Target picker: enumerate the user's memberships, exclude the
  // active workspace (no self-promote) and the synthetic _platform.
  const memberships = session?.session.memberships ?? [];
  const targetOptions = memberships
    .map((m) => m.workspace_name)
    .filter(
      (slug) =>
        slug !== session?.activeWorkspaceSlug && slug !== "_platform",
    );

  // If the user has only the active workspace + _platform, there's
  // no valid target. Render the button but disable it with a hint.
  const noValidTargets = targetOptions.length === 0;

  async function handleSubmit(): Promise<void> {
    if (target.length === 0) {
      setFeedback({ tag: "err", message: "Pick a target workspace." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await api.requestToolPromotion(props.toolName, {
        to_workspace_slug: target,
        justification,
      });
      setFeedback({
        tag: "ok",
        message:
          "Promotion request submitted. A platform admin will review it.",
      });
      setOpen(false);
      setTarget("");
      setJustification("");
    } catch (err) {
      setFeedback({
        tag: "err",
        message: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setFeedback(null);
          }}
          disabled={noValidTargets}
          title={
            noValidTargets
              ? "You have no other workspaces to promote to."
              : undefined
          }
        >
          Promote
        </button>
        {feedback?.tag === "ok" && (
          <p className="status-ok" role="status">
            {feedback.message}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="tool-promote-form" role="dialog">
      <label className="tool-promote-field">
        <span>Target workspace</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
        >
          <option value="">— pick one —</option>
          {targetOptions.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
      </label>
      <label className="tool-promote-field">
        <span>Justification (optional)</span>
        <textarea
          rows={3}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          disabled={busy}
        />
      </label>
      {feedback?.tag === "err" && (
        <p className="status-error" role="alert">
          {feedback.message}
        </p>
      )}
      <div className="action-row action-row-start">
        <button
          type="button"
          className="primary"
          onClick={handleSubmit}
          disabled={busy}
        >
          {busy ? "Submitting…" : "Request promotion"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFeedback(null);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
