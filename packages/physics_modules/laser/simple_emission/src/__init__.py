"""Spontaneous emission with explicit lifetime — Phase 1D ``candidate`` module."""

from __future__ import annotations

import numpy as np
import pint

from simworkbench.units import Q, magnitude, require_dimensionality


def decay(
    *,
    initial_excited_density: pint.Quantity,
    lifetime: pint.Quantity,
    time_grid: pint.Quantity,
) -> dict[str, pint.Quantity]:
    """Compute excited-state density and photon emission rate on ``time_grid``.

    Returns:
    - ``"excited_density_trajectory"``: n*(t)  [1/m^3]
    - ``"photon_emission_rate"``: n*(t) / tau  [1/(m^3 s)]
    """
    require_dimensionality(initial_excited_density, "1 / [length] ** 3")
    require_dimensionality(lifetime, "[time]")
    require_dimensionality(time_grid, "[time]")

    n0 = magnitude(initial_excited_density, "1 / meter ** 3")
    tau = magnitude(lifetime, "second")
    if tau <= 0:
        raise ValueError("Lifetime must be positive.")
    ts = np.asarray(time_grid.to("second").magnitude, dtype=np.float64)

    n_star = n0 * np.exp(-ts / tau)
    rate = n_star / tau

    return {
        "excited_density_trajectory": Q(n_star, "1 / meter ** 3"),
        "photon_emission_rate": Q(rate, "1 / (meter ** 3 * second)"),
    }


__all__ = ["decay"]
