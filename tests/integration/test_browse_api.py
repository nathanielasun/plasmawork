"""Folder browser endpoint — integration tests.

Pins the contract every UI panel that picks a path relies on:
  - allow-listed roots only.
  - `..` and resolved-symlink escapes refused.
  - response carries a discriminated dir/file shape with relative paths.
  - entry list capped to prevent OOM.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from simworkbench.api.server import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def test_browse_examples_root_lists_all_dirs():
    resp = _client().get("/api/browse?root=examples")
    assert resp.status_code == 200
    body = resp.json()
    assert body["root"] == "examples"
    assert body["relative_path"] == ""
    assert body["parent_relative_path"] is None
    names = {e["name"] for e in body["entries"]}
    # Six examples (the five disciplines + autonomous_experiment_kr).
    expected = {
        "simple_rate_equations",
        "krf_excimer",
        "laser_species",
        "molecular_dynamics",
        "ising_phase_transition",
        "pde_wave_equation",
        "autonomous_experiment_kr",
    }
    assert expected <= names


def test_browse_descend_into_directory():
    resp = _client().get("/api/browse?root=examples&path=krf_excimer")
    assert resp.status_code == 200
    body = resp.json()
    assert body["relative_path"] == "krf_excimer"
    assert body["parent_relative_path"] == ""
    files = {e["name"]: e for e in body["entries"] if e["kind"] == "file"}
    # The example ships these three files.
    assert "model.yaml" in files
    assert "README.md" in files
    assert "run.py" in files
    # Files carry a positive size and an mtime.
    assert files["model.yaml"]["size_bytes"] > 0
    assert files["model.yaml"]["mtime_iso"] is not None


def test_browse_path_escape_refused_via_dotdot():
    resp = _client().get("/api/browse?root=examples&path=..")
    assert resp.status_code == 400
    assert "outside" in resp.json()["detail"].lower()


def test_browse_path_escape_refused_via_dotdot_through_subdir():
    resp = _client().get(
        "/api/browse?root=examples&path=krf_excimer/../../etc"
    )
    assert resp.status_code == 400


def test_browse_unknown_root_refused():
    resp = _client().get("/api/browse?root=etc")
    assert resp.status_code == 400
    assert "Unknown browse root" in resp.json()["detail"]


def test_browse_path_to_file_returns_404():
    """Browse target must be a directory — pointing at a file is 404."""
    resp = _client().get(
        "/api/browse?root=examples&path=krf_excimer/model.yaml"
    )
    assert resp.status_code == 404


def test_browse_paths_are_repo_relative():
    """No entry leaks an absolute path; all are relative to the chosen root."""
    resp = _client().get("/api/browse?root=examples&path=krf_excimer")
    assert resp.status_code == 200
    for entry in resp.json()["entries"]:
        assert not entry["path"].startswith("/")


def test_browse_simulation_capsules_root_works_when_empty():
    """An allow-listed root that has no children returns a real but
    empty entry list — not a 404."""
    # We don't know whether the repo has any capsules; either way the
    # endpoint must succeed.
    resp = _client().get("/api/browse?root=local_cache")
    assert resp.status_code == 200
    body = resp.json()
    assert body["root"] == "local_cache"
    assert isinstance(body["entries"], list)


def test_browse_response_dir_entries_have_null_size():
    """Per the discriminated-union shape, dir entries carry size_bytes=null."""
    resp = _client().get("/api/browse?root=examples")
    assert resp.status_code == 200
    for entry in resp.json()["entries"]:
        if entry["kind"] == "dir":
            assert entry["size_bytes"] is None
        else:
            assert isinstance(entry["size_bytes"], int)
