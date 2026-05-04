"""Runnable usage example for the candidate species-density module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import total_particles, uniform_density


def main() -> None:
    density = uniform_density(1.0e12, Q(1.0e-6, "meter ** 3"))
    particles = total_particles(density, Q(1.0e-6, "meter ** 3"))
    print(f"density={density:~P}")
    print(f"particles={particles}")


if __name__ == "__main__":
    main()
