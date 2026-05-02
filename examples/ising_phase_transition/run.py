"""Run the 2D Ising phase-transition example.

Sweeps reduced temperature across the Onsager critical point T_c* ≈ 2.269
and reports magnetization, energy, heat capacity, and susceptibility per
spin at each temperature. Writes a JSON summary under ``temp_runs/<run_id>/``.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import uuid
from pathlib import Path

from simworkbench.paths import temp_runs_root

_ISING_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "phase_transition"
    / "ising_2d"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("ising_2d", _ISING_PATH)
assert _spec and _spec.loader
_ising = importlib.util.module_from_spec(_spec)
sys.modules["ising_2d"] = _ising
_spec.loader.exec_module(_ising)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lattice-size", type=int, default=12)
    parser.add_argument("--n-sweeps", type=int, default=400)
    parser.add_argument("--equilibration-sweeps", type=int, default=200)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    run_id = "ising-" + uuid.uuid4().hex[:8]
    print(f"[run] run_id = {run_id}")

    temperatures = [1.5, 2.0, 2.27, 2.5, 3.0, 4.0]
    rows = []
    for T in temperatures:
        r = _ising.simulate(
            lattice_size=args.lattice_size,
            temperature_reduced=T,
            n_sweeps=args.n_sweeps,
            equilibration_sweeps=args.equilibration_sweeps,
            seed=args.seed,
        )
        rows.append(
            {
                "T_reduced": T,
                "m_per_spin": r["magnetization_per_spin"],
                "e_per_spin": r["energy_per_spin"],
                "heat_capacity_per_spin": r["heat_capacity_per_spin"],
                "susceptibility_per_spin": r["susceptibility_per_spin"],
            }
        )
        print(
            f"[T*={T:5.2f}] |m|={r['magnetization_per_spin']:.3f}  "
            f"e={r['energy_per_spin']:.3f}  "
            f"chi={r['susceptibility_per_spin']:.3f}"
        )

    summary_path = temp_runs_root() / run_id / "summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(
            {
                "run_id": run_id,
                "lattice_size": args.lattice_size,
                "n_sweeps": args.n_sweeps,
                "equilibration_sweeps": args.equilibration_sweeps,
                "T_c_onsager": 2.269,
                "rows": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[done] summary = {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
