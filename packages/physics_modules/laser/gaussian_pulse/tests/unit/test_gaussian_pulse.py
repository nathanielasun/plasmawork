from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

spec = importlib.util.spec_from_file_location(
    "phase7_gaussian_pulse",
    Path(__file__).parents[2] / "src" / "__init__.py",
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)

GaussianPulse = module.GaussianPulse


def test_intensity_peaks_at_center_time():
    pulse = GaussianPulse(
        peak_intensity=Q(10.0, "watt / meter ** 2"),
        center_time=Q(1.0, "second"),
        fwhm_duration=Q(2.0, "second"),
    )

    peak = magnitude(pulse.intensity_at(Q(1.0, "second")), "watt / meter ** 2")
    assert peak == pytest.approx(10.0)


def test_fwhm_half_peak_points():
    pulse = GaussianPulse(
        peak_intensity=Q(10.0, "watt / meter ** 2"),
        center_time=Q(0.0, "second"),
        fwhm_duration=Q(2.0, "second"),
    )

    left = magnitude(pulse.intensity_at(Q(-1.0, "second")), "watt / meter ** 2")
    right = magnitude(pulse.intensity_at(Q(1.0, "second")), "watt / meter ** 2")
    assert left == pytest.approx(5.0)
    assert right == pytest.approx(5.0)


def test_fluence_matches_closed_form():
    pulse = GaussianPulse(
        peak_intensity=Q(3.0, "watt / meter ** 2"),
        center_time=Q(0.0, "second"),
        fwhm_duration=Q(4.0, "second"),
    )

    expected_sigma = 4.0 / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    expected = 3.0 * expected_sigma * math.sqrt(2.0 * math.pi)
    assert magnitude(pulse.fluence(), "joule / meter ** 2") == pytest.approx(expected)


def test_rejects_non_positive_width():
    with pytest.raises(ValueError, match="FWHM"):
        GaussianPulse(
            peak_intensity=Q(1.0, "watt / meter ** 2"),
            center_time=Q(0.0, "second"),
            fwhm_duration=Q(0.0, "second"),
        )
