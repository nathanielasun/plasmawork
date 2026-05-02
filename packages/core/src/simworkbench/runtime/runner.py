"""Simulation runner.

Provides the start/pause/resume/stop/checkpoint API for Phase 1 manual runs.
The runner consumes an ``Experiment`` (which bundles a ``ModelSpec``,
``RunConfig``, ``BackendConfig``, ``DiagnosticConfig``) and drives a backend
that implements ``BackendProtocol``.

Phase 1 ships with a single ``python_cpu`` backend that wraps
``scipy.integrate.solve_ivp`` for 0D rate-equation models. Other backends
register through ``register_backend``. Per ``bugs_and_fixes/
agent_error_patterns.md`` *Replacing validated solver calls with naive
generated loops*, the rate-equation runner uses scipy's vetted LSODA — never
a hand-rolled timestep loop.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Protocol, runtime_checkable

import numpy as np

from simworkbench.experiment import Experiment
from simworkbench.runtime.checkpoint import Checkpoint, write_checkpoint
from simworkbench.runtime.events import EventBus
from simworkbench.runtime.progress import ProgressTracker, ProgressUpdate
from simworkbench.runtime.seeds import SeedSet, derive


class RunState(str, Enum):
    """Lifecycle state of a ``Runner`` instance."""

    CREATED = "created"
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    STOPPED = "stopped"
    FAILED = "failed"


@runtime_checkable
class BackendProtocol(Protocol):
    """Interface every Phase 1 backend implements.

    The protocol is intentionally minimal: ``initialize`` returns an opaque
    state, ``step`` advances it by ``dt`` and returns the new state plus any
    diagnostic samples, ``serialize_state`` produces something pickle-safe for
    checkpoints, ``deserialize_state`` is the inverse. Backends own their own
    numerical methods.
    """

    name: str

    def initialize(self, experiment: Experiment, seeds: SeedSet) -> Any: ...

    def step(self, state: Any, dt: float) -> tuple[Any, dict[str, Any]]: ...

    def is_complete(self, state: Any) -> bool: ...

    def serialize_state(self, state: Any) -> Any: ...

    def deserialize_state(self, payload: Any) -> Any: ...


_BACKENDS: dict[str, BackendProtocol] = {}


def register_backend(backend: BackendProtocol) -> None:
    """Register ``backend`` so a ``Runner`` can resolve it by name."""
    _BACKENDS[backend.name] = backend


def get_backend(name: str) -> BackendProtocol:
    if name not in _BACKENDS:
        raise KeyError(
            f"Backend {name!r} is not registered. Known: {sorted(_BACKENDS)}."
        )
    return _BACKENDS[name]


def known_backends() -> tuple[str, ...]:
    return tuple(sorted(_BACKENDS))


@dataclass
class RunResult:
    """Final output of a completed run."""

    run_id: str
    state: RunState
    elapsed_seconds: float
    final_simulation_time: float
    final_state: Any
    diagnostics: dict[str, Any] = field(default_factory=dict)


class Runner:
    """Drives an ``Experiment`` against a backend with checkpointing and events.

    Lifecycle: ``CREATED → READY → RUNNING → (PAUSED ↔ RUNNING) → COMPLETED``
    (or ``STOPPED`` / ``FAILED``).

    Typical use::

        runner = Runner(experiment, base_seed=0)
        result = runner.run()                    # blocking
        # or, interactively:
        runner.start()
        while not runner.state.value in {"completed", "stopped"}:
            runner.step_for(0.1)                 # 100 ms wall-clock budget
            if some_condition: runner.pause()
        runner.resume()

    The runner emits events on ``runner.events`` and progress updates on
    ``runner.progress``. Checkpoints land under ``temp_runs/<run_id>/checkpoints/``
    via ``simworkbench.runtime.checkpoint``.
    """

    def __init__(
        self,
        experiment: Experiment,
        *,
        run_id: str | None = None,
        base_seed: int = 0,
        checkpoint_every: int | None = None,
    ) -> None:
        self.experiment = experiment
        self.run_id = run_id or _make_run_id()
        self.base_seed = base_seed
        self.checkpoint_every = checkpoint_every
        self.seeds: SeedSet = derive(base_seed, self.run_id)
        self.events = EventBus()
        self.progress = ProgressTracker()
        self.state = RunState.CREATED
        self._backend: BackendProtocol | None = None
        self._sim_state: Any = None
        self._sim_time: float = 0.0
        self._step_index: int = 0
        self._wall_started: float = 0.0
        self._diagnostics: dict[str, list[Any]] = {}

    # ----- public API ----------------------------------------------------

    def prepare(self) -> None:
        """Resolve backend, initialize state, and emit the READY event."""
        if self.state not in (RunState.CREATED, RunState.READY):
            raise RuntimeError(f"Cannot prepare from state {self.state.value}.")
        backend_name = self.experiment.backend_config.name
        try:
            self._backend = get_backend(backend_name)
        except KeyError as exc:
            self.state = RunState.FAILED
            self.events.emit("ERROR", "runtime", f"unknown backend: {exc}")
            raise
        self._sim_state = self._backend.initialize(self.experiment, self.seeds)
        self._sim_time = float(self._t_start_seconds())
        self._step_index = 0
        self.state = RunState.READY
        self.events.emit(
            "INFO",
            "runtime",
            "runner ready",
            run_id=self.run_id,
            backend=backend_name,
            base_seed=self.base_seed,
        )

    def _t_start_seconds(self) -> float:
        return float(self.experiment.run_config.start_time.to("seconds").magnitude)

    def _t_end_seconds(self) -> float:
        return float(self.experiment.run_config.end_time.to("seconds").magnitude)

    def _output_dt_seconds(self) -> float:
        """Derive the sample interval (output dt) from RunConfig.

        Strategy: divide the run window by ``max_steps`` if set, otherwise
        default to 100 output steps. Backends with adaptive solvers use this
        as the **sample** interval; their internal timestep is still
        solver-controlled.
        """
        rc = self.experiment.run_config
        window = self._t_end_seconds() - self._t_start_seconds()
        if window <= 0:
            return 0.0
        n_steps = rc.max_steps if rc.max_steps is not None else 100
        return window / n_steps

    def start(self) -> None:
        if self.state == RunState.CREATED:
            self.prepare()
        if self.state != RunState.READY:
            raise RuntimeError(f"Cannot start from state {self.state.value}.")
        self.state = RunState.RUNNING
        self._wall_started = time.perf_counter()
        self.events.emit("INFO", "runtime", "run started", run_id=self.run_id)

    def pause(self) -> None:
        if self.state != RunState.RUNNING:
            raise RuntimeError(f"Cannot pause from state {self.state.value}.")
        self.state = RunState.PAUSED
        self.events.emit("INFO", "runtime", "run paused", step=self._step_index)

    def resume(self) -> None:
        if self.state != RunState.PAUSED:
            raise RuntimeError(f"Cannot resume from state {self.state.value}.")
        self.state = RunState.RUNNING
        self.events.emit("INFO", "runtime", "run resumed", step=self._step_index)

    def stop(self) -> None:
        if self.state in (RunState.COMPLETED, RunState.STOPPED, RunState.FAILED):
            return
        self.state = RunState.STOPPED
        self.events.emit("WARN", "runtime", "run stopped", step=self._step_index)

    def step_once(self) -> None:
        """Advance one output step and update diagnostics."""
        if self.state != RunState.RUNNING:
            raise RuntimeError(f"Cannot step from state {self.state.value}.")
        backend = self._require_backend()
        dt = self._output_dt_seconds()
        try:
            new_state, samples = backend.step(self._sim_state, dt)
        except Exception as exc:  # noqa: BLE001 — runner converts to FAILED
            self.state = RunState.FAILED
            self.events.emit("ERROR", "runtime", "step failed", error=str(exc))
            raise
        self._sim_state = new_state
        self._sim_time += dt
        self._step_index += 1
        # Always record the simulation time so diagnostics align.
        self._diagnostics.setdefault("time_seconds", []).append(self._sim_time)
        for key, value in samples.items():
            self._diagnostics.setdefault(key, []).append(value)
        self.progress.update(
            step=self._step_index,
            total=self._estimated_total_steps(),
            message=f"t = {self._sim_time:.6g} s",
            elapsed_seconds=time.perf_counter() - self._wall_started,
        )
        if self.checkpoint_every and self._step_index % self.checkpoint_every == 0:
            self.checkpoint()
        # Termination: backend says complete OR we've reached t_end.
        if backend.is_complete(self._sim_state) or self._sim_time >= self._t_end_seconds() - 1e-12:
            self.state = RunState.COMPLETED
            self.progress.finish(message="run complete")
            self.events.emit(
                "INFO",
                "runtime",
                "run completed",
                step=self._step_index,
                t_final=self._sim_time,
            )

    def step_for(self, wall_seconds: float) -> int:
        """Advance for at most ``wall_seconds`` of wall-clock time. Return step count."""
        budget_end = time.perf_counter() + max(0.0, wall_seconds)
        steps = 0
        while self.state == RunState.RUNNING and time.perf_counter() < budget_end:
            self.step_once()
            steps += 1
        return steps

    def run(self) -> RunResult:
        """Blocking driver: prepare → start → step until terminal."""
        if self.state == RunState.CREATED:
            self.prepare()
        if self.state == RunState.READY:
            self.start()
        while self.state == RunState.RUNNING:
            self.step_once()
        return self.result()

    def checkpoint(self) -> Checkpoint:
        """Write the current state as a checkpoint and return it."""
        backend = self._require_backend()
        chk = Checkpoint(
            run_id=self.run_id,
            step=self._step_index,
            time_seconds=self._sim_time,
            state=backend.serialize_state(self._sim_state),
            backend=backend.name,
            metadata={"base_seed": self.base_seed},
        )
        path = write_checkpoint(chk)
        self.events.emit("INFO", "runtime", "checkpoint written", path=str(path))
        return chk

    def restore(self, checkpoint: Checkpoint) -> None:
        """Restore runner state from a previously-written checkpoint.

        The runner must be in CREATED or READY; backends do not currently
        support restoring mid-run.
        """
        if self.state not in (RunState.CREATED, RunState.READY):
            raise RuntimeError(
                f"Cannot restore from state {self.state.value}; restore from a fresh runner."
            )
        if self._backend is None:
            self.prepare()
        backend = self._require_backend()
        if checkpoint.backend and checkpoint.backend != backend.name:
            raise ValueError(
                f"Checkpoint backend {checkpoint.backend!r} does not match runner backend "
                f"{backend.name!r}."
            )
        self._sim_state = backend.deserialize_state(checkpoint.state)
        self._sim_time = checkpoint.time_seconds
        self._step_index = checkpoint.step
        self.state = RunState.READY
        self.events.emit(
            "INFO",
            "runtime",
            "checkpoint restored",
            step=checkpoint.step,
            time_seconds=checkpoint.time_seconds,
        )

    def result(self) -> RunResult:
        return RunResult(
            run_id=self.run_id,
            state=self.state,
            elapsed_seconds=(
                time.perf_counter() - self._wall_started if self._wall_started else 0.0
            ),
            final_simulation_time=self._sim_time,
            final_state=self._sim_state,
            diagnostics={k: list(v) for k, v in self._diagnostics.items()},
        )

    # ----- helpers -------------------------------------------------------

    def _require_backend(self) -> BackendProtocol:
        if self._backend is None:
            raise RuntimeError("Runner backend is not initialized; call prepare() first.")
        return self._backend

    def _estimated_total_steps(self) -> int | None:
        dt = self._output_dt_seconds()
        if dt <= 0:
            return None
        return int(np.ceil((self._t_end_seconds() - self._t_start_seconds()) / dt))


def _make_run_id() -> str:
    """Generate a stable-ish run id (UUID4 short form)."""
    return uuid.uuid4().hex[:12]


__all__ = [
    "BackendProtocol",
    "RunResult",
    "RunState",
    "Runner",
    "get_backend",
    "known_backends",
    "register_backend",
]
