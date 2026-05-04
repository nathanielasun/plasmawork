"""Phase 8 — Backend metadata Pydantic shape.

Mirrors ``configs/backends.yaml`` one-to-one. The registry uses this
to cross-check the YAML at load time so a malformed entry fails
loudly (rule 20: "Registry discovery does not hide invalid metadata").
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class BackendSupports(BaseModel):
    """What a backend can run against."""

    model_config = ConfigDict(extra="allow")

    domains: list[str] = Field(default_factory=list)
    geometries: list[int] = Field(default_factory=list)
    precision: list[str] = Field(default_factory=list)


class BackendDependencies(BaseModel):
    """Declared dependencies. Free-form lists per category."""

    model_config = ConfigDict(extra="allow")

    python: list[str] = Field(default_factory=list)
    build: list[str] = Field(default_factory=list)
    runtime: list[str] = Field(default_factory=list)
    external: list[str] = Field(default_factory=list)


class BackendMetadata(BaseModel):
    """Phase 8 / 8A — one ``configs/backends.yaml`` entry.

    ``status`` is a Pydantic ``Literal`` of the five valid lifecycle
    values; arbitrary strings are refused at load time. Phase-8 audit
    found a plain ``str`` field accepted ``status: totally_invalid``
    silently, and the failure only surfaced when ``.status`` was
    accessed downstream (carries the new pattern "Plain str field
    where a Literal/enum belongs" — see
    `agent_error_patterns.md`).
    """

    model_config = ConfigDict(extra="allow")

    name: str
    status: Literal[
        "planned",
        "in_progress",
        "validated",
        "trusted",
        "deprecated",
    ] = "planned"
    phase: int = 8
    description: str = ""
    supports: BackendSupports = Field(default_factory=BackendSupports)
    dependencies: BackendDependencies = Field(default_factory=BackendDependencies)
    determinism: bool = True


class _BackendsRoot(BaseModel):
    """Internal Pydantic shape for the YAML root."""

    model_config = ConfigDict(extra="allow")

    backends: list[BackendMetadata]
    selection_policy: dict[str, Any] = Field(default_factory=dict)


def load_backends_yaml(path: str | Path) -> tuple[list[BackendMetadata], dict[str, Any]]:
    """Load ``configs/backends.yaml`` into a list of metadata + the
    selection policy block.

    Raises a structured ``ValidationError`` (Pydantic) when an entry
    is malformed. The registry catches this and re-raises a
    ``BackendRegistryError`` carrying the file path so callers learn
    which file failed to parse (carries Phase-7 audit rule 20:
    "Registry discovery does not hide invalid metadata").
    """
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"backends.yaml must parse to a mapping: {path}")
    parsed = _BackendsRoot.model_validate(raw)
    return list(parsed.backends), dict(parsed.selection_policy)


__all__ = [
    "BackendDependencies",
    "BackendMetadata",
    "BackendSupports",
    "ValidationError",
    "load_backends_yaml",
]
