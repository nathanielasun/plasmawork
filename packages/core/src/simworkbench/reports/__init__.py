"""Phase 9 / 9D — Comparative experiment reports.

Public API::

    from simworkbench.reports import ComparisonReport

The reporter consumes a ``SweepReport`` (from
``simworkbench.sweep``) plus a target metric and produces:

  - ``manifest.json`` — machine-readable ranking + per-run metrics.
  - ``report.md``    — human-readable Markdown summary with a
    ranking table and best-of-set callouts.

Plan §Phase 9 / 9D bullets:
  - Compare model variants / solver variants / backend performance /
    validation metrics — all cases reduce to "rank a set of runs by
    one metric"; the reporter is metric-agnostic.
  - Produce ranked summaries — ``ComparisonReport.rank()`` returns
    the ordered list.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover — type-check only
    from simworkbench.sweep import SweepReport, SweepRow


@dataclass
class ComparisonReport:
    """One comparison: rank ``SweepReport`` rows by ``metric``."""

    metric: str
    lower_is_better: bool = True
    title: str = "Comparison Report"

    def rank(self, sweep_report: SweepReport) -> list[SweepRow]:
        """Return the report's runs ordered by ``metric``."""
        completed = [r for r in sweep_report.runs if r.error is None]
        # Drop runs missing the metric.
        valid = [r for r in completed if self.metric in r.metrics]
        return sorted(
            valid,
            key=lambda r: float(r.metrics[self.metric]),
            reverse=not self.lower_is_better,
        )

    def write(
        self,
        sweep_report: SweepReport,
        target: str | Path,
    ) -> dict[str, Path]:
        """Write ``manifest.json`` + ``report.md`` under ``target``.
        Returns the paths."""
        out = Path(target)
        out.mkdir(parents=True, exist_ok=True)
        ranked = self.rank(sweep_report)

        manifest: dict[str, Any] = {
            "title": self.title,
            "sweep_id": sweep_report.sweep_id,
            "spec_name": sweep_report.spec_name,
            "metric": self.metric,
            "lower_is_better": self.lower_is_better,
            "n_completed": len(sweep_report.completed),
            "n_failed": len(sweep_report.failed),
            "stopped_reason": sweep_report.stopped_reason,
            "ranking": [
                {
                    "rank": i + 1,
                    "parameters": r.parameters,
                    "metrics": r.metrics,
                }
                for i, r in enumerate(ranked)
            ],
        }
        manifest_path = out / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

        # Markdown summary.
        body = self._render_markdown(sweep_report, ranked)
        report_path = out / "report.md"
        report_path.write_text(body, encoding="utf-8")

        return {"manifest": manifest_path, "report": report_path}

    def _render_markdown(
        self,
        sweep_report: SweepReport,
        ranked: list[SweepRow],
    ) -> str:
        direction = "lower is better" if self.lower_is_better else "higher is better"
        lines = [
            f"# {self.title}",
            "",
            f"- Sweep: `{sweep_report.spec_name}` (id `{sweep_report.sweep_id}`)",
            f"- Metric: `{self.metric}` ({direction})",
            f"- Completed: {len(sweep_report.completed)}",
            f"- Failed: {len(sweep_report.failed)}",
            f"- Stopped reason: `{sweep_report.stopped_reason}`",
            "",
            "## Ranking",
            "",
        ]
        if not ranked:
            lines.append("_No runs completed with the target metric._")
            return "\n".join(lines) + "\n"

        # Build the table dynamically — every parameter + metric.
        param_keys = sorted(ranked[0].parameters.keys())
        metric_keys = sorted({self.metric, *ranked[0].metrics.keys()})
        headers = ["Rank", *param_keys, *metric_keys]
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("|" + "|".join("---" for _ in headers) + "|")
        for i, row in enumerate(ranked):
            cells: list[str] = [str(i + 1)]
            for p in param_keys:
                cells.append(f"{row.parameters.get(p, ''):.6g}")
            for m in metric_keys:
                v = row.metrics.get(m, "")
                cells.append(f"{v:.6g}" if isinstance(v, (int, float)) else str(v))
            lines.append("| " + " | ".join(cells) + " |")

        # Best callout.
        best = ranked[0]
        lines.append("")
        lines.append("## Best run")
        lines.append("")
        lines.append(f"- Parameters: `{best.parameters}`")
        lines.append(f"- Metric (`{self.metric}`): `{best.metrics[self.metric]}`")
        return "\n".join(lines) + "\n"


__all__ = ["ComparisonReport"]
