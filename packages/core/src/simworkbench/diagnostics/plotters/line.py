"""Line-plot helper — Phase 1E."""

from __future__ import annotations

from typing import Any

import matplotlib.pyplot as plt
import numpy as np


def line_plot(
    times: np.ndarray | list[float],
    series: dict[str, np.ndarray | list[float]],
    *,
    x_label: str = "time (s)",
    y_label: str = "value",
    title: str | None = None,
    yscale: str = "linear",
) -> Any:
    """Render multiple time series on a single Axes.

    Returns the matplotlib ``Figure`` so callers can save / inspect / embed it.
    Steering-quality only — publication plotters live elsewhere.
    """
    fig, ax = plt.subplots(figsize=(7.0, 4.0))
    t = np.asarray(times, dtype=np.float64)
    for name, ys in series.items():
        ax.plot(t, np.asarray(ys, dtype=np.float64), label=name)
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)
    if title:
        ax.set_title(title)
    if yscale != "linear":
        ax.set_yscale(yscale)
    if series:
        ax.legend(loc="best", fontsize=9)
    fig.tight_layout()
    return fig


__all__ = ["line_plot"]
