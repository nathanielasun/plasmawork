"""1D linear wave equation — Phase 7 ``validated`` PDE module.

u_tt = c^2 u_xx, with Dirichlet BCs u(0,t) = u(L,t) = 0. Explicit
centered-difference scheme (leapfrog in time, central in space). CFL
number r = c * dt / dx must satisfy r <= 1 for stability.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pint
from simworkbench.units import magnitude, require_dimensionality


def simulate(
    *,
    domain_length: pint.Quantity,
    wave_speed: pint.Quantity,
    grid_resolution: pint.Quantity,
    dt: pint.Quantity,
    n_steps: int,
    initial_displacement: Callable[[np.ndarray], np.ndarray],
    initial_velocity: Callable[[np.ndarray], np.ndarray] | None = None,
) -> dict[str, np.ndarray]:
    """Run the 1D wave equation on a uniform grid with Dirichlet BCs.

    Returns ``{trajectory: shape (n_steps+1, nx), time_seconds: shape
    (n_steps+1,), x_meters: shape (nx,), cfl: float}``.
    """
    require_dimensionality(domain_length, "[length]")
    require_dimensionality(wave_speed, "[length] / [time]")
    require_dimensionality(grid_resolution, "[length]")
    require_dimensionality(dt, "[time]")
    if n_steps <= 0:
        raise ValueError("n_steps must be positive.")

    L = magnitude(domain_length, "meter")
    c = magnitude(wave_speed, "meter / second")
    dx = magnitude(grid_resolution, "meter")
    dt_s = magnitude(dt, "second")

    nx = int(round(L / dx)) + 1
    if nx < 3:
        raise ValueError("Grid too coarse — nx must be >= 3.")
    x = np.linspace(0.0, L, nx)
    cfl = c * dt_s / dx
    if cfl > 1.0 + 1e-12:
        raise ValueError(
            f"CFL violated: c*dt/dx = {cfl:.4f} > 1. Reduce dt or "
            "coarsen the grid."
        )

    u_prev = initial_displacement(x).astype(np.float64)
    if initial_velocity is None:
        u_curr = u_prev.copy()  # zero initial velocity
    else:
        v0 = initial_velocity(x).astype(np.float64)
        u_curr = u_prev + dt_s * v0  # 1st-order half step
    # Apply Dirichlet BCs.
    u_prev[0] = u_prev[-1] = 0.0
    u_curr[0] = u_curr[-1] = 0.0

    trajectory = np.zeros((n_steps + 1, nx), dtype=np.float64)
    times = np.zeros(n_steps + 1, dtype=np.float64)
    trajectory[0] = u_prev
    trajectory[1] = u_curr
    times[1] = dt_s

    cfl_sq = cfl * cfl
    for step in range(2, n_steps + 1):
        u_next = np.empty_like(u_curr)
        u_next[1:-1] = (
            2 * u_curr[1:-1]
            - u_prev[1:-1]
            + cfl_sq * (u_curr[2:] - 2 * u_curr[1:-1] + u_curr[:-2])
        )
        u_next[0] = u_next[-1] = 0.0  # Dirichlet
        trajectory[step] = u_next
        times[step] = step * dt_s
        u_prev = u_curr
        u_curr = u_next

    return {
        "trajectory": trajectory,
        "time_seconds": times,
        "x_meters": x,
        "cfl": cfl,
    }


__all__ = ["simulate"]
