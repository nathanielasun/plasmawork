"""Lambert-Beer unit tests."""

from __future__ import annotations

import math

import pytest
from simworkbench.units import Q

from ..src import LambertBeerAbsorber


def test_transmission_unity_at_zero_path_length():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0, "watt / meter ** 2"),
        absorption_coefficient=Q(50.0, "1 / meter"),
    )
    assert a.transmission(Q(0.0, "meter")) == 1.0


def test_transmission_e_at_optical_depth_one():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0, "watt / meter ** 2"),
        absorption_coefficient=Q(100.0, "1 / meter"),
    )
    assert a.transmission(Q(1e-2, "meter")) == pytest.approx(math.exp(-1.0), rel=1e-12)


def test_transmitted_intensity_units():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0e10, "watt / meter ** 2"),
        absorption_coefficient=Q(50.0, "1 / meter"),
    )
    out = a.transmitted_intensity(Q(1e-2, "meter"))
    assert out.units == Q(1.0, "watt / meter ** 2").units


def test_path_length_for_transmission_inverts_transmission():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0, "watt / meter ** 2"),
        absorption_coefficient=Q(25.0, "1 / meter"),
    )
    z = a.path_length_for_transmission(0.1)
    assert a.transmission(z) == pytest.approx(0.1, rel=1e-12)


def test_invalid_target_transmission_raises():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0, "watt / meter ** 2"),
        absorption_coefficient=Q(25.0, "1 / meter"),
    )
    with pytest.raises(ValueError):
        a.path_length_for_transmission(0.0)
    with pytest.raises(ValueError):
        a.path_length_for_transmission(1.5)


def test_zero_alpha_path_length_inverse_raises():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0, "watt / meter ** 2"),
        absorption_coefficient=Q(0.0, "1 / meter"),
    )
    with pytest.raises(ValueError, match="zero"):
        a.path_length_for_transmission(0.5)


def test_negative_path_length_raises():
    a = LambertBeerAbsorber(
        incident_intensity=Q(1.0, "watt / meter ** 2"),
        absorption_coefficient=Q(50.0, "1 / meter"),
    )
    with pytest.raises(ValueError):
        a.transmission(Q(-1.0, "meter"))


def test_negative_alpha_construction_raises():
    with pytest.raises(ValueError):
        LambertBeerAbsorber(
            incident_intensity=Q(1.0, "watt / meter ** 2"),
            absorption_coefficient=Q(-1.0, "1 / meter"),
        )
