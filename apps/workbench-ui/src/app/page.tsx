/**
 * Compatibility smoke entrypoint for environments that still scan
 * `src/app/page.tsx`.
 *
 * The routed Vite application lives in `src/App.tsx`; this file remains only
 * as a lightweight exported function for repository convention checks.
 */
export function workbenchAppSmokeEntrypoint(): string {
  return "Scientific Simulation Workbench UI routed shell";
}
