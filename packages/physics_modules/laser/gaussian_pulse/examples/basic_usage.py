"""Runnable usage example for the candidate Gaussian pulse module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import GaussianPulse


def main() -> None:
    pulse = GaussianPulse(
        peak_intensity=Q(1.0e10, "watt / meter ** 2"),
        center_time=Q(0.0, "second"),
        fwhm_duration=Q(25.0, "nanosecond"),
    )
    print(f"peak={pulse.intensity_at(Q(0.0, 'second')):~P}")
    print(f"fluence={pulse.fluence():~P}")


if __name__ == "__main__":
    main()
