/**
 * AutonomyPanel — Phase 10 UI surface.
 *
 * Drives the four autonomy endpoints (design / smoke / sweep / review).
 * Every action emits DATA only — no mutation runs without an explicit
 * approval token granted via `simworkbench.autonomy.grant_autonomy_approval`
 * (a CLI / human-in-the-loop helper, intentionally absent from the UI).
 */
import { useState } from "react";
import {
  apiClient,
  type AutonomyDesignResponse,
  type AutonomyReviewResponse,
  type AutonomySweepResponse,
} from "../../api/client";

export default function AutonomyPanel() {
  const [capsule, setCapsule] = useState("");
  const [design, setDesign] = useState<AutonomyDesignResponse | null>(null);
  const [review, setReview] = useState<AutonomyReviewResponse | null>(null);
  const [sweep, setSweep] = useState<AutonomySweepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<"none" | "design" | "review" | "sweep">("none");

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

  return (
    <article>
      <h2>Autonomy</h2>
      <p>
        Phase 10 — autonomous experiment design loop. Every action below
        emits data; nothing mutates the capsule's lifecycle status.
        Privileged actions (trusted-promotion, expensive-runs,
        external-export, destructive-edits) require an out-of-band
        approval token (see <code>simworkbench.autonomy.grant_autonomy_approval</code>).
      </p>

      <p>
        <label>
          Capsule:&nbsp;
          <input
            aria-label="autonomy-capsule"
            value={capsule}
            onChange={(e) => setCapsule(e.target.value)}
            size={40}
            placeholder="autonomous_experiment_kr_demo.lxp"
          />
        </label>
      </p>

      <p>
        <button
          type="button"
          onClick={handleDesign}
          disabled={!capsule.trim() || running !== "none"}
        >
          {running === "design" ? "Designing…" : "Design experiment"}
        </button>
        &nbsp;
        <button
          type="button"
          onClick={handleSweep}
          disabled={!capsule.trim() || running !== "none"}
        >
          {running === "sweep" ? "Sweeping…" : "Bounded sweep"}
        </button>
        &nbsp;
        <button
          type="button"
          onClick={handleReview}
          disabled={!capsule.trim() || running !== "none"}
        >
          {running === "review" ? "Reviewing…" : "Scientific review"}
        </button>
      </p>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {design && (
        <section>
          <h3>Plan</h3>
          <p>
            <strong>Minimum viable model:</strong> {design.minimum_viable_model}
          </p>
          <p>
            <strong>Capsule status:</strong>{" "}
            <code>{design.capsule_status}</code>
            {design.placeholders.length > 0 && (
              <>
                {" "}
                (placeholders: {design.placeholders.join(", ")})
              </>
            )}
          </p>
          <p>
            <strong>Cost estimate:</strong>{" "}
            {design.cost_estimate.total_cpu_seconds.toFixed(2)} CPU-s on{" "}
            <code>{design.cost_estimate.backend}</code>
          </p>
          <h4>Fidelity ladder</h4>
          <ol>
            {design.fidelity_ladder.map((step) => (
              <li key={step.label}>
                <code>{step.label}</code> ({step.cpu_cost_factor}×) —{" "}
                {step.description}
              </li>
            ))}
          </ol>
          <h4>Diagnostics</h4>
          <ul>
            {design.diagnostics.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
          <h4>Validation path</h4>
          <ol>
            {design.validation_path.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ol>
        </section>
      )}

      {sweep && (
        <section>
          <h3>Bounded sweep</h3>
          <p>{sweep.trend_summary}</p>
          <p>
            <strong>Next sweep:</strong> {sweep.next_sweep_recommendation}
          </p>
          <p>
            Completed {sweep.completed}, failed {sweep.failed} (failure ratio{" "}
            {(sweep.failure_ratio * 100).toFixed(1)}%) — stopped:{" "}
            <code>{sweep.stopped_reason}</code>
          </p>
        </section>
      )}

      {review && (
        <section>
          <h3>Scientific review</h3>
          <p>
            Wrote <code>{review.review_path}</code> under capsule{" "}
            <code>{review.capsule}</code>. Open the file in the Code
            Viewer to read the full critique.
          </p>
        </section>
      )}
    </article>
  );
}
