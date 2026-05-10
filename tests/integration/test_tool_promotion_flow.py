"""Phase α.4 (2026-05-10) — cross-workspace tool promotion flow.

End-to-end: WorkspaceAdmin in workspace A imports a tool, requests
promotion to ``shared-internal-tools``, PlatformAdmin approves, the
tool now appears in every workspace's listing.

Pins the contracts:
  - The promotion request body is forbidden-field-clean (no source
    slug, requester id, or request id from the body).
  - Source workspace comes from ``request.state.workspace_slug``
    (defaulted to DEFAULT_WORKSPACE_SLUG in dev mode).
  - Approval performs the directory copy AND emits the audit
    breadcrumb (the record on disk has status="approved" with
    approver + timestamp).
  - The promoted tool is now visible from EVERY workspace via
    ``ToolRegistry`` after the approval, but NOT before.
  - Re-approving an already-approved record is idempotent.
  - Denying a pending record marks status="denied"; the source tool
    is unchanged; re-approving a denied record raises 400.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from simworkbench.api.server import DEFAULT_WORKSPACE_SLUG, create_app
from simworkbench.paths import (
    imported_tools_root_for,
    tool_promotions_root,
)
from simworkbench.tools.registry import ToolRegistry

# DEFAULT_WORKSPACE_SLUG is "shared-public-experiments" — the dev-mode
# default. We promote OUT of it (TO shared-internal-tools) so the
# promotion source is the workspace_slug_dep result.
SOURCE_SLUG = DEFAULT_WORKSPACE_SLUG
TARGET_SLUG = "shared-internal-tools"


def _make_tool(name: str, slug: str) -> Path:
    """Plant a minimal-but-valid tool under workspace ``slug``."""
    target = imported_tools_root_for(slug) / name
    target.mkdir(parents=True, exist_ok=True)
    (target / "tool.yaml").write_text(
        yaml.safe_dump(
            {
                "name": name,
                "version": "0.1.0",
                "type": "diagnostic",
                "status": "candidate",
                "description": "Promotion flow probe.",
                "entrypoint": "src/tool.py:Tool",
                "inputs": [],
                "outputs": [],
                "validation": {"tests": [], "reference_cases": []},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return target


@pytest.fixture
def planted_tool() -> tuple[str, Path]:
    name = f"_pytest_promote_{uuid.uuid4().hex[:8]}"
    target = _make_tool(name, SOURCE_SLUG)
    try:
        yield name, target
    finally:
        shutil.rmtree(target, ignore_errors=True)
        # Clean up any promoted copy too.
        promoted = imported_tools_root_for(TARGET_SLUG) / name
        shutil.rmtree(promoted, ignore_errors=True)
        # Clean up any pending promotion records for this tool.
        for record in tool_promotions_root().glob("*.json"):
            try:
                if name in record.read_text(encoding="utf-8"):
                    record.unlink()
            except OSError:
                pass


def test_request_creates_pending_record(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    r = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": "vet me"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tool_name"] == name
    assert body["from_workspace_slug"] == SOURCE_SLUG
    assert body["to_workspace_slug"] == TARGET_SLUG
    assert body["status"] == "pending"
    assert body["justification"] == "vet me"
    # The request_id is server-derived — the body payload did NOT
    # carry it.
    assert "request_id" in body
    uuid.UUID(body["request_id"])  # validates v4-shape


def test_promote_invisible_until_approved(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    # Pre-approval: tool is in source only, not in target.
    pre = ToolRegistry()
    pre.refresh()
    target_root = imported_tools_root_for(TARGET_SLUG) / name
    assert not target_root.exists()

    request = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
    )
    request_id = request.json()["request_id"]

    # Mid-flight: still not in target.
    assert not target_root.exists()

    # Approve.
    approve = client.post(
        f"/api/tool-promotions/{request_id}/approve",
        json={"decision_note": "looks good"},
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "approved"
    assert approve.json()["decided_by"]
    assert approve.json()["decided_at"]

    # Post-approval: tool is in BOTH source AND target.
    assert (imported_tools_root_for(SOURCE_SLUG) / name).is_dir()
    assert target_root.is_dir()


def test_approved_tool_visible_from_every_workspace(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    request = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
    )
    request_id = request.json()["request_id"]
    client.post(
        f"/api/tool-promotions/{request_id}/approve",
        json={"decision_note": ""},
    )

    # Visible from a fresh workspace.
    fresh = ToolRegistry(workspace_slug="some_other_workspace_xyz")
    fresh.refresh()
    assert name in fresh, (
        f"Approved promotion did not reach shared-internal-tools "
        f"(or the registry doesn't merge it). Tool {name!r} missing."
    )


def test_request_refuses_when_target_already_has_tool(planted_tool):
    name, _ = planted_tool
    # Pre-plant the target with the same name.
    pre_existing = _make_tool(name, TARGET_SLUG)
    try:
        client = TestClient(create_app())
        r = client.post(
            f"/api/tools/{name}/promote",
            json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
        )
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"]
    finally:
        shutil.rmtree(pre_existing, ignore_errors=True)


def test_request_refuses_when_source_workspace_equals_target(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    # Source workspace is DEFAULT_WORKSPACE_SLUG; ask to promote
    # to the same slug.
    r = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": SOURCE_SLUG, "justification": ""},
    )
    assert r.status_code == 400
    assert "must differ" in r.json()["detail"]


def test_request_refuses_unknown_tool():
    client = TestClient(create_app())
    r = client.post(
        "/api/tools/does_not_exist_xyz_xyz/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
    )
    assert r.status_code == 400
    assert "not present" in r.json()["detail"]


def test_listing_pending_returns_open_requests(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    request = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
    )
    request_id = request.json()["request_id"]

    listing = client.get("/api/tool-promotions")
    assert listing.status_code == 200
    body = listing.json()
    assert any(r["request_id"] == request_id for r in body)
    # Each pending entry has the canonical shape.
    matching = next(r for r in body if r["request_id"] == request_id)
    assert matching["status"] == "pending"
    assert matching["tool_name"] == name


def test_approve_is_idempotent(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    request = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
    )
    request_id = request.json()["request_id"]
    first = client.post(
        f"/api/tool-promotions/{request_id}/approve",
        json={"decision_note": "first"},
    )
    second = client.post(
        f"/api/tool-promotions/{request_id}/approve",
        json={"decision_note": "second-call-ignored"},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    # Second approval returns the unchanged first record (note unchanged).
    assert second.json()["decision_note"] == first.json()["decision_note"]


def test_deny_marks_record_and_blocks_subsequent_approve(planted_tool):
    name, _ = planted_tool
    client = TestClient(create_app())
    request = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": ""},
    )
    request_id = request.json()["request_id"]
    deny = client.post(
        f"/api/tool-promotions/{request_id}/deny",
        json={"decision_note": "not yet"},
    )
    assert deny.status_code == 200
    assert deny.json()["status"] == "denied"

    # Approving a denied record raises 400.
    approve = client.post(
        f"/api/tool-promotions/{request_id}/approve",
        json={"decision_note": ""},
    )
    assert approve.status_code == 400
    assert "denied" in approve.json()["detail"]


def test_approve_unknown_request_returns_404():
    client = TestClient(create_app())
    bogus = "11111111-1111-4111-8111-111111111111"
    r = client.post(
        f"/api/tool-promotions/{bogus}/approve",
        json={"decision_note": ""},
    )
    assert r.status_code == 404


def test_promotion_decisions_land_in_tamper_evident_audit_chain(planted_tool):
    """Audit fix (2026-05-10) #7 — interim: every request/approve/
    deny appends a hash-chained event to
    ``_pending_promotions/_audit_chain.jsonl``. The row_hash chains
    to the previous row's row_hash so an attacker who mutates ANY
    record breaks the chain at the next read.

    This test pins three properties:
      1. A request emits one chain entry with action
         ``tool.promotion_requested``.
      2. An approval emits a second entry that chains off the first
         (the entry's ``prev_hash`` equals the previous entry's
         ``row_hash``).
      3. The chain is append-only — re-reading after mutation of an
         intermediate entry would produce a different last-row hash.
    """
    import hashlib
    import json as _json

    name, _ = planted_tool
    client = TestClient(create_app())

    from simworkbench.tools.promotion import verify_promotion_audit_chain

    chain_path = tool_promotions_root() / "_audit_chain.jsonl"
    pre_existing_lines = (
        chain_path.read_text(encoding="utf-8").splitlines()
        if chain_path.exists()
        else []
    )

    request = client.post(
        f"/api/tools/{name}/promote",
        json={"to_workspace_slug": TARGET_SLUG, "justification": "vet"},
    )
    request_id = request.json()["request_id"]
    client.post(
        f"/api/tool-promotions/{request_id}/approve",
        json={"decision_note": "approved"},
    )

    chain_lines = chain_path.read_text(encoding="utf-8").splitlines()
    new_lines = chain_lines[len(pre_existing_lines):]
    # Two new lines: requested + approved.
    matching = [
        _json.loads(line)
        for line in new_lines
        if request_id in line
    ]
    assert len(matching) == 2, (
        f"expected 2 chain entries for {request_id}; got {len(matching)}"
    )
    requested, approved = matching
    assert requested["action"] == "tool.promotion_requested"
    assert approved["action"] == "tool.promoted"
    # Each entry has a row_hash, and `approved.prev_hash` chains to
    # `requested.row_hash`.
    assert "row_hash" in requested
    assert "row_hash" in approved
    assert approved["prev_hash"] == requested["row_hash"]
    # The row_hash recomputes deterministically from the canonical
    # payload — pinning the SHA-256 + sorted-key shape.
    canonical_payload = {k: v for k, v in approved.items() if k != "row_hash"}
    expected_hash = hashlib.sha256(
        _json.dumps(canonical_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    assert approved["row_hash"] == expected_hash
    ok, reason = verify_promotion_audit_chain()
    assert ok, reason
