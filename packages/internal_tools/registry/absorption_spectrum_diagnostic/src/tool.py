"""Phase 3B example tool — absorption-spectrum peak finder.

Reference implementation cited by plan §9.4. Used by the registry
integration test as the canonical "tool that exists, validates, runs,
and returns a structured ToolOutput".
"""

from __future__ import annotations

import numpy as np
from simworkbench.tools import BaseTool, ToolInput, ToolOutput
from simworkbench.units import magnitude


class AbsorptionSpectrumDiagnostic(BaseTool):
    """Find local maxima in an intensity-vs-frequency spectrum."""

    name = "absorption_spectrum_diagnostic"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("frequency", units="Hz")
        inputs.require_array("intensity")

    def run(self, inputs: ToolInput) -> ToolOutput:
        freq = magnitude(inputs["frequency"], "Hz")
        intensity = np.asarray(inputs["intensity"].magnitude, dtype=float)
        if freq.ndim != 1 or intensity.ndim != 1:
            raise ValueError(
                "absorption_spectrum_diagnostic requires 1-D frequency and intensity"
            )
        if freq.shape != intensity.shape:
            raise ValueError(
                f"frequency.shape={freq.shape} != intensity.shape={intensity.shape}"
            )

        # Local-maximum finder: index i is a peak iff intensity[i] is strictly
        # greater than both neighbors. Endpoints are excluded — peaks at the
        # boundary are not well-defined for a discrete spectrum.
        peak_idx = []
        for i in range(1, intensity.size - 1):
            if intensity[i] > intensity[i - 1] and intensity[i] > intensity[i + 1]:
                peak_idx.append(i)

        peaks = [
            {"frequency_hz": float(freq[i]), "intensity": float(intensity[i])}
            for i in peak_idx
        ]
        return ToolOutput(
            {
                "peaks": peaks,
                "peak_count": len(peaks),
            }
        )


__all__ = ["AbsorptionSpectrumDiagnostic"]
