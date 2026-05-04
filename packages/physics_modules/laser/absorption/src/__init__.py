"""Linear absorption helper module."""

from __future__ import annotations

import math

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def absorption_coefficient(
    cross_section: pint.Quantity,
    absorber_density: pint.Quantity,
) -> pint.Quantity:
    """Return alpha = sigma * n in 1/m."""
    require_dimensionality(cross_section, "[length] ** 2")
    require_dimensionality(absorber_density, "1 / [length] ** 3")
    sigma = magnitude(cross_section, "meter ** 2")
    density = magnitude(absorber_density, "1 / meter ** 3")
    if sigma < 0 or density < 0:
        raise ValueError("cross_section and absorber_density must be non-negative.")
    return Q(sigma * density, "1 / meter")


def transmitted_intensity(
    incident_intensity: pint.Quantity,
    cross_section: pint.Quantity,
    absorber_density: pint.Quantity,
    path_length: pint.Quantity,
) -> pint.Quantity:
    """Return Lambert-Beer transmitted intensity for caller-supplied data."""
    require_dimensionality(incident_intensity, "[mass] / [time] ** 3")
    require_dimensionality(path_length, "[length]")
    i0 = magnitude(incident_intensity, "watt / meter ** 2")
    z = magnitude(path_length, "meter")
    if i0 < 0 or z < 0:
        raise ValueError("incident_intensity and path_length must be non-negative.")
    alpha = magnitude(absorption_coefficient(cross_section, absorber_density), "1 / meter")
    return Q(i0 * math.exp(-alpha * z), "watt / meter ** 2")


__all__ = ["absorption_coefficient", "transmitted_intensity"]
