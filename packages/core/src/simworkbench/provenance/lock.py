"""Phase 2B — `provenance.lock` writer/reader.

Per ADR-0002 (Accepted), the lock format is TOML. The Pydantic model below
captures the lock fields the workbench writes for every run; downstream
tooling reads it back via ``load_lock``.
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProvenanceLock(BaseModel):
    """Authoritative provenance record for one capsule.

    Fields chosen to satisfy plan §2.4 ("Reproducibility by default") and
    §7.1's `provenance/provenance.lock` slot: a saved capsule should be
    reproducible from the data this lock carries, modulo backend-determinism
    caveats noted in plan §11.3.
    """

    model_config = ConfigDict(extra="forbid")

    workbench_version: str
    python_version: str
    platform: str
    capsule_format_version: str
    run_id: str
    base_seed: int
    backend: str
    model_spec_hash: str = ""  # SHA-256 of model_spec.yaml (Phase 2B-onwards)
    placeholders: list[str] = Field(default_factory=list)
    parent_capsule_hash: str = ""  # populated on forks
    created_at: str  # ISO-8601 UTC


def write_lock(lock: ProvenanceLock, path: str | Path) -> None:
    """Write a ``ProvenanceLock`` as TOML at ``path``.

    Hand-rolled flat-TOML writer (like ``manifest.py``) to avoid an extra
    dependency for a tiny use case.
    """
    data = lock.model_dump(mode="python")
    lines = [f"{key} = {_toml_value(value)}" for key, value in data.items()]
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_lock(path: str | Path) -> ProvenanceLock:
    """Read a TOML provenance lock from ``path`` and validate it."""
    with Path(path).open("rb") as fh:
        data = tomllib.load(fh)
    return ProvenanceLock.model_validate(data)


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    raise TypeError(
        f"Unsupported TOML value type for provenance lock: {type(value).__name__}"
    )


__all__ = ["ProvenanceLock", "load_lock", "write_lock"]
