"""Runnable usage example for the candidate recombination module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import recombination_rate


def main() -> None:
    rate = recombination_rate(
        Q(1.0e18, "1 / meter ** 3"),
        Q(1.0e18, "1 / meter ** 3"),
        Q(1.0e-13, "meter ** 3 / second"),
    )
    print(f"recombination_rate={rate:~P}")


if __name__ == "__main__":
    main()
