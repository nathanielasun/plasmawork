"""Tool schema, preview, run, and artifact API integration tests."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.paths import local_cache_root, repo_root
from simworkbench.tools.artifacts import tool_runs_root


def _client() -> TestClient:
    return TestClient(create_app())


def _absorption_body() -> dict[str, object]:
    return {
        "kwargs": {
            "frequency": [1.0, 2.0, 3.0, 4.0, 5.0],
            "intensity": [0.0, 1.0, 0.2, 0.8, 0.0],
        },
        "units": {"frequency": "Hz", "intensity": "dimensionless"},
    }


def _absorption_ui_body() -> dict[str, object]:
    return {
        "inputs": {
            "frequency": [1.0, 2.0, 3.0, 4.0, 5.0],
            "intensity": [0.0, 1.0, 0.2, 0.8, 0.0],
        },
        "units": {"frequency": "Hz", "intensity": "dimensionless"},
        "data_mappings": {},
    }


def _cleanup_run(run_id: str | None) -> None:
    if run_id:
        shutil.rmtree(tool_runs_root() / run_id, ignore_errors=True)


def test_tool_schema_preview_and_run_materializes_table_artifact():
    client = _client()
    run_id: str | None = None
    try:
        schema_response = client.get(
            "/api/tools/absorption_spectrum_diagnostic/schema"
        )
        assert schema_response.status_code == 200, schema_response.text
        schema = schema_response.json()
        assert schema["name"] == "absorption_spectrum_diagnostic"
        assert "entrypoint" not in schema
        assert schema["artifacts"]["outputs"][0]["name"] == "peaks"

        before = set(tool_runs_root().iterdir())
        preview_response = client.post(
            "/api/tools/absorption_spectrum_diagnostic/preview",
            json=_absorption_body(),
        )
        assert preview_response.status_code == 200, preview_response.text
        preview = preview_response.json()
        assert preview["planned_artifacts"][0]["kind"] == "table"
        assert set(tool_runs_root().iterdir()) == before

        run_response = client.post(
            "/api/tools/absorption_spectrum_diagnostic/runs",
            json=_absorption_body(),
        )
        assert run_response.status_code == 200, run_response.text
        run = run_response.json()
        run_id = run["run_id"]
        assert run["status"] == "completed"
        assert run["inline_output"]["peak_count"] == 2
        assert run["artifacts"][0]["name"] == "peaks"
        assert run["artifacts"][0]["kind"] == "table"
        artifact_path = repo_root() / run["artifacts"][0]["path"]
        assert artifact_path.is_file()
        artifact_path.relative_to(tool_runs_root() / run_id)

        fetched = client.get(
            f"/api/tools/absorption_spectrum_diagnostic/runs/{run_id}"
        )
        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["run_id"] == run_id

        artifacts = client.get(
            f"/api/tools/absorption_spectrum_diagnostic/runs/{run_id}/artifacts"
        )
        assert artifacts.status_code == 200, artifacts.text
        assert artifacts.json()["artifacts"][0]["artifact_id"] == run["artifacts"][0][
            "artifact_id"
        ]

        artifact = client.get(
            f"/api/tool-artifacts/{run['artifacts'][0]['artifact_id']}"
        )
        assert artifact.status_code == 200, artifact.text
        assert artifact.json()["name"] == "peaks"
        assert artifact.json()["preview"]["rows"][0]["frequency_hz"] == 2.0
    finally:
        _cleanup_run(run_id)


def test_tool_run_accepts_ui_inputs_body_shape():
    client = _client()
    run_id: str | None = None
    try:
        response = client.post(
            "/api/tools/absorption_spectrum_diagnostic/runs",
            json=_absorption_ui_body(),
        )
        assert response.status_code == 200, response.text
        run = response.json()
        run_id = run["run_id"]
        assert run["status"] == "completed"
        assert run["outputs"][0]["name"] in {"peak_count", "peaks"}
    finally:
        _cleanup_run(run_id)


def test_execute_endpoint_preserves_legacy_output_shape_with_run_metadata():
    client = _client()
    run_id: str | None = None
    try:
        response = client.post(
            "/api/tools/absorption_spectrum_diagnostic/execute",
            json=_absorption_body(),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        run_id = body["run_id"]
        assert body["output"]["peak_count"] == 2
        assert body["output"]["peaks"][0]["frequency_hz"] == 2.0
        assert body["artifacts"][0]["name"] == "peaks"
    finally:
        _cleanup_run(run_id)


def test_diagram_output_is_materialized_as_structured_artifact():
    name = f"_pytest_diagram_{uuid.uuid4().hex[:8]}"
    tool_dir = local_cache_root() / "imported_tools" / name
    run_id: str | None = None
    try:
        _write_diagram_tool(tool_dir, name)
        client = _client()
        response = client.post(
            f"/api/tools/{name}/runs",
            json={"kwargs": {"label": "root"}, "units": {}},
        )
        assert response.status_code == 200, response.text
        run = response.json()
        run_id = run["run_id"]
        assert run["status"] == "completed"
        artifact = run["artifacts"][0]
        assert artifact["name"] == "graph"
        assert artifact["kind"] == "diagram"
        assert artifact["preview"]["nodes"][0]["id"] == "root"
        artifact_path = repo_root() / artifact["path"]
        assert artifact_path.is_file()
        artifact_path.relative_to(tool_runs_root() / run_id)
    finally:
        _cleanup_run(run_id)
        shutil.rmtree(tool_dir, ignore_errors=True)


def _write_diagram_tool(tool_dir: Path, name: str) -> None:
    (tool_dir / "src").mkdir(parents=True)
    (tool_dir / "tool.yaml").write_text(
        f"""name: {name}
version: 0.1.0
type: visualization
description: Test diagram tool.
author: pytest
status: draft
entrypoint: src/tool.py:DiagramTool
inputs:
  - name: label
    type: string
    description: Node label.
outputs:
  - name: graph
    type: diagram
    description: Structured graph.
compatible_domains: []
requires:
  python: []
  system: []
validation:
  tests: []
  reference_cases: []
io:
  mode: mixed
  max_inline_bytes: 65536
permissions:
  filesystem: none
  network: none
  high_risk_actions: []
  approval_required: []
ui:
  display_name: Test Diagram
  input_groups:
    - id: main
      title: Main
      ports:
        - label
  output_views:
    - port: graph
      renderer: diagram
artifacts:
  outputs:
    - name: graph
      kind: diagram
      mime_type: application/json
      diagram_type: graph
      description: Structured graph artifact.
""",
        encoding="utf-8",
    )
    (tool_dir / "src" / "tool.py").write_text(
        f'''from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class DiagramTool(BaseTool):
    name = "{name}"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require("label")

    def run(self, inputs: ToolInput) -> ToolOutput:
        label = str(inputs["label"])
        return ToolOutput({{"graph": {{"nodes": [{{"id": label}}], "edges": []}}}})
''',
        encoding="utf-8",
    )
