"""Workbench unit registry.

Wraps a `pint.UnitRegistry` configured for the laser-physics / plasma-kinetics
domain the workbench targets. The registry instance is module-level so all
workbench code shares one set of unit definitions and conversions.

Per ADR-0004, `pint` is the implementation; `simworkbench.units` is the public
API. Code outside this package should import `Q` and helpers from
`simworkbench.units`, not from this module directly.
"""

from __future__ import annotations

from functools import lru_cache

import pint


@lru_cache(maxsize=1)
def get_registry() -> pint.UnitRegistry:
    """Return the workbench's `pint.UnitRegistry`, building it on first call.

    The registry is lazy-initialized so importing `simworkbench.units` is cheap
    and so test code can patch it before first use if needed.
    """
    return _build_registry()


def _build_registry() -> pint.UnitRegistry:
    """Construct a pint registry with workbench-specific definitions."""
    registry = pint.UnitRegistry()

    # `pint` already knows electron_volt, joule, watt, meter, second, etc.
    # We add a small set of workbench-relevant aliases and check that the
    # constants the laser-physics modules will need are present.
    #
    # Aliases below are conservative — adding more should be done with an ADR
    # since they affect every capsule's `provenance.lock` unit definitions.
    registry.define("photon_energy = electron_volt = ph_eV")  # alias for clarity in laser code
    registry.define("number_density = 1 / meter**3 = n_density")
    registry.define("intensity = watt / meter**2 = W_per_m2")

    # Sanity probe: ensure the registry parses the units the workbench needs
    # before any caller hits a dimensional error in unrelated code.
    _required_unit_strings = (
        "1/m^3",
        "W/m^2",
        "V/m",
        "J",
        "eV",
        "nm",
        "ps",
        "Hz",
        "K",
    )
    for s in _required_unit_strings:
        registry.parse_expression(f"1.0 {s}")

    return registry


__all__ = ["get_registry"]
