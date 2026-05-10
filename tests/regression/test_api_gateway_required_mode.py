"""Phase 0.5 post-audit hardening (2026-05-09).

The Phase E5 commit shipped ``workspace_slug_dep`` with a permissive
fallback to ``DEFAULT_WORKSPACE_SLUG``. The original intent was to keep
direct-TestClient tests working while the gateway slice was in flight.
The audit caught the unintended consequence: a same-host process could
bypass the gateway entirely (FastAPI binds 127.0.0.1 only, but other
processes on the box still reach it) and run as the default workspace
because the FastAPI app never actually mounted the
``WorkbenchHandoffMiddleware``.

This regression pins the post-audit fix:

  - When ``WORKBENCH_GATEWAY_HANDOFF_SECRET`` (or the explicit
    ``SIMWORKBENCH_REQUIRE_GATEWAY=1`` opt-in) is present in the
    process env, ``create_app`` mounts the middleware AND
    ``workspace_slug_dep`` raises 401 instead of falling back.
  - When the env is unset, the existing dev-mode fallback engages so
    direct TestClient tests + internal-caller scripts continue to
    work.

Both branches MUST be exercised for the fix to stay in place.
"""

from __future__ import annotations

import hashlib
import hmac
import sys
import time

import pytest
from fastapi.testclient import TestClient
from simworkbench.api.auth_middleware import (
    HANDOFF_HEADER_ISSUED_AT,
    HANDOFF_HEADER_REQUEST_ID,
    HANDOFF_HEADER_ROLES,
    HANDOFF_HEADER_SIGNATURE,
    HANDOFF_HEADER_USER_ID,
    HANDOFF_HEADER_WORKSPACE_ID,
    HANDOFF_HEADER_WORKSPACE_SLUG,
)

SECRET = "Aa!23456789012345678901234567890123456"  # 38 bytes
USER_ID = "11111111-1111-4111-8111-111111111111"
WORKSPACE_ID = "22222222-2222-4222-8222-222222222222"
WORKSPACE_SLUG = "shared-public-experiments"
REQUEST_ID = "33333333-3333-4333-8333-333333333333"


def _sign(payload: str) -> str:
    return hmac.new(SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _signed_headers() -> dict[str, str]:
    issued_at_sec = int(time.time())
    # The gateway always forwards the user's resolved role name (E2-rest
    # composes ``[req.membership.roleName]``). The middleware refuses
    # empty role headers as malformed.
    canonical_roles = "WorkspaceAdmin"
    payload = "|".join(
        (USER_ID, WORKSPACE_ID, WORKSPACE_SLUG, canonical_roles, REQUEST_ID, str(issued_at_sec))
    )
    return {
        HANDOFF_HEADER_USER_ID: USER_ID,
        HANDOFF_HEADER_WORKSPACE_ID: WORKSPACE_ID,
        HANDOFF_HEADER_WORKSPACE_SLUG: WORKSPACE_SLUG,
        HANDOFF_HEADER_ROLES: canonical_roles,
        HANDOFF_HEADER_REQUEST_ID: REQUEST_ID,
        HANDOFF_HEADER_ISSUED_AT: str(issued_at_sec),
        HANDOFF_HEADER_SIGNATURE: _sign(payload),
    }


@pytest.fixture
def gateway_env(monkeypatch: pytest.MonkeyPatch):
    """Set the env that flips create_app() into gateway-required mode."""
    monkeypatch.setenv("WORKBENCH_GATEWAY_HANDOFF_SECRET", SECRET)
    monkeypatch.setenv("SIMWORKBENCH_REQUIRE_GATEWAY", "1")
    yield


@pytest.fixture
def gateway_disabled_env(monkeypatch: pytest.MonkeyPatch):
    """Drop the env so create_app() stays in dev mode."""
    monkeypatch.delenv("WORKBENCH_GATEWAY_HANDOFF_SECRET", raising=False)
    monkeypatch.delenv("SIMWORKBENCH_REQUIRE_GATEWAY", raising=False)
    yield


def test_gateway_required_mode_rejects_unsigned_request(gateway_env):
    """Direct TestClient → no handoff headers → 401 instead of fallback.

    Closes the audit finding "Major: FastAPI handoff middleware is
    implemented but not mounted". With the env var set, even a
    same-host process must present a valid HMAC.
    """
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    r = client.get("/api/runs")
    assert r.status_code == 401, r.text


def test_gateway_required_mode_accepts_signed_request(gateway_env):
    """A correctly signed handoff produces a 200; the workspace slug
    on request.state matches what the handler resolves."""
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    r = client.get("/api/runs", headers=_signed_headers())
    assert r.status_code == 200, r.text


def test_gateway_required_mode_health_remains_unauthenticated(gateway_env):
    """``/api/health`` is in the bypass list — it has to stay
    callable from a load balancer / probe."""
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    r = client.get("/api/health")
    assert r.status_code == 200


def test_workspace_slug_dep_rejects_missing_state_in_required_mode(gateway_env):
    """Defense in depth: even if a future refactor drops the
    middleware mount, ``workspace_slug_dep`` raises 401 when state is
    unset and the env declares gateway-required mode."""
    from simworkbench.api.server import create_app

    # Build the app WITHOUT the middleware (override) so any handler
    # invocation must rely on the dependency's own fail-closed branch.
    client = TestClient(create_app(mount_handoff_middleware=False))
    r = client.get("/api/runs")
    assert r.status_code == 401


def test_preview_refused_in_production_without_configured_sandbox(
    gateway_env,
    monkeypatch: pytest.MonkeyPatch,
):
    """Audit fix (2026-05-10) — Critical: tool draft preview is an
    unsandboxed Python subprocess that inherits os.environ. In
    multi-tenant production, ANY authenticated workspace member can
    weaponize it for RCE.

    The fix requires a configured sandbox launcher in production mode.
    Without one, the endpoint refuses with 503 — no subprocess, no RCE
    surface."""
    monkeypatch.delenv("WORKBENCH_PREVIEW_SANDBOX_COMMAND", raising=False)
    monkeypatch.delenv("WORKBENCH_PREVIEW_SANDBOX_RUNTIME", raising=False)
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    # Sign a request so we get past the middleware. The preview gate
    # fires AFTER auth.
    r = client.post(
        "/api/tool-authoring/drafts/some-id/preview",
        headers=_signed_headers(),
        json={"harness": "python_smoke"},
    )
    assert r.status_code == 503, r.text
    assert "WORKBENCH_PREVIEW_SANDBOX_COMMAND" in r.text


def test_preview_uses_configured_sandbox_launcher(
    gateway_env,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    """Gateway-required preview uses the configured sandbox launcher and
    does not require the old boolean bypass flag."""
    launcher = tmp_path / "fake_preview_sandbox.py"
    launcher.write_text(
        """
from __future__ import annotations
import argparse
import json

parser = argparse.ArgumentParser()
parser.add_argument("--draft-root")
parser.add_argument("--harness")
parser.add_argument("--result-path")
parser.add_argument("--core-src")
parser.add_argument("--runner-module")
args = parser.parse_args()
with open(args.result_path, "w", encoding="utf-8") as fh:
    json.dump(
        {
            "passed": True,
            "outputs": [{"name": "sandbox", "kind": "scalar", "preview": 1}],
            "diagnostics": [],
        },
        fh,
    )
print("sandbox launcher used")
""".lstrip(),
        encoding="utf-8",
    )
    monkeypatch.setenv(
        "WORKBENCH_PREVIEW_SANDBOX_COMMAND",
        f"{sys.executable} {launcher}",
    )
    monkeypatch.delenv("WORKBENCH_PREVIEW_SANDBOX_RUNTIME", raising=False)
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    created = client.post(
        "/api/tool-authoring/drafts",
        headers=_signed_headers(),
        json={"template_id": "diagnostic", "name": "sandbox_preview_test"},
    )
    assert created.status_code == 200, created.text
    draft_id = created.json()["draft_id"]
    r = client.post(
        f"/api/tool-authoring/drafts/{draft_id}/preview",
        headers=_signed_headers(),
        json={"harness": "python_smoke"},
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["passed"] is True
    assert "sandbox launcher used" in payload["stdout"]


def test_preview_refused_in_production_for_non_workspace_admin(
    gateway_env,
    monkeypatch: pytest.MonkeyPatch,
):
    """Even with a sandbox configured, a regular workspace member
    (no WorkspaceAdmin role) cannot trigger preview."""
    monkeypatch.setenv("WORKBENCH_PREVIEW_SANDBOX_COMMAND", sys.executable)
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    # Sign with empty roles — non-WorkspaceAdmin member.
    issued_at_sec = int(time.time())
    payload = "|".join(
        (USER_ID, WORKSPACE_ID, WORKSPACE_SLUG, "", REQUEST_ID, str(issued_at_sec))
    )
    headers = {
        HANDOFF_HEADER_USER_ID: USER_ID,
        HANDOFF_HEADER_WORKSPACE_ID: WORKSPACE_ID,
        HANDOFF_HEADER_WORKSPACE_SLUG: WORKSPACE_SLUG,
        HANDOFF_HEADER_REQUEST_ID: REQUEST_ID,
        HANDOFF_HEADER_ISSUED_AT: str(issued_at_sec),
        HANDOFF_HEADER_SIGNATURE: _sign(payload),
    }
    # Empty roles header is malformed per the middleware (rejected
    # at handoff layer); use a non-WorkspaceAdmin role instead.
    canonical_roles = "Researcher"
    payload2 = "|".join(
        (USER_ID, WORKSPACE_ID, WORKSPACE_SLUG, canonical_roles, REQUEST_ID, str(issued_at_sec))
    )
    headers[HANDOFF_HEADER_ROLES] = canonical_roles
    headers[HANDOFF_HEADER_SIGNATURE] = _sign(payload2)
    r = client.post(
        "/api/tool-authoring/drafts/some-id/preview",
        headers=headers,
        json={"harness": "python_smoke"},
    )
    # 403 (role refused) — not 200, not 503.
    assert r.status_code == 403, r.text


def test_dev_mode_uses_default_workspace_fallback(gateway_disabled_env):
    """Without the env var set, the fallback is engaged so existing
    TestClient tests + internal-caller scripts keep working."""
    from simworkbench.api.server import create_app

    client = TestClient(create_app())
    r = client.get("/api/runs")
    assert r.status_code == 200, r.text


def test_dev_mode_does_not_mount_middleware(gateway_disabled_env):
    """In dev mode the middleware MUST NOT be mounted — otherwise
    every direct TestClient test would break."""
    from simworkbench.api.server import create_app

    app = create_app()
    middleware_classes = [m.cls.__name__ for m in app.user_middleware]
    assert "WorkbenchHandoffMiddleware" not in middleware_classes
