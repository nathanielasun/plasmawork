"""Phase 1B — Units subsystem tests.

Cover:
- Quantity construction (numeric + units, single string, passthrough).
- Parse-from-string with optional dimensionality check.
- Conversion and magnitude extraction.
- Dimensionality checks.
- Boundary validators (require_units, require_dimensionality).
- Workbench registry exposes the laser-physics units the modules will need.
"""

from __future__ import annotations


import pytest

from simworkbench.units import (
    Q,
    UnitsError,
    check_dimensionality,
    equations_consistent,
    get_registry,
    magnitude,
    parse_quantity,
    require_dimensionality,
    require_units,
    to_unit,
)


# ---------------------------------------------------------------------------
# Quantity construction
# ---------------------------------------------------------------------------

def test_Q_from_numeric_and_units_string():
    q = Q(1.5, "J")
    assert q.magnitude == pytest.approx(1.5)
    assert str(q.units) == "joule"


def test_Q_from_single_string():
    q = Q("248 nm")
    assert q.magnitude == pytest.approx(248)
    assert str(q.units) == "nanometer"


def test_Q_passthrough_returns_workbench_registry_bound_quantity():
    q1 = Q(1.0, "eV")
    q2 = Q(q1)
    assert q2.magnitude == pytest.approx(1.0)
    assert str(q2.units) == "electron_volt"
    # Same registry — comparison should not error.
    assert q1.dimensionality == q2.dimensionality


def test_Q_rejects_quantity_plus_units_string():
    with pytest.raises(UnitsError, match="Cannot pass both"):
        Q(Q(1.0, "J"), "eV")


def test_Q_rejects_unparseable_string():
    with pytest.raises(UnitsError, match="Could not parse"):
        Q("12 quibblefoo")


def test_Q_dimensionless_bare_number_is_allowed():
    q = Q(0.5)
    assert q.dimensionless
    assert q.magnitude == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# Parse + dimensionality checks
# ---------------------------------------------------------------------------

def test_parse_quantity_with_expected_dimensionality():
    q = parse_quantity("1.0e18 1/m^3", expected_dimensionality="1 / [length] ** 3")
    assert q.magnitude == pytest.approx(1.0e18)


def test_parse_quantity_dimensionality_mismatch_raises():
    with pytest.raises(UnitsError, match="Dimensionality mismatch"):
        parse_quantity("248 nm", expected_dimensionality="[time]")


def test_check_dimensionality_passes_for_match():
    check_dimensionality(Q(1.0, "m/s"), "[length] / [time]")


def test_check_dimensionality_raises_for_mismatch():
    with pytest.raises(UnitsError, match="Dimensionality mismatch"):
        check_dimensionality(Q(1.0, "m/s"), "[length]")


# ---------------------------------------------------------------------------
# Conversion + magnitude
# ---------------------------------------------------------------------------

def test_to_unit_converts():
    q = to_unit(Q(1.0, "eV"), "joule")
    # 1 eV = 1.602176634e-19 J
    assert q.magnitude == pytest.approx(1.602176634e-19, rel=1e-6)


def test_to_unit_raises_on_dimensional_mismatch():
    with pytest.raises(UnitsError):
        to_unit(Q(1.0, "eV"), "second")


def test_magnitude_at_boundary():
    # 60 MW peak power expressed in W
    pulse_energy = Q(1.5, "J")
    pulse_duration = Q("25 ns")
    peak_power = pulse_energy / pulse_duration
    assert magnitude(peak_power, "W") == pytest.approx(6.0e7, rel=1e-9)


def test_magnitude_returns_float_for_unit_conversion():
    # Even though Q(1, "MJ") to "J" is 1e6, magnitude() ensures float
    val = magnitude(Q(1, "MJ"), "J")
    assert isinstance(val, float)
    assert val == pytest.approx(1.0e6)


# ---------------------------------------------------------------------------
# Boundary validators
# ---------------------------------------------------------------------------

def test_require_units_accepts_quantity():
    q = require_units(Q(1.0, "eV"))
    assert q.magnitude == pytest.approx(1.0)


def test_require_units_accepts_string():
    q = require_units("1.0 eV")
    assert q.magnitude == pytest.approx(1.0)


def test_require_units_rejects_raw_float():
    with pytest.raises(UnitsError, match="Expected a quantity"):
        require_units(1.5)


def test_require_units_rejects_raw_int():
    with pytest.raises(UnitsError, match="Expected a quantity"):
        require_units(1)


def test_require_units_rejects_dimensionless_quantity_by_default():
    with pytest.raises(UnitsError, match="dimensionless"):
        require_units(Q(0.5))


def test_require_units_allows_dimensionless_when_opted_in():
    q = require_units(Q(0.5), allow_dimensionless=True)
    assert q.dimensionless


def test_require_dimensionality_passes():
    q = require_dimensionality("1.5 J", "[mass] * [length] ** 2 / [time] ** 2")
    assert q.dimensionality == get_registry().get_dimensionality("[energy]")


def test_require_dimensionality_raises_on_mismatch():
    with pytest.raises(UnitsError, match="Dimensionality mismatch"):
        require_dimensionality("1.5 J", "[length]")


# ---------------------------------------------------------------------------
# Equations consistency
# ---------------------------------------------------------------------------

def test_equations_consistent_same_dimensionality():
    assert equations_consistent([Q(1, "J"), Q(2, "eV"), Q(3, "kJ")])


def test_equations_inconsistent_mixed_dimensionality():
    assert not equations_consistent([Q(1, "J"), Q(2, "second")])


def test_equations_consistent_empty_list():
    assert equations_consistent([])


def test_equations_consistent_single_element():
    assert equations_consistent([Q(1, "J")])


# ---------------------------------------------------------------------------
# Workbench registry surface
# ---------------------------------------------------------------------------

def test_registry_understands_laser_physics_units():
    # Smoke test: every unit string we expect to encounter in laser-species
    # ModelSpec YAML must round-trip through Q().
    expected = [
        "1.0e18 1/m^3",
        "1.0e10 W/m^2",
        "5.0e8 V/m",
        "1.5 J",
        "5.0 eV",
        "248 nm",
        "25 ns",
        "1.21e15 Hz",
        "300 K",
        "1.0e6 1/s",
    ]
    for s in expected:
        q = Q(s)
        assert q.magnitude is not None
        assert not q.dimensionless, f"unexpectedly dimensionless: {s}"


def test_registry_alias_W_per_m2_dimensionality():
    # Workbench-defined alias `intensity` should be dimensionally consistent
    # with W/m^2 — i.e. [mass] / [time]**3.
    q = Q(1.0, "W/m^2")
    expected_dim = get_registry().get_dimensionality("[power] / [area]")
    assert q.dimensionality == expected_dim


def test_dimensionless_division():
    # Common case: photon energy ratio is dimensionless, must parse cleanly.
    ratio = Q(2.0, "eV") / Q(1.0, "eV")
    assert ratio.dimensionless
    assert ratio.magnitude == pytest.approx(2.0)


def test_planck_constant_consistency():
    # E = h * nu sanity check using pint constants if available, otherwise
    # using the unit registry's photon-energy alias.
    h_J_s = 6.62607015e-34  # exact post-2019 SI
    nu = Q(1.21e15, "Hz")  # ~248 nm photon
    energy = (h_J_s * nu.magnitude) * get_registry().joule
    assert magnitude(energy, "eV") == pytest.approx(5.0, rel=5e-2)
