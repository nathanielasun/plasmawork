/**
 * ToolStatus — renders the lifecycle bar (draft / candidate / validated /
 * trusted / deprecated) and exposes a promote button.
 *
 * The backend chooses the actor server-side. Agent-allowed transitions
 * (draft / candidate / deprecated) succeed unconditionally. Human-only
 * transitions (validated / trusted) require a single-use approval token
 * pre-written to `local_cache/tool_approvals/` via the local CLI
 * (`python -m simworkbench.tools.approve <tool> <to_status>`). If
 * absent the API returns 403 and the UI surfaces the message.
 *
 * Earlier the UI sent `actor: "human"` and the API trusted the field;
 * carries `agent_error_patterns.md` "Trusting a client-supplied actor
 * identity for a privileged check".
 */
import { useState } from "react";
import {
  apiClient,
  type ToolStatus as Status,
} from "../../api/client";

interface Props {
  toolName: string;
  current: Status;
  onChanged?: (next: Status) => void;
}

const ORDER: Status[] = [
  "draft",
  "candidate",
  "validated",
  "trusted",
];

const NEXT: Record<Status, Status | null> = {
  draft: "candidate",
  candidate: "validated",
  validated: "trusted",
  trusted: null,
  deprecated: null,
};

export default function ToolStatus({ toolName, current, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = NEXT[current];
  const promote = async () => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.setToolStatus(toolName, next);
      onChanged?.(result.status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Tool lifecycle">
      <ol className="lifecycle">
        {ORDER.map((s) => (
          <li
            key={s}
            className={s === current ? "lifecycle-active" : undefined}
            aria-current={s === current ? "step" : undefined}
          >
            {s}
          </li>
        ))}
        {current === "deprecated" && (
          <li className="lifecycle-active">deprecated</li>
        )}
      </ol>
      {next && (
        <button type="button" disabled={busy} onClick={promote}>
          {busy ? "Promoting…" : `Promote to ${next}`}
        </button>
      )}
      {error && <p className="placeholder">Promotion failed: {error}</p>}
    </section>
  );
}
