"""Phase 10 / 10B — Autonomous smoke runs.

Drives the existing ``simworkbench.runtime.Runner`` for a short
exploratory pass, then interprets the diagnostics to decide whether
the run is healthy. Hard rules:

  - The runner does NOT silently retry; it reports.
  - Suggested parameter adjustments are markdown text, never auto-
    applied. Plan §16.1 + §22.
  - Numeric instability (NaN, +/-inf, monotonic blow-up) is a
    first-class report field, not a generic exception.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from simworkbench.experiment import Experiment
from simworkbench.runtime.runner import Runner


@dataclass
class SmokeReport:
    """Output of one autonomous smoke run.

    Plan-named fields:
      - diagnostics_interpretation: short summary per diagnostic key.
      - instability_flags: list of detected instabilities (NaN, blow-up,
        conservation drift). Empty list = healthy run.
      - suggested_param_adjustments: markdown bullets the user can read
        and decide whether to apply. The agent never auto-applies.
      - review_markdown: human-readable narrative summary.
    """

    diagnostics_interpretation: dict[str, str] = field(default_factory=dict)
    instability_flags: list[str] = field(default_factory=list)
    suggested_param_adjustments: list[str] = field(default_factory=list)
    review_markdown: str = ""


class SmokeRunner:
    """Run a small exploratory simulation and interpret the result."""

    def run(
        self,
        experiment: Experiment,
        *,
        _force_synthetic_diagnostics: dict[str, Sequence[Any]] | None = None,
    ) -> SmokeReport:
        """Execute a smoke run and return a report.

        ``_force_synthetic_diagnostics`` is a TEST-ONLY hook that
        bypasses the actual runtime to inject a known diagnostic
        trajectory (e.g. a deliberately unstable one). Production
        callers leave it ``None``. The leading underscore signals the
        contract: it must not appear in any non-test call site, and
        is intentionally absent from the public docstring example.
        """
        diagnostics: dict[str, Any] = {}
        if _force_synthetic_diagnostics is not None:
            diagnostics = {k: list(v) for k, v in _force_synthetic_diagnostics.items()}
        else:
            runner = Runner(experiment)
            try:
                result = runner.run()
                diagnostics = dict(result.diagnostics)
            except Exception as exc:  # noqa: BLE001 — smoke runs report, never raise
                report = SmokeReport(
                    instability_flags=[
                        f"runtime error: {type(exc).__name__}: {exc}"
                    ],
                )
                report.review_markdown = self._compose_markdown(report)
                return report

        report = SmokeReport()
        for key, series in diagnostics.items():
            interpretation, flags = self._interpret_series(key, series)
            report.diagnostics_interpretation[key] = interpretation
            report.instability_flags.extend(flags)

        if report.instability_flags:
            report.suggested_param_adjustments = (
                self._suggest_adjustments(report.instability_flags)
            )

        report.review_markdown = self._compose_markdown(report)
        return report

    @staticmethod
    def _interpret_series(
        name: str, series: Any
    ) -> tuple[str, list[str]]:
        flags: list[str] = []
        try:
            values = [float(v) for v in series]
        except (TypeError, ValueError):
            return (
                f"{name}: non-numeric series; cannot interpret.",
                [f"{name}: non-numeric diagnostic"],
            )
        if not values:
            return f"{name}: empty series.", []

        # NaN / inf detection.
        bad = [v for v in values if math.isnan(v) or math.isinf(v)]
        if bad:
            flags.append(f"{name}: NaN / inf in trajectory")

        # Monotonic blow-up (each step at least 10x the previous, three
        # times in a row → almost certainly a numerical blowup).
        runaway = 0
        for prev, cur in zip(values, values[1:], strict=False):
            if (
                math.isfinite(prev)
                and math.isfinite(cur)
                and abs(prev) > 0
                and abs(cur) >= 10.0 * abs(prev)
            ):
                runaway += 1
            else:
                runaway = 0
            if runaway >= 2:
                flags.append(f"{name}: monotonic blow-up (10× per step)")
                break

        # Healthy summary.
        finite = [v for v in values if math.isfinite(v)]
        if finite:
            summary = (
                f"{name}: min={min(finite):.3g}, max={max(finite):.3g}, "
                f"final={finite[-1]:.3g} (n={len(values)})"
            )
        else:
            summary = f"{name}: no finite values."
        return summary, flags

    @staticmethod
    def _suggest_adjustments(flags: Sequence[str]) -> list[str]:
        suggestions: list[str] = []
        seen: set[str] = set()
        for flag in flags:
            if "blow-up" in flag and "halve_dt" not in seen:
                suggestions.append(
                    "Reduce timestep: try `dt = dt / 2` and re-run; if "
                    "still unstable, drop to `dt / 4`."
                )
                seen.add("halve_dt")
            if "NaN" in flag and "guard_division" not in seen:
                suggestions.append(
                    "Audit divisions and `log` calls in the rate "
                    "expressions — NaN typically traces to a 0/0 or "
                    "log(0). Add positivity floors at the boundary."
                )
                seen.add("guard_division")
            if "non-numeric" in flag and "schema_check" not in seen:
                suggestions.append(
                    "Diagnostic key returned a non-numeric series; "
                    "check the diagnostic's `compute(state)` return "
                    "type matches the declared output schema."
                )
                seen.add("schema_check")
        if not suggestions and flags:
            suggestions.append(
                "Detected instability that doesn't match a known "
                "remediation pattern; rerun with verbose diagnostics "
                "and inspect the per-step trace."
            )
        return suggestions

    @staticmethod
    def _compose_markdown(report: SmokeReport) -> str:
        lines = ["# Smoke Run Review", ""]
        if report.instability_flags:
            lines.append("## Instability flags")
            for flag in report.instability_flags:
                lines.append(f"- {flag}")
            lines.append("")
        else:
            lines.append("## Status: healthy")
            lines.append("No instability detected in the smoke trajectory.")
            lines.append("")
        if report.diagnostics_interpretation:
            lines.append("## Diagnostics summary")
            for key, summary in report.diagnostics_interpretation.items():
                lines.append(f"- **{key}** — {summary}")
            lines.append("")
        if report.suggested_param_adjustments:
            lines.append("## Suggested parameter adjustments (REVIEW BEFORE APPLYING)")
            for s in report.suggested_param_adjustments:
                lines.append(f"- {s}")
            lines.append("")
        return "\n".join(lines)


__all__ = ["SmokeReport", "SmokeRunner"]
