"""Phase 0.5 auth gateway / Phase E (2026-05-09).

Pin the FastAPI ↔ workbench-gateway HMAC handoff middleware:

    - Missing handoff headers → 401.
    - Malformed user_id / workspace_id / slug / signature → 401.
    - Wrong HMAC signature → 401.
    - Replay window exceeded (>30s) → 401.
    - URL slug mismatch with header slug → 403.
    - Happy path → 200 + ``request.state.workspace_slug`` populated.
    - Bypass paths (e.g. /api/health) skip the middleware entirely.

These tests are pure-logic: a thin FastAPI app uses the middleware
directly without touching the workbench's 60 routes. The gateway-side
signer is exercised separately in
``apps/workbench-gateway/test/proxy/handoffSigner.test.ts``.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from simworkbench.api.auth_middleware import (
    HANDOFF_HEADER_ISSUED_AT,
    HANDOFF_HEADER_REQUEST_ID,
    HANDOFF_HEADER_ROLES,
    HANDOFF_HEADER_SIGNATURE,
    HANDOFF_HEADER_USER_ID,
    HANDOFF_HEADER_WORKSPACE_ID,
    HANDOFF_HEADER_WORKSPACE_SLUG,
    WorkbenchHandoffMiddleware,
)

SECRET = "Aa!23456789012345678901234567890123456"  # 38 bytes
USER_ID = "11111111-1111-4111-8111-111111111111"
WORKSPACE_ID = "22222222-2222-4222-8222-222222222222"
WORKSPACE_SLUG = "shared-public-experiments"
REQUEST_ID = "33333333-3333-4333-8333-333333333333"


def _build_app(*, replay_window_sec: int = 30, clock=None) -> FastAPI:
    app = FastAPI()

    if clock is not None:
        app.add_middleware(
            WorkbenchHandoffMiddleware,
            handoff_secret=SECRET,
            replay_window_sec=replay_window_sec,
            clock=clock,
        )
    else:
        app.add_middleware(
            WorkbenchHandoffMiddleware,
            handoff_secret=SECRET,
            replay_window_sec=replay_window_sec,
        )

    @app.get("/api/health")
    def _health():
        # In the bypass list — should NOT be HMAC-checked.
        return {"ok": True}

    @app.get("/api/echo-actor")
    def _echo(request: Request):
        return {
            "user_id": request.state.workbench_actor.user_id,
            "workspace_slug": request.state.workbench_actor.workspace_slug,
            "roles": list(request.state.workbench_actor.roles),
        }

    return app


def _sign(payload: str) -> str:
    return hmac.new(SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _signed_headers(
    *,
    user_id: str = USER_ID,
    workspace_id: str = WORKSPACE_ID,
    workspace_slug: str = WORKSPACE_SLUG,
    roles: tuple[str, ...] = ("Researcher", "WorkspaceAdmin"),
    request_id: str = REQUEST_ID,
    issued_at_sec: int | None = None,
) -> dict[str, str]:
    if issued_at_sec is None:
        issued_at_sec = int(time.time())
    canonical_roles = ",".join(sorted(roles))
    payload = "|".join(
        (user_id, workspace_id, workspace_slug, canonical_roles, request_id, str(issued_at_sec))
    )
    return {
        HANDOFF_HEADER_USER_ID: user_id,
        HANDOFF_HEADER_WORKSPACE_ID: workspace_id,
        HANDOFF_HEADER_WORKSPACE_SLUG: workspace_slug,
        HANDOFF_HEADER_ROLES: canonical_roles,
        HANDOFF_HEADER_REQUEST_ID: request_id,
        HANDOFF_HEADER_ISSUED_AT: str(issued_at_sec),
        HANDOFF_HEADER_SIGNATURE: _sign(payload),
    }


# ---------------------------------------------------------------------
# Happy path + bypass
# ---------------------------------------------------------------------


def test_happy_path_passes_and_populates_request_state():
    client = TestClient(_build_app())
    r = client.get("/api/echo-actor", headers=_signed_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == USER_ID
    assert body["workspace_slug"] == WORKSPACE_SLUG
    assert body["roles"] == ["Researcher", "WorkspaceAdmin"]


def test_bypass_path_does_not_require_handoff_headers():
    client = TestClient(_build_app())
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ---------------------------------------------------------------------
# Missing / malformed headers
# ---------------------------------------------------------------------


def test_missing_signature_header_returns_401():
    client = TestClient(_build_app())
    headers = _signed_headers()
    headers.pop(HANDOFF_HEADER_SIGNATURE)
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 401
    assert "Missing handoff header" in r.json()["error"]["message"]


def test_missing_user_id_header_returns_401():
    client = TestClient(_build_app())
    headers = _signed_headers()
    headers.pop(HANDOFF_HEADER_USER_ID)
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 401


def test_malformed_user_id_returns_401():
    client = TestClient(_build_app())
    headers = _signed_headers(user_id="not-a-uuid")
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 401
    assert "Malformed handoff: user-id" in r.json()["error"]["message"]


def test_malformed_workspace_slug_returns_401():
    client = TestClient(_build_app())
    headers = _signed_headers(workspace_slug="has spaces!")
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 401
    assert "workspace-slug" in r.json()["error"]["message"]


# ---------------------------------------------------------------------
# Signature / replay
# ---------------------------------------------------------------------


def test_wrong_signature_returns_401():
    client = TestClient(_build_app())
    headers = _signed_headers()
    # Forge a same-length signature.
    headers[HANDOFF_HEADER_SIGNATURE] = "0" * 64
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 401
    assert "signature" in r.json()["error"]["message"].lower()


def test_replay_window_exceeded_returns_401():
    # Pin clock at T0; build headers issued at T0.
    fixed_now = 1_700_000_000
    headers = _signed_headers(issued_at_sec=fixed_now)
    # Move the clock forward past the window.
    advanced_now = fixed_now + 31

    client = TestClient(
        _build_app(replay_window_sec=30, clock=lambda: advanced_now)
    )
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 401
    assert "replay" in r.json()["error"]["message"].lower()


def test_payload_at_window_boundary_passes():
    fixed_now = 1_700_000_000
    headers = _signed_headers(issued_at_sec=fixed_now)
    # Exactly the window boundary — must pass (delta == replay_window).
    advanced_now = fixed_now + 30

    client = TestClient(
        _build_app(replay_window_sec=30, clock=lambda: advanced_now)
    )
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 200


def test_role_order_does_not_affect_signature():
    # Reverse the role order in the header; the middleware sorts before
    # HMAC compare, so the signature still verifies.
    fixed_now = 1_700_000_000
    canonical = ",".join(sorted(("Researcher", "WorkspaceAdmin")))
    payload = "|".join(
        (USER_ID, WORKSPACE_ID, WORKSPACE_SLUG, canonical, REQUEST_ID, str(fixed_now))
    )
    sig = _sign(payload)
    headers = {
        HANDOFF_HEADER_USER_ID: USER_ID,
        HANDOFF_HEADER_WORKSPACE_ID: WORKSPACE_ID,
        HANDOFF_HEADER_WORKSPACE_SLUG: WORKSPACE_SLUG,
        # Reversed in the header value:
        HANDOFF_HEADER_ROLES: "WorkspaceAdmin,Researcher",
        HANDOFF_HEADER_REQUEST_ID: REQUEST_ID,
        HANDOFF_HEADER_ISSUED_AT: str(fixed_now),
        HANDOFF_HEADER_SIGNATURE: sig,
    }
    client = TestClient(_build_app(clock=lambda: fixed_now))
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 200


# ---------------------------------------------------------------------
# URL slug cross-check
# ---------------------------------------------------------------------


def test_url_slug_mismatch_returns_403_when_slug_prefixed_paths_configured():
    """If the request URL is shaped /api/{ws}/... AND the deployment
    opted into slug-cross-check via ``slug_prefixed_paths=("/api",)``,
    the slug MUST match the asserted header."""
    fixed_now = 1_700_000_000
    headers = _signed_headers(issued_at_sec=fixed_now)
    app = FastAPI()
    app.add_middleware(
        WorkbenchHandoffMiddleware,
        handoff_secret=SECRET,
        slug_prefixed_paths=("/api",),
        clock=lambda: fixed_now,
    )

    @app.get("/api/{slug}/echo")
    def _echo(slug: str):
        return {"slug": slug}

    client = TestClient(app)
    # Header asserts shared-public-experiments; URL says different-slug.
    r = client.get("/api/different-slug/echo", headers=headers)
    assert r.status_code == 403


def test_url_slug_match_passes_when_slug_prefixed_paths_configured():
    fixed_now = 1_700_000_000
    headers = _signed_headers(issued_at_sec=fixed_now)
    app = FastAPI()
    app.add_middleware(
        WorkbenchHandoffMiddleware,
        handoff_secret=SECRET,
        slug_prefixed_paths=("/api",),
        clock=lambda: fixed_now,
    )

    @app.get(f"/api/{WORKSPACE_SLUG}/echo")
    def _echo():
        return {"ok": True}

    client = TestClient(app)
    r = client.get(f"/api/{WORKSPACE_SLUG}/echo", headers=headers)
    assert r.status_code == 200


def test_url_slug_check_does_not_fire_on_flat_routes_by_default():
    """Default config has slug_prefixed_paths empty, so the cross-check
    does NOT fire on /api/echo-actor (where ``echo-actor`` syntactically
    matches the slug pattern but is actually a resource name)."""
    fixed_now = 1_700_000_000
    headers = _signed_headers(issued_at_sec=fixed_now)
    client = TestClient(_build_app(clock=lambda: fixed_now))
    r = client.get("/api/echo-actor", headers=headers)
    assert r.status_code == 200
