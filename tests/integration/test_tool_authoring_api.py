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


def test_authoring_code_templates_apply_preview_and_delete() -> None:
    client = _client()
    tool_name = _new_tool_name("ui_author_preview")
    draft_id: str | None = None
    user_template_id: str | None = None
    _cleanup(tool_name)
    try:
        listed = client.get("/api/tool-authoring/code-templates")
        assert listed.status_code == 200, listed.text
        built_ins = listed.json()
        assert "quick_ode_solver" in {row["template_id"] for row in built_ins}

        created = client.post(
            "/api/tool-authoring/drafts",
            json={"template_id": "diagnostic", "name": tool_name},
        )
        assert created.status_code == 200, created.text
        draft_id = created.json()["draft_id"]

        applied = client.post(
            f"/api/tool-authoring/drafts/{draft_id}/apply-code-template",
            json={"template_id": "diagnostic_summary"},
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["path"] == "src/tool.py"

        preview = client.post(
            f"/api/tool-authoring/drafts/{draft_id}/preview",
            json={"harness": "python_smoke"},
        )
        assert preview.status_code == 200, preview.text
        preview_body = preview.json()
        assert preview_body["passed"] is True
        assert preview_body["outputs"]
        assert preview_body["content_hash"]

        saved = client.post(
            "/api/tool-authoring/code-templates",
            json={
                "title": "Pytest Saved Diagnostic",
                "description": "saved during regression test",
                "category": "diagnostic",
                "target_path": "src/tool.py",
                "preview_harness": "python_smoke",
                "content": "print('template body')\n",
            },
        )
        assert saved.status_code == 200, saved.text
        user_template_id = saved.json()["template_id"]

        delete_builtin = client.delete(
            "/api/tool-authoring/code-templates/diagnostic_summary"
        )
        assert delete_builtin.status_code == 400

        deleted = client.delete(f"/api/tool-authoring/code-templates/{user_template_id}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["deleted"] is True
        user_template_id = None

        deleted_draft = client.delete(f"/api/tool-authoring/drafts/{draft_id}")
        assert deleted_draft.status_code == 200, deleted_draft.text
        assert deleted_draft.json()["deleted"] is True
        missing = client.get(f"/api/tool-authoring/drafts/{draft_id}")
        assert missing.status_code == 404
        draft_id = None
    finally:
        if user_template_id is not None:
            client.delete(f"/api/tool-authoring/code-templates/{user_template_id}")
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
        # Phase α (2026-05-10): drafts moved under
        # ``workspaces/{slug}/tool_drafts/`` where the slug now comes
        # from ``workspace_slug_dep`` (defaults to
        # ``DEFAULT_WORKSPACE_SLUG="shared-public-experiments"`` in
        # dev mode / TestClient). Read the slug from the same source
        # the handler uses.
        from simworkbench.api.server import DEFAULT_WORKSPACE_SLUG

        draft_root = (
            local_cache_root()
            / "workspaces"
            / DEFAULT_WORKSPACE_SLUG
            / "tool_drafts"
            / draft_id
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
