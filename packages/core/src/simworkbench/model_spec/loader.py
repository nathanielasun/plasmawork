"""Load and save ModelSpec YAML.

YAML at rest, Pydantic in memory. Quantities round-trip as strings — see
``types.Quantity``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from .types import ModelSpec


class ModelSpecError(ValueError):
    """Raised when a ModelSpec YAML / dict fails to validate."""


def from_dict(data: dict[str, Any]) -> ModelSpec:
    """Validate a dict and return a ``ModelSpec`` (or raise ``ModelSpecError``)."""
    try:
        return ModelSpec.model_validate(data)
    except ValidationError as exc:
        raise ModelSpecError(f"ModelSpec validation failed:\n{exc}") from exc


def load_yaml(path: str | Path) -> ModelSpec:
    """Load a ModelSpec from a YAML file path."""
    text = Path(path).read_text(encoding="utf-8")
    return load_yaml_str(text, source=str(path))


def load_yaml_str(text: str, *, source: str = "<string>") -> ModelSpec:
    """Load a ModelSpec from a YAML string. ``source`` decorates errors."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise ModelSpecError(f"YAML parse error in {source}: {exc}") from exc
    if not isinstance(data, dict):
        raise ModelSpecError(
            f"ModelSpec YAML must parse to a mapping at the top level; "
            f"{source} parsed to {type(data).__name__}."
        )
    return from_dict(data)


def to_dict(spec: ModelSpec) -> dict[str, Any]:
    """Serialize a ``ModelSpec`` to a plain dict (with quantity strings)."""
    return spec.model_dump(by_alias=True, mode="json")


def to_yaml(spec: ModelSpec) -> str:
    """Serialize a ``ModelSpec`` to a YAML string."""
    return yaml.safe_dump(to_dict(spec), sort_keys=False, indent=2)


def save_yaml(spec: ModelSpec, path: str | Path) -> None:
    """Write a ``ModelSpec`` to a YAML file."""
    Path(path).write_text(to_yaml(spec), encoding="utf-8")


__all__ = [
    "ModelSpecError",
    "from_dict",
    "load_yaml",
    "load_yaml_str",
    "save_yaml",
    "to_dict",
    "to_yaml",
]
