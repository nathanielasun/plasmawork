"""Electron-temperature conversion helpers."""

from __future__ import annotations

import pint
from simworkbench.units import Q, magnitude, require_dimensionality

K_B = 1.380649e-23


def temperature_from_mean_energy(mean_energy: pint.Quantity) -> pint.Quantity:
    """Return T_e = 2 <E> / (3 k_B)."""
    require_dimensionality(mean_energy, "[energy]")
    energy = magnitude(mean_energy, "joule")
    if energy < 0:
        raise ValueError("mean_energy must be non-negative.")
    return Q(2.0 * energy / (3.0 * K_B), "kelvin")


def mean_energy_from_temperature(temperature: pint.Quantity) -> pint.Quantity:
    """Return <E> = 3 k_B T_e / 2."""
    require_dimensionality(temperature, "[temperature]")
    temp = magnitude(temperature, "kelvin")
    if temp < 0:
        raise ValueError("temperature must be non-negative.")
    return Q(1.5 * K_B * temp, "joule")


__all__ = ["K_B", "mean_energy_from_temperature", "temperature_from_mean_energy"]
