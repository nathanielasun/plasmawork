"""Tests for the example absorption-spectrum diagnostic tool."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest
from simworkbench.tools import ToolIOError
from simworkbench.units import Q


def _load_tool():
    here = Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location(
        "_absorption_spectrum_tool", here / "src" / "tool.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.AbsorptionSpectrumDiagnostic


def test_finds_two_peaks_in_synthetic_spectrum():
    tool = _load_tool()()
    # Use 0..10 inclusive so freq[i] == i (clean integer indexing).
    freq = Q(np.arange(11, dtype=float), "Hz")
    # Two peaks at indices 3 (freq=3Hz) and 7 (freq=7Hz).
    intensity_values = np.array([0, 0, 0.2, 1.0, 0.4, 0.1, 0.3, 0.9, 0.3, 0.1, 0])
    intensity = Q(intensity_values, "dimensionless")
    out = tool.execute(frequency=freq, intensity=intensity)
    assert out["peak_count"] == 2
    peak_freqs = sorted(p["frequency_hz"] for p in out["peaks"])
    assert peak_freqs == pytest.approx([3.0, 7.0])


def test_zero_peaks_for_monotonic_spectrum():
    tool = _load_tool()()
    freq = Q(np.linspace(0.0, 1.0, 5), "Hz")
    intensity = Q(np.linspace(0.0, 1.0, 5), "dimensionless")
    out = tool.execute(frequency=freq, intensity=intensity)
    assert out["peak_count"] == 0


def test_rejects_mismatched_shapes():
    tool = _load_tool()()
    freq = Q(np.array([1.0, 2.0, 3.0]), "Hz")
    intensity = Q(np.array([0.0, 0.5]), "dimensionless")
    with pytest.raises(ValueError, match="shape"):
        tool.execute(frequency=freq, intensity=intensity)


def test_rejects_bare_arrays():
    """Tool boundary rejects raw numpy arrays without units."""
    tool = _load_tool()()
    with pytest.raises(ToolIOError, match="unit-aware"):
        tool.execute(
            frequency=np.array([1.0, 2.0, 3.0]),
            intensity=np.array([0.0, 0.5, 1.0]),
        )
