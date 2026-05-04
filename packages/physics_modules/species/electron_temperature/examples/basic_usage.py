"""Runnable usage example for the candidate electron-temperature module."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simworkbench.units import Q
from src import mean_energy_from_temperature, temperature_from_mean_energy


def main() -> None:
    energy = mean_energy_from_temperature(Q(11604.518, "kelvin"))
    temperature = temperature_from_mean_energy(energy)
    print(f"mean_energy={energy:~P}")
    print(f"temperature={temperature:~P}")


if __name__ == "__main__":
    main()
