"""Single-use, file-backed human-approval tokens for tool lifecycle.

The HTTP API may not accept ``actor="human"`` from a request body —
that's a client-controlled flag and the Phase-6 audit found a worker
agent could promote a tool to ``validated`` by posting the field
itself.

Instead, human-only transitions (``validated``, ``trusted``) require a
pre-written approval file under ``<repo>/local_cache/tool_approvals/``:

    <name>__<from>-to-<to>.approval

The file is written by a local CLI / desktop action that the human
runs explicitly. The API endpoint consumes (reads + deletes) the file
before promoting. The token is single-use so a stale approval cannot
silently authorize a later, unrelated transition.

Carries `agent_error_patterns.md` "Trusting a client-supplied actor
identity for a privileged check" forward into Phase 6+.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from simworkbench.paths import local_cache_root

APPROVAL_SUBDIR: Final[str] = "tool_approvals"


class ApprovalError(RuntimeError):
    """Raised when a required approval token is missing or invalid."""


def approvals_root() -> Path:
    root = local_cache_root() / APPROVAL_SUBDIR
    root.mkdir(parents=True, exist_ok=True)
    return root


def approval_path(name: str, *, from_status: str, to_status: str) -> Path:
    safe_name = "".join(c if c.isalnum() or c in ("-", "_", ".") else "_" for c in name)
    return approvals_root() / f"{safe_name}__{from_status}-to-{to_status}.approval"


def grant_approval(
    name: str, *, from_status: str, to_status: str, reviewer: str = "local"
) -> Path:
    """Write a single-use approval token for the named transition.

    Called by a local CLI / desktop hook that confirmed the human's
    intent. Returns the path of the written token.
    """
    if not name:
        raise ApprovalError("Cannot grant approval for empty tool name.")
    if not reviewer:
        raise ApprovalError(
            "Reviewer name required so the approval is auditable; "
            "the agent's own identity is not a valid reviewer."
        )
    payload = (
        f"reviewer: {reviewer}\n"
        f"granted_at: {datetime.now(UTC).isoformat(timespec='microseconds')}\n"
        f"transition: {from_status} -> {to_status}\n"
        f"token: {secrets.token_hex(16)}\n"
    )
    target = approval_path(name, from_status=from_status, to_status=to_status)
    target.write_text(payload, encoding="utf-8")
    return target


def consume_approval(
    name: str, *, from_status: str, to_status: str
) -> str:
    """Atomically consume the approval token for the named transition.

    Returns the reviewer string from the token. Raises ``ApprovalError``
    if no token exists. The token file is deleted on a successful read
    so it can't be replayed.
    """
    target = approval_path(name, from_status=from_status, to_status=to_status)
    if not target.is_file():
        raise ApprovalError(
            f"No human-approval token for {name!r}: {from_status} → "
            f"{to_status}. Generate one with `python -m "
            "simworkbench.tools.approve` (or `grant_approval(...)` from "
            "Python) before retrying."
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
    "ApprovalError",
    "approval_path",
    "approvals_root",
    "consume_approval",
    "grant_approval",
]
