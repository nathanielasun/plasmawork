"""Heatmap helper — Phase 1E.

Used for 2D field visualizations (e.g. Ising spin lattices, density fields).
"""

from __future__ import annotations

from typing import Any

import matplotlib.pyplot as plt
import numpy as np


def heatmap(
    field: np.ndarray,
    *,
    x_label: str = "x",
    y_label: str = "y",
    title: str | None = None,
    colormap: str = "viridis",
    colorbar_label: str | None = None,
    vmin: float | None = None,
    vmax: float | None = None,
) -> Any:
    """Render a 2D scalar field as a heatmap. Returns the matplotlib Figure."""
    arr = np.asarray(field, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError(f"heatmap requires a 2D array; got shape {arr.shape}.")
    fig, ax = plt.subplots(figsize=(5.0, 4.5))
    im = ax.imshow(
        arr, origin="lower", cmap=colormap, aspect="auto", vmin=vmin, vmax=vmax
    )
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)
    if title:
        ax.set_title(title)
    cbar = fig.colorbar(im, ax=ax)
    if colorbar_label:
        cbar.set_label(colorbar_label)
    fig.tight_layout()
    return fig


__all__ = ["heatmap"]
