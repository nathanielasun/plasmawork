"""Phase 7C collisional-model interface — candidate.

Coulomb collision frequency for a Maxwellian plasma:
    nu_ei ~ n_e * Lambda / T_e^(3/2)
The full numerical model awaits Phase 8.
"""

from __future__ import annotations

import math

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def coulomb_log(*, electron_density: pint.Quantity, electron_temperature: pint.Quantity) -> float:
    """Estimate the Coulomb logarithm for an electron-ion plasma.

    ``ln Lambda ~ 23 - ln(n_e^{1/2} T_e^{-3/2})`` for T_e >= 10 eV
    (NRL Plasma Formulary, electron-ion). Returns the dimensionless
    Coulomb log clipped to [1, 30].
    """
    require_dimensionality(electron_density, "1 / [length] ** 3")
    require_dimensionality(electron_temperature, "[temperature]")
    n = magnitude(electron_density, "1 / centimeter ** 3")
    T_eV = magnitude(electron_temperature, "kelvin") / 11604.518
    if n <= 0 or T_eV <= 0:
        raise ValueError("Electron density and temperature must be positive.")
    raw = 23.0 - math.log(n**0.5 * T_eV ** (-1.5))
    return max(1.0, min(30.0, raw))


def collision_frequency(
    *,
    electron_density: pint.Quantity,
    electron_temperature: pint.Quantity,
    ion_charge: int = 1,
) -> pint.Quantity:
    """Order-of-magnitude electron-ion collision frequency.

    nu_ei ~ 2.91e-6 * Z * n_e * Lambda / T_e^{1.5} [cgs Hz, Z=1]
    (NRL Plasma Formulary). Returned as a unit-aware quantity in 1/s.
    """
    Lambda = coulomb_log(
        electron_density=electron_density,
        electron_temperature=electron_temperature,
    )
    n_e = magnitude(electron_density, "1 / centimeter ** 3")
    T_eV = magnitude(electron_temperature, "kelvin") / 11604.518
    nu_hz = 2.91e-6 * ion_charge * n_e * Lambda / (T_eV**1.5)
    return Q(nu_hz, "1 / second")


__all__ = ["collision_frequency", "coulomb_log"]
