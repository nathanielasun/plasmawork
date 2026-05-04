"""Runnable usage example for the candidate absorption module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import absorption_coefficient, transmitted_intensity


def main() -> None:
    alpha = absorption_coefficient(Q(1.0e-22, "meter ** 2"), Q(1.0e20, "1 / meter ** 3"))
    transmitted = transmitted_intensity(
        Q(1.0, "watt / meter ** 2"),
        Q(1.0e-22, "meter ** 2"),
        Q(1.0e20, "1 / meter ** 3"),
        Q(0.1, "meter"),
    )
    print(f"alpha={alpha:~P}")
    print(f"transmitted={transmitted:~P}")


if __name__ == "__main__":
    main()
