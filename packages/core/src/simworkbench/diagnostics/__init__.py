"""Phase 1E — Diagnostics API + statistics + streams + plotters.

Public API for collecting and visualizing simulation observations.
"""

from __future__ import annotations

from .api import Diagnostic, DiagnosticCollector
from .plotters import heatmap, line_plot, particle_scatter
from .statistics import (
    Summary,
    conservation_error,
    histogram,
    relative_drift,
    summarize,
)
from .streams import DiagnosticStream

__all__ = [
    "Diagnostic",
    "DiagnosticCollector",
    "DiagnosticStream",
    "Summary",
    "conservation_error",
    "heatmap",
    "histogram",
    "line_plot",
    "particle_scatter",
    "relative_drift",
    "summarize",
]
