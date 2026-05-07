"""Phase 3A — Tool metadata schema.

Mirrors ``tool.yaml`` (plan §9.3) as a Pydantic model so loaders and the
registry both validate against the same shape. The model is strict —
unknown keys are rejected — so ``tool.yaml`` typos surface at load time
instead of silently being ignored.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .lifecycle import ToolStatus

ToolIOMode = Literal["inline", "artifact", "mixed"]
ToolFilesystemPermission = Literal["none", "read_artifacts", "write_artifacts"]
ToolNetworkPermission = Literal["none", "proxy_required"]
ToolRenderer = Literal[
    "scalar",
    "table",
    "timeseries",
    "heatmap",
    "particle_scatter",
    "image",
    "diagram",
    "file",
    "report",
    "json",
    "plot",
    "graph",
    "flow",
    "schema",
    "pipeline",
]
ToolArtifactKind = Literal[
    "scalar",
    "table",
    "timeseries",
    "heatmap",
    "particle_scatter",
    "image",
    "diagram",
    "file",
    "report",
    "json",
]
ToolDiagramType = Literal["graph", "flow", "schema", "pipeline"]


_UNSAFE_MIME_TYPES = {"text/html", "application/xhtml+xml"}


def _reject_path_shaped_identifier(value: str, *, field_name: str) -> str:
    """Reject identifiers that could become filesystem paths.

    Tool metadata must describe ports/artifacts, not provide storage paths.
    Paths are derived server-side by the artifact materializer.
    """
    if not value.strip():
        raise ValueError(f"{field_name} must not be blank")
    if value.strip() != value:
        raise ValueError(f"{field_name} must not have leading/trailing whitespace")
    if value in {".", ".."} or value.startswith(".."):
        raise ValueError(f"{field_name} must not traverse directories")
    if "/" in value or "\\" in value:
        raise ValueError(f"{field_name} must be an identifier, not a path")
    return value


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


class ToolIOContract(BaseModel):
    """Runtime I/O policy for a tool.

    ``mixed`` is the default because small scalar outputs stay inline while
    table/file/diagram outputs are materialized as artifacts.
    """

    model_config = ConfigDict(extra="forbid")

    mode: ToolIOMode = "mixed"
    max_inline_bytes: int = 65_536

    @field_validator("max_inline_bytes")
    @classmethod
    def _positive_inline_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("io.max_inline_bytes must be positive")
        return value


class ToolPermissions(BaseModel):
    """Declared capabilities a tool needs before execution.

    High-risk actions must name an approval declaration. The local API only
    records this in preview/run metadata; secure-core enforces the workspace
    approval flow before side effects.
    """

    model_config = ConfigDict(extra="forbid")

    filesystem: ToolFilesystemPermission = "none"
    network: ToolNetworkPermission = "none"
    high_risk_actions: list[str] = Field(default_factory=list)
    approval_required: list[str] = Field(default_factory=list)

    @field_validator("high_risk_actions", "approval_required")
    @classmethod
    def _action_names_are_identifiers(cls, values: list[str]) -> list[str]:
        return [
            _reject_path_shaped_identifier(value, field_name="permission action")
            for value in values
        ]

    @model_validator(mode="after")
    def _high_risk_actions_have_approvals(self) -> ToolPermissions:
        if self.high_risk_actions and not self.approval_required:
            raise ValueError(
                "permissions.high_risk_actions requires "
                "permissions.approval_required declarations"
            )
        missing = set(self.high_risk_actions) - set(self.approval_required)
        if missing:
            raise ValueError(
                "permissions.approval_required must include every high-risk "
                f"action; missing {sorted(missing)!r}"
            )
        return self


class ToolInputGroup(BaseModel):
    """UI grouping for related input ports."""

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    ports: list[str] = Field(default_factory=list)
    collapsed: bool = False

    @field_validator("id")
    @classmethod
    def _id_is_identifier(cls, value: str) -> str:
        return _reject_path_shaped_identifier(value, field_name="ui.input_groups.id")

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ui.input_groups.title must not be blank")
        return value


class ToolOutputView(BaseModel):
    """UI renderer preference for one output port."""

    model_config = ConfigDict(extra="forbid")

    port: str
    renderer: ToolRenderer
    title: str | None = None

    @field_validator("port")
    @classmethod
    def _port_is_identifier(cls, value: str) -> str:
        return _reject_path_shaped_identifier(value, field_name="ui.output_views.port")


class ToolUI(BaseModel):
    """UI hints for schema-derived tool binding."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    input_groups: list[ToolInputGroup] = Field(default_factory=list)
    output_views: list[ToolOutputView] = Field(default_factory=list)

    @field_validator("display_name")
    @classmethod
    def _display_name_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("ui.display_name must not be blank when provided")
        return value


class ToolArtifactDeclaration(BaseModel):
    """Declared materialized output for a tool port.

    The declaration intentionally omits ``storage_path`` and ``content_hash``;
    both are derived by the run manager after execution.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    kind: ToolArtifactKind
    mime_type: str = "application/json"
    diagram_type: ToolDiagramType | None = None
    description: str = ""

    @field_validator("name")
    @classmethod
    def _name_is_identifier(cls, value: str) -> str:
        return _reject_path_shaped_identifier(value, field_name="artifacts.outputs.name")

    @field_validator("mime_type")
    @classmethod
    def _mime_type_is_safe(cls, value: str) -> str:
        mime = value.strip().lower()
        if not mime:
            raise ValueError("artifacts.outputs.mime_type must not be blank")
        if mime in _UNSAFE_MIME_TYPES:
            raise ValueError(
                "raw HTML artifact declarations are refused; use a structured "
                "diagram, report, json, image, table, or file artifact instead"
            )
        return mime

    @model_validator(mode="after")
    def _diagram_declarations_are_structured(self) -> ToolArtifactDeclaration:
        if self.kind == "diagram" and self.diagram_type is None:
            raise ValueError(
                "diagram artifacts must declare a safe diagram_type "
                "(graph, flow, schema, or pipeline)"
            )
        if self.kind != "diagram" and self.diagram_type is not None:
            raise ValueError(
                "artifacts.outputs.diagram_type is only valid when kind=diagram"
            )
        return self


class ToolArtifacts(BaseModel):
    """Materialized output declarations keyed by output port name."""

    model_config = ConfigDict(extra="forbid")

    outputs: list[ToolArtifactDeclaration] = Field(default_factory=list)


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
    io: ToolIOContract = Field(default_factory=ToolIOContract)
    permissions: ToolPermissions = Field(default_factory=ToolPermissions)
    ui: ToolUI = Field(default_factory=ToolUI)
    artifacts: ToolArtifacts = Field(default_factory=ToolArtifacts)

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

    @model_validator(mode="after")
    def _metadata_sections_reference_declared_ports(self) -> ToolMetadata:
        inputs = {port.name for port in self.inputs}
        outputs = {port.name for port in self.outputs}

        for group in self.ui.input_groups:
            unknown = [name for name in group.ports if name not in inputs]
            if unknown:
                raise ValueError(
                    f"ui.input_groups[{group.id!r}] references undeclared "
                    f"input port(s): {unknown!r}"
                )

        for view in self.ui.output_views:
            if view.port not in outputs:
                raise ValueError(
                    f"ui.output_views references undeclared output port: "
                    f"{view.port!r}"
                )

        for artifact in self.artifacts.outputs:
            if artifact.name not in outputs:
                raise ValueError(
                    "artifacts.outputs references undeclared output port: "
                    f"{artifact.name!r}"
                )
        return self


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
    "ToolArtifactDeclaration",
    "ToolArtifactKind",
    "ToolArtifacts",
    "ToolDiagramType",
    "ToolFilesystemPermission",
    "ToolIOContract",
    "ToolIOMode",
    "ToolInputGroup",
    "ToolMetadata",
    "ToolNetworkPermission",
    "ToolOutputView",
    "ToolPermissions",
    "ToolPort",
    "ToolRenderer",
    "ToolRequires",
    "ToolUI",
    "ToolValidation",
    "load_tool_yaml",
    "write_tool_yaml",
]
