"""Runnable usage example for the candidate emission module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import emission_rate, excited_density_after_time


def main() -> None:
    rate = emission_rate(Q(1.0e18, "1 / meter ** 3"), Q(10.0, "nanosecond"))
    remaining = excited_density_after_time(
        Q(1.0e18, "1 / meter ** 3"),
        Q(10.0, "nanosecond"),
        Q(5.0, "nanosecond"),
    )
    print(f"emission_rate={rate:~P}")
    print(f"remaining={remaining:~P}")


if __name__ == "__main__":
    main()
