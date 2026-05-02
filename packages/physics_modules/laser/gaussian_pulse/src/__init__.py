"""Gaussian temporal laser pulse — Phase 1D ``candidate`` module.

I(t) = I0 * exp(-((t - t0)^2) / (2 sigma^2)), with sigma = FWHM / (2 sqrt(2 ln 2)).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pint

from simworkbench.units import Q, magnitude, require_dimensionality


@dataclass(frozen=True)
class GaussianPulse:
    """Transform-limited Gaussian temporal laser pulse.

    Inputs at construction are unit-aware. Internal storage is normalized to
    SI base units (W/m^2, s).
    """

    peak_intensity: pint.Quantity
    center_time: pint.Quantity
    fwhm_duration: pint.Quantity

    def __post_init__(self) -> None:
        require_dimensionality(self.peak_intensity, "[mass] / [time] ** 3")  # power per area
        require_dimensionality(self.center_time, "[time]")
        require_dimensionality(self.fwhm_duration, "[time]")
        if magnitude(self.fwhm_duration, "second") <= 0:
            raise ValueError("Gaussian pulse FWHM must be positive.")

    @property
    def sigma_seconds(self) -> float:
        return magnitude(self.fwhm_duration, "second") / (2.0 * math.sqrt(2.0 * math.log(2.0)))

    def intensity_at(self, t: pint.Quantity | str) -> pint.Quantity:
        """Return I(t) as a unit-aware quantity in W/m^2."""
        t_s = magnitude(Q(t), "second")
        t0_s = magnitude(self.center_time, "second")
        I0 = magnitude(self.peak_intensity, "watt / meter ** 2")
        sigma = self.sigma_seconds
        intensity = I0 * math.exp(-((t_s - t0_s) ** 2) / (2.0 * sigma**2))
        return Q(intensity, "watt / meter ** 2")

    def fluence(self) -> pint.Quantity:
        """Total fluence under the pulse: integral of I(t) dt = I0 * sigma * sqrt(2*pi)."""
        I0 = magnitude(self.peak_intensity, "watt / meter ** 2")
        return Q(I0 * self.sigma_seconds * math.sqrt(2.0 * math.pi), "joule / meter ** 2")


__all__ = ["GaussianPulse"]
