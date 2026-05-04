"""Lambert-Beer absorption sweep — Phase 7 ``validated`` module example.

Exercises ``packages/physics_modules/laser/absorption_lambert_beer/`` with
two sweeps:

  1. **Path-length sweep** at fixed absorption coefficient — reproduces
     the classic exponential attenuation law I(z) = I0 * exp(-alpha * z).
  2. **Coefficient sweep** at fixed path length — shows how transmission
     drops as the absorbing medium gets denser (or thicker, or both).

Writes a JSON summary under ``temp_runs/<run_id>/`` plus a CSV of the
two sweeps so a downstream tool (Plot panel, comparison report) can
render the results without re-running the simulation.

Usage::

    python examples/laser_species/run.py
    python examples/laser_species/run.py --i0-W-per-m2 1e10 --alpha-1-per-m 0.5
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import sys
import uuid
from pathlib import Path

from simworkbench.paths import temp_runs_root
from simworkbench.units import Q

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "laser"
    / "absorption_lambert_beer"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("absorption_lambert_beer", _MODULE_PATH)
assert _spec and _spec.loader
_lb = importlib.util.module_from_spec(_spec)
sys.modules["absorption_lambert_beer"] = _lb
_spec.loader.exec_module(_lb)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--i0-W-per-m2",
        type=float,
        default=1.0e10,
        help="Incident intensity (W/m^2). Default 1e10 matches a typical "
             "ns-pulse industrial laser.",
    )
    parser.add_argument(
        "--alpha-1-per-m",
        type=float,
        default=2.5,
        help="Absorption coefficient (1/m). Default 2.5/m is a typical "
             "weakly-absorbing medium.",
    )
    parser.add_argument(
        "--n-path-samples",
        type=int,
        default=21,
        help="Path-length sweep resolution.",
    )
    parser.add_argument(
        "--n-coefficient-samples",
        type=int,
        default=11,
        help="Coefficient sweep resolution.",
    )
    args = parser.parse_args()

    run_id = "laser_species-" + uuid.uuid4().hex[:8]
    print(f"[run] run_id = {run_id}")
    print(f"[run] I0 = {args.i0_W_per_m2:.3e} W/m^2")
    print(f"[run] alpha = {args.alpha_1_per_m:.3f} 1/m  (fixed for path sweep)")

    # --- 1. Path-length sweep at fixed alpha. -----------------------------
    absorber = _lb.LambertBeerAbsorber(
        incident_intensity=Q(args.i0_W_per_m2, "watt / meter ** 2"),
        absorption_coefficient=Q(args.alpha_1_per_m, "1 / meter"),
    )
    z_max_meters = 5.0 / args.alpha_1_per_m  # five 1/e lengths
    path_rows = []
    for i in range(args.n_path_samples):
        z = z_max_meters * i / (args.n_path_samples - 1)
        T = absorber.transmission(Q(z, "meter"))
        I_z = absorber.transmitted_intensity(Q(z, "meter")).magnitude
        path_rows.append({"z_meters": z, "transmission": T, "I_W_per_m2": I_z})

    print()
    print(f"[path] alpha = {args.alpha_1_per_m:.3f} 1/m")
    print(f"[path] z (m)        T            I (W/m^2)")
    for row in path_rows[:: max(1, len(path_rows) // 7)]:
        print(
            f"[path] {row['z_meters']:8.4f}    "
            f"{row['transmission']:.4f}    "
            f"{row['I_W_per_m2']:.4e}"
        )

    # 1/e path length should be 1/alpha; sanity-check.
    one_over_e = absorber.path_length_for_transmission(1.0 / 2.71828182845904523536)
    print(
        f"[path] 1/e path length = {one_over_e.to('meter').magnitude:.4f} m  "
        f"(expected 1/alpha = {1.0 / args.alpha_1_per_m:.4f} m)"
    )

    # --- 2. Coefficient sweep at fixed path length. -----------------------
    z_fixed_meters = 1.0 / args.alpha_1_per_m  # one 1/e length
    alpha_min, alpha_max = 0.1 * args.alpha_1_per_m, 5.0 * args.alpha_1_per_m
    coeff_rows = []
    for i in range(args.n_coefficient_samples):
        alpha = alpha_min + (alpha_max - alpha_min) * i / (args.n_coefficient_samples - 1)
        local = _lb.LambertBeerAbsorber(
            incident_intensity=Q(args.i0_W_per_m2, "watt / meter ** 2"),
            absorption_coefficient=Q(alpha, "1 / meter"),
        )
        T = local.transmission(Q(z_fixed_meters, "meter"))
        I_z = local.transmitted_intensity(Q(z_fixed_meters, "meter")).magnitude
        coeff_rows.append({"alpha_1_per_m": alpha, "transmission": T, "I_W_per_m2": I_z})

    print()
    print(f"[coef] z = {z_fixed_meters:.4f} m  (one 1/e length)")
    print(f"[coef] alpha (1/m)  T")
    for row in coeff_rows[:: max(1, len(coeff_rows) // 6)]:
        print(f"[coef] {row['alpha_1_per_m']:8.4f}    {row['transmission']:.4f}")

    # --- 3. Persist outputs. ----------------------------------------------
    out_dir = temp_runs_root() / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    summary_path = out_dir / "summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "run_id": run_id,
                "module": "laser/absorption_lambert_beer",
                "module_status": "validated",
                "i0_W_per_m2": args.i0_W_per_m2,
                "alpha_1_per_m_fixed": args.alpha_1_per_m,
                "z_meters_fixed": z_fixed_meters,
                "one_over_e_path_meters": one_over_e.to("meter").magnitude,
                "path_sweep": path_rows,
                "coefficient_sweep": coeff_rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    path_csv = out_dir / "path_sweep.csv"
    with path_csv.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["z_meters", "transmission", "I_W_per_m2"])
        writer.writeheader()
        writer.writerows(path_rows)

    coeff_csv = out_dir / "coefficient_sweep.csv"
    with coeff_csv.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["alpha_1_per_m", "transmission", "I_W_per_m2"])
        writer.writeheader()
        writer.writerows(coeff_rows)

    print()
    print(f"[done] summary = {summary_path}")
    print(f"[done] path csv = {path_csv}")
    print(f"[done] coef csv = {coeff_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
