"""Phase 3 gate-walk integration test.

Plan §Phase 3 gate: a user can **create**, **test**, **document**,
**register**, **use it in an experiment**, and **export** a custom
diagnostic tool. The earlier Phase 3 close shipped only list / view-docs
/ status — this test exists so a future close can never claim Phase 3
done without exercising every gate verb end-to-end.

Carries the post-Phase-3-close pattern "Implementing the gate's verbs
you can see, not the verbs the plan listed".
"""

from __future__ import annotations

import shutil
import zipfile

import numpy as np
import pytest
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.experiment import Experiment, RunConfig, ToolReference
from simworkbench.model_spec import load_yaml
from simworkbench.paths import local_cache_root, repo_root
from simworkbench.runtime import Runner
from simworkbench.tools import ToolRegistry, apply_tools

TEMPLATES_ROOT = repo_root() / "packages" / "internal_tools" / "templates"
IMPORTED_ROOT = local_cache_root() / "imported_tools"
EXPORTS_ROOT = local_cache_root() / "exports"
EXAMPLE = repo_root() / "examples" / "simple_rate_equations" / "model.yaml"


@pytest.fixture
def gate_walk_tool(tmp_path):
    """Create a fresh diagnostic tool from a template, like a real user."""
    target_name = f"_pytest_gate_{tmp_path.name}"
    IMPORTED_ROOT.mkdir(parents=True, exist_ok=True)
    target_dir = IMPORTED_ROOT / target_name
    if target_dir.exists():
        shutil.rmtree(target_dir)

    registry = ToolRegistry()
    registry.refresh()
    entry = registry.register_from_template(
        TEMPLATES_ROOT / "diagnostic",
        target_name,
        target_root=IMPORTED_ROOT,
    )
    # Replace the run() with a real implementation: count the samples and
    # return the maximum. tool.yaml's outputs already declare `summary`.
    src_path = entry.directory / "src" / "tool.py"
    src_path.write_text(
        "from simworkbench.tools import BaseTool, ToolInput, ToolOutput\n"
        "\n"
        "class DiagnosticTemplate(BaseTool):\n"
        f'    name = "{target_name}"\n'
        '    version = "0.1.0"\n'
        "    def validate_inputs(self, inputs: ToolInput) -> None:\n"
        "        inputs.require_array('time', units='s')\n"
        "        inputs.require_array('signal')\n"
        "    def run(self, inputs: ToolInput) -> ToolOutput:\n"
        "        time = inputs['time']\n"
        "        signal = inputs['signal']\n"
        "        return ToolOutput({'summary': [{\n"
        "            'n_samples': int(time.size),\n"
        "            'signal_min': float(signal.min().magnitude),\n"
        "            'signal_max': float(signal.max().magnitude),\n"
        "        }]})\n"
    )
    # Drop a trivial test in.
    test_path = entry.directory / "tests" / "test_template.py"
    test_path.parent.mkdir(parents=True, exist_ok=True)
    test_path.write_text("def test_smoke():\n    assert True\n")
    # Pin validation.tests explicitly via yaml.safe_load + dump so we don't
    # rely on the safe_dump-produced indentation matching some literal.
    import yaml as _yaml

    yaml_path = entry.directory / "tool.yaml"
    data = _yaml.safe_load(yaml_path.read_text())
    data["validation"]["tests"] = ["tests/test_template.py"]
    yaml_path.write_text(_yaml.safe_dump(data, sort_keys=False))
    try:
        yield target_name
    finally:
        if target_dir.exists():
            shutil.rmtree(target_dir)


def _client():
    return TestClient(create_app())


def test_phase_3_gate_walk_create_test_register(gate_walk_tool):
    """Create + register + test the tool. The first three gate verbs."""
    client = _client()
    # Tool is registered (imported into local_cache/imported_tools/).
    body = client.get(f"/api/tools/{gate_walk_tool}").json()
    assert body["metadata"]["type"] == "diagnostic"

    # Run-tests verb: pytest on the tool's declared validation tests.
    r = client.post(f"/api/tools/{gate_walk_tool}/run-tests")
    assert r.status_code == 200, r.text
    assert r.json()["passed"] is True


def test_phase_3_gate_walk_execute(gate_walk_tool):
    """Execute verb: invoke the tool with kwargs through the API."""
    client = _client()
    r = client.post(
        f"/api/tools/{gate_walk_tool}/execute",
        json={
            "kwargs": {
                "time": [0.0, 1e-9, 2e-9, 3e-9],
                "signal": [0.0, 0.5, 1.0, 0.7],
            },
            "units": {"time": "s", "signal": "dimensionless"},
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "summary" in body["output"]
    rows = body["output"]["summary"]
    assert rows[0]["n_samples"] == 4


def test_phase_3_gate_walk_export(gate_walk_tool):
    """Export verb: produce a portable .zip under local_cache/exports/."""
    client = _client()
    r = client.post(f"/api/tools/{gate_walk_tool}/export")
    assert r.status_code == 200, r.text
    archive_rel = r.json()["archive"]
    archive = repo_root() / archive_rel
    assert archive.is_file()
    with zipfile.ZipFile(archive) as zf:
        names = set(zf.namelist())
    # The archive must carry the tool's identity files.
    assert any(n.endswith("tool.yaml") for n in names)
    assert any(n.endswith("src/tool.py") for n in names)
    assert any(n.endswith("README.md") for n in names)
    archive.unlink()


def test_phase_3_gate_walk_import_external(tmp_path):
    """Import verb: copy an external tool tree into the registry."""
    # Stage an external "tool tree" under tmp_path.
    external = tmp_path / "my_external_tool"
    shutil.copytree(TEMPLATES_ROOT / "diagnostic", external)
    # Sanitize tool.yaml's name so the import test doesn't collide with
    # the real templates name.
    target_name = f"_pytest_imported_{tmp_path.name}"
    yaml_path = external / "tool.yaml"
    yaml_path.write_text(
        yaml_path.read_text().replace("name: TEMPLATE", f"name: {target_name}")
    )
    client = _client()
    try:
        r = client.post(
            "/api/tools/import",
            json={"source_path": str(external), "target_name": target_name},
        )
        assert r.status_code == 200, r.text
        # The imported tool is now visible through the listing API.
        listing = {row["name"] for row in client.get("/api/tools").json()}
        assert target_name in listing
    finally:
        # Phase α (2026-05-10): imports now land under
        # ``imported_tools/{workspace_slug}/{name}/``. The default
        # slug for direct TestClient usage is
        # DEFAULT_WORKSPACE_SLUG; clean both the new layout AND the
        # legacy flat path so the cleanup is robust against partial
        # transitions.
        from simworkbench.api.server import DEFAULT_WORKSPACE_SLUG

        for candidate in (
            IMPORTED_ROOT / DEFAULT_WORKSPACE_SLUG / target_name,
            IMPORTED_ROOT / target_name,
        ):
            if candidate.exists():
                shutil.rmtree(candidate)


def test_phase_3_gate_walk_use_in_experiment(gate_walk_tool):
    """The hardest gate verb: bind the tool to an Experiment and apply it
    after a real run.

    Round-trip: ModelSpec → Experiment with tool_refs → Runner →
    apply_tools → tool output keyed off run diagnostics.
    """
    spec = load_yaml(EXAMPLE)
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=5),
    )
    # Bind the gate-walk tool to the experiment. Pull `time` from the
    # run's `time_seconds` diagnostic, pull `signal` from species `A`.
    exp = exp.model_copy(
        update={
            "tool_refs": [
                ToolReference(
                    name=gate_walk_tool,
                    inputs_from={
                        "time": "diagnostic:time_seconds",
                        "signal": "diagnostic:A",
                    },
                    units={"time": "s", "signal": "dimensionless"},
                ),
            ]
        }
    )
    result = Runner(exp).run()
    diagnostics = {k: np.asarray(v) for k, v in result.diagnostics.items()}
    outputs = apply_tools(exp, diagnostics)
    assert gate_walk_tool in outputs
    summary = outputs[gate_walk_tool]["summary"]
    # The tool's output structure round-trips.
    assert summary[0]["n_samples"] == 5


def test_phase_3_gate_walk_run_tests_runs_real_tests(gate_walk_tool):
    """Negative case: a tool whose validation tests fail must report that."""
    import yaml as _yaml

    target_dir = IMPORTED_ROOT / gate_walk_tool
    failing = target_dir / "tests" / "test_failing.py"
    failing.write_text("def test_fails():\n    assert False, 'x'\n")
    yaml_path = target_dir / "tool.yaml"
    data = _yaml.safe_load(yaml_path.read_text())
    data["validation"]["tests"] = ["tests/test_failing.py"]
    yaml_path.write_text(_yaml.safe_dump(data, sort_keys=False))
    r = _client().post(f"/api/tools/{gate_walk_tool}/run-tests")
    assert r.status_code == 200
    assert r.json()["passed"] is False
