"""Lambert-Beer absorption — Phase 7 ``validated`` module.

I(z) = I0 * exp(-alpha * z), assuming a homogeneous absorbing medium
with linear absorption (no saturation, no dispersion).

The function signatures take and return unit-aware quantities so
callers cannot accidentally mix W/m^2 with W/cm^2 or 1/m with 1/cm.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


@dataclass(frozen=True)
class LambertBeerAbsorber:
    """Absorbing medium with constant ``absorption_coefficient`` (alpha).

    ``incident_intensity`` is I0 in W/m^2; ``absorption_coefficient`` is
    alpha in 1/m. ``path_length`` is supplied per-call to
    ``transmitted_intensity`` and ``transmission``.
    """

    incident_intensity: pint.Quantity
    absorption_coefficient: pint.Quantity

    def __post_init__(self) -> None:
        require_dimensionality(
            self.incident_intensity, "[mass] / [time] ** 3"
        )  # power per area
        require_dimensionality(self.absorption_coefficient, "1 / [length]")
        if magnitude(self.incident_intensity, "watt / meter ** 2") < 0:
            raise ValueError(
                "Lambert-Beer requires non-negative incident intensity."
            )
        if magnitude(self.absorption_coefficient, "1 / meter") < 0:
            raise ValueError(
                "Lambert-Beer requires non-negative absorption coefficient."
            )

    def transmission(self, path_length: pint.Quantity | str) -> float:
        """Return T(z) = I(z) / I0 as a dimensionless float."""
        z = self._z_meters(path_length)
        alpha = magnitude(self.absorption_coefficient, "1 / meter")
        return math.exp(-alpha * z)

    def transmitted_intensity(self, path_length: pint.Quantity | str) -> pint.Quantity:
        """Return I(z) as a unit-aware quantity in W/m^2."""
        I0 = magnitude(self.incident_intensity, "watt / meter ** 2")
        return Q(I0 * self.transmission(path_length), "watt / meter ** 2")

    def path_length_for_transmission(
        self, target_transmission: float
    ) -> pint.Quantity:
        """Return the path length z such that I(z) / I0 == ``target_transmission``.

        Raises ``ValueError`` for non-physical targets (<= 0 or > 1) or
        when alpha is zero (any path length yields full transmission).
        """
        if not (0 < target_transmission <= 1):
            raise ValueError(
                "target_transmission must satisfy 0 < T <= 1; "
                f"got {target_transmission!r}."
            )
        alpha = magnitude(self.absorption_coefficient, "1 / meter")
        if alpha == 0:
            raise ValueError(
                "absorption_coefficient is zero; any path length "
                "transmits 100%."
            )
        return Q(-math.log(target_transmission) / alpha, "meter")

    @staticmethod
    def _z_meters(path_length: pint.Quantity | str) -> float:
        z = magnitude(Q(path_length), "meter")
        if z < 0:
            raise ValueError("Lambert-Beer requires non-negative path length.")
        return z


__all__ = ["LambertBeerAbsorber"]
