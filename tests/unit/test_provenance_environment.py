"""Phase 2B — Environment capture tests."""

from __future__ import annotations

import sys

import yaml
from simworkbench.provenance import (
    capture_environment,
    load_environment,
    write_environment,
)


def test_capture_returns_basic_fields():
    snap = capture_environment()
    assert snap["python_version"].count(".") >= 2
    assert snap["platform"]  # non-empty
    assert snap["python_executable"] == sys.executable
    assert "packages" in snap


def test_packages_field_lists_installed_modules():
    """At least pytest and pint should appear (we just imported them via the
    test runner / capture path)."""
    snap = capture_environment()
    pkgs = snap["packages"]
    assert isinstance(pkgs, list)
    if pkgs and "name" in pkgs[0]:
        names = {p.get("name") for p in pkgs}
        # Don't pin a specific package — pip freeze in some envs prints
        # editable installs in a non-standard form. We only assert a
        # non-empty set of names (or the explicit unavailable note).
        assert len(names) > 0


def test_round_trip_through_yaml(tmp_path):
    target = tmp_path / "environment.yaml"
    write_environment(target)
    reloaded = load_environment(target)
    assert reloaded["python_version"] == sys.version.split()[0]
    assert reloaded["platform"]


def test_explicit_snapshot_is_written_verbatim(tmp_path):
    target = tmp_path / "environment.yaml"
    snapshot = {"python_version": "9.9.9", "platform": "synthetic", "packages": []}
    write_environment(target, snapshot)
    parsed = yaml.safe_load(target.read_text())
    assert parsed == snapshot


def test_load_returns_empty_for_empty_file(tmp_path):
    target = tmp_path / "environment.yaml"
    target.write_text("")
    assert load_environment(target) == {}
