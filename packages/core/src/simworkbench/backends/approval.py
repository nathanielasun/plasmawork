"""Phase 8 — Backend-promotion approval tokens.

Mirrors the Phase 6 tool-approval flow + Phase 7 module-approval flow:
the HTTP API may not promote a backend to ``validated`` / ``trusted``
on the strength of a request-body field. A local CLI / Python helper
writes a single-use token under
``<repo>/local_cache/backend_approvals/`` and the API consumes it
on the matching transition.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from simworkbench.paths import local_cache_root
from simworkbench.tools.approval import ApprovalError as BackendApprovalError

APPROVAL_SUBDIR: Final[str] = "backend_approvals"


def backend_approvals_root() -> Path:
    root = local_cache_root() / APPROVAL_SUBDIR
    root.mkdir(parents=True, exist_ok=True)
    return root


def backend_approval_path(
    name: str, *, from_status: str, to_status: str
) -> Path:
    safe = "".join(
        c if c.isalnum() or c in ("-", "_", ".") else "_" for c in name
    )
    return backend_approvals_root() / f"{safe}__{from_status}-to-{to_status}.approval"


def grant_backend_approval(
    name: str,
    *,
    from_status: str,
    to_status: str,
    reviewer: str = "local",
) -> Path:
    if not name:
        raise BackendApprovalError("Cannot grant approval for empty backend name.")
    if not reviewer:
        raise BackendApprovalError(
            "Reviewer name required so the approval is auditable; "
            "the agent's own identity is not a valid reviewer."
        )
    payload = (
        f"reviewer: {reviewer}\n"
        f"granted_at: {datetime.now(UTC).isoformat(timespec='microseconds')}\n"
        f"transition: {from_status} -> {to_status}\n"
        f"token: {secrets.token_hex(16)}\n"
    )
    target = backend_approval_path(name, from_status=from_status, to_status=to_status)
    target.write_text(payload, encoding="utf-8")
    return target


def consume_backend_approval(
    name: str, *, from_status: str, to_status: str
) -> str:
    target = backend_approval_path(name, from_status=from_status, to_status=to_status)
    if not target.is_file():
        raise BackendApprovalError(
            f"No human-approval token for backend {name!r}: "
            f"{from_status} → {to_status}. Generate one with "
            "`simworkbench.backends.grant_backend_approval` before retrying."
        )
    body = target.read_text(encoding="utf-8")
    target.unlink()
    reviewer = "unknown"
    for line in body.splitlines():
        if line.startswith("reviewer:"):
            reviewer = line.split(":", 1)[1].strip() or "unknown"
            break
    return reviewer


__all__ = [
    "APPROVAL_SUBDIR",
    "BackendApprovalError",
    "backend_approval_path",
    "backend_approvals_root",
    "consume_backend_approval",
    "grant_backend_approval",
]
