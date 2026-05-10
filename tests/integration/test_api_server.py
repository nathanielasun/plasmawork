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


def test_runs_list_responds_with_a_list_of_run_summaries():
    """`/api/runs` returns 200 with a JSON list. The list is no longer
    "initially empty" — as of the temp_runs/ merge (2026-05-05) it
    surfaces on-disk summaries written by script-driven examples too.
    Per-app in-memory isolation is checked separately by
    `test_two_apps_have_isolated_in_memory_runs`."""
    r = _client().get("/api/runs")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    for row in body:
        assert "run_id" in row
        assert "state" in row
        assert "diagnostics_keys" in row


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


def test_two_apps_have_isolated_in_memory_runs():
    """Regression for `agent_error_patterns.md` "API factory advertises
    isolation while sharing module-global state".

    Both apps share the on-disk `temp_runs/` directory (it's a
    filesystem singleton, not closure state), but the in-memory
    registry must remain per-app. Asserting on the diff in run_ids
    after one app starts a run is the right shape: the freshly
    started run_id must appear ONLY in app A's listing.
    """
    a = _client()
    b = _client()
    a_before = {row["run_id"] for row in a.get("/api/runs").json()}
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
    new_run_id = started.json()["run_id"]
    a_after = {row["run_id"] for row in a.get("/api/runs").json()}
    b_after = {row["run_id"] for row in b.get("/api/runs").json()}
    assert new_run_id in a_after, "App A should see its own run"
    assert new_run_id not in b_after, (
        "App B should NOT see App A's IN-MEMORY run — registry must "
        "live in the create_app() closure, not at module scope. "
        "(Disk-backed temp_runs/ entries are shared by design.)"
    )
    # And app A's in-memory delta is exactly the new run.
    assert (a_after - a_before) == {new_run_id}


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
from simworkbench.api.server import DEFAULT_WORKSPACE_SLUG  # noqa: E402
from simworkbench.experiment import Experiment, RunConfig  # noqa: E402
from simworkbench.model_spec import load_yaml  # noqa: E402
from simworkbench.paths import repo_root, simulation_capsules_root_for  # noqa: E402
from simworkbench.runtime import Runner  # noqa: E402
from simworkbench.serialization import save_capsule  # noqa: E402


@pytest.fixture
def real_capsule():
    """Build a capsule directly under the API's resolved workspace root
    and yield its name. Phase 0.5 / Phase E5 (2026-05-09) made the API's
    capsule lookup workspace-scoped — the fixture saves into the same
    workspace the API resolves via ``workspace_slug_dep`` (which falls
    back to ``DEFAULT_WORKSPACE_SLUG`` for direct TestClient use)."""
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
        base=simulation_capsules_root_for(DEFAULT_WORKSPACE_SLUG),
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


# ---------------------------------------------------------------------------
# Phase 3D — Tool registry endpoints.
# ---------------------------------------------------------------------------


def test_list_tools_returns_registry_index():
    r = _client().get("/api/tools")
    assert r.status_code == 200
    body = r.json()
    names = [row["name"] for row in body]
    assert "absorption_spectrum_diagnostic" in names


def test_get_tool_returns_metadata():
    r = _client().get("/api/tools/absorption_spectrum_diagnostic")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "absorption_spectrum_diagnostic"
    assert body["metadata"]["type"] == "diagnostic"
    assert any(p["name"] == "frequency" for p in body["metadata"]["inputs"])


def test_get_tool_404_for_unknown():
    r = _client().get("/api/tools/no-such-tool")
    assert r.status_code == 404


def test_get_tool_docs_returns_readme_and_yaml():
    r = _client().get("/api/tools/absorption_spectrum_diagnostic/docs")
    assert r.status_code == 200
    body = r.json()
    assert "absorption" in body["readme"].lower()
    assert "name: absorption_spectrum_diagnostic" in body["tool_yaml"]


def test_set_tool_status_rejects_unauthorized_agent_promotion(tmp_path):
    """Phase 9.5: human-only promotions cannot be triggered through the
    API by trusting a body field. The API never reads ``actor`` from the
    body; agent-allowed transitions run as agent, and human-only
    transitions require a single-use approval token written by the
    local CLI / Python helper.

    This test asserts:
      1. POST without an approval → 403 (no client-side bypass).
      2. POST with a granted approval → 200 (correct path).
      3. The approval token is single-use (re-POST without re-granting
         returns 403).
    """
    # Use the real example tool but reset to candidate after the test if we
    # successfully promoted it, so we don't permanently flip its status.
    import shutil
    import uuid

    from simworkbench.paths import local_cache_root
    from simworkbench.tools import grant_approval
    src = (
        repo_root()
        / "packages"
        / "internal_tools"
        / "registry"
        / "absorption_spectrum_diagnostic"
    )
    cache = local_cache_root() / "imported_tools"
    cache.mkdir(parents=True, exist_ok=True)
    name = f"_pytest_api_{uuid.uuid4().hex[:6]}"
    target = cache / name
    shutil.copytree(src, target)
    # Rename inside the copy so it doesn't clash with the canonical tool.
    yaml_path = target / "tool.yaml"
    yaml_path.write_text(
        yaml_path.read_text().replace(
            "name: absorption_spectrum_diagnostic", f"name: {name}"
        )
    )
    try:
        client = _client()
        # 1. POST without approval → 403 (the bypass path is closed).
        r = client.post(f"/api/tools/{name}/status", json={"status": "validated"})
        assert r.status_code == 403, r.text
        # 2. Grant approval, then POST → 200.
        grant_approval(
            name,
            from_status="candidate",
            to_status="validated",
            reviewer="pytest",
        )
        r = client.post(f"/api/tools/{name}/status", json={"status": "validated"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "validated"
        # 3. Single-use: re-POSTing for the next transition without a
        #    fresh approval token returns 403.
        r = client.post(f"/api/tools/{name}/status", json={"status": "trusted"})
        assert r.status_code == 403, r.text
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_set_tool_status_ignores_actor_from_body():
    """Even posting ``actor=human`` in the body must NOT bypass the
    approval gate. The API ignores the field; the PydanticV2 model uses
    extra='ignore' (the default for our other status bodies).
    """
    import shutil
    import uuid

    from simworkbench.paths import local_cache_root

    src = (
        repo_root()
        / "packages"
        / "internal_tools"
        / "registry"
        / "absorption_spectrum_diagnostic"
    )
    cache = local_cache_root() / "imported_tools"
    cache.mkdir(parents=True, exist_ok=True)
    name = f"_pytest_api_actor_{uuid.uuid4().hex[:6]}"
    target = cache / name
    shutil.copytree(src, target)
    yaml_path = target / "tool.yaml"
    yaml_path.write_text(
        yaml_path.read_text().replace(
            "name: absorption_spectrum_diagnostic", f"name: {name}"
        )
    )
    try:
        client = _client()
        r = client.post(
            f"/api/tools/{name}/status",
            json={"status": "validated", "actor": "human"},
        )
        assert r.status_code == 403, (
            "Posting actor=human must not unlock human-only promotions; "
            f"got {r.status_code}: {r.text}"
        )
    finally:
        shutil.rmtree(target, ignore_errors=True)


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
