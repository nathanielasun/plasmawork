"""Spontaneous-emission helpers."""

from __future__ import annotations

import math

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def emission_rate(excited_density: pint.Quantity, lifetime: pint.Quantity) -> pint.Quantity:
    """Return photon emission rate density N*/tau."""
    require_dimensionality(excited_density, "1 / [length] ** 3")
    require_dimensionality(lifetime, "[time]")
    density = magnitude(excited_density, "1 / meter ** 3")
    tau = magnitude(lifetime, "second")
    if density < 0 or tau <= 0:
        raise ValueError("excited_density must be non-negative and lifetime positive.")
    return Q(density / tau, "1 / (meter ** 3 * second)")


def excited_density_after_time(
    initial_excited_density: pint.Quantity,
    lifetime: pint.Quantity,
    time: pint.Quantity,
) -> pint.Quantity:
    """Return N*(t) = N*(0) exp(-t/tau)."""
    require_dimensionality(time, "[time]")
    n0 = magnitude(initial_excited_density, "1 / meter ** 3")
    tau = magnitude(lifetime, "second")
    t = magnitude(time, "second")
    if n0 < 0 or tau <= 0 or t < 0:
        raise ValueError("density/time inputs must be non-negative and lifetime positive.")
    return Q(n0 * math.exp(-t / tau), "1 / meter ** 3")


__all__ = ["emission_rate", "excited_density_after_time"]
