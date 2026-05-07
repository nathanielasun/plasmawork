"""Regression coverage for tool run artifact path and renderer isolation."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.paths import local_cache_root
from simworkbench.tools import ToolRunManager
from simworkbench.tools.artifacts import ToolArtifactError, tool_runs_root


def test_tool_run_manager_rejects_path_shaped_run_id_before_reading():
    manager = ToolRunManager()

    with pytest.raises(ToolArtifactError, match="Invalid tool run id"):
        manager.get_run("absorption_spectrum_diagnostic", "../escape")

    assert not (tool_runs_root().parent / "escape").exists()


def test_unsafe_diagram_payload_fails_and_leaves_no_artifacts():
    name = f"_pytest_bad_diagram_{uuid.uuid4().hex[:8]}"
    tool_dir = local_cache_root() / "imported_tools" / name
    run_id: str | None = None
    try:
        _write_bad_diagram_tool(tool_dir, name)
        client = TestClient(create_app())
        response = client.post(
            f"/api/tools/{name}/runs",
            json={"kwargs": {"label": "root"}, "units": {}},
        )
        assert response.status_code == 200, response.text
        run = response.json()
        run_id = run["run_id"]
        assert run["status"] == "failed"
        assert "unsafe key" in run["error"]
        assert run["artifacts"] == []
        assert not (tool_runs_root() / run_id / "artifacts").exists()
    finally:
        if run_id:
            shutil.rmtree(tool_runs_root() / run_id, ignore_errors=True)
        shutil.rmtree(tool_dir, ignore_errors=True)


def _write_bad_diagram_tool(tool_dir: Path, name: str) -> None:
    (tool_dir / "src").mkdir(parents=True)
    (tool_dir / "tool.yaml").write_text(
        f"""name: {name}
version: 0.1.0
type: visualization
description: Unsafe diagram payload regression tool.
author: pytest
status: draft
entrypoint: src/tool.py:BadDiagramTool
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
  display_name: Bad Diagram
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


class BadDiagramTool(BaseTool):
    name = "{name}"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require("label")

    def run(self, inputs: ToolInput) -> ToolOutput:
        return ToolOutput({{"graph": {{"html": "<script>alert(1)</script>"}}}})
''',
        encoding="utf-8",
    )
