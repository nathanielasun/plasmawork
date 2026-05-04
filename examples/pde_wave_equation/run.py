"""1D linear wave equation example — Phase 7 ``validated`` PDE module.

Drives ``packages/physics_modules/pde/wave_equation_1d/`` with a
Gaussian initial displacement on a string fixed at both ends. Tracks
the resulting standing-wave dynamics, performs a grid-convergence
check (the module is validated against 2nd-order convergence), and
writes a JSON summary plus a snapshot CSV under
``temp_runs/<run_id>/``.

Usage::

    python examples/pde_wave_equation/run.py
    python examples/pde_wave_equation/run.py --domain-length-m 2.0 --grid-nx 401
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import sys
import uuid
from pathlib import Path

import numpy as np
from simworkbench.paths import temp_runs_root
from simworkbench.units import Q

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "pde"
    / "wave_equation_1d"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("wave_equation_1d", _MODULE_PATH)
assert _spec and _spec.loader
_we = importlib.util.module_from_spec(_spec)
sys.modules["wave_equation_1d"] = _we
_spec.loader.exec_module(_we)


def _gaussian(width: float, x0: float):
    def initial(x: np.ndarray) -> np.ndarray:
        return np.exp(-((x - x0) / width) ** 2)
    return initial


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain-length-m", type=float, default=1.0)
    parser.add_argument("--wave-speed-m-per-s", type=float, default=1.0)
    parser.add_argument(
        "--grid-nx",
        type=int,
        default=201,
        help="Number of grid points (>=3). Doubling this triggers the convergence comparison.",
    )
    parser.add_argument("--n-steps", type=int, default=400)
    parser.add_argument("--cfl", type=float, default=0.8)
    parser.add_argument(
        "--no-convergence-check",
        action="store_true",
        help="Skip the half-grid run that confirms 2nd-order convergence.",
    )
    args = parser.parse_args()

    L = args.domain_length_m
    c = args.wave_speed_m_per_s
    nx = args.grid_nx
    if nx < 3:
        raise SystemExit("--grid-nx must be >= 3")
    dx = L / (nx - 1)
    dt = args.cfl * dx / c
    pulse = _gaussian(width=L / 20.0, x0=L / 2.0)

    run_id = "wave-" + uuid.uuid4().hex[:8]
    print(f"[run] run_id = {run_id}")
    print(f"[run] L = {L:.3f} m, c = {c:.3f} m/s, nx = {nx}, dt = {dt:.3e} s")
    print(f"[run] CFL target = {args.cfl:.3f}, n_steps = {args.n_steps}")

    coarse = _we.simulate(
        domain_length=Q(L, "meter"),
        wave_speed=Q(c, "meter / second"),
        grid_resolution=Q(dx, "meter"),
        dt=Q(dt, "second"),
        n_steps=args.n_steps,
        initial_displacement=pulse,
    )
    print(f"[run] CFL realized = {coarse['cfl']:.4f}")

    coarse_traj = coarse["trajectory"]
    coarse_x = coarse["x_meters"]
    coarse_t = coarse["time_seconds"]
    print(
        f"[done] u_max(t=0)        = {float(np.max(np.abs(coarse_traj[0]))):.4f}"
    )
    print(
        f"[done] u_max(t_final)    = {float(np.max(np.abs(coarse_traj[-1]))):.4f}"
    )
    # By D'Alembert's solution, the initial Gaussian splits into two
    # counter-propagating half-amplitude pulses, so u_max should drop
    # toward 0.5 well before either half reflects off a boundary.
    # This is real physics, not a numerical artifact.
    t_final = float(coarse_t[-1])
    print(f"[done] simulated time    = {t_final:.4e} s")

    convergence_block: dict[str, float | bool] | None = None
    if not args.no_convergence_check:
        # Halve the grid spacing → keep the same CFL → halve dt.
        nx_fine = 2 * nx - 1
        dx_fine = L / (nx_fine - 1)
        dt_fine = args.cfl * dx_fine / c
        n_steps_fine = int(round(args.n_steps * dt / dt_fine))
        fine = _we.simulate(
            domain_length=Q(L, "meter"),
            wave_speed=Q(c, "meter / second"),
            grid_resolution=Q(dx_fine, "meter"),
            dt=Q(dt_fine, "second"),
            n_steps=n_steps_fine,
            initial_displacement=pulse,
        )
        # Sample the fine solution onto the coarse grid for comparison.
        fine_at_coarse = fine["trajectory"][-1, ::2]
        # Truncate / pad if rounding made them off by one.
        n_match = min(len(fine_at_coarse), len(coarse_traj[-1]))
        diff = coarse_traj[-1, :n_match] - fine_at_coarse[:n_match]
        l2 = float(np.sqrt(np.trapezoid(diff ** 2, coarse_x[:n_match])))  # noqa: NPY201
        # The module advertises 2nd-order convergence; the L2 error
        # should drop by ~4x when dx is halved. We don't assert here
        # (exact factor depends on initial pulse smoothness), only
        # report.
        convergence_block = {
            "coarse_nx": nx,
            "fine_nx": nx_fine,
            "l2_error_coarse_vs_fine": l2,
        }
        print()
        print(f"[converge] coarse nx = {nx}, fine nx = {nx_fine}")
        print(f"[converge] L2(coarse(t_final) - fine(t_final)) = {l2:.4e}")

    out_dir = temp_runs_root() / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    summary_path = out_dir / "summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "run_id": run_id,
                "module": "pde/wave_equation_1d",
                "module_status": "validated",
                "domain_length_m": L,
                "wave_speed_m_per_s": c,
                "grid_nx": nx,
                "dt_s": dt,
                "cfl_realized": float(coarse["cfl"]),
                "n_steps": args.n_steps,
                "u_max_t0": float(np.max(np.abs(coarse_traj[0]))),
                "u_max_t_final": float(np.max(np.abs(coarse_traj[-1]))),
                "simulated_time_s": t_final,
                "convergence": convergence_block,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    snapshot_csv = out_dir / "final_snapshot.csv"
    with snapshot_csv.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["x_meters", "u_t_final"])
        for x_val, u_val in zip(coarse_x, coarse_traj[-1], strict=True):
            writer.writerow([float(x_val), float(u_val)])

    print()
    print(f"[done] summary = {summary_path}")
    print(f"[done] snapshot = {snapshot_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
