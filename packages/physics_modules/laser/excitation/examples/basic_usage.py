"""Runnable usage example for the candidate excitation module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import excitation_rate


def main() -> None:
    rate = excitation_rate(Q(1.0e20, "1 / meter ** 3"), Q(2.0e6, "1 / second"))
    print(f"excitation_rate={rate:~P}")


if __name__ == "__main__":
    main()
