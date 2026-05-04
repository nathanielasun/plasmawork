"""Phase 10 / 10C — Controlled Sweep Agent.

Wraps the Phase-9 ``SweepEngine`` with a budget-aware autonomous
loop. The agent's contract:

  - ``budget`` is the hard ceiling on evaluations. No bypass kwargs
    exist. (Phase-7/8/9 audit lesson; signature regression test in
    test_phase_10_gate_walk.py.)
  - The agent monitors run-by-run progress and stops the engine
    cleanly if any failure ratio threshold is breached.
  - Output carries a ``trend_summary`` markdown describing the
    objective's behaviour and a concrete ``next_sweep_recommendation``
    for follow-up bounded sweeps.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from simworkbench.sweep import SweepEngine, SweepSpec
from simworkbench.sweep.engine import SweepReport

Objective = Callable[[dict[str, float]], dict[str, Any]]


@dataclass
class ControlledSweepResult:
    """Output of a controlled sweep launch."""

    report: SweepReport
    trend_summary: str
    next_sweep_recommendation: str
    failure_ratio: float
    aborted_for_failure_rate: bool = False
    summary_metric: str = "loss"


@dataclass
class ControlledSweepAgent:
    """Budget-aware autonomous wrapper around ``SweepEngine``.

    The agent enforces three invariants:
      1. Total evaluations <= ``budget`` (delegates to ``SweepEngine``
         via ``SweepSpec.max_evaluations`` when no per-spec cap exists,
         and clamps when the spec's cap is larger).
      2. Failure ratio threshold (default 50% of completed runs failing
         after at least 4 evaluations) triggers a clean stop.
      3. Trend summary + next-sweep recommendation are always present.
    """

    budget: int
    failure_ratio_threshold: float = 0.5
    summary_metric: str = "loss"

    def __post_init__(self) -> None:
        if self.budget <= 0:
            raise ValueError(
                f"ControlledSweepAgent.budget must be positive; got "
                f"{self.budget!r}. There is no bypass."
            )
        if not (0.0 < self.failure_ratio_threshold <= 1.0):
            raise ValueError(
                "failure_ratio_threshold must be in (0, 1]; "
                f"got {self.failure_ratio_threshold!r}."
            )

    def launch(
        self,
        spec: SweepSpec,
        objective: Objective,
    ) -> SweepReport:
        """Launch a budget-bounded sweep and return the raw report.

        Phase-10 round-2 audit: when the failure ratio crosses the
        configured threshold AFTER at least four runs have happened,
        the engine is asked to stop cleanly via the per-row observer
        hook. The earlier implementation ran the full capped sweep
        and only RELABELED the result; that defeated the agent's
        purpose (saving budget on a sweep that's already failing).
        """
        capped_spec = self._cap_spec(spec)
        # Mutable container so the per-row closure can record the
        # specific stop cause without reaching into engine internals.
        stop_reason: dict[str, str] = {}
        seen = {"completed": 0, "failed": 0}

        def _observer(row) -> bool:  # noqa: ANN001 — engine API shape
            if row.error:
                seen["failed"] += 1
            else:
                seen["completed"] += 1
            total = seen["completed"] + seen["failed"]
            # Defer the failure-rate check until after at least four
            # runs; small samples produce spurious abort signals.
            if total < 4:
                return False
            ratio = seen["failed"] / max(total, 1)
            if ratio >= self.failure_ratio_threshold:
                stop_reason["reason"] = "high_failure_rate"
                return True
            return False

        engine = SweepEngine(
            spec=capped_spec,
            objective=objective,
            require_workbench_target=False,
            on_row=_observer,
        )
        report = engine.run()
        if "reason" in stop_reason:
            # Engine set stopped_reason="stopped_by_observer"; replace
            # with the agent's specific cause for auditability.
            report.stopped_reason = stop_reason["reason"]
        return report

    def launch_with_summary(
        self,
        spec: SweepSpec,
        objective: Objective,
    ) -> ControlledSweepResult:
        """Launch and return the rich result with summaries."""
        report = self.launch(spec, objective)
        ratio = self._failure_ratio(report)
        result = ControlledSweepResult(
            report=report,
            trend_summary=self._trend_summary(report),
            next_sweep_recommendation=self._next_sweep_recommendation(report),
            failure_ratio=ratio,
            aborted_for_failure_rate=(
                ratio >= self.failure_ratio_threshold
                and len(report.runs) >= 4
            ),
            summary_metric=self.summary_metric,
        )
        return result

    # --- helpers --------------------------------------------------------

    def _cap_spec(self, spec: SweepSpec) -> SweepSpec:
        existing = spec.max_evaluations
        cap = self.budget if existing is None else min(existing, self.budget)
        # SweepSpec is a dataclass; rebuild with the clamped cap.
        from dataclasses import replace

        return replace(spec, max_evaluations=cap)

    @staticmethod
    def _failure_ratio(report: SweepReport) -> float:
        if not report.runs:
            return 0.0
        return len(report.failed) / max(len(report.runs), 1)

    def _trend_summary(self, report: SweepReport) -> str:
        completed = report.completed
        if not completed:
            return (
                "No runs completed; sweep produced "
                f"{len(report.failed)} failure(s)."
            )
        metric = self.summary_metric
        values = [
            float(r.metrics.get(metric))
            for r in completed
            if metric in r.metrics and r.metrics.get(metric) is not None
        ]
        if not values:
            return (
                f"{len(completed)} run(s) completed; metric "
                f"{metric!r} not present in results — pick a different "
                "summary metric or augment the objective."
            )
        best = min(values)
        worst = max(values)
        avg = sum(values) / len(values)
        return (
            f"{len(completed)} run(s) completed, "
            f"{len(report.failed)} failed. "
            f"Metric `{metric}` ranged "
            f"{best:.4g} (best) → {worst:.4g} (worst), "
            f"mean {avg:.4g}."
        )

    def _next_sweep_recommendation(self, report: SweepReport) -> str:
        completed = report.completed
        if not completed:
            return (
                "No completed runs — debug the objective before "
                "scheduling another sweep."
            )
        metric = self.summary_metric
        ranked = sorted(
            (r for r in completed if metric in r.metrics),
            key=lambda r: float(r.metrics[metric]),
        )
        if not ranked:
            return (
                "No runs carry the configured summary metric; choose a "
                "different metric or augment the objective."
            )
        best = ranked[0]
        return (
            f"Next sweep: tighten the parameter ranges around the best "
            f"observed point {best.parameters!r} (metric "
            f"`{metric}` = {float(best.metrics[metric]):.4g}). Reduce "
            "axis spans by ~50% and increase sampling density there."
        )


__all__ = [
    "ControlledSweepAgent",
    "ControlledSweepResult",
    "Objective",
]
