/**
 * AutonomyPanel — Phase 10 UI surface.
 *
 * Drives the four autonomy endpoints (design / smoke / sweep / review).
 * Every action emits DATA only — no mutation runs without an explicit
 * approval token granted via `simworkbench.autonomy.grant_autonomy_approval`
 * (a CLI / human-in-the-loop helper, intentionally absent from the UI).
 *
 * Phase-10 round-2 audit: every endpoint also writes one line to the
 * capsule's `provenance/agent_trace.md` so an autonomous decision is
 * auditable post hoc.
 *
 * Styling: uses the shared `Card` / `Pill` / `Kpi` primitives from
 * `components/ui/`. The `capsule_status` field is rendered as a Pill so
 * the Plan §22 invariant (placeholders → exploratory) is visible at a
 * glance instead of buried in JSON.
 */
import { useState } from "react";
import {
  apiClient,
  type AutonomyDesignResponse,
  type AutonomyReviewResponse,
  type AutonomySmokeResponse,
  type AutonomySweepResponse,
} from "../../api/client";
import { Card, FolderBrowser, Kpi, Pill } from "../ui";

export default function AutonomyPanel() {
  const [capsule, setCapsule] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [design, setDesign] = useState<AutonomyDesignResponse | null>(null);
  const [smoke, setSmoke] = useState<AutonomySmokeResponse | null>(null);
  const [review, setReview] = useState<AutonomyReviewResponse | null>(null);
  const [sweep, setSweep] = useState<AutonomySweepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<"none" | "design" | "smoke" | "review" | "sweep">("none");

  const handleDesign = async () => {
    setError(null);
    setRunning("design");
    try {
      const result = await apiClient.designExperiment(capsule.trim());
      setDesign(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning("none");
    }
  };

  const handleSmoke = async () => {
    setError(null);
    setRunning("smoke");
    try {
      const result = await apiClient.smokeExperiment(capsule.trim());
      setSmoke(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning("none");
    }
  };

  const handleReview = async () => {
    setError(null);
    setRunning("review");
    try {
      const result = await apiClient.reviewExperiment(capsule.trim());
      setReview(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning("none");
    }
  };

  const handleSweep = async () => {
    setError(null);
    setRunning("sweep");
    try {
      const result = await apiClient.autonomousSweep(capsule.trim(), {
        parameters: { x: [0.0, 0.25, 0.5, 0.75, 1.0] },
        metric: "loss",
        name: "autonomy_demo",
      });
      setSweep(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning("none");
    }
  };

  const disableActions = !capsule.trim() || running !== "none";

  return (
    <article>
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Phase 10 · Autonomy</p>
            <h1 className="hero-title">Autonomous experiment design loop</h1>
            <p className="hero-subtitle">
              Every action below emits data; nothing mutates the capsule's
              lifecycle status. Privileged actions (trusted-promotion,
              expensive-runs, external-export, destructive-edits) require an
              out-of-band approval token via{" "}
              <code>simworkbench.autonomy.grant_autonomy_approval</code>.
            </p>
          </div>
        </div>
      </header>

      <Card
        title="Capsule"
        subtitle="Pick a capsule under simulation_capsules/. The four actions below run against its model_spec.yaml and append to provenance/agent_trace.md."
      >
        <div className="row" style={{ marginBottom: "0.75rem" }}>
          <label>
            <span className="eyebrow" style={{ marginRight: "0.5rem" }}>Capsule</span>
            <input
              aria-label="autonomy-capsule"
              value={capsule}
              onChange={(e) => setCapsule(e.target.value)}
              size={40}
              placeholder="autonomous_experiment_kr_demo.lxp"
            />
          </label>
          <button
            type="button"
            onClick={() => setBrowserOpen((v) => !v)}
          >
            {browserOpen ? "Hide browser" : "Browse capsules…"}
          </button>
        </div>
        {browserOpen && (
          <div style={{ marginBottom: "0.75rem" }}>
            <FolderBrowser
              roots={["simulation_capsules"]}
              initialRoot="simulation_capsules"
              onSelect={(entry) => {
                // Top-level capsule directories are the selectable
                // unit; descend into them to inspect, but the autonomy
                // endpoints want the directory name itself.
                const head = entry.path.split("/")[0];
                setCapsule(head);
                setBrowserOpen(false);
              }}
              onClose={() => setBrowserOpen(false)}
            />
          </div>
        )}
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={handleDesign}
            disabled={disableActions}
          >
            {running === "design" ? "Designing…" : "Design experiment"}
          </button>
          <button
            type="button"
            onClick={handleSmoke}
            disabled={disableActions}
          >
            {running === "smoke" ? "Running smoke…" : "Smoke run"}
          </button>
          <button
            type="button"
            onClick={handleSweep}
            disabled={disableActions}
          >
            {running === "sweep" ? "Sweeping…" : "Bounded sweep"}
          </button>
          <button
            type="button"
            onClick={handleReview}
            disabled={disableActions}
          >
            {running === "review" ? "Reviewing…" : "Scientific review"}
          </button>
        </div>
      </Card>

      {error && (
        <p role="alert" className="error" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {design && (
        <Card
          title="Plan"
          subtitle={design.minimum_viable_model}
          action={
            <Pill
              kind={
                design.capsule_status === "validated"
                  ? "validated"
                  : "exploratory"
              }
            >
              {design.capsule_status}
            </Pill>
          }
        >
          <div className="kpi-strip">
            <Kpi
              label="Cost estimate"
              value={`${design.cost_estimate.total_cpu_seconds.toFixed(2)} CPU-s`}
            />
            <Kpi label="Backend" value={<code>{design.cost_estimate.backend}</code>} />
            <Kpi label="Fidelity rungs" value={design.fidelity_ladder.length} />
            <Kpi
              label="Placeholders"
              value={design.placeholders.length}
            />
          </div>

          {design.placeholders.length > 0 && (
            <Card nested title="Placeholder coefficients" subtitle="Plan §22 — the capsule cannot be promoted to validated while any of these are unresolved.">
              <div className="row">
                {design.placeholders.map((name) => (
                  <Pill key={name} kind="warning">
                    {name}
                  </Pill>
                ))}
              </div>
            </Card>
          )}

          <Card nested title="Fidelity ladder">
            <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {design.fidelity_ladder.map((step) => (
                <li key={step.label}>
                  <code>{step.label}</code> ({step.cpu_cost_factor}×) —{" "}
                  {step.description}
                </li>
              ))}
            </ol>
          </Card>

          <Card nested title="Diagnostics">
            <div className="row">
              {design.diagnostics.map((d) => (
                <Pill key={d} kind="diagnostic">
                  {d}
                </Pill>
              ))}
            </div>
          </Card>

          <Card nested title="Validation path">
            <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {design.validation_path.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ol>
          </Card>
        </Card>
      )}

      {smoke && (
        <Card
          title="Smoke run"
          action={
            smoke.instability_flags.length === 0 ? (
              <Pill kind="trusted">healthy</Pill>
            ) : (
              <Pill kind="warning">
                {smoke.instability_flags.length} flag
                {smoke.instability_flags.length === 1 ? "" : "s"}
              </Pill>
            )
          }
        >
          {smoke.instability_flags.length === 0 ? (
            <p className="muted">No instability detected in the smoke trajectory.</p>
          ) : (
            <Card nested title="Instability flags">
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {smoke.instability_flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </Card>
          )}
          {smoke.suggested_param_adjustments.length > 0 && (
            <Card
              nested
              title="Suggested adjustments"
              subtitle="Review before applying — the agent does not auto-apply parameter changes."
            >
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {smoke.suggested_param_adjustments.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Card>
          )}
        </Card>
      )}

      {sweep && (
        <Card
          title="Bounded sweep"
          subtitle={sweep.trend_summary}
          action={
            <Pill
              kind={
                sweep.stopped_reason === "high_failure_rate"
                  ? "warning"
                  : "validated"
              }
            >
              {sweep.stopped_reason}
            </Pill>
          }
        >
          <div className="kpi-strip">
            <Kpi label="Completed" value={sweep.completed} />
            <Kpi label="Failed" value={sweep.failed} />
            <Kpi
              label="Failure ratio"
              value={`${(sweep.failure_ratio * 100).toFixed(1)}%`}
            />
          </div>
          <Card nested title="Next sweep recommendation">
            <p style={{ margin: 0 }}>{sweep.next_sweep_recommendation}</p>
          </Card>
        </Card>
      )}

      {review && (
        <Card
          title="Scientific review"
          action={<Pill kind="validation">written</Pill>}
        >
          <p>
            Wrote <code>{review.review_path}</code> under capsule{" "}
            <code>{review.capsule}</code>. Open the file in the Code Viewer
            to read the full critique.
          </p>
        </Card>
      )}
    </article>
  );
}
