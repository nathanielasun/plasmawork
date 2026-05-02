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
    run_id = body["run_id"]

    # And the run shows up in /api/runs.
    r2 = client.get("/api/runs")
    assert r2.status_code == 200
    listed = r2.json()
    assert any(item["run_id"] == run_id for item in listed)


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
