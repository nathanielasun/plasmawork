"""Runnable usage example for the candidate ionization module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import ionization_rate


def main() -> None:
    rate = ionization_rate(Q(1.0e20, "1 / meter ** 3"), Q(5.0e5, "1 / second"))
    print(f"ionization_rate={rate:~P}")


if __name__ == "__main__":
    main()
