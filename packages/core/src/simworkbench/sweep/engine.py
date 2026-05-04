"""Phase 9 / 9A — SweepEngine.

Iterates the sampler, runs the objective on each parameter point,
and aggregates the result into a structured ``SweepReport``. Honors
``max_evaluations`` as a hard cap (no silent overrun) and
checkpoints to disk after each completed row when
``checkpoint_path=`` is set.

Carries Phase-7/8 audit lessons:
  - ``run`` and ``__init__`` expose NO budget-bypass kwargs (a
    regression test inspects the signature).
  - The aggregate report distinguishes ``completed`` from ``failed``
    rows; one failure does not stop the sweep.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .checkpoint import SweepCheckpoint, _params_key
from .samplers import AdaptiveSampler
from .spec import SweepSpec

Objective = Callable[[dict[str, float]], dict[str, Any]]


@dataclass
class SweepRow:
    """One sweep result row."""

    parameters: dict[str, float]
    metrics: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    parent_sweep_id: str = ""


@dataclass
class SweepReport:
    """Aggregated output of a completed (or capped) sweep."""

    sweep_id: str
    spec_name: str
    runs: list[SweepRow] = field(default_factory=list)
    stopped_reason: str = ""

    @property
    def completed(self) -> list[SweepRow]:
        return [r for r in self.runs if r.error is None]

    @property
    def failed(self) -> list[SweepRow]:
        return [r for r in self.runs if r.error]


class SweepEngine:
    """Drive a parameter sweep through one objective callable.

    No kwargs called ``ignore_budget`` / ``unbounded`` exist here —
    Phase-7/8 audit lesson. The budget is the cap, period.
    """

    def __init__(
        self,
        *,
        spec: SweepSpec,
        objective: Objective,
        checkpoint_path: str | Path | None = None,
        sweep_id: str | None = None,
    ) -> None:
        self.spec = spec
        self.objective = objective
        self.checkpoint_path = (
            Path(checkpoint_path) if checkpoint_path else None
        )
        self.sweep_id = sweep_id or uuid.uuid4().hex
        self._completed_keys: set[tuple] = set()
        self._completed_rows: list[SweepRow] = []

    # ------------------------------------------------------------------
    # Resumption
    # ------------------------------------------------------------------

    @classmethod
    def resume(
        cls,
        *,
        spec: SweepSpec,
        objective: Objective,
        checkpoint_path: str | Path,
    ) -> SweepEngine:
        """Resume a sweep from ``checkpoint_path``. Re-uses the
        checkpoint's ``sweep_id`` so the provenance chain stays
        coherent across kills.
        """
        path = Path(checkpoint_path)
        if not path.is_file():
            raise FileNotFoundError(
                f"Cannot resume — no checkpoint at {path}"
            )
        ckpt = SweepCheckpoint.load(path)
        engine = cls(
            spec=spec,
            objective=objective,
            checkpoint_path=path,
            sweep_id=ckpt.sweep_id or None,
        )
        for row in ckpt.completed:
            params = dict(row.get("parameters") or {})
            engine._completed_keys.add(_params_key(params))
            engine._completed_rows.append(
                SweepRow(
                    parameters={k: float(v) for k, v in params.items()},
                    metrics=dict(row.get("metrics") or {}),
                    error=row.get("error"),
                    parent_sweep_id=engine.sweep_id,
                )
            )
        return engine

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------

    def run(self) -> SweepReport:
        """Execute the sweep and return the aggregated report."""
        report = SweepReport(
            sweep_id=self.sweep_id,
            spec_name=self.spec.name,
            runs=list(self._completed_rows),
        )
        sampler = self.spec.sampler
        max_evals = self.spec.max_evaluations
        # Budget already accounts for completed rows from the checkpoint.
        budget_remaining: int | None = (
            None if max_evals is None
            else max(0, max_evals - len(self._completed_rows))
        )

        history_view = (
            sampler._history if isinstance(sampler, AdaptiveSampler) else None
        )

        for params in self._iter_points(sampler):
            if budget_remaining is not None and budget_remaining <= 0:
                report.stopped_reason = "budget_cap"
                break
            key = _params_key(params)
            if key in self._completed_keys:
                # Already done in a prior session; skip.
                continue
            row = self._evaluate_one(params)
            report.runs.append(row)
            self._completed_rows.append(row)
            self._completed_keys.add(key)
            self._persist_checkpoint()
            if history_view is not None:
                history_view.append(
                    {
                        "parameters": row.parameters,
                        "metrics": row.metrics,
                        "error": row.error,
                    }
                )
            if budget_remaining is not None:
                budget_remaining -= 1
                if budget_remaining == 0:
                    report.stopped_reason = "budget_cap"
                    break

        if not report.stopped_reason:
            report.stopped_reason = "completed"
        return report

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _iter_points(self, sampler: Any) -> Iterator[dict[str, float]]:
        for point in sampler.points(self.spec):
            yield {k: float(v) for k, v in point.items()}

    def _evaluate_one(self, params: dict[str, float]) -> SweepRow:
        try:
            metrics = dict(self.objective(params))
            return SweepRow(
                parameters=dict(params),
                metrics=metrics,
                error=None,
                parent_sweep_id=self.sweep_id,
            )
        except Exception as exc:  # noqa: BLE001 — sweep continues
            return SweepRow(
                parameters=dict(params),
                metrics={},
                error=f"{type(exc).__name__}: {exc}",
                parent_sweep_id=self.sweep_id,
            )

    def _persist_checkpoint(self) -> None:
        if self.checkpoint_path is None:
            return
        ckpt = SweepCheckpoint(
            sweep_id=self.sweep_id,
            sweep_name=self.spec.name,
            completed=[
                {
                    "parameters": row.parameters,
                    "metrics": row.metrics,
                    "error": row.error,
                }
                for row in self._completed_rows
            ],
        )
        ckpt.save(self.checkpoint_path)


__all__ = ["Objective", "SweepEngine", "SweepReport", "SweepRow"]
