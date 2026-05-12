/**
 * Backend-mode probe client — feeds the BackendStatusBanner.
 *
 * Hits ``GET /dev-status`` (proxied via vite to the gateway). The dev
 * stub returns 200 with ``{ mode: "stub", hint: "..." }``. The real
 * gateway does NOT implement this route — it returns 404, which the
 * banner interprets as "live mode". Any other failure (connection
 * refused, 5xx, timeout) becomes "error" mode.
 *
 * The probe is intentionally cheap: no auth, no body, no CSRF. Safe
 * to call on every app mount + every 30s.
 */

export type BackendMode = "stub" | "live" | "error";

export interface DevStatus {
  readonly mode: BackendMode;
  /** Actionable hint from the stub (null in live/error modes). */
  readonly hint: string | null;
  /** Error detail when mode === "error" (null otherwise). */
  readonly error: string | null;
}

const DEV_STATUS_PATH = "/dev-status";

export async function probeBackendMode(
  signal?: AbortSignal,
): Promise<DevStatus> {
  try {
    const r = await fetch(DEV_STATUS_PATH, {
      signal,
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (r.status === 200) {
      let body: unknown = null;
      try {
        body = await r.json();
      } catch {
        // Server answered 200 but body wasn't JSON — treat as error.
        return {
          mode: "error",
          hint: null,
          error: "/dev-status returned a non-JSON body",
        };
      }
      const hint =
        typeof body === "object" &&
        body !== null &&
        typeof (body as { hint?: unknown }).hint === "string"
          ? ((body as { hint: string }).hint ?? null)
          : null;
      return { mode: "stub", hint, error: null };
    }
    if (r.status === 404) {
      // Real gateway doesn't expose /dev-status — that's the signal
      // for "live" mode.
      return { mode: "live", hint: null, error: null };
    }
    return {
      mode: "error",
      hint: null,
      error: `/dev-status returned HTTP ${r.status}`,
    };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") throw err;
    return {
      mode: "error",
      hint: null,
      error: (err as Error).message,
    };
  }
}
