"""2D Ising MC with Metropolis single-spin-flip — Phase 1D ``candidate`` module.

All quantities are dimensionless (energy in units of coupling J, temperature
in units of J / k_B). The module returns plain floats / numpy arrays. This
is the only Phase 1D module that does not take ``Quantity`` at the boundary
because the Ising domain is intrinsically dimensionless.
"""

from __future__ import annotations

import math

import numpy as np


def _delta_E(spins: np.ndarray, i: int, j: int, h: float, L: int) -> float:
    s = spins[i, j]
    neighbor_sum = (
        spins[(i - 1) % L, j]
        + spins[(i + 1) % L, j]
        + spins[i, (j - 1) % L]
        + spins[i, (j + 1) % L]
    )
    return float(2.0 * s * (neighbor_sum + h))


def _total_energy(spins: np.ndarray, h: float) -> float:
    # Sum over right and down neighbors only to avoid double-counting.
    right = np.roll(spins, -1, axis=1)
    down = np.roll(spins, -1, axis=0)
    bond_sum = float(np.sum(spins * right) + np.sum(spins * down))
    field_sum = float(np.sum(spins))
    return -bond_sum - h * field_sum


def simulate(
    *,
    lattice_size: int,
    temperature_reduced: float,
    n_sweeps: int,
    equilibration_sweeps: int = 0,
    external_field: float = 0.0,
    seed: int = 0,
) -> dict[str, float | np.ndarray]:
    """Run a 2D Ising simulation. All inputs and outputs are dimensionless."""
    if lattice_size <= 0:
        raise ValueError("lattice_size must be positive.")
    if temperature_reduced <= 0:
        raise ValueError("temperature_reduced must be positive.")
    if n_sweeps <= 0:
        raise ValueError("n_sweeps must be positive.")
    if equilibration_sweeps < 0:
        raise ValueError("equilibration_sweeps must be non-negative.")

    L = int(lattice_size)
    rng = np.random.default_rng(seed)
    # Hot start near T_c, cold start otherwise (a tiny convergence aid).
    if temperature_reduced > 2.0:
        spins = rng.choice([-1, 1], size=(L, L)).astype(np.int8)
    else:
        spins = np.ones((L, L), dtype=np.int8)

    beta = 1.0 / temperature_reduced
    h = float(external_field)

    # Pre-compute Boltzmann weights for the eight possible delta-E values
    # at h=0 (delta-E ∈ {-8, -4, 0, 4, 8}); for h≠0 we recompute on the fly.
    energies = []
    magnetizations = []

    total_steps = n_sweeps + equilibration_sweeps
    for sweep in range(total_steps):
        # One sweep = L*L attempted single-spin flips (random sites).
        i_arr = rng.integers(0, L, size=L * L)
        j_arr = rng.integers(0, L, size=L * L)
        rand_arr = rng.random(L * L)
        for k in range(L * L):
            i = int(i_arr[k])
            j = int(j_arr[k])
            dE = _delta_E(spins, i, j, h, L)
            if dE <= 0 or rand_arr[k] < math.exp(-beta * dE):
                spins[i, j] = -spins[i, j]
        if sweep >= equilibration_sweeps:
            energies.append(_total_energy(spins, h))
            magnetizations.append(float(np.sum(spins)))

    energies_arr = np.asarray(energies, dtype=np.float64)
    mags_arr = np.asarray(magnetizations, dtype=np.float64)
    n_spins = float(L * L)

    e_mean = float(np.mean(energies_arr) / n_spins)
    m_mean = float(np.mean(np.abs(mags_arr)) / n_spins)
    var_e = float(np.var(energies_arr))
    var_m = float(np.var(mags_arr))
    heat_capacity = beta**2 * var_e / n_spins
    susceptibility = beta * var_m / n_spins

    return {
        "magnetization_per_spin": m_mean,
        "energy_per_spin": e_mean,
        "heat_capacity_per_spin": heat_capacity,
        "susceptibility_per_spin": susceptibility,
        "magnetization_trace": mags_arr / n_spins,
        "energy_trace": energies_arr / n_spins,
        "final_spins": spins.copy(),
        "lattice_size": L,
        "temperature_reduced": temperature_reduced,
    }


__all__ = ["simulate"]
