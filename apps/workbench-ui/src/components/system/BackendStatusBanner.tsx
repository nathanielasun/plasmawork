/**
 * Backend mode banner — always-visible status strip at the top of the
 * app. Catches the bug shape where the SPA is unknowingly running
 * against the dev stub (no real auth, no real audit) by surfacing the
 * mode explicitly. Also surfaces a "live" indicator so the absence of
 * a stub banner is unambiguously "real backend," not "JS is broken."
 *
 * Probes ``GET /dev-status`` on mount and every 30 seconds. Renders
 * one of three states:
 *
 *   stub  → warning tier. Loud enough that nobody ships against the
 *           stub by accident, surfaces the hint from the stub body
 *           so the path to the real gateway is one click away.
 *   live  → trusted tier. Subtle so it doesn't clutter the real UX.
 *   error → deprecated tier. Means the gateway is unreachable; renders
 *           with the curl-style error string.
 *
 * Mounted in App.tsx OUTSIDE the SessionProvider so it shows
 * pre-login (e.g. on the /login page).
 */

import { useEffect, useState } from "react";

import { probeBackendMode, type BackendMode, type DevStatus } from "../../api/devStatus.js";

const REFRESH_INTERVAL_MS = 30_000;

type BannerState =
  | { readonly tag: "loading" }
  | { readonly tag: "ready"; readonly status: DevStatus };

function modeLabel(mode: BackendMode): string {
  if (mode === "stub") return "Dev stub gateway";
  if (mode === "live") return "Live backend";
  return "Backend unreachable";
}

function modeKind(mode: BackendMode): "warning" | "trusted" | "deprecated" {
  if (mode === "stub") return "warning";
  if (mode === "live") return "trusted";
  return "deprecated";
}

export default function BackendStatusBanner(): JSX.Element | null {
  const [state, setState] = useState<BannerState>({ tag: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const probe = async (): Promise<void> => {
      try {
        const status = await probeBackendMode(controller.signal);
        if (!cancelled) setState({ tag: "ready", status });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!cancelled) {
          setState({
            tag: "ready",
            status: {
              mode: "error",
              hint: null,
              error: (err as Error).message,
            },
          });
        }
      }
    };

    void probe();
    const handle = window.setInterval(() => void probe(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(handle);
    };
  }, []);

  if (state.tag === "loading") return null;

  const { mode, hint, error } = state.status;
  const kind = modeKind(mode);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`backend-status-banner backend-status-banner-${kind}`}
      data-mode={mode}
    >
      <span className="backend-status-banner-label">{modeLabel(mode)}</span>
      {hint !== null && (
        <span className="backend-status-banner-hint">{hint}</span>
      )}
      {error !== null && (
        <span className="backend-status-banner-error">{error}</span>
      )}
    </div>
  );
}
