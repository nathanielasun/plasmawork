"""Integration tests for the examples discovery + one-click runner.

The UI's ExamplesGallery panel binds to two new endpoints:
  - GET  /api/examples            — discover under examples/ on disk.
  - POST /api/examples/{name}/run — execute end-to-end, return the
                                    artifact paths.

These tests pin the contract: every example shipped today must be
discoverable, both execution paths (modelspec + script) must work,
and the bypass surfaces (made-up name, path traversal) must refuse.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from simworkbench.api.server import create_app
from simworkbench.paths import repo_root


def _client() -> TestClient:
    return TestClient(create_app())


def test_examples_discovery_returns_all_six():
    """Every directory under examples/ that ships run.py + README.md
    is discovered. The current set is six (5 disciplines + the
    autonomous experiment); a future add bumps this."""
    resp = _client().get("/api/examples")
    assert resp.status_code == 200
    body = resp.json()
    names = {row["name"] for row in body}
    expected = {
        "simple_rate_equations",
        "krf_excimer",
        "laser_species",
        "molecular_dynamics",
        "ising_phase_transition",
        "pde_wave_equation",
    }
    missing = expected - names
    assert not missing, (
        f"GET /api/examples missed {missing}; this means examples/ "
        "lost a run.py or README.md. Re-add the missing file."
    )


def test_examples_kind_split():
    """ModelSpec-driven examples carry has_model_yaml=True; script-
    driven examples don't. The kind field is the public discriminator."""
    rows = {row["name"]: row for row in _client().get("/api/examples").json()}
    assert rows["simple_rate_equations"]["kind"] == "modelspec"
    assert rows["simple_rate_equations"]["has_model_yaml"] is True
    assert rows["krf_excimer"]["kind"] == "modelspec"
    assert rows["laser_species"]["kind"] == "script"
    assert rows["laser_species"]["has_model_yaml"] is False


def test_run_modelspec_example_returns_run_id():
    """The ModelSpec path runs synchronously and returns a run_id."""
    resp = _client().post("/api/examples/simple_rate_equations/run")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "simple_rate_equations"
    assert body["run_id"], "ModelSpec runs must surface a run_id"
    assert body["duration_seconds"] >= 0


def test_run_script_example_returns_summary_path():
    """The script path execs run.py via subprocess and parses its
    stdout for the [run] / [done] markers. Use the fastest example
    (laser_species, no ODE, ~0.5s) so this test stays cheap."""
    resp = _client().post("/api/examples/laser_species/run")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "laser_species"
    assert body["run_id"] is not None
    assert body["summary_path"] is not None
    assert "laser_species-" in body["run_id"]


def test_run_unknown_example_404():
    resp = _client().post("/api/examples/totally_made_up/run")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_examples_endpoint_does_not_accept_arbitrary_paths():
    """A path-traversal attempt against the run endpoint must NOT
    execute anything outside examples/. The endpoint is allow-listed
    against the discovered set so a name with `../` simply doesn't
    match."""
    for name in ("..", "../bin/python", "%2e%2e", "../../etc/passwd"):
        resp = _client().post(f"/api/examples/{name}/run")
        # 404 (not in discovered set) or 400 (FastAPI path validation);
        # what matters is no execution and no leak of file contents.
        assert resp.status_code in {400, 404, 405}


def test_examples_descriptions_come_from_readme_first_paragraph():
    """The description field shouldn't be empty for any shipped
    example. README must have at least one non-heading line before
    the divider — the discovery helper grabs that as the description."""
    rows = _client().get("/api/examples").json()
    blanks = [r["name"] for r in rows if not r["description"].strip()]
    assert not blanks, (
        f"Examples with empty description (README missing prose?): {blanks}"
    )


def test_examples_paths_are_repo_relative():
    """run_path / readme_path / model_yaml_path are repo-relative so
    the UI can render them without exposing absolute filesystem paths."""
    rows = _client().get("/api/examples").json()
    abs_root = str(repo_root())
    for row in rows:
        for key in ("readme_path", "run_path", "model_yaml_path"):
            value = row.get(key)
            if value is None:
                continue
            assert not value.startswith("/"), (
                f"{row['name']}.{key} = {value!r} should be repo-relative"
            )
            assert abs_root not in value, (
                f"{row['name']}.{key} leaks absolute path"
            )
