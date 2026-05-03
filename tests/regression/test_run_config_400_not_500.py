"""Regression for `bugs_and_fixes/agent_error_patterns.md` "Boundary
validation parity": malformed run-config payloads must surface as 400,
not 500.

Phase-6 audit found that ``RunConfig(...)`` was constructed before the
``try / except`` block in ``start_run``. A Pydantic ``ValidationError``
from ``max_steps=0`` or a malformed ``end_time`` escaped as a server
500. The fix wraps the construction; this test pins it.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from simworkbench.api import create_app


def _client():
    return TestClient(create_app())


def test_zero_max_steps_returns_400():
    r = _client().post(
        "/api/runs",
        json={
            "model_yaml_path": "examples/simple_rate_equations/model.yaml",
            "max_steps": 0,
        },
    )
    assert r.status_code == 400, r.text


def test_malformed_end_time_returns_400():
    r = _client().post(
        "/api/runs",
        json={
            "model_yaml_path": "examples/simple_rate_equations/model.yaml",
            "end_time": "not a quantity",
        },
    )
    assert r.status_code == 400, r.text


def test_unknown_yaml_path_returns_400():
    r = _client().post(
        "/api/runs",
        json={"model_yaml_path": "this/does/not/exist.yaml"},
    )
    assert r.status_code == 400, r.text
