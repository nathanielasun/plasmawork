"""Tool metadata contract expansion tests."""

from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError
from simworkbench.paths import repo_root
from simworkbench.tools import ToolMetadata, load_tool_yaml, normalize_tool_schema


def _base_metadata() -> dict[str, object]:
    return {
        "name": "example_tool",
        "version": "0.1.0",
        "type": "diagnostic",
        "description": "Example",
        "author": "local",
        "status": "draft",
        "entrypoint": "src/tool.py:ExampleTool",
        "inputs": [
            {
                "name": "signal",
                "type": "array",
                "units": "dimensionless",
                "description": "Signal",
            }
        ],
        "outputs": [
            {
                "name": "summary",
                "type": "table",
                "description": "Summary rows",
            }
        ],
        "compatible_domains": [],
        "requires": {"python": [], "system": []},
        "validation": {"tests": ["tests/test_example.py"], "reference_cases": []},
        "io": {"mode": "mixed", "max_inline_bytes": 65536},
        "permissions": {
            "filesystem": "none",
            "network": "none",
            "high_risk_actions": [],
            "approval_required": [],
        },
        "ui": {
            "display_name": "Example Tool",
            "input_groups": [
                {"id": "main", "title": "Main", "ports": ["signal"]}
            ],
            "output_views": [{"port": "summary", "renderer": "table"}],
        },
        "artifacts": {
            "outputs": [
                {
                    "name": "summary",
                    "kind": "table",
                    "mime_type": "application/json",
                    "description": "Rows",
                }
            ]
        },
    }


def test_absorption_tool_loads_with_extended_contract():
    metadata = load_tool_yaml(
        repo_root()
        / "packages"
        / "internal_tools"
        / "registry"
        / "absorption_spectrum_diagnostic"
        / "tool.yaml"
    )

    assert metadata.ui.display_name == "Absorption Spectrum Diagnostic"
    assert metadata.io.mode == "mixed"
    assert metadata.artifacts.outputs[0].name == "peaks"


def test_normalized_schema_is_ui_safe():
    schema = normalize_tool_schema(ToolMetadata.model_validate(_base_metadata()))

    assert schema["name"] == "example_tool"
    assert "entrypoint" not in schema
    assert "directory" not in schema
    assert schema["artifacts"]["outputs"][0]["kind"] == "table"
    assert schema["validation"] == {
        "has_tests": True,
        "test_count": 1,
        "reference_case_count": 0,
    }


def test_unitless_array_port_is_rejected():
    raw = deepcopy(_base_metadata())
    raw["inputs"][0].pop("units")  # type: ignore[index,union-attr]

    with pytest.raises(ValidationError, match="Array tool port"):
        ToolMetadata.model_validate(raw)


def test_unknown_metadata_key_is_rejected():
    raw = deepcopy(_base_metadata())
    raw["surprise"] = True

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ToolMetadata.model_validate(raw)


def test_path_shaped_artifact_name_is_rejected():
    raw = deepcopy(_base_metadata())
    raw["artifacts"]["outputs"][0]["name"] = "../summary"  # type: ignore[index,union-attr]

    with pytest.raises(ValidationError, match="not traverse directories"):
        ToolMetadata.model_validate(raw)


def test_raw_html_artifact_declaration_is_rejected():
    raw = deepcopy(_base_metadata())
    raw["artifacts"]["outputs"][0]["mime_type"] = "text/html"  # type: ignore[index,union-attr]

    with pytest.raises(ValidationError, match="raw HTML"):
        ToolMetadata.model_validate(raw)


def test_unsafe_renderer_is_rejected():
    raw = deepcopy(_base_metadata())
    raw["ui"]["output_views"][0]["renderer"] = "raw_html"  # type: ignore[index,union-attr]

    with pytest.raises(ValidationError):
        ToolMetadata.model_validate(raw)


def test_high_risk_permission_requires_approval_declaration():
    raw = deepcopy(_base_metadata())
    raw["permissions"]["high_risk_actions"] = ["external_export"]  # type: ignore[index]

    with pytest.raises(ValidationError, match="approval_required"):
        ToolMetadata.model_validate(raw)
