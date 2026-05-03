"""Run checkpoint write / restore.

Phase 1 uses pickle for the checkpoint payload — it round-trips numpy arrays
and dataclasses correctly, and the checkpoint format will be re-specified in
Phase 2 (ADR-0002 finalizes HDF5/Zarr). The on-disk layout
(`temp_runs/<run_id>/checkpoints/step_NNNNNN.pkl`) is stable; only the file
format changes in Phase 2.

All checkpoint paths resolve under ``temp_runs/`` or a capsule's
``results/checkpoints/`` — never ``/tmp/``, never ``~/``. The runner enforces
this via ``simworkbench.paths.is_under_workbench``. See
``bugs_and_fixes/agent_error_patterns.md`` "Writing program artifacts outside
the project directory".
"""

from __future__ import annotations

import json
import pickle
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from simworkbench.paths import is_under_workbench, temp_runs_root


@dataclass
class Checkpoint:
    """One run checkpoint.

    Captures everything needed to resume a run deterministically on the same
    backend: time, step index, opaque solver state, RNG state, and metadata.
    """

    run_id: str
    step: int
    time_seconds: float
    state: Any  # backend-specific opaque payload (e.g. species densities array)
    rng_state: Any | None = None  # numpy.random.Generator.bit_generator.state, etc.
    backend: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


def checkpoint_dir(run_id: str, *, base: Path | None = None) -> Path:
    """Resolve and (if allowed) create the checkpoint directory for ``run_id``.

    Default base is ``<repo>/temp_runs/<run_id>/checkpoints/``. ``base`` lets
    callers point at a capsule's ``results/checkpoints/`` instead.

    **Validation runs BEFORE any side effect.** If the resolved target lies
    outside the four allowed workbench roots the function raises
    ``PermissionError`` and creates nothing — guards against
    `agent_error_patterns.md` "Side-effecting before validating".
    """
    if base is None:
        base = temp_runs_root() / run_id
    target = Path(base) / "checkpoints"
    if not is_under_workbench(target):
        raise PermissionError(
            f"Refusing to create checkpoint directory outside workbench-managed roots: {target}"
        )
    target.mkdir(parents=True, exist_ok=True)
    return target


def write_checkpoint(checkpoint: Checkpoint, *, base: Path | None = None) -> Path:
    """Write ``checkpoint`` to disk; return the resulting path.

    Refuses to write outside the four allowed workbench roots. The refusal
    is enforced by ``checkpoint_dir()``'s pre-mkdir guard so the disk is
    never touched on rejection. Honors `agent_error_patterns.md` "Writing
    program artifacts outside the project directory" AND "Side-effecting
    before validating".
    """
    target_dir = checkpoint_dir(checkpoint.run_id, base=base)
    path = target_dir / f"step_{checkpoint.step:06d}.pkl"
    with path.open("wb") as fh:
        pickle.dump(checkpoint, fh, protocol=pickle.HIGHEST_PROTOCOL)
    # Companion JSON sidecar with the small fields, for ad-hoc inspection
    # without unpickling. State is omitted (it can be huge / non-JSON).
    sidecar = path.with_suffix(".json")
    with sidecar.open("w", encoding="utf-8") as fh:
        json.dump(
            {
                "run_id": checkpoint.run_id,
                "step": checkpoint.step,
                "time_seconds": checkpoint.time_seconds,
                "backend": checkpoint.backend,
                "metadata": checkpoint.metadata,
            },
            fh,
            indent=2,
        )
    return path


def read_checkpoint(path: Path | str) -> Checkpoint:
    """Read a previously-written checkpoint."""
    p = Path(path)
    with p.open("rb") as fh:
        obj = pickle.load(fh)
    if not isinstance(obj, Checkpoint):
        raise TypeError(
            f"Expected Checkpoint, got {type(obj).__name__} from {path}"
        )
    return obj


def latest_checkpoint(run_id: str, *, base: Path | None = None) -> Path | None:
    """Return the highest-step checkpoint path for ``run_id``, or None."""
    target_dir = checkpoint_dir(run_id, base=base)
    files = sorted(target_dir.glob("step_*.pkl"))
    return files[-1] if files else None


__all__ = [
    "Checkpoint",
    "checkpoint_dir",
    "latest_checkpoint",
    "read_checkpoint",
    "write_checkpoint",
]
