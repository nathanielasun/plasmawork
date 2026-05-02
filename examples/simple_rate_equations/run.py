"""Run the simple-rate-equations example end-to-end.

Loads ``examples/simple_rate_equations/model.yaml``, builds an ``Experiment``,
drives the ``Runner`` against the built-in ``python_cpu`` backend, and writes
a checkpoint plus a diagnostics summary under ``temp_runs/<run_id>/``.

Usage::

    python examples/simple_rate_equations/run.py
    python examples/simple_rate_equations/run.py --max-steps 200 --seed 7
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.paths import temp_runs_root
from simworkbench.runtime import Runner


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--end-time", type=str, default="100 ns")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--checkpoint-every", type=int, default=25)
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
                "diagnostics": {
                    k: list(v) for k, v in result.diagnostics.items() if k == "time_seconds"
                },
                "species_trajectories": {
                    name: list(result.diagnostics[name])
                    for name in (s.name for s in spec.species)
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    A_final = result.diagnostics["A"][-1]
    B_final = result.diagnostics["B"][-1]
    print()
    print(f"[done] state = {result.state.value}")
    print(f"[done] t_final = {result.final_simulation_time:.3e} s")
    print(f"[done] A(t_final) = {A_final:.6e} 1/m^3")
    print(f"[done] B(t_final) = {B_final:.6e} 1/m^3")
    print(f"[done] summary = {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
