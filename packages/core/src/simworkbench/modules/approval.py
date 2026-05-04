"""Phase 7 — Module-promotion approval tokens.

Mirrors the Phase 6 tool-approval flow (
``simworkbench.tools.approval``): the HTTP API may not promote a
module to ``validated`` or ``trusted`` on the strength of a request-
body field. Instead, a local CLI / Python helper writes a single-use
token under ``<repo>/local_cache/module_approvals/`` and the API
consumes it on the matching transition.

Carries `agent_error_patterns.md` "Trusting a client-supplied actor
identity for a privileged check" forward into Phase 7.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from simworkbench.paths import local_cache_root
from simworkbench.tools.approval import ApprovalError as ModuleApprovalError

APPROVAL_SUBDIR: Final[str] = "module_approvals"


def module_approvals_root() -> Path:
    root = local_cache_root() / APPROVAL_SUBDIR
    root.mkdir(parents=True, exist_ok=True)
    return root


def module_approval_path(
    name: str, *, from_status: str, to_status: str
) -> Path:
    safe = "".join(
        c if c.isalnum() or c in ("-", "_", ".") else "_" for c in name
    )
    return module_approvals_root() / f"{safe}__{from_status}-to-{to_status}.approval"


def grant_module_approval(
    name: str,
    *,
    from_status: str,
    to_status: str,
    reviewer: str = "local",
) -> Path:
    if not name:
        raise ModuleApprovalError("Cannot grant approval for empty module name.")
    if not reviewer:
        raise ModuleApprovalError(
            "Reviewer name required so the approval is auditable; "
            "the agent's own identity is not a valid reviewer."
        )
    payload = (
        f"reviewer: {reviewer}\n"
        f"granted_at: {datetime.now(UTC).isoformat(timespec='microseconds')}\n"
        f"transition: {from_status} -> {to_status}\n"
        f"token: {secrets.token_hex(16)}\n"
    )
    target = module_approval_path(name, from_status=from_status, to_status=to_status)
    target.write_text(payload, encoding="utf-8")
    return target


def consume_module_approval(
    name: str, *, from_status: str, to_status: str
) -> str:
    target = module_approval_path(name, from_status=from_status, to_status=to_status)
    if not target.is_file():
        raise ModuleApprovalError(
            f"No human-approval token for module {name!r}: "
            f"{from_status} → {to_status}. Generate one with "
            "`simworkbench.modules.grant_module_approval` (or "
            "`python -m simworkbench.modules.approve`) before retrying."
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
    "ModuleApprovalError",
    "consume_module_approval",
    "grant_module_approval",
    "module_approval_path",
    "module_approvals_root",
]
