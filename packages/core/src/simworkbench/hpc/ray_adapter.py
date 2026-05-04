"""Phase 8 / 8E — Ray adapter (optional dep).

Ray is an optional dependency. The adapter exposes a minimal
submission interface; missing dep returns a structured ``RayUnavailable``
error so callers can fall back to Slurm or local runs.
"""

from __future__ import annotations

from dataclasses import dataclass

from simworkbench.experiment import Experiment


class RayUnavailable(RuntimeError):
    """The Ray runtime is not installed in the current Python env."""


@dataclass
class RayAdapter:
    """Submit an Experiment to a Ray cluster.

    Phase 8 ships the contract; the actual Ray submission is wired
    when a downstream user opts in (`pip install ray`).
    """

    address: str = "auto"
    runtime_env: dict[str, object] | None = None

    def is_available(self) -> bool:
        try:
            import ray  # type: ignore[import-untyped]  # noqa: F401
            return True
        except Exception:  # noqa: BLE001
            return False

    def submit(self, experiment: Experiment) -> str:
        """Submit ``experiment`` to a Ray cluster. Returns the Ray
        actor / task id as a string. Raises ``RayUnavailable`` if
        Ray isn't installed.
        """
        try:
            import ray  # type: ignore[import-untyped]
        except Exception as exc:  # noqa: BLE001
            raise RayUnavailable(
                "ray is not installed. Install with `pip install ray` and "
                "restart the workbench, or use SlurmJob instead."
            ) from exc
        if not ray.is_initialized():
            ray.init(address=self.address, runtime_env=self.runtime_env or {})
        # We register a thin Ray remote that re-runs the experiment.
        # The wrapper imports the workbench inside the worker; if the
        # Ray cluster doesn't have it installed, the worker raises a
        # clean ImportError.
        @ray.remote  # type: ignore[misc]
        def _remote_run(experiment_payload: dict) -> dict:
            from simworkbench.experiment import Experiment
            from simworkbench.runtime import Runner

            exp = Experiment.from_dict(experiment_payload)
            result = Runner(exp, base_seed=exp.run_config.seed).run()
            return {
                "run_id": result.run_id,
                "state": result.state.value,
                "elapsed_seconds": result.elapsed_seconds,
                "final_simulation_time": result.final_simulation_time,
                "diagnostics": {k: list(v) for k, v in result.diagnostics.items()},
                "placeholders": list(result.placeholders),
            }

        ref = _remote_run.remote(experiment.to_dict())
        return str(ref)


__all__ = ["RayAdapter", "RayUnavailable"]
