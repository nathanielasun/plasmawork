"""Basic species wrapper — Phase 1D ``candidate`` module."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import pint
from simworkbench.units import Q, require_dimensionality

SpeciesKind = Literal["atom", "ion", "molecule", "electron", "photon", "quasi_particle"]

# Electron rest mass in SI.
_ELECTRON_MASS_SI = 9.1093837015e-31  # kg


@dataclass(frozen=True)
class BasicSpecies:
    """A species participant in a 0D rate-equation or kinetic model."""

    name: str
    kind: SpeciesKind
    mass: pint.Quantity
    charge: float  # multiples of the elementary charge
    initial_density: pint.Quantity

    def __post_init__(self) -> None:
        require_dimensionality(self.mass, "[mass]")
        require_dimensionality(self.initial_density, "1 / [length] ** 3")
        if self.charge != int(self.charge):
            raise ValueError(
                f"BasicSpecies charge must be integer (multiples of e); got {self.charge!r}."
            )


def atom(name: str, mass: pint.Quantity, initial_density: pint.Quantity) -> BasicSpecies:
    return BasicSpecies(
        name=name, kind="atom", mass=mass, charge=0.0, initial_density=initial_density
    )


def ion(
    name: str, mass: pint.Quantity, charge: int, initial_density: pint.Quantity
) -> BasicSpecies:
    if charge == 0:
        raise ValueError("Ion charge must be non-zero; use atom() for neutrals.")
    return BasicSpecies(
        name=name,
        kind="ion",
        mass=mass,
        charge=float(charge),
        initial_density=initial_density,
    )


def electron(initial_density: pint.Quantity) -> BasicSpecies:
    return BasicSpecies(
        name="e-",
        kind="electron",
        mass=Q(_ELECTRON_MASS_SI, "kilogram"),
        charge=-1.0,
        initial_density=initial_density,
    )


__all__ = ["BasicSpecies", "atom", "electron", "ion"]
