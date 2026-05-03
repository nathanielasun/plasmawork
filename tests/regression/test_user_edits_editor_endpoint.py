"""Regression for `bugs_and_fixes/agent_error_patterns.md` "UI calls
itself an editor while shipping a viewer".

Phase-6 plan said "Generated Code Viewer AND Editor". The original UI
shipped a viewer + action panel only. The fix adds a real editor: a
backend endpoint that writes under ``<capsule>/src/user_edits/`` and
a textarea in the GeneratedCodeView panel.

This test pins the backend contract:
  - Writing under ``user_edits/`` succeeds.
  - Writing anywhere else returns 400 (no path-escape).
  - Empty path returns 400.
  - Library function refuses non-user_edits paths.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.codegen import SandboxViolation, user_edit_write
from simworkbench.paths import simulation_capsules_root


@pytest.fixture
def capsule():
    name = f"_pytest_user_edit_{uuid.uuid4().hex[:8]}.lxp"
    target = simulation_capsules_root() / name
    (target / "src" / "generated").mkdir(parents=True)
    (target / "src" / "user_edits").mkdir(parents=True)
    (target / "paper_sources").mkdir(parents=True)
    (target / "provenance").mkdir(parents=True)
    try:
        yield target
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_post_user_edit_writes_to_user_edits_only(capsule):
    client = TestClient(create_app())
    r = client.post(
        f"/api/capsules/{capsule.name}/user_edits/tweaks/run_overrides.py",
        json={"content": "# reviewer override\n"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"] == "src/user_edits/tweaks/run_overrides.py"
    actual = capsule / "src" / "user_edits" / "tweaks" / "run_overrides.py"
    assert actual.read_text(encoding="utf-8") == "# reviewer override\n"


def test_post_user_edit_empty_path_returns_400(capsule):
    client = TestClient(create_app())
    r = client.post(
        f"/api/capsules/{capsule.name}/user_edits/",
        json={"content": "# nope\n"},
    )
    # FastAPI either returns 404 (no route matched) or our explicit 400 —
    # both are acceptable; the bug we're guarding against is "200 with
    # silent success".
    assert r.status_code in (400, 404, 405), r.text


def test_library_user_edit_write_refuses_paper_sources(capsule):
    """The library function refuses any subtree other than user_edits/.
    Defense-in-depth against an API misroute."""
    with pytest.raises(SandboxViolation, match="user_edits"):
        user_edit_write(capsule, "paper_sources/note.md", "# nope\n")


def test_library_user_edit_write_refuses_generated(capsule):
    """The editor cannot smuggle a write to the generated tree."""
    with pytest.raises(SandboxViolation, match="user_edits"):
        user_edit_write(capsule, "src/generated/experiment.py", "# nope\n")


def test_library_user_edit_write_refuses_provenance(capsule):
    with pytest.raises(SandboxViolation, match="user_edits"):
        user_edit_write(capsule, "provenance/log.md", "# nope\n")


def test_library_user_edit_write_refuses_path_escape(capsule):
    with pytest.raises(SandboxViolation):
        user_edit_write(capsule, "../escape.py", "# nope\n")
