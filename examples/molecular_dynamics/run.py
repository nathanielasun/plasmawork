"""Run the Lennard-Jones MD example end-to-end.

Demonstrates Phase 1D's MD module driving a small 2D LJ system. Writes a
JSON summary of the energy trace under ``temp_runs/<run_id>/``.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import uuid
from pathlib import Path

from simworkbench.paths import temp_runs_root
from simworkbench.units import Q, magnitude

# Module not on Python path — import via spec.
_LJ_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "molecular_dynamics"
    / "lennard_jones"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("lennard_jones", _LJ_PATH)
assert _spec and _spec.loader
_lj = importlib.util.module_from_spec(_spec)
sys.modules["lennard_jones"] = _lj
_spec.loader.exec_module(_lj)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n-particles", type=int, default=64)
    parser.add_argument("--n-steps", type=int, default=200)
    parser.add_argument("--temperature-K", type=float, default=100.0)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    run_id = "md-" + uuid.uuid4().hex[:8]
    print(f"[run] run_id = {run_id}")
    result = _lj.simulate(
        n_particles=args.n_particles,
        box_size=Q("3.4 nm"),
        temperature=Q(args.temperature_K, "K"),
        epsilon=Q(1.66e-21, "J"),
        sigma=Q("0.34 nm"),
        mass=Q("39.948 amu"),
        n_steps=args.n_steps,
        dt=Q("4 fs"),
        seed=args.seed,
    )

    summary_path = temp_runs_root() / run_id / "summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(
            {
                "run_id": run_id,
                "n_particles": args.n_particles,
                "n_steps": args.n_steps,
                "temperature_K": args.temperature_K,
                "energy_drift_relative": result["energy_drift_relative"],
                "reduced_temperature": result["reduced_temperature"],
                "total_energy_first": magnitude(result["trajectory_total_energy"], "J")[0],
                "total_energy_last": magnitude(result["trajectory_total_energy"], "J")[-1],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"[done] energy_drift = {result['energy_drift_relative']:.3e}")
    print(f"[done] T* = {result['reduced_temperature']:.3f}")
    print(f"[done] summary = {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
