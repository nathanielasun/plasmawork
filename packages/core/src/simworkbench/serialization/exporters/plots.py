"""Phase 2C — Plot exporter.

Re-renders line plots from the capsule's ``results/diagnostics.h5`` (or the
JSON sidecar fallback) and writes PNG/SVG files under the target. Uses the
Phase 1E line plotter so output is identical to what the UI's PlotPanel
shows in steering mode.
"""

from __future__ import annotations

import json
from pathlib import Path

from simworkbench.diagnostics.plotters import line_plot
from simworkbench.paths import is_under_workbench
from simworkbench.serialization.bulk_data import read_diagnostics_h5


def export_plots(
    capsule_dir: str | Path,
    target: str | Path,
    *,
    require_workbench_target: bool = True,
) -> tuple[Path, ...]:
    """Render one PNG + one SVG per non-time diagnostic series.

    Looks for ``results/diagnostics.h5`` first; falls back to
    ``results/diagnostics.json``. Returns the produced file paths.
    """
    h5_path = Path(capsule_dir) / "results" / "diagnostics.h5"
    json_path = Path(capsule_dir) / "results" / "diagnostics.json"

    if h5_path.is_file():
        diagnostics, _metadata = read_diagnostics_h5(h5_path)
        diagnostics = {k: list(v) for k, v in diagnostics.items()}
    elif json_path.is_file():
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        diagnostics = payload.get("diagnostics", {})
    else:
        raise FileNotFoundError(
            f"No results/diagnostics.{{h5,json}} under {capsule_dir}; nothing to plot."
        )

    out_root = Path(target) / "results" / "plots"
    if require_workbench_target and not is_under_workbench(out_root):
        raise PermissionError(
            f"Refusing to write plots outside workbench-managed roots: {out_root}"
        )
    out_root.mkdir(parents=True, exist_ok=True)

    times = diagnostics.get("time_seconds")
    if times is None:
        raise ValueError(
            "Capsule diagnostics carry no time_seconds series — Phase 2C plots "
            "expect a time axis from the runner. Add a time series to the "
            "diagnostics or extend the plotter for spatial-only data."
        )

    written: list[Path] = []
    for name, series in diagnostics.items():
        if name == "time_seconds":
            continue
        fig = line_plot(
            times,
            {name: series},
            x_label="time (s)",
            y_label=name,
            title=name,
        )
        png = out_root / f"{name}.png"
        svg = out_root / f"{name}.svg"
        fig.savefig(png, dpi=120)
        fig.savefig(svg)
        # Close so headless matplotlib doesn't accumulate figures.
        import matplotlib.pyplot as plt

        plt.close(fig)
        written.extend([png, svg])

    return tuple(written)


__all__ = ["export_plots"]
