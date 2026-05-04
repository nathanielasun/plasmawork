"""Phase 8 / 8E — Remote result import.

Reads a ``result.json`` produced by ``SlurmJob.write()``'s
``run_remote.py`` (or by a Ray actor that follows the same shape)
and reconstitutes a ``RunResult``-shaped object the local UI can
consume identically to a local run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ImportedRemoteResult:
    """``RunResult``-shaped projection of a remote run.

    Mirrors ``simworkbench.runtime.RunResult`` so consumers can
    handle local + remote results uniformly. The ``final_state``
    field is intentionally not included — remote runs return
    diagnostics + scalars, not the backend's internal state object.
    """

    run_id: str
    state: str
    elapsed_seconds: float
    final_simulation_time: float
    diagnostics: dict[str, list[float]] = field(default_factory=dict)
    placeholders: list[str] = field(default_factory=list)
    backend: str = ""
    error: str = ""


def import_remote_result(path: str | Path) -> ImportedRemoteResult:
    """Load ``result.json`` produced by a remote run.

    Raises ``ValueError`` if the file carries a remote-side error
    field — the caller can surface it to the user.
    """
    payload: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    if "error" in payload:
        raise ValueError(
            f"Remote run reported an error: {payload['error']}\n"
            f"  (full payload at {path})"
        )
    return ImportedRemoteResult(
        run_id=str(payload.get("run_id", "")),
        state=str(payload.get("state", "")),
        elapsed_seconds=float(payload.get("elapsed_seconds", 0.0)),
        final_simulation_time=float(payload.get("final_simulation_time", 0.0)),
        diagnostics={
            k: list(v) for k, v in (payload.get("diagnostics") or {}).items()
        },
        placeholders=list(payload.get("placeholders") or []),
        backend=str(payload.get("backend", "")),
    )


__all__ = ["ImportedRemoteResult", "import_remote_result"]
