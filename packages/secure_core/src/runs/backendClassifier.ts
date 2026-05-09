/**
 * Run-backend classifier — audit fix F3 (2026-05-09).
 *
 * v4 §17 lists `expensive_run` and `hpc_submission` as high-risk
 * actions that MUST go through the §16 approval flow. The L4.3 run
 * routes accept a `backend` body field and pass it directly to the
 * state machine. Without classification, a user with `run:create`
 * could submit any backend — including HPC clusters or GPU farms —
 * without an approval token.
 *
 * This module is the single authoritative classifier. The route
 * handler reads the body's `backend`, calls `classifyRunBackend`,
 * and (when the result is non-null) consumes a high-risk approval
 * token before invoking the state machine.
 *
 * Adding a backend slot is a deliberate change: extend the
 * `RUN_BACKENDS` const + the `BACKEND_RISK` map together. New HPC
 * pools or expensive accelerators land here.
 */

import type { HighRiskAction } from "../config/high_risk_actions.js";

/**
 * Closed enum of accepted backends. Empty + unknown strings refuse
 * earlier in the route via the Ajv schema's `enum` keyword. This
 * source is the union the schema's `enum` derives from.
 */
export const RUN_BACKENDS = [
  // Low-risk — local in-process execution
  "local",
  // Expensive resource pools
  "expensive:gpu",
  "expensive:large_cpu",
  // HPC submission targets
  "hpc:slurm",
  "hpc:pbs",
  "hpc:sge",
] as const;

export type RunBackend = (typeof RUN_BACKENDS)[number];

export const RUN_BACKEND_SET: ReadonlySet<RunBackend> = Object.freeze(
  new Set(RUN_BACKENDS),
);

export function isRunBackend(value: unknown): value is RunBackend {
  return typeof value === "string" && RUN_BACKEND_SET.has(value as RunBackend);
}

/**
 * Map each backend to its high-risk action — or `null` for low-risk
 * paths that don't require an approval token.
 *
 * v4 §17 enumerates `expensive_run` and `hpc_submission` separately
 * because they may end up requiring different approver capabilities
 * (`run:approve_expensive` vs `run:approve_hpc` per L1.1). Keeping
 * the discrimination here means the approval-flow audit row carries
 * the right action name per §29 #84.
 */
const BACKEND_RISK: Readonly<Record<RunBackend, HighRiskAction | null>> =
  Object.freeze({
    local: null,
    "expensive:gpu": "expensive_run",
    "expensive:large_cpu": "expensive_run",
    "hpc:slurm": "hpc_submission",
    "hpc:pbs": "hpc_submission",
    "hpc:sge": "hpc_submission",
  });

/**
 * Returns the v4 §17 high-risk action a backend triggers, or `null`
 * if the backend is low-risk and may run without an approval token.
 *
 * Refuses unknown backends with `null` (the route's Ajv schema is
 * the gate that produces the 400 — the classifier is for the
 * approved-set only).
 */
export function classifyRunBackend(
  backend: string,
): HighRiskAction | null {
  if (!isRunBackend(backend)) return null;
  return BACKEND_RISK[backend];
}
