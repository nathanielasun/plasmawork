/**
 * ToolStatus — renders the lifecycle bar (draft / candidate / validated /
 * trusted / deprecated) and exposes a promote button. Promotion to
 * `validated` and `trusted` requires the human-actor flag (plan §9.5);
 * the UI sends `actor: "human"` so the backend allows the transition.
 *
 * The bar is informational by default; ``onPromote`` activates the
 * forward-step button when the parent component is willing to handle
 * the side effect.
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
      const result = await apiClient.setToolStatus(toolName, next, "human");
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
