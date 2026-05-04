"""Phase 10 / 10E — Human approval gates for autonomous actions.

Carries the Phase-7/8 backend-approval pattern forward into the
autonomy layer. Every privileged action — trusted-module promotion,
expensive runs, external file export, destructive edits — requires an
out-of-band single-use approval token. The HTTP API never reads
``actor`` / ``role`` from a request body (Phase-6 audit lesson).

Approvals live under ``local_cache/autonomy_approvals/`` as files. The
file's existence IS the grant; consuming the gate deletes the file
(single-use semantics, auditable through filesystem mtime).
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from simworkbench.paths import local_cache_root

# Plan §16.1 + configs/agents.yaml `human_approval_gates` block.
# Every action listed here is gateable; unrecognised actions raise.
KNOWN_ACTIONS: Final[frozenset[str]] = frozenset(
    {
        "trusted_promotion",
        "module_promotion_to_trusted",
        "expensive_run",
        "high_compute_runs",
        "external_export",
        "destructive_edits",
        "destructive_git_operations",
    }
)

APPROVAL_SUBDIR: Final[str] = "autonomy_approvals"

_SAFE_RE: Final[re.Pattern[str]] = re.compile(r"[^A-Za-z0-9._-]+")


class ApprovalRequiredError(RuntimeError):
    """Raised when a privileged action is attempted without a granted token."""


@dataclass(frozen=True)
class ApprovalRecord:
    """Audit trail of a consumed approval token."""

    action: str
    subject: str
    reviewer: str
    granted_at: str
    consumed_at: str


def _safe(part: str) -> str:
    return _SAFE_RE.sub("_", part) or "_"


def _validate_action(action: str) -> str:
    if not action:
        raise ApprovalRequiredError("Approval action must be a non-empty string.")
    if action not in KNOWN_ACTIONS:
        raise ApprovalRequiredError(
            f"Unknown approval action {action!r}. Supported: "
            f"{sorted(KNOWN_ACTIONS)}."
        )
    return action


class ApprovalGate:
    """Filesystem-backed single-use approval gate.

    Construct with an explicit ``state_dir`` for tests; defaults to
    ``local_cache/autonomy_approvals/`` in production.
    """

    def __init__(
        self,
        state_dir: str | Path | None = None,
        *,
        require_workbench_target: bool = True,
    ) -> None:
        self.state_dir = (
            Path(state_dir) if state_dir is not None
            else local_cache_root() / APPROVAL_SUBDIR
        )
        # Phase-10 round-2 audit: approval state must live under the
        # workbench's managed roots. The earlier implementation
        # accepted ``state_dir=/private/tmp/...`` which let an
        # autonomy probe drop tokens (and audit trails) outside the
        # repo. The opt-out kwarg matches the pattern used by every
        # other Phase-8/9/10 writer.
        self.require_workbench_target = require_workbench_target
        if require_workbench_target:
            from simworkbench.paths import is_under_workbench

            if not is_under_workbench(self.state_dir):
                raise PermissionError(
                    f"Refusing to use approval state_dir outside "
                    f"workbench-managed roots: {self.state_dir}. "
                    "Pass require_workbench_target=False if the user "
                    "explicitly chose an external destination."
                )
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def _token_path(self, *, action: str, subject: str) -> Path:
        return self.state_dir / f"{_safe(action)}__{_safe(subject)}.approval"

    def consume(self, *, action: str, subject: str) -> ApprovalRecord:
        """Consume a single-use approval token.

        Raises ``ApprovalRequiredError`` when no matching token exists,
        the action name is unknown, or the action/subject combination
        doesn't match a granted token. On success, the file is deleted
        — the same call cannot be made twice.
        """
        _validate_action(action)
        if not subject:
            raise ApprovalRequiredError(
                "Approval subject must be a non-empty string."
            )
        target = self._token_path(action=action, subject=subject)
        if not target.is_file():
            raise ApprovalRequiredError(
                f"No human-approval token for action={action!r} "
                f"subject={subject!r}. Generate one with "
                "`simworkbench.autonomy.grant_autonomy_approval` "
                "before retrying."
            )
        body = target.read_text(encoding="utf-8")
        target.unlink()
        reviewer = "unknown"
        granted_at = ""
        for line in body.splitlines():
            if line.startswith("reviewer:"):
                reviewer = line.split(":", 1)[1].strip() or "unknown"
            elif line.startswith("granted_at:"):
                granted_at = line.split(":", 1)[1].strip()
        return ApprovalRecord(
            action=action,
            subject=subject,
            reviewer=reviewer,
            granted_at=granted_at,
            consumed_at=datetime.now(UTC).isoformat(timespec="microseconds"),
        )


def grant_autonomy_approval(
    *,
    action: str,
    subject: str,
    reviewer: str = "local",
    state_dir: str | Path | None = None,
    require_workbench_target: bool = True,
) -> Path:
    """Write a single-use approval token to disk.

    The HTTP API never invokes this — it's a CLI / human-in-the-loop
    helper. The file at the returned path exists exactly until
    ``ApprovalGate.consume`` deletes it. ``require_workbench_target``
    matches the gate's own locality guard.
    """
    _validate_action(action)
    if not subject:
        raise ApprovalRequiredError(
            "Approval subject must be a non-empty string."
        )
    if not reviewer:
        raise ApprovalRequiredError(
            "Reviewer name required so the approval is auditable; "
            "the agent's own identity is not a valid reviewer."
        )
    gate = ApprovalGate(
        state_dir=state_dir,
        require_workbench_target=require_workbench_target,
    )
    target = gate._token_path(action=action, subject=subject)
    payload = (
        f"reviewer: {reviewer}\n"
        f"granted_at: {datetime.now(UTC).isoformat(timespec='microseconds')}\n"
        f"action: {action}\n"
        f"subject: {subject}\n"
        f"token: {secrets.token_hex(16)}\n"
    )
    target.write_text(payload, encoding="utf-8")
    return target


__all__ = [
    "APPROVAL_SUBDIR",
    "ApprovalGate",
    "ApprovalRecord",
    "ApprovalRequiredError",
    "KNOWN_ACTIONS",
    "grant_autonomy_approval",
]
