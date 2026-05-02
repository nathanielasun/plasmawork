"""2D Lennard-Jones MD with Velocity Verlet — Phase 1D ``candidate`` module.

The integrator works in reduced LJ units internally for numerical
robustness, but the public API takes and returns unit-aware quantities and
converts at the boundary.
"""

from __future__ import annotations

import numpy as np
import pint

from simworkbench.units import Q, magnitude, require_dimensionality


def _lj_force_and_potential(
    positions: np.ndarray, box_size: float
) -> tuple[np.ndarray, float]:
    """Per-particle force (reduced units) and total potential energy.

    Inputs in reduced units (sigma=1, epsilon=1). Periodic minimum-image.
    """
    n = positions.shape[0]
    forces = np.zeros_like(positions)
    potential = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            rij = positions[i] - positions[j]
            # Minimum-image
            rij -= box_size * np.round(rij / box_size)
            r2 = float(np.dot(rij, rij))
            if r2 < 1e-12:
                continue
            inv_r2 = 1.0 / r2
            inv_r6 = inv_r2**3
            inv_r12 = inv_r6**2
            # V = 4 (r^-12 - r^-6); F = -dV/dr; in vector form per particle.
            potential += 4.0 * (inv_r12 - inv_r6)
            # f_ij in reduced units: 24 * (2 * inv_r12 - inv_r6) / r^2 * rij
            f_mag_over_r2 = 24.0 * (2.0 * inv_r12 - inv_r6) * inv_r2
            f_ij = f_mag_over_r2 * rij
            forces[i] += f_ij
            forces[j] -= f_ij
    return forces, potential


def simulate(
    *,
    n_particles: int,
    box_size: pint.Quantity,
    temperature: pint.Quantity,
    epsilon: pint.Quantity,
    sigma: pint.Quantity,
    mass: pint.Quantity,
    n_steps: int,
    dt: pint.Quantity,
    seed: int = 0,
) -> dict[str, pint.Quantity | np.ndarray | float]:
    """Run a 2D LJ MD simulation. See module README for inputs and outputs."""
    require_dimensionality(box_size, "[length]")
    require_dimensionality(temperature, "[temperature]")
    require_dimensionality(epsilon, "[energy]")
    require_dimensionality(sigma, "[length]")
    require_dimensionality(mass, "[mass]")
    require_dimensionality(dt, "[time]")
    if n_particles <= 0:
        raise ValueError("n_particles must be positive.")
    if n_steps <= 0:
        raise ValueError("n_steps must be positive.")

    # ---- Convert to reduced LJ units --------------------------------------
    eps_J = magnitude(epsilon, "joule")
    sig_m = magnitude(sigma, "meter")
    m_kg = magnitude(mass, "kilogram")
    box_m = magnitude(box_size, "meter")
    L_red = box_m / sig_m
    # Reduced time unit tau = sigma * sqrt(m / epsilon)
    tau_s = sig_m * np.sqrt(m_kg / eps_J)
    dt_red = magnitude(dt, "second") / tau_s
    # Reduced temperature T* = k_B T / epsilon
    k_B = 1.380649e-23
    T_red = magnitude(temperature, "kelvin") * k_B / eps_J

    rng = np.random.default_rng(seed)
    # ---- Initial conditions: simple square lattice + Maxwell-Boltzmann -----
    side = int(np.ceil(np.sqrt(n_particles)))
    spacing = L_red / side
    positions = []
    for i in range(side):
        for j in range(side):
            if len(positions) < n_particles:
                positions.append([i * spacing, j * spacing])
    positions = np.asarray(positions, dtype=np.float64)
    velocities = rng.standard_normal((n_particles, 2)) * np.sqrt(T_red)
    # Remove COM drift
    velocities -= velocities.mean(axis=0, keepdims=True)
    # Rescale to exact target temperature: <v^2> = 2 T* (2D)
    vmean_sq = float(np.mean(np.sum(velocities * velocities, axis=1)))
    if vmean_sq > 0:
        velocities *= np.sqrt(2.0 * T_red / vmean_sq)

    # ---- Velocity Verlet --------------------------------------------------
    forces, potential = _lj_force_and_potential(positions, L_red)
    kinetic = 0.5 * float(np.sum(velocities * velocities))
    energies = np.zeros(n_steps + 1)
    kinetics = np.zeros(n_steps + 1)
    potentials = np.zeros(n_steps + 1)
    energies[0] = kinetic + potential
    kinetics[0] = kinetic
    potentials[0] = potential
    trajectories = np.zeros((n_steps + 1, n_particles, 2))
    trajectories[0] = positions

    for step in range(1, n_steps + 1):
        # r_{t+dt} = r_t + v_t dt + 0.5 a_t dt^2; a = F (mass = 1 in reduced units)
        positions = positions + velocities * dt_red + 0.5 * forces * dt_red**2
        # Wrap to box
        positions = positions % L_red
        new_forces, potential = _lj_force_and_potential(positions, L_red)
        velocities = velocities + 0.5 * (forces + new_forces) * dt_red
        forces = new_forces
        kinetic = 0.5 * float(np.sum(velocities * velocities))
        kinetics[step] = kinetic
        potentials[step] = potential
        energies[step] = kinetic + potential
        trajectories[step] = positions

    # ---- Convert back to SI -----------------------------------------------
    pos_m = trajectories * sig_m
    ke_J = kinetics * eps_J
    pe_J = potentials * eps_J
    e_J = energies * eps_J
    energy_drift_rel = float(np.max(np.abs(e_J - e_J[0]) / max(abs(e_J[0]), 1e-30)))

    return {
        "trajectory_positions": Q(pos_m, "meter"),
        "trajectory_kinetic_energy": Q(ke_J, "joule"),
        "trajectory_potential_energy": Q(pe_J, "joule"),
        "trajectory_total_energy": Q(e_J, "joule"),
        "energy_drift_relative": energy_drift_rel,
        "reduced_dt": dt_red,
        "reduced_temperature": T_red,
    }


__all__ = ["simulate"]
