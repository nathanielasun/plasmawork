"""Particle scatter / phase-space helper — Phase 1E.

Used for MD particle positions and phase-space (x, v) projections.
"""

from __future__ import annotations

from typing import Any

import matplotlib.pyplot as plt
import numpy as np


def particle_scatter(
    positions: np.ndarray,
    *,
    velocities: np.ndarray | None = None,
    x_label: str = "x",
    y_label: str = "y",
    title: str | None = None,
    box_extent: tuple[float, float] | None = None,
) -> Any:
    """Render particle positions; optionally overlay velocity arrows.

    ``positions`` shape ``(N, 2)``. ``velocities`` if given is ``(N, 2)`` and
    overlaid as quivers. Returns the matplotlib Figure.
    """
    pos = np.asarray(positions, dtype=np.float64)
    if pos.ndim != 2 or pos.shape[1] != 2:
        raise ValueError(f"particle_scatter requires (N, 2) positions; got {pos.shape}.")

    fig, ax = plt.subplots(figsize=(5.0, 5.0))
    ax.scatter(pos[:, 0], pos[:, 1], s=24, alpha=0.7, edgecolors="black", linewidths=0.4)
    if velocities is not None:
        v = np.asarray(velocities, dtype=np.float64)
        if v.shape != pos.shape:
            raise ValueError(
                f"velocities shape {v.shape} must match positions shape {pos.shape}."
            )
        # Use a coarse arrow scale so the visualization stays readable.
        scale = float(np.linalg.norm(pos.max(axis=0) - pos.min(axis=0)) / 10.0) or 1.0
        ax.quiver(
            pos[:, 0], pos[:, 1], v[:, 0], v[:, 1],
            angles="xy", scale_units="xy", scale=scale,
            width=0.003, alpha=0.6,
        )
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)
    if title:
        ax.set_title(title)
    if box_extent is not None:
        ax.set_xlim(0, box_extent[0])
        ax.set_ylim(0, box_extent[1])
    ax.set_aspect("equal", adjustable="box")
    fig.tight_layout()
    return fig


__all__ = ["particle_scatter"]
