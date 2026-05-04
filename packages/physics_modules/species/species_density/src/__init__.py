"""Species-density conversion helpers."""

from __future__ import annotations

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def uniform_density(particle_count: float, volume: pint.Quantity) -> pint.Quantity:
    """Return n = N / V as a number density."""
    require_dimensionality(volume, "[length] ** 3")
    volume_m3 = magnitude(volume, "meter ** 3")
    if particle_count < 0 or volume_m3 <= 0:
        raise ValueError("particle_count must be non-negative and volume positive.")
    return Q(float(particle_count) / volume_m3, "1 / meter ** 3")


def total_particles(density: pint.Quantity, volume: pint.Quantity) -> float:
    """Return N = n V as a dimensionless count."""
    require_dimensionality(density, "1 / [length] ** 3")
    require_dimensionality(volume, "[length] ** 3")
    density_m3 = magnitude(density, "1 / meter ** 3")
    volume_m3 = magnitude(volume, "meter ** 3")
    if density_m3 < 0 or volume_m3 < 0:
        raise ValueError("density and volume must be non-negative.")
    return float(density_m3 * volume_m3)


__all__ = ["total_particles", "uniform_density"]
