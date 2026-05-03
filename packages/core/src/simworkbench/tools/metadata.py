"""Phase 3A — Tool metadata schema.

Mirrors ``tool.yaml`` (plan §9.3) as a Pydantic model so loaders and the
registry both validate against the same shape. The model is strict —
unknown keys are rejected — so ``tool.yaml`` typos surface at load time
instead of silently being ignored.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .lifecycle import ToolStatus


class ToolPort(BaseModel):
    """One row of the ``inputs:`` or ``outputs:`` list in ``tool.yaml``.

    ``units`` is optional — figures, tables, and categorical results don't
    have units. When the ``type`` is ``array``, units MUST be present;
    arrays without units would silently re-introduce raw floats at the
    scientific boundary (plan §22 / `agent_error_patterns.md` "Letting
    `dict[str, Any]` bypass scientific boundary validation").
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    type: str  # array | scalar | table | figure | string | bool | ...
    units: str | None = None
    description: str = ""

    @field_validator("name")
    @classmethod
    def _no_blanks(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Tool port name must not be blank")
        return v


class ToolRequires(BaseModel):
    model_config = ConfigDict(extra="forbid")

    python: list[str] = Field(default_factory=list)
    system: list[str] = Field(default_factory=list)


class ToolValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tests: list[str] = Field(default_factory=list)
    reference_cases: list[str] = Field(default_factory=list)


class ToolMetadata(BaseModel):
    """Validated representation of a single ``tool.yaml`` file.

    Strict (``extra="forbid"``) so authors can't smuggle undeclared fields
    past the registry. The registry also validates that ``entrypoint``
    resolves to an importable class that subclasses ``BaseTool``.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    version: str
    # diagnostic | visualization | import | physics | solver | validation | export | agent
    type: str
    description: str = ""
    author: str = "local"
    status: ToolStatus = ToolStatus.DRAFT
    entrypoint: str  # "src/tool.py:ClassName"

    inputs: list[ToolPort] = Field(default_factory=list)
    outputs: list[ToolPort] = Field(default_factory=list)

    compatible_domains: list[str] = Field(default_factory=list)
    requires: ToolRequires = Field(default_factory=ToolRequires)
    validation: ToolValidation = Field(default_factory=ToolValidation)

    @field_validator("entrypoint")
    @classmethod
    def _entrypoint_format(cls, v: str) -> str:
        if ":" not in v:
            raise ValueError(
                "Tool entrypoint must be 'relative/path/to/module.py:ClassName'"
            )
        return v

    @field_validator("inputs", "outputs")
    @classmethod
    def _array_ports_have_units(cls, ports: list[ToolPort]) -> list[ToolPort]:
        for port in ports:
            if port.type == "array" and not port.units:
                raise ValueError(
                    f"Array tool port {port.name!r} must declare units; "
                    "raw floats are not allowed at the tool boundary "
                    "(plan §22 / `agent_error_patterns.md` "
                    "'Letting dict[str, Any] bypass scientific boundary "
                    "validation')."
                )
        return ports


def load_tool_yaml(path: str | Path) -> ToolMetadata:
    """Parse and validate a ``tool.yaml`` file."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"tool.yaml at {path} did not parse to a mapping")
    return ToolMetadata.model_validate(raw)


def write_tool_yaml(metadata: ToolMetadata, path: str | Path) -> None:
    """Serialize ``ToolMetadata`` back to YAML at ``path``.

    Mostly used by the registry when promoting/demoting status.
    """
    target = Path(path)
    data: dict[str, Any] = metadata.model_dump(mode="json")
    target.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


__all__ = [
    "ToolMetadata",
    "ToolPort",
    "ToolRequires",
    "ToolValidation",
    "load_tool_yaml",
    "write_tool_yaml",
]
