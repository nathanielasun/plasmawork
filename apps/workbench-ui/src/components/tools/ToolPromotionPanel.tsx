/**
 * ToolPromotionPanel — Phase α.4 (2026-05-10).
 *
 * PlatformAdmin (IncidentRemediator role) surface for reviewing
 * pending cross-workspace tool promotions. Lists every pending
 * request from ``GET /api/tool-promotions``, with approve / deny
 * actions that hit the corresponding endpoints. The panel hides
 * itself when the active membership lacks the
 * ``platform:incident_remediate`` capability.
 *
 * The promotion request itself happens elsewhere (Promote button on
 * the tool detail view). This panel is the approver-side surface.
 */
import { useEffect, useState } from "react";

import { useSession } from "../auth/SessionContext.js";
import {
  createApiClient,
  type ApiClient,
  type ToolPromotionRequest,
} from "../../api/client.js";

export interface ToolPromotionPanelProps {
  /** Override for tests. Defaults to the module-level api client. */
  readonly api?: ApiClient;
}

type LoadState =
  | { tag: "loading" }
  | { tag: "ready"; pending: readonly ToolPromotionRequest[] }
  | { tag: "error"; message: string }
  | { tag: "denied" };

export function ToolPromotionPanel(
  props: ToolPromotionPanelProps = {},
): JSX.Element {
  const session = useSession();
  const api = props.api ?? createApiClient();
  const [state, setState] = useState<LoadState>({ tag: "loading" });
  const [decisionInProgress, setDecisionInProgress] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasApproverCapability = (
    session.activeMembership?.capabilities ?? []
  ).includes("platform:incident_remediate");

  async function refresh(): Promise<void> {
    if (!hasApproverCapability) {
      setState({ tag: "denied" });
      return;
    }
    setState({ tag: "loading" });
    try {
      const pending = await api.listToolPromotions();
      setState({ tag: "ready", pending });
    } catch (err) {
      setState({
        tag: "error",
        message: err instanceof Error ? err.message : "Could not load.",
      });
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasApproverCapability]);

  async function handleDecision(
    requestId: string,
    action: "approve" | "deny",
    note: string,
  ): Promise<void> {
    setDecisionInProgress(requestId);
    setErrorMessage(null);
    try {
      if (action === "approve") {
        await api.approveToolPromotion(requestId, { decision_note: note });
      } else {
        await api.denyToolPromotion(requestId, { decision_note: note });
      }
      await refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : `Could not ${action}.`,
      );
    } finally {
      setDecisionInProgress(null);
    }
  }

  if (state.tag === "denied") {
    return (
      <div className="tool-promotion-panel" role="region">
        <h2>Tool promotions</h2>
        <p className="muted">
          Approving cross-workspace tool promotions requires the{" "}
          <code>platform:incident_remediate</code> capability. Ask a
          platform administrator if you need access.
        </p>
      </div>
    );
  }

  return (
    <div className="tool-promotion-panel" role="region">
      <h2>Tool promotions</h2>
      <p className="muted">
        Pending cross-workspace promotion requests. Approving copies
        the tool's directory from the source workspace into the
        target; denying leaves the source unchanged.
      </p>
      {state.tag === "loading" && <p>Loading…</p>}
      {state.tag === "error" && (
        <p className="status-error" role="alert">
          {state.message}
        </p>
      )}
      {errorMessage !== null && (
        <p className="status-error" role="alert">
          {errorMessage}
        </p>
      )}
      {state.tag === "ready" && state.pending.length === 0 && (
        <p className="muted">No pending requests.</p>
      )}
      {state.tag === "ready" && state.pending.length > 0 && (
        <ul className="tool-promotion-list">
          {state.pending.map((request) => (
            <PromotionRow
              key={request.request_id}
              request={request}
              busy={decisionInProgress === request.request_id}
              onDecide={(action, note) =>
                handleDecision(request.request_id, action, note)
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface PromotionRowProps {
  readonly request: ToolPromotionRequest;
  readonly busy: boolean;
  readonly onDecide: (
    action: "approve" | "deny",
    note: string,
  ) => Promise<void>;
}

function PromotionRow(props: PromotionRowProps): JSX.Element {
  const [note, setNote] = useState("");
  const { request, busy, onDecide } = props;
  return (
    <li className="tool-promotion-row">
      <div className="tool-promotion-summary">
        <strong>{request.tool_name}</strong>
        <span className="muted">
          {request.from_workspace_slug} → {request.to_workspace_slug}
        </span>
        <span className="muted">requested by {request.requested_by}</span>
      </div>
      {request.justification && (
        <p className="tool-promotion-justification">
          {request.justification}
        </p>
      )}
      <textarea
        className="tool-promotion-note"
        placeholder="Decision note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy}
        rows={2}
        aria-label={`decision note for ${request.tool_name}`}
      />
      <div className="tool-promotion-actions">
        <button
          type="button"
          onClick={() => onDecide("approve", note)}
          disabled={busy}
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={() => onDecide("deny", note)}
          disabled={busy}
          className="tool-promotion-deny"
        >
          Deny
        </button>
      </div>
    </li>
  );
}
