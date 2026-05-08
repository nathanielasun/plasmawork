"""Integration coverage for secure tool-authoring draft endpoints."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.paths import local_cache_root
from simworkbench.tools.authoring import ToolAuthoringError, ToolAuthoringService


def _client() -> TestClient:
    return TestClient(create_app())


def _cleanup(tool_name: str, draft_id: str | None = None) -> None:
    shutil.rmtree(local_cache_root() / "imported_tools" / tool_name, ignore_errors=True)
    if draft_id is not None:
        shutil.rmtree(
            local_cache_root() / "workspaces" / "local" / "tool_drafts" / draft_id,
            ignore_errors=True,
        )


def _new_tool_name(prefix: str = "ui_author_tool") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def test_authoring_lists_server_known_templates() -> None:
    client = _client()
    response = client.get("/api/tool-authoring/templates")

    assert response.status_code == 200
    templates = response.json()
    ids = {row["template_id"] for row in templates}
    assert "diagnostic" in ids
    diagnostic = next(row for row in templates if row["template_id"] == "diagnostic")
    assert "tool.yaml" in diagnostic["editable_files"]
    assert "src/tool.py" in diagnostic["editable_files"]


def test_authoring_rejects_bad_template_and_bad_name() -> None:
    client = _client()

    bad_template = client.post(
        "/api/tool-authoring/drafts",
        json={"template_id": "../diagnostic", "name": _new_tool_name()},
    )
    assert bad_template.status_code == 400

    bad_name = client.post(
        "/api/tool-authoring/drafts",
        json={"template_id": "diagnostic", "name": "../../escape"},
    )
    assert bad_name.status_code == 400


def test_authoring_rejects_unsafe_workspace_ids() -> None:
    with pytest.raises(ToolAuthoringError):
        ToolAuthoringService(workspace_id="../escape")


def test_authoring_draft_check_stale_guard_and_registration() -> None:
    client = _client()
    tool_name = _new_tool_name()
    draft_id: str | None = None
    _cleanup(tool_name)
    try:
        created = client.post(
            "/api/tool-authoring/drafts",
            json={"template_id": "diagnostic", "name": tool_name},
        )
        assert created.status_code == 200, created.text
        draft = created.json()
        draft_id = draft["draft_id"]
        assert draft["tool_name"] == tool_name
        assert draft["status"] == "draft"
        assert draft["manifest_ok"] is True

        read_yaml = client.get(
            f"/api/tool-authoring/drafts/{draft_id}/files/tool.yaml"
        )
        assert read_yaml.status_code == 200
        assert f"name: {tool_name}" in read_yaml.json()["content"]

        hidden_write = client.put(
            f"/api/tool-authoring/drafts/{draft_id}/files/.simworkbench/draft.json",
            json={"content": "{}"},
        )
        assert hidden_write.status_code == 400

        test_file = client.put(
            f"/api/tool-authoring/drafts/{draft_id}/files/tests/test_template.py",
            json={"content": "def test_template_passes():\n    assert True\n"},
        )
        assert test_file.status_code == 200, test_file.text

        checked = client.post(f"/api/tool-authoring/drafts/{draft_id}/check")
        assert checked.status_code == 200, checked.text
        check_body = checked.json()
        assert check_body["passed"] is True
        assert check_body["content_hash"]

        stale_edit = client.put(
            f"/api/tool-authoring/drafts/{draft_id}/files/README.md",
            json={"content": "# Edited after check\n"},
        )
        assert stale_edit.status_code == 200

        stale_register = client.post(
            f"/api/tool-authoring/drafts/{draft_id}/register"
        )
        assert stale_register.status_code == 400
        assert "changed after the last package check" in stale_register.text

        rechecked = client.post(f"/api/tool-authoring/drafts/{draft_id}/check")
        assert rechecked.status_code == 200
        assert rechecked.json()["passed"] is True

        registered = client.post(f"/api/tool-authoring/drafts/{draft_id}/register")
        assert registered.status_code == 200, registered.text
        assert registered.json()["name"] == tool_name
        assert (
            Path(registered.json()["directory"])
            == Path("local_cache") / "imported_tools" / tool_name
        )

        listing = client.get("/api/tools")
        assert listing.status_code == 200
        assert tool_name in {row["name"] for row in listing.json()}
    finally:
        _cleanup(tool_name, draft_id)


def test_authoring_rejects_symlinked_draft_files() -> None:
    client = _client()
    tool_name = _new_tool_name("ui_author_link")
    draft_id: str | None = None
    secret = local_cache_root() / f"{tool_name}_secret.txt"
    _cleanup(tool_name)
    try:
        created = client.post(
            "/api/tool-authoring/drafts",
            json={"template_id": "diagnostic", "name": tool_name},
        )
        assert created.status_code == 200, created.text
        draft_id = created.json()["draft_id"]
        draft_root = (
            local_cache_root() / "workspaces" / "local" / "tool_drafts" / draft_id
        )
        secret.write_text("must not be packaged\n", encoding="utf-8")
        link = draft_root / "docs" / "leak.txt"
        link.parent.mkdir(parents=True, exist_ok=True)
        try:
            link.symlink_to(secret)
        except OSError as exc:
            pytest.skip(f"symlink creation unavailable on this platform: {exc}")

        read_link = client.get(
            f"/api/tool-authoring/drafts/{draft_id}/files/docs/leak.txt"
        )
        assert read_link.status_code == 400

        draft_listing = client.get(f"/api/tool-authoring/drafts/{draft_id}")
        assert draft_listing.status_code == 400
    finally:
        secret.unlink(missing_ok=True)
        _cleanup(tool_name, draft_id)
