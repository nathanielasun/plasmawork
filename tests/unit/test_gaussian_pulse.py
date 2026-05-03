"""Phase 1D — Gaussian laser pulse tests."""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, UnitsError, magnitude

# Load the module from its plan-named location (not on the Python path).
_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "laser"
    / "gaussian_pulse"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("gaussian_pulse", _MODULE_PATH)
assert _spec is not None and _spec.loader is not None
_gaussian_pulse = importlib.util.module_from_spec(_spec)
sys.modules["gaussian_pulse"] = _gaussian_pulse
_spec.loader.exec_module(_gaussian_pulse)
GaussianPulse = _gaussian_pulse.GaussianPulse


def test_intensity_at_center_equals_peak():
    p = GaussianPulse(
        peak_intensity=Q("1.0e10 W/m^2"),
        center_time=Q("10 ns"),
        fwhm_duration=Q("25 ns"),
    )
    I = p.intensity_at(Q("10 ns"))
    assert magnitude(I, "W/m^2") == pytest.approx(1.0e10)


def test_intensity_at_fwhm_offset_is_half_peak():
    p = GaussianPulse(
        peak_intensity=Q("1.0e10 W/m^2"),
        center_time=Q("0 s"),
        fwhm_duration=Q("25 ns"),
    )
    fwhm_half = magnitude(p.fwhm_duration, "second") / 2
    I = p.intensity_at(Q(fwhm_half, "second"))
    assert magnitude(I, "W/m^2") == pytest.approx(0.5e10, rel=1e-9)


def test_intensity_far_from_center_is_negligible():
    p = GaussianPulse(
        peak_intensity=Q("1.0 W/m^2"),
        center_time=Q("0 s"),
        fwhm_duration=Q("1 ns"),
    )
    # 10 sigma away → exp(-50) ≈ 2e-22.
    far = 10 * p.sigma_seconds
    I = p.intensity_at(Q(far, "second"))
    assert magnitude(I, "W/m^2") < 1e-20


def test_fluence_matches_analytic():
    I0 = 1.0e10
    fwhm = 25e-9
    sigma = fwhm / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    expected = I0 * sigma * math.sqrt(2.0 * math.pi)
    p = GaussianPulse(
        peak_intensity=Q(I0, "W/m^2"),
        center_time=Q("0 s"),
        fwhm_duration=Q(fwhm, "s"),
    )
    assert magnitude(p.fluence(), "J/m^2") == pytest.approx(expected, rel=1e-12)


def test_rejects_zero_fwhm():
    with pytest.raises(ValueError, match="FWHM must be positive"):
        GaussianPulse(
            peak_intensity=Q("1.0e10 W/m^2"),
            center_time=Q("0 s"),
            fwhm_duration=Q("0 s"),
        )


def test_rejects_unit_mismatch_on_intensity():
    with pytest.raises(UnitsError):
        GaussianPulse(
            peak_intensity=Q("1.0 second"),  # wrong dimension
            center_time=Q("0 s"),
            fwhm_duration=Q("25 ns"),
        )


def test_intensity_at_accepts_string():
    p = GaussianPulse(
        peak_intensity=Q("1.0e10 W/m^2"),
        center_time=Q("0 s"),
        fwhm_duration=Q("25 ns"),
    )
    I = p.intensity_at("0 ns")
    assert magnitude(I, "W/m^2") == pytest.approx(1.0e10)
