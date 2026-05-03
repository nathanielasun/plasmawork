"""Phase 1F — Backend API integration tests.

Uses FastAPI's TestClient (httpx-based) to exercise the server end-to-end
without binding to a real port. Each test gets a fresh app instance so the
in-memory run registry doesn't leak.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from simworkbench.api import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def test_health_returns_ok():
    r = _client().get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "version" in body


def test_runs_list_initially_empty():
    r = _client().get("/api/runs")
    assert r.status_code == 200
    assert r.json() == []


def test_start_run_executes_simple_rate_equations():
    client = _client()
    r = client.post(
        "/api/runs",
        json={
            "model_yaml_path": "examples/simple_rate_equations/model.yaml",
            "end_time": "100 ns",
            "max_steps": 10,
            "seed": 0,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "completed"
    assert body["final_simulation_time"] > 0
    assert "A" in body["diagnostics_keys"]
    assert "B" in body["diagnostics_keys"]
    # The example flags its rate constant as a placeholder; the API must
    # surface this so the UI can render an "exploratory" warning. Honors
    # bugs_and_fixes/agent_error_patterns.md "Silently inventing missing
    # physical coefficients".
    assert body["placeholder_used"] is True
    assert len(body["placeholders"]) >= 1
    run_id = body["run_id"]

    # And the run shows up in /api/runs.
    r2 = client.get("/api/runs")
    assert r2.status_code == 200
    listed = r2.json()
    assert any(item["run_id"] == run_id for item in listed)


def test_two_apps_have_isolated_run_registries():
    """Regression for `agent_error_patterns.md` "API factory advertises
    isolation while sharing module-global state"."""
    a = _client()
    b = _client()
    started = a.post(
        "/api/runs",
        json={
            "model_yaml_path": "examples/simple_rate_equations/model.yaml",
            "end_time": "100 ns",
            "max_steps": 5,
            "seed": 0,
        },
    )
    assert started.status_code == 200
    a_runs = a.get("/api/runs").json()
    b_runs = b.get("/api/runs").json()
    assert len(a_runs) == 1, "App A should see its own run"
    assert len(b_runs) == 0, (
        "App B should NOT see App A's run — registry must live in the "
        "create_app() closure, not at module scope."
    )


def test_get_run_returns_404_for_unknown_id():
    r = _client().get("/api/runs/does-not-exist")
    assert r.status_code == 404


def test_start_run_rejects_missing_yaml():
    r = _client().post(
        "/api/runs",
        json={"model_yaml_path": "examples/no_such_thing/model.yaml"},
    )
    assert r.status_code == 400


def test_get_diagnostic_returns_series():
    client = _client()
    r = client.post(
        "/api/runs",
        json={
            "model_yaml_path": "examples/simple_rate_equations/model.yaml",
            "max_steps": 5,
        },
    )
    run_id = r.json()["run_id"]

    r2 = client.get(f"/api/runs/{run_id}/diagnostics/A")
    assert r2.status_code == 200
    body = r2.json()
    assert body["name"] == "A"
    assert len(body["times"]) == 5
    assert len(body["values"]) == 5


def test_list_docs_pages_exposes_canonical_content():
    r = _client().get("/api/docs/pages")
    assert r.status_code == 200
    pages = r.json()
    slugs = {p["slug"] for p in pages}
    # The ten plan-required pages from §4.2 should all appear.
    assert {"overview", "installation", "usage", "architecture"}.issubset(slugs)


def test_list_capsules_returns_list_for_empty_repo():
    r = _client().get("/api/capsules")
    assert r.status_code == 200
    # No capsules in a fresh checkout — an empty list is the contract.
    assert isinstance(r.json(), list)


def test_list_temp_runs_returns_list():
    r = _client().get("/api/temp_runs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------------------------------------------------------------------------
# Phase 2D — capsule inspection endpoints. We build a real capsule from the
# example rate-equations spec via save_capsule, then assert every detail
# endpoint surfaces something useful.
# ---------------------------------------------------------------------------


import shutil  # noqa: E402
import uuid  # noqa: E402

import pytest  # noqa: E402
from simworkbench.experiment import Experiment, RunConfig  # noqa: E402
from simworkbench.model_spec import load_yaml  # noqa: E402
from simworkbench.paths import repo_root, simulation_capsules_root  # noqa: E402
from simworkbench.runtime import Runner  # noqa: E402
from simworkbench.serialization import save_capsule  # noqa: E402


@pytest.fixture
def real_capsule():
    """Build a capsule directly under simulation_capsules_root() and yield its
    name. The API's capsule lookup walks the top level of that directory, so
    the capsule must land there (not in a nested scratch dir)."""
    spec = load_yaml(repo_root() / "examples" / "simple_rate_equations" / "model.yaml")
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=5),
    )
    result = Runner(exp).run()
    capsule_name = f"_pytest-api-{uuid.uuid4().hex[:8]}"
    capsule_dir = save_capsule(
        experiment=exp,
        result=result,
        name=capsule_name,
        base=simulation_capsules_root(),
    )
    try:
        yield capsule_dir.name, capsule_dir
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def test_get_capsule_returns_manifest_and_subtrees(real_capsule):
    name, _ = real_capsule
    r = _client().get(f"/api/capsules/{name}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == name
    assert body["manifest"] is not None
    assert body["manifest"]["capsule"]["format_version"] == "0.1"
    subtree_names = {s["name"] for s in body["subtrees"]}
    assert "model" in subtree_names
    assert "results" in subtree_names
    assert "provenance" in subtree_names


def test_get_capsule_404_for_unknown_name():
    r = _client().get("/api/capsules/no-such.lxp")
    assert r.status_code == 404


def test_get_capsule_400_for_path_escape():
    r = _client().get("/api/capsules/..%2Fetc")
    # The escape attempt either resolves outside simulation_capsules/ (400)
    # or doesn't exist (404). Either is acceptable; what we MUST not see is
    # 200 with content from outside the sandbox.
    assert r.status_code in (400, 404)


def test_get_capsule_file_returns_modelspec_text(real_capsule):
    name, _ = real_capsule
    r = _client().get(f"/api/capsules/{name}/files/model/model_spec.yaml")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "schema_version" in body["content"]


def test_get_capsule_file_refuses_path_escape(real_capsule):
    name, _ = real_capsule
    r = _client().get(f"/api/capsules/{name}/files/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code in (400, 404)


def test_get_capsule_file_refuses_binary(real_capsule):
    name, capsule_dir = real_capsule
    # Drop a fake binary into results/ so the suffix check engages.
    (capsule_dir / "results" / "junk.h5").write_bytes(b"\x89HDF\r\n\x1a\n")
    r = _client().get(f"/api/capsules/{name}/files/results/junk.h5")
    assert r.status_code == 415


def test_validate_capsule_returns_report(real_capsule):
    name, _ = real_capsule
    r = _client().get(f"/api/capsules/{name}/validate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == name
    assert "violations" in body
    assert isinstance(body["ok"], bool)


def test_get_capsule_tree_lists_src_files(real_capsule):
    """Regression for the post-Phase-2-close finding "CapsuleCodeView never
    actually showed code". The /tree endpoint must enumerate files under
    a subtree so the UI can render the picker.
    """
    name, capsule_dir = real_capsule
    # Drop a file under src/generated so the tree has something to list.
    (capsule_dir / "src" / "generated").mkdir(parents=True, exist_ok=True)
    (capsule_dir / "src" / "generated" / "runner.py").write_text("# hi\n")
    r = _client().get(f"/api/capsules/{name}/tree?subtree=src")
    assert r.status_code == 200, r.text
    body = r.json()
    paths = [f["path"] for f in body["files"]]
    assert "src/generated/runner.py" in paths


def test_get_capsule_tree_refuses_subtree_escape(real_capsule):
    name, _ = real_capsule
    r = _client().get(f"/api/capsules/{name}/tree?subtree=..%2F..")
    assert r.status_code in (400, 404)


def test_get_capsule_diagnostics_returns_series(real_capsule):
    name, _ = real_capsule
    r = _client().get(f"/api/capsules/{name}/diagnostics")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] in ("h5", "json")
    assert "A" in body["series"]
    assert isinstance(body["series"]["A"], list)
    # Regression: the JSON fallback used to return the whole sidecar as
    # `series`, leaking run_id/state/elapsed_seconds into the series table.
    for forbidden_key in ("run_id", "state", "elapsed_seconds", "final_simulation_time"):
        assert forbidden_key not in body["series"]


def test_get_capsule_diagnostics_json_fallback(real_capsule):
    """Force the JSON fallback path by removing diagnostics.h5; the response
    must still be the `{name, source, series: {<diagnostic>: [...]}}` shape,
    with metadata keys NOT bleeding into series.
    """
    name, capsule_dir = real_capsule
    (capsule_dir / "results" / "diagnostics.h5").unlink()
    r = _client().get(f"/api/capsules/{name}/diagnostics")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "json"
    assert "A" in body["series"]
    # No metadata keys leaked.
    for forbidden_key in ("run_id", "state", "elapsed_seconds", "placeholders"):
        assert forbidden_key not in body["series"]
