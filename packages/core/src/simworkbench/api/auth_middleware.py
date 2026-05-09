"""FastAPI ↔ workbench-gateway HMAC handoff middleware.

Phase 0.5 auth gateway / Phase E (2026-05-09).

The Fastify gateway authenticates the user, resolves the workspace,
then proxies the request to the FastAPI workbench at
``http://127.0.0.1:${WORKBENCH_BACKEND_PORT}`` after attaching seven
``X-Workbench-*`` headers signed with HMAC-SHA256. This middleware is
the FastAPI side of that handoff: it verifies the signature against
the shared ``WORKBENCH_GATEWAY_HANDOFF_SECRET``, rejects replays older
than 30 seconds, and stashes the resolved actor on
``request.state``. The actor is then read by route handlers via
``request.state.workspace_slug`` etc. when computing workspace-scoped
paths through ``simworkbench.paths.simulation_capsules_root_for(...)``.

Defense composition (what the threat model actually relies on):

- **HMAC verification — always on.** Every non-bypass request must
  carry a valid signature against ``WORKBENCH_GATEWAY_HANDOFF_SECRET``.
  Anyone on localhost could spoof the headers without this secret;
  the secret comes from ``.env.auth`` and never leaves the
  gateway/backend pair.
- **Loopback bind — enforced by deployment.** ``scripts/dev/run_backend.py``
  pins ``DEFAULT_HOST = "127.0.0.1"``; the convention checker pins
  the literal so a deployment can't drop it accidentally. Another
  process on the same host could still hit FastAPI directly with no
  auth, but a different host on the network cannot.
- **URL slug cross-check — opt-in via ``slug_prefixed_paths``.** When
  configured (production gateway sets ``slug_prefixed_paths=("/api",)``
  once Phase E5 lands workspace-prefixed FastAPI URLs), the URL's
  workspace prefix must match the asserted slug — defends against
  path tampering even with a valid HMAC. Default is empty: the
  current FastAPI routes are flat ``/api/...`` URLs and the gateway
  strips any slug before proxying, so there's nothing to cross-check
  against. The flag turns the third defense on once the URL
  contract changes.

Companion files:
- ``apps/workbench-gateway/src/proxy/handoffSigner.ts`` — gateway side.
- ``apps/workbench-gateway/src/proxy/workbenchProxy.ts`` — gateway proxy.
- ``packages/core/src/simworkbench/paths/__init__.py`` — workspace-
  scoped path helpers.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


# Lowercase header keys. Fastify normalizes outbound headers, so the
# gateway sets these in lowercase; FastAPI's request headers are case-
# insensitive but we read in lowercase to match.
HANDOFF_HEADER_USER_ID = "x-workbench-user-id"
HANDOFF_HEADER_WORKSPACE_ID = "x-workbench-workspace-id"
HANDOFF_HEADER_WORKSPACE_SLUG = "x-workbench-workspace-slug"
HANDOFF_HEADER_ROLES = "x-workbench-roles"
HANDOFF_HEADER_REQUEST_ID = "x-workbench-request-id"
HANDOFF_HEADER_ISSUED_AT = "x-workbench-issued-at"
HANDOFF_HEADER_SIGNATURE = "x-workbench-signature"

HANDOFF_REQUIRED_HEADERS = (
    HANDOFF_HEADER_USER_ID,
    HANDOFF_HEADER_WORKSPACE_ID,
    HANDOFF_HEADER_WORKSPACE_SLUG,
    HANDOFF_HEADER_ROLES,
    HANDOFF_HEADER_REQUEST_ID,
    HANDOFF_HEADER_ISSUED_AT,
    HANDOFF_HEADER_SIGNATURE,
)

# Replay window (gateway issues with `now`; clock skew tolerance).
DEFAULT_REPLAY_WINDOW_SEC = 30

# Slug pattern mirrors LOGIN_SCHEMA / paths._WORKSPACE_SLUG_PATTERN.
_WORKSPACE_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,64}$")
_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_HEX_64_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class WorkbenchActor:
    """Resolved actor from the gateway handoff. Populated on
    ``request.state`` by the middleware; route handlers read this
    instead of querying the gateway again."""

    user_id: str
    workspace_id: str
    workspace_slug: str
    roles: tuple[str, ...]
    request_id: str
    issued_at_sec: int


class WorkbenchHandoffMiddleware(BaseHTTPMiddleware):
    """Verify the gateway-signed X-Workbench-* headers on every
    request, then attach the resolved actor to ``request.state``.

    Routes that should bypass the middleware (health checks, /docs,
    static OpenAPI JSON) are configurable via ``bypass_paths``.
    """

    def __init__(
        self,
        app,  # ASGIApp
        *,
        handoff_secret: str,
        replay_window_sec: int = DEFAULT_REPLAY_WINDOW_SEC,
        bypass_paths: tuple[str, ...] = ("/api/health",),
        slug_prefixed_paths: tuple[str, ...] = (),
        clock: Callable[[], float] = time.time,
    ) -> None:
        super().__init__(app)
        if not isinstance(handoff_secret, str) or len(handoff_secret) == 0:
            raise ValueError(
                "WorkbenchHandoffMiddleware: handoff_secret must be a non-empty string. "
                "Set WORKBENCH_GATEWAY_HANDOFF_SECRET in .env.auth (≥32 bytes)."
            )
        self._handoff_secret = handoff_secret.encode("utf-8")
        self._replay_window_sec = replay_window_sec
        self._bypass_paths = tuple(bypass_paths)
        # Path prefixes that carry the workspace slug as the FIRST URL
        # segment after the prefix (e.g. ``/api`` if the FastAPI app
        # uses /api/{slug}/... URLs). Defaults to empty: the current
        # FastAPI routes are flat ``/api/...`` URLs and the gateway
        # strips any slug prefix before proxying. Deployments that
        # adopt slug-prefixed FastAPI URLs configure this so the URL
        # cross-check fires.
        self._slug_prefixed_paths = tuple(slug_prefixed_paths)
        self._clock = clock

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[JSONResponse]],
    ):
        # Bypass list: health check + anything else the operator opts out.
        path = request.url.path
        for prefix in self._bypass_paths:
            if path == prefix or path.startswith(prefix + "/"):
                return await call_next(request)

        actor, error = self._verify_and_extract(request)
        if error is not None:
            return error
        # The verifier returns an actor on success.
        assert actor is not None
        request.state.workspace_slug = actor.workspace_slug
        request.state.workspace_id = actor.workspace_id
        request.state.workbench_actor = actor
        return await call_next(request)

    def _verify_and_extract(
        self, request: Request
    ) -> tuple[WorkbenchActor | None, JSONResponse | None]:
        # 1. Required headers present + non-empty.
        missing: list[str] = []
        values: dict[str, str] = {}
        for header in HANDOFF_REQUIRED_HEADERS:
            v = request.headers.get(header)
            if not isinstance(v, str) or len(v) == 0:
                missing.append(header)
                continue
            values[header] = v
        if missing:
            return None, _deny(
                status=401,
                code="UNAUTHENTICATED",
                message=f"Missing handoff header(s): {', '.join(missing)}.",
            )

        # 2. Field shapes — refuse anything that doesn't fit the
        # expected alphabet so a tampered header can't smuggle quote
        # characters into the payload.
        user_id = values[HANDOFF_HEADER_USER_ID]
        workspace_id = values[HANDOFF_HEADER_WORKSPACE_ID]
        workspace_slug = values[HANDOFF_HEADER_WORKSPACE_SLUG]
        roles_raw = values[HANDOFF_HEADER_ROLES]
        request_id = values[HANDOFF_HEADER_REQUEST_ID]
        issued_at_str = values[HANDOFF_HEADER_ISSUED_AT]
        signature_hex = values[HANDOFF_HEADER_SIGNATURE]

        if not _UUID_PATTERN.match(user_id):
            return None, _deny(401, "UNAUTHENTICATED", "Malformed handoff: user-id.")
        if not _UUID_PATTERN.match(workspace_id):
            return None, _deny(401, "UNAUTHENTICATED", "Malformed handoff: workspace-id.")
        if not _WORKSPACE_SLUG_PATTERN.match(workspace_slug):
            return None, _deny(401, "UNAUTHENTICATED", "Malformed handoff: workspace-slug.")
        if not _HEX_64_PATTERN.match(signature_hex):
            return None, _deny(401, "UNAUTHENTICATED", "Malformed handoff: signature.")

        try:
            issued_at_sec = int(issued_at_str)
        except ValueError:
            return None, _deny(401, "UNAUTHENTICATED", "Malformed handoff: issued-at.")

        # 3. Replay window check.
        now_sec = int(self._clock())
        if abs(now_sec - issued_at_sec) > self._replay_window_sec:
            return None, _deny(401, "UNAUTHENTICATED", "Handoff replay window exceeded.")

        # 4. HMAC verification. Roles are joined alphabetically by the
        # gateway; we re-canonicalize the same way before HMAC compare.
        roles = tuple(r for r in roles_raw.split(",") if len(r) > 0)
        canonical_roles = ",".join(sorted(roles))
        payload = "|".join(
            (
                user_id,
                workspace_id,
                workspace_slug,
                canonical_roles,
                request_id,
                str(issued_at_sec),
            )
        ).encode("utf-8")
        expected = hmac.new(
            self._handoff_secret, payload, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, signature_hex.lower()):
            return None, _deny(401, "UNAUTHENTICATED", "Handoff signature invalid.")

        # 5. Slug cross-check (opt-in). For each configured prefix in
        # `slug_prefixed_paths`, if the request path falls under that
        # prefix and the next segment matches the slug pattern, it
        # MUST equal the asserted slug. The current FastAPI routes
        # are flat (the gateway strips the slug before proxying), so
        # this list is empty by default and the cross-check is a no-op.
        for prefix in self._slug_prefixed_paths:
            url_slug = _extract_url_workspace_slug(request.url.path, prefix)
            if url_slug is not None and url_slug != workspace_slug:
                return None, _deny(
                    403, "PERMISSION_DENIED", "Workspace slug mismatch."
                )
            if url_slug is not None:
                # Slug found and matched — no need to check other prefixes.
                break

        return (
            WorkbenchActor(
                user_id=user_id,
                workspace_id=workspace_id,
                workspace_slug=workspace_slug,
                roles=roles,
                request_id=request_id,
                issued_at_sec=issued_at_sec,
            ),
            None,
        )


def _extract_url_workspace_slug(path: str, prefix: str) -> str | None:
    """If the URL is shaped ``${prefix}/{workspace_slug}/...``, return
    the slug. Otherwise return None. Only fires for prefixes the
    deployment opts into via the ``slug_prefixed_paths`` constructor
    argument."""
    normalized_prefix = prefix.rstrip("/") + "/"
    if not path.startswith(normalized_prefix):
        return None
    remainder = path[len(normalized_prefix):]
    next_slash = remainder.find("/")
    candidate = remainder if next_slash < 0 else remainder[:next_slash]
    if _WORKSPACE_SLUG_PATTERN.match(candidate):
        return candidate
    return None


def _deny(status: int, code: str, message: str) -> JSONResponse:
    """Uniform error envelope shape that matches secure_core's §3.
    Keeps the response surface small so the SPA can branch on the
    same shape it gets from the gateway proper."""
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
            }
        },
    )


def load_handoff_secret_from_env() -> str:
    """Convenience helper for the FastAPI app factory: read the same
    env var the gateway loader reads. Throws a friendly error if
    missing — the operator's first cue that ``.env.auth`` is set up
    on the gateway side but not exported into the FastAPI process."""
    secret = os.environ.get("WORKBENCH_GATEWAY_HANDOFF_SECRET")
    if not isinstance(secret, str) or len(secret) == 0:
        raise RuntimeError(
            "WORKBENCH_GATEWAY_HANDOFF_SECRET is not set in the FastAPI process "
            "environment. Source /.env.auth (or the gateway's copy) before "
            "starting the workbench backend so HMAC verification can run."
        )
    if len(secret.encode("utf-8")) < 32:
        raise RuntimeError(
            "WORKBENCH_GATEWAY_HANDOFF_SECRET must be at least 32 bytes "
            "(matches the gateway's loadGatewayEnv minimum)."
        )
    return secret


__all__ = [
    "DEFAULT_REPLAY_WINDOW_SEC",
    "HANDOFF_REQUIRED_HEADERS",
    "WorkbenchActor",
    "WorkbenchHandoffMiddleware",
    "load_handoff_secret_from_env",
]
