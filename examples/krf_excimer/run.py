"""Run the simplified KrF excimer kinetics example end-to-end.

Loads ``examples/krf_excimer/model.yaml``, builds an ``Experiment``, runs
it against ``python_cpu``, writes a JSON summary under
``temp_runs/<run_id>/``, and saves a portable capsule under
``simulation_capsules/`` with status ``exploratory`` (every rate
coefficient is a placeholder per Plan §22 — see the YAML's
``coefficient_sources`` entries).

Usage::

    python examples/krf_excimer/run.py
    python examples/krf_excimer/run.py --max-steps 400 --seed 7 --no-capsule
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.paths import temp_runs_root
from simworkbench.runtime import Runner
from simworkbench.serialization import save_capsule


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-steps", type=int, default=200)
    parser.add_argument("--end-time", type=str, default="60 ns")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--checkpoint-every", type=int, default=50)
    parser.add_argument(
        "--no-capsule",
        action="store_true",
        help="Skip the simulation_capsules/ save (the temp_runs/ summary still lands).",
    )
    args = parser.parse_args()

    spec_path = Path(__file__).resolve().parent / "model.yaml"
    spec = load_yaml(spec_path)
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(
            start_time="0 s",
            end_time=args.end_time,
            max_steps=args.max_steps,
            seed=args.seed,
        ),
    )

    runner = Runner(
        experiment,
        base_seed=args.seed,
        checkpoint_every=args.checkpoint_every,
    )
    print(f"[run] run_id = {runner.run_id}")
    runner.events.subscribe(
        lambda ev: print(f"[{ev.level}] {ev.subsystem}: {ev.message}")
    )
    result = runner.run()

    summary_path = temp_runs_root() / runner.run_id / "summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(
            {
                "run_id": result.run_id,
                "state": result.state.value,
                "elapsed_seconds": result.elapsed_seconds,
                "final_simulation_time": result.final_simulation_time,
                "species_trajectories": {
                    name: list(result.diagnostics[name])
                    for name in (s.name for s in spec.species)
                    if name in result.diagnostics
                },
                "placeholders": list(result.placeholders),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    capsule_path = None
    if not args.no_capsule:
        capsule_path = save_capsule(experiment=experiment, result=result)

    print()
    print(f"[done] state = {result.state.value}")
    print(f"[done] t_final = {result.final_simulation_time:.3e} s")
    for name in (s.name for s in spec.species):
        if name in result.diagnostics:
            traj = result.diagnostics[name]
            print(
                f"[done] {name}(0) = {traj[0]:.3e},  "
                f"{name}(t_final) = {traj[-1]:.3e} 1/m^3"
            )
    if result.placeholder_used:
        print(
            f"[exploratory] placeholder rate constants in use for "
            f"{len(result.placeholders)} interaction(s): {result.placeholders}"
        )
        print(
            "[exploratory] capsule status is `exploratory` (Plan §22 — "
            "placeholders preclude `validated` until paper ingestion "
            "supplies real coefficients)."
        )
    print(f"[done] summary = {summary_path}")
    if capsule_path is not None:
        print(f"[done] capsule = {capsule_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
