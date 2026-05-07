"""UI-safe normalized tool contracts.

The registry's ``ToolMetadata`` mirrors ``tool.yaml`` exactly, including
implementation-facing fields such as ``entrypoint`` and validation-test paths.
This module projects that strict metadata into the smaller contract consumed by
the API/UI and provides request validation for preview/run endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .metadata import ToolArtifactDeclaration, ToolMetadata, ToolPort


class ToolSchemaError(ValueError):
    """Raised when a tool request violates the normalized contract."""


_ARTIFACT_PORT_TYPES = {
    "table",
    "timeseries",
    "heatmap",
    "particle_scatter",
    "figure",
    "image",
    "diagram",
    "file",
    "report",
}


@dataclass(frozen=True)
class ToolInputValidation:
    """Validated API request shape for a tool run."""

    kwargs: dict[str, Any]
    units: dict[str, str]


def normalize_tool_schema(metadata: ToolMetadata) -> dict[str, Any]:
    """Return the UI-safe contract for a tool.

    The response intentionally omits Python internals (``entrypoint``), local
    filesystem paths, validation-test paths, and any server-derived storage
    facts. It is safe for the browser to use as the source for input forms,
    renderer selection, and preview/run controls.
    """

    artifacts = [_artifact_to_schema(item) for item in planned_artifacts(metadata)]
    return {
        "name": metadata.name,
        "version": metadata.version,
        "type": metadata.type,
        "description": metadata.description,
        "author": metadata.author,
        "status": metadata.status.value,
        "inputs": [
            _port_to_schema(port, required=True, kind=_input_kind_for_port(port))
            for port in metadata.inputs
        ],
        "outputs": [
            _port_to_schema(
                port,
                required=False,
                kind=_output_kind_for_port(port),
                renderer=_renderer_for_output(metadata, port.name),
            )
            for port in metadata.outputs
        ],
        "io": metadata.io.model_dump(mode="json"),
        "permissions": metadata.permissions.model_dump(mode="json"),
        "ui": metadata.ui.model_dump(mode="json"),
        "artifacts": {"outputs": artifacts},
        "validation": {
            "has_tests": bool(metadata.validation.tests),
            "test_count": len(metadata.validation.tests),
            "reference_case_count": len(metadata.validation.reference_cases),
        },
        "actions": {
            "can_preview": True,
            "can_run": True,
            "can_execute_compat": True,
        },
    }


def validate_tool_run_request(
    metadata: ToolMetadata,
    *,
    kwargs: dict[str, Any],
    units: dict[str, str] | None = None,
) -> ToolInputValidation:
    """Validate the JSON request body for preview/run endpoints.

    All declared inputs are required for now. Optional inputs can be introduced
    later as explicit metadata; treating absence as optional would make tool
    behavior depend on hidden defaults.
    """

    unit_map = dict(units or {})
    declared_inputs = {port.name: port for port in metadata.inputs}
    supplied = set(kwargs)
    declared = set(declared_inputs)

    missing = sorted(declared - supplied)
    if missing:
        raise ToolSchemaError(f"Missing required tool input(s): {missing!r}")

    unknown = sorted(supplied - declared)
    if unknown:
        raise ToolSchemaError(f"Unknown tool input(s): {unknown!r}")

    unknown_units = sorted(set(unit_map) - declared)
    if unknown_units:
        raise ToolSchemaError(f"Units supplied for unknown input(s): {unknown_units!r}")

    for port in metadata.inputs:
        if port.type == "array" and port.units and port.name not in unit_map:
            raise ToolSchemaError(
                f"Input {port.name!r} requires units compatible with "
                f"{port.units!r}; include it in the units object."
            )

    return ToolInputValidation(kwargs=dict(kwargs), units=unit_map)


def planned_artifacts(metadata: ToolMetadata) -> list[ToolArtifactDeclaration]:
    """Return explicit and inferred materialized artifacts for a tool."""

    explicit = {artifact.name: artifact for artifact in metadata.artifacts.outputs}
    planned: list[ToolArtifactDeclaration] = []
    for port in metadata.outputs:
        if port.name in explicit:
            planned.append(explicit[port.name])
            continue
        if metadata.io.mode == "artifact" or port.type in _ARTIFACT_PORT_TYPES:
            planned.append(_infer_artifact_for_port(port))
    return planned


def artifact_for_output(
    metadata: ToolMetadata,
    port_name: str,
) -> ToolArtifactDeclaration | None:
    """Return the artifact declaration for an output port, if materialized."""

    for artifact in planned_artifacts(metadata):
        if artifact.name == port_name:
            return artifact
    return None


def _port_to_schema(
    port: ToolPort,
    *,
    required: bool,
    kind: str,
    renderer: str | None = None,
) -> dict[str, Any]:
    return {
        "name": port.name,
        "kind": kind,
        "type": port.type,
        "units": port.units,
        "description": port.description,
        "required": required,
        **({"renderer": renderer} if renderer is not None else {}),
    }


def _input_kind_for_port(port: ToolPort) -> str:
    port_type = port.type.lower()
    if port_type in {
        "scalar",
        "array",
        "table",
        "string",
        "bool",
        "enum",
        "file",
        "capsule",
    }:
        return port_type
    for token, kind in (
        ("bool", "bool"),
        ("table", "table"),
        ("array", "array"),
        ("vector", "array"),
        ("list", "array"),
        ("file", "file"),
        ("artifact", "file"),
        ("capsule", "capsule"),
        ("string", "string"),
        ("text", "string"),
    ):
        if token in port_type:
            return kind
    return "scalar"


def _output_kind_for_port(port: ToolPort) -> str:
    port_type = port.type.lower()
    if port_type == "figure":
        return "image"
    if port_type in {
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
    }:
        return port_type
    for token, kind in (
        ("table", "table"),
        ("series", "timeseries"),
        ("diagram", "diagram"),
        ("graph", "diagram"),
        ("flow", "diagram"),
        ("image", "image"),
        ("figure", "image"),
        ("file", "file"),
        ("report", "report"),
        ("markdown", "report"),
        ("json", "json"),
        ("object", "json"),
    ):
        if token in port_type:
            return kind
    return "scalar"


def _renderer_for_output(metadata: ToolMetadata, port_name: str) -> str | None:
    for view in metadata.ui.output_views:
        if view.port == port_name:
            return view.renderer
    artifact = artifact_for_output(metadata, port_name)
    if artifact is not None and artifact.kind == "diagram" and artifact.diagram_type:
        return artifact.diagram_type
    if artifact is not None:
        return artifact.kind
    return None


def _artifact_to_schema(artifact: ToolArtifactDeclaration) -> dict[str, Any]:
    data = artifact.model_dump(mode="json")
    data.pop("description", None)
    if artifact.description:
        data["description"] = artifact.description
    return data


def _infer_artifact_for_port(port: ToolPort) -> ToolArtifactDeclaration:
    kind = port.type
    mime_type = "application/json"
    diagram_type = None

    if kind == "figure":
        kind = "image"
        mime_type = "image/png"
    elif kind == "image":
        mime_type = "image/png"
    elif kind == "report":
        mime_type = "text/markdown"
    elif kind == "file":
        mime_type = "application/octet-stream"
    elif kind == "diagram":
        diagram_type = "graph"

    if kind not in {
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
    }:
        kind = "json"

    return ToolArtifactDeclaration(
        name=port.name,
        kind=kind,  # type: ignore[arg-type]
        mime_type=mime_type,
        diagram_type=diagram_type,  # type: ignore[arg-type]
        description=port.description,
    )


__all__ = [
    "ToolInputValidation",
    "ToolSchemaError",
    "artifact_for_output",
    "normalize_tool_schema",
    "planned_artifacts",
    "validate_tool_run_request",
]
