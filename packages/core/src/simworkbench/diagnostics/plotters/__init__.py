"""Plotters — Phase 1E.

Steering-lane plots (per plan §12.3): designed to look at a running or
just-finished simulation, not for publication. Publication-quality
plotters land later. All plotters use the matplotlib Agg backend so
headless CI doesn't need a display server.
"""

from __future__ import annotations

import matplotlib

# Force headless backend before pyplot is imported anywhere downstream.
matplotlib.use("Agg")  # noqa: E402

from .heatmap import heatmap  # noqa: E402
from .line import line_plot  # noqa: E402
from .particle_scatter import particle_scatter  # noqa: E402

__all__ = ["heatmap", "line_plot", "particle_scatter"]
