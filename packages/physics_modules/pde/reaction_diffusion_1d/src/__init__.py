"""1D linear reaction-diffusion — Phase 7 ``validated`` PDE module.

u_t = D u_xx - k u, with Dirichlet BCs u(0,t) = u(L,t) = 0.
Crank-Nicolson tridiagonal solve every step.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pint
from simworkbench.units import magnitude, require_dimensionality


def _solve_tridiag(
    a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray
) -> np.ndarray:
    """Thomas algorithm for tridiagonal linear systems.

    a[0] is unused; c[-1] is unused. Returns x with shape == d.shape.
    """
    n = len(d)
    cp = np.zeros_like(b)
    dp = np.zeros_like(d)
    cp[0] = c[0] / b[0]
    dp[0] = d[0] / b[0]
    for i in range(1, n):
        denom = b[i] - a[i] * cp[i - 1]
        cp[i] = c[i] / denom if i < n - 1 else 0.0
        dp[i] = (d[i] - a[i] * dp[i - 1]) / denom
    x = np.zeros_like(d)
    x[-1] = dp[-1]
    for i in range(n - 2, -1, -1):
        x[i] = dp[i] - cp[i] * x[i + 1]
    return x


def simulate(
    *,
    domain_length: pint.Quantity,
    diffusion_coefficient: pint.Quantity,
    reaction_rate: pint.Quantity,
    grid_resolution: pint.Quantity,
    dt: pint.Quantity,
    n_steps: int,
    initial_condition: Callable[[np.ndarray], np.ndarray],
) -> dict[str, np.ndarray]:
    """Crank-Nicolson 1D reaction-diffusion. Dirichlet BCs."""
    require_dimensionality(domain_length, "[length]")
    require_dimensionality(diffusion_coefficient, "[length] ** 2 / [time]")
    require_dimensionality(reaction_rate, "1 / [time]")
    require_dimensionality(grid_resolution, "[length]")
    require_dimensionality(dt, "[time]")
    if n_steps <= 0:
        raise ValueError("n_steps must be positive.")

    L = magnitude(domain_length, "meter")
    D = magnitude(diffusion_coefficient, "meter ** 2 / second")
    k = magnitude(reaction_rate, "1 / second")
    dx = magnitude(grid_resolution, "meter")
    dt_s = magnitude(dt, "second")

    nx = int(round(L / dx)) + 1
    if nx < 4:
        raise ValueError("Grid too coarse — nx must be >= 4.")
    x = np.linspace(0.0, L, nx)
    interior = nx - 2
    r = D * dt_s / (dx * dx)

    # Crank-Nicolson interior matrices: (I + (r/2) A_diff + (k dt /2) I)
    # u_new = (I - (r/2) A_diff - (k dt /2) I) u_old, where A_diff is
    # the standard 2nd-order Laplacian with -2 on the diagonal and 1
    # on the off-diagonals.
    half_diag_lhs = 1.0 + r + k * dt_s / 2.0
    half_diag_rhs = 1.0 - r - k * dt_s / 2.0
    off_lhs = -r / 2.0
    off_rhs = r / 2.0

    a_lhs = np.full(interior, off_lhs)
    b_lhs = np.full(interior, half_diag_lhs)
    c_lhs = np.full(interior, off_lhs)

    u = initial_condition(x).astype(np.float64)
    u[0] = u[-1] = 0.0
    trajectory = np.zeros((n_steps + 1, nx), dtype=np.float64)
    times = np.zeros(n_steps + 1, dtype=np.float64)
    trajectory[0] = u

    for step in range(1, n_steps + 1):
        u_int = u[1:-1]
        rhs = (
            off_rhs * np.roll(u_int, 1)
            + half_diag_rhs * u_int
            + off_rhs * np.roll(u_int, -1)
        )
        # Fix the wrap from np.roll at the interior endpoints.
        rhs[0] = half_diag_rhs * u_int[0] + off_rhs * u_int[1]
        rhs[-1] = off_rhs * u_int[-2] + half_diag_rhs * u_int[-1]
        # Dirichlet BCs ⇒ no boundary contribution to RHS.
        new_int = _solve_tridiag(a_lhs, b_lhs, c_lhs, rhs)
        u_new = np.zeros_like(u)
        u_new[1:-1] = new_int
        trajectory[step] = u_new
        times[step] = step * dt_s
        u = u_new

    return {
        "trajectory": trajectory,
        "time_seconds": times,
        "x_meters": x,
    }


__all__ = ["simulate"]
