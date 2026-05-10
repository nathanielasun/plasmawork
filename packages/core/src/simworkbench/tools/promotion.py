"""Tool promotion service — Phase α.4 (2026-05-10).

Cross-workspace tool promotion via a lightweight dual-actor pattern.
A WorkspaceAdmin in workspace X requests promotion of one of X's
imported tools to a target workspace (typically
``shared-internal-tools``); a PlatformAdmin approves; the approval
performs the cross-workspace directory copy and audits the action.

Production audit emission uses a gateway-internal HMAC bridge so
promotion request/decision events land in the canonical secure_core
audit chain. Local single-user development falls back to an append-only
hash-chained JSONL verifier so promotion behavior stays inspectable
without a database-backed gateway.

State layout::

    local_cache/imported_tools/_pending_promotions/{request_id}.json
        {
          "request_id":         <uuid v4>,
          "tool_name":          <tool name>,
          "from_workspace_slug": <source slug>,
          "to_workspace_slug":   <target slug>,
          "requested_by":        <requester user_id from handoff>,
          "requested_at":        <RFC3339 UTC>,
          "justification":       <free text>,
          "status":              "pending" | "approved" | "denied",
          "decided_by":          <approver user_id, on approve/deny>,
          "decided_at":          <RFC3339 UTC, on approve/deny>,
          "decision_note":       <approver's free text, optional>
        }

The state directory is sibling to the workspace slug folders under
``imported_tools/`` and is in ``RESERVED_QUARANTINE_DIRS`` so
``ToolRegistry`` never walks it.

Approval is idempotent on completed records (re-approving a
previously-approved request is a no-op). Denying a pending request
simply sets the status; the operator can manually delete the JSON.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from simworkbench.paths import (
    imported_tools_root_for,
    tool_promotions_root,
)

# Tamper-evident audit chain for local promotion decisions — Phase α
# post-audit hardening (2026-05-10).
#
# The promotion JSON records under _pending_promotions/{id}.json are
# mutable (status flips pending → approved | denied; decided_by /
# decided_at land on the same record). That's fine for the workflow
# state but it's NOT a tamper-evident audit. The audit caught this:
# secure_core has a hash-chained audit_events table; our promotion
# decisions don't reach it.
#
# Gateway-required deployments POST through a gateway-internal audit
# route and fail closed when canonical audit emission fails. Local
# single-user development writes ``_pending_promotions/_audit_chain.jsonl``
# with rows shaped as ``{prev_hash, fields..., row_hash}``, where
# row_hash = SHA-256(canonical(prev_hash + fields)). The verifier below
# walks that chain and surfaces tampering.
PROMOTION_AUDIT_LOG_NAME = "_audit_chain.jsonl"


class PromotionAuditError(RuntimeError):
    """Raised when promotion audit emission fails closed."""


def _gateway_required() -> bool:
    return (
        bool(os.environ.get("WORKBENCH_GATEWAY_HANDOFF_SECRET"))
        or os.environ.get("SIMWORKBENCH_REQUIRE_GATEWAY") == "1"
    )


def _canonicalize(payload: dict[str, object]) -> bytes:
    """JCS-style canonicalization: sorted keys + minimal separators."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _emit_promotion_audit(
    *,
    action: str,
    record: PromotionRequest,
) -> None:
    if _gateway_required():
        _emit_canonical_promotion_audit(action=action, record=record)
        return
    _emit_local_promotion_audit(action=action, record=record)


def _emit_local_promotion_audit(
    *,
    action: str,
    record: PromotionRequest,
) -> None:
    """Append a hash-chained event to the promotion audit log.

    The fields land in a stable canonical order; the row_hash chains
    to the previous line's row_hash so an attacker who edits any
    record breaks the chain at the next read.
    """
    log_path = tool_promotions_root() / PROMOTION_AUDIT_LOG_NAME
    prev_hash: str | None = None
    if log_path.is_file():
        try:
            last_line = ""
            with log_path.open("r", encoding="utf-8") as fh:
                for raw_line in fh:
                    stripped = raw_line.strip()
                    if stripped:
                        last_line = stripped
            if last_line:
                prev = json.loads(last_line)
                prev_hash = prev.get("row_hash")
        except (OSError, ValueError):
            # Corrupted last line — treat as the chain head. The
            # verifier surfaces this as a tamper finding on read.
            prev_hash = None
    fields: dict[str, object] = {
        "action": action,
        "request_id": record.request_id,
        "tool_name": record.tool_name,
        "from_workspace_slug": record.from_workspace_slug,
        "to_workspace_slug": record.to_workspace_slug,
        "requested_by": record.requested_by,
        "requested_at": record.requested_at,
        "status": record.status,
        "decided_by": record.decided_by,
        "decided_at": record.decided_at,
        "ts": _now_iso(),
    }
    payload: dict[str, object] = {"prev_hash": prev_hash, **fields}
    row_hash = hashlib.sha256(_canonicalize(payload)).hexdigest()
    line = {**payload, "row_hash": row_hash}
    log_path.parent.mkdir(parents=True, exist_ok=True)
    # Append atomically. The promotion path is single-writer per
    # request_id (FastAPI single process); concurrent writes on
    # DIFFERENT request_ids could in principle interleave, but each
    # write is a single line so there's no torn-write hazard.
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(line, sort_keys=True) + "\n")


def verify_promotion_audit_chain() -> tuple[bool, str]:
    """Verify the dev-mode local promotion audit chain."""
    log_path = tool_promotions_root() / PROMOTION_AUDIT_LOG_NAME
    ok = True
    message = "ok"
    if not log_path.exists():
        return True, "empty"
    previous: str | None = None
    try:
        lines = log_path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        ok = False
        message = f"unreadable: {exc}"
    if ok:
        for index, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            failure: str | None = None
            try:
                row = json.loads(line)
            except ValueError as exc:
                failure = f"line {index}: invalid JSON: {exc}"
            if failure is None and row.get("prev_hash") != previous:
                failure = f"line {index}: prev_hash mismatch"
            row_hash = row.get("row_hash") if failure is None else None
            if failure is None and not isinstance(row_hash, str):
                failure = f"line {index}: missing row_hash"
            if failure is None:
                canonical_payload = {
                    k: v for k, v in row.items() if k != "row_hash"
                }
                expected = hashlib.sha256(
                    _canonicalize(canonical_payload)
                ).hexdigest()
                if not hmac.compare_digest(row_hash, expected):
                    failure = f"line {index}: row_hash mismatch"
            if failure is not None:
                ok = False
                message = failure
                break
            previous = row_hash
    return ok, message


def _canonical_action(action: str) -> str:
    if action == "tool.promotion_approved":
        return "tool.promoted"
    return action


def _canonical_result(action: str) -> str:
    return "denied" if action == "tool.promotion_denied" else "succeeded"


def _audit_actor(record: PromotionRequest) -> str:
    if record.status == "pending":
        return record.requested_by
    if record.decided_by:
        return record.decided_by
    return record.requested_by


def _emit_canonical_promotion_audit(
    *,
    action: str,
    record: PromotionRequest,
) -> None:
    secret = os.environ.get("WORKBENCH_GATEWAY_HANDOFF_SECRET")
    if not secret:
        raise PromotionAuditError(
            "WORKBENCH_GATEWAY_HANDOFF_SECRET is required for canonical promotion audit."
        )
    ts = str(int(time.time()))
    body = {
        "action": _canonical_action(action),
        "promotion_request_id": record.request_id,
        "actor_user_id": _audit_actor(record),
        "result": _canonical_result(action),
    }
    payload = "|".join(
        (
            ts,
            body["action"],
            body["promotion_request_id"],
            body["actor_user_id"],
            body["result"],
        )
    )
    signature = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    gateway_url = os.environ.get(
        "WORKBENCH_GATEWAY_INTERNAL_URL",
        "http://127.0.0.1:4000",
    ).rstrip("/")
    req = urllib.request.Request(
        f"{gateway_url}/internal/audit-events/tool-promotion",
        data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-workbench-internal-audit-timestamp": ts,
            "x-workbench-internal-audit-signature": signature,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status < 200 or response.status >= 300:
                raise PromotionAuditError(
                    f"canonical audit bridge returned HTTP {response.status}"
                )
    except (OSError, urllib.error.URLError) as exc:
        raise PromotionAuditError(
            f"canonical promotion audit bridge failed: {exc}"
        ) from exc


PromotionStatus = Literal["pending", "approved", "denied"]


class PromotionError(RuntimeError):
    """Raised when a promotion request / approval fails a precondition.

    The FastAPI handler maps this to 400 (caller error). The error
    message is surfaced verbatim — every PromotionError emits a
    discrete, reviewable diagnostic (no anti-enumeration concern
    here; the requester is already authenticated).
    """


class PromotionNotFound(PromotionError):
    """The referenced promotion request id does not exist on disk."""


@dataclass(frozen=True)
class PromotionRequest:
    request_id: str
    tool_name: str
    from_workspace_slug: str
    to_workspace_slug: str
    requested_by: str
    requested_at: str
    justification: str
    status: PromotionStatus
    decided_by: str | None = None
    decided_at: str | None = None
    decision_note: str | None = None

    def as_json_dict(self) -> dict[str, object]:
        return asdict(self)


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _record_path(request_id: str) -> Path:
    if not _is_valid_request_id(request_id):
        raise PromotionError(
            f"request_id {request_id!r} is not a valid UUID v4."
        )
    return tool_promotions_root() / f"{request_id}.json"


def _is_valid_request_id(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return False
    # Accept UUIDv4 + UUIDv7 (some tooling generates v7); reject other
    # versions so the on-disk shape is predictable.
    return parsed.version in (4, 7)


def _validate_tool_name(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise PromotionError("tool_name must be a non-empty string.")
    if "/" in value or "\\" in value or value.startswith("."):
        raise PromotionError(
            f"tool_name {value!r} contains a path separator or starts "
            "with a dot — refusing."
        )
    return value


def _validate_workspace_slug(value: str) -> str:
    # Mirror the slug regex from simworkbench.paths — but the path
    # helper validates strictly (ValueError on malformed). We catch
    # here to surface as PromotionError.
    from simworkbench.paths import _validate_workspace_slug as _path_validate  # noqa: PLC0415

    try:
        return _path_validate(value)
    except ValueError as exc:
        raise PromotionError(str(exc)) from exc


class PromotionService:
    """Manages pending + completed cross-workspace tool promotions.

    Stateless aside from the on-disk record directory. Each method
    is safe to call concurrently as long as the underlying filesystem
    is. Approval performs the directory copy in two steps (copy to
    a temp directory, then atomic rename) so a partial failure leaves
    the target untouched.
    """

    def request(
        self,
        *,
        tool_name: str,
        from_workspace_slug: str,
        to_workspace_slug: str,
        requested_by: str,
        justification: str,
    ) -> PromotionRequest:
        """Create a pending promotion request. Returns the persisted
        record. Refuses when:
          - the source tool does not exist in the source workspace
          - the same tool already exists in the target workspace
            (same name → would conflict on copy)
          - source == target (no-op)
        """
        tool_name = _validate_tool_name(tool_name)
        from_workspace_slug = _validate_workspace_slug(from_workspace_slug)
        to_workspace_slug = _validate_workspace_slug(to_workspace_slug)
        if from_workspace_slug == to_workspace_slug:
            raise PromotionError(
                "Source and target workspace must differ."
            )
        if not isinstance(requested_by, str) or not requested_by:
            raise PromotionError("requested_by must be a non-empty string.")
        if not isinstance(justification, str):
            raise PromotionError("justification must be a string.")

        source_dir = imported_tools_root_for(from_workspace_slug) / tool_name
        if not source_dir.is_dir() or not (source_dir / "tool.yaml").is_file():
            raise PromotionError(
                f"Tool {tool_name!r} is not present in workspace "
                f"{from_workspace_slug!r}."
            )
        target_dir = imported_tools_root_for(to_workspace_slug) / tool_name
        if target_dir.exists():
            raise PromotionError(
                f"Tool {tool_name!r} already exists in workspace "
                f"{to_workspace_slug!r}; refusing to overwrite. Delete "
                "the target first or pick a different name."
            )

        record = PromotionRequest(
            request_id=str(uuid.uuid4()),
            tool_name=tool_name,
            from_workspace_slug=from_workspace_slug,
            to_workspace_slug=to_workspace_slug,
            requested_by=requested_by,
            requested_at=_now_iso(),
            justification=justification[:4096],
            status="pending",
        )
        record_path = _record_path(record.request_id)
        record_path.write_text(
            json.dumps(record.as_json_dict(), indent=2),
            encoding="utf-8",
        )
        try:
            _emit_promotion_audit(
                action="tool.promotion_requested",
                record=record,
            )
        except Exception:
            record_path.unlink(missing_ok=True)
            raise
        return record

    def list_pending(self) -> list[PromotionRequest]:
        """Return every pending request, oldest first."""
        out: list[PromotionRequest] = []
        for path in sorted(tool_promotions_root().glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            try:
                record = PromotionRequest(**data)
            except TypeError:
                continue
            if record.status == "pending":
                out.append(record)
        out.sort(key=lambda r: r.requested_at)
        return out

    def get(self, request_id: str) -> PromotionRequest:
        path = _record_path(request_id)
        if not path.is_file():
            raise PromotionNotFound(f"No promotion request {request_id!r}.")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PromotionError(
                f"Promotion record {request_id!r} is unreadable: {exc}"
            ) from exc
        try:
            return PromotionRequest(**data)
        except TypeError as exc:
            raise PromotionError(
                f"Promotion record {request_id!r} has an unexpected shape: {exc}"
            ) from exc

    def approve(
        self,
        *,
        request_id: str,
        approver_user_id: str,
        decision_note: str = "",
    ) -> PromotionRequest:
        """Approve a pending request. Performs the directory copy
        (source → target) and persists the completed record.

        Re-approving an already-approved record is a no-op (returns
        the existing record unchanged). Approving a denied record
        raises ``PromotionError``.
        """
        if not isinstance(approver_user_id, str) or not approver_user_id:
            raise PromotionError(
                "approver_user_id must be a non-empty string."
            )
        record = self.get(request_id)
        if record.status == "approved":
            return record
        if record.status == "denied":
            raise PromotionError(
                f"Promotion {request_id!r} was previously denied; cannot approve."
            )

        source_dir = (
            imported_tools_root_for(record.from_workspace_slug)
            / record.tool_name
        )
        target_dir = (
            imported_tools_root_for(record.to_workspace_slug)
            / record.tool_name
        )
        if not source_dir.is_dir():
            raise PromotionError(
                "Source tool no longer exists; cannot promote. Was it "
                "deleted between request and approval?"
            )
        if target_dir.exists():
            raise PromotionError(
                "Target slot is now occupied; cannot promote without "
                "overwriting. Delete the target first or deny this "
                "request."
            )

        # Two-step copy: stage to a temp dir alongside the target,
        # then atomic rename. Avoids leaving a half-copied tree if
        # the operator's filesystem fails mid-copy.
        #
        # Audit fix (2026-05-10): use safe_copy_tree so a workspace-
        # local tool tree that contains symlinks is REFUSED at approval
        # time instead of exfiltrating host files into the target
        # workspace. Symlinks could only have been planted by an
        # author who had write access to the source workspace's
        # tool dir, but the threat model says we don't trust that
        # author with cross-workspace promotion.
        staging = target_dir.with_name(f"{record.tool_name}.staging")
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        from simworkbench.tools.safe_copy import (  # noqa: PLC0415
            SafeCopyError,
            safe_copy_tree,
        )
        try:
            safe_copy_tree(source_dir, staging)
        except SafeCopyError as exc:
            raise PromotionError(str(exc)) from exc
        staging.rename(target_dir)

        approved = PromotionRequest(
            request_id=record.request_id,
            tool_name=record.tool_name,
            from_workspace_slug=record.from_workspace_slug,
            to_workspace_slug=record.to_workspace_slug,
            requested_by=record.requested_by,
            requested_at=record.requested_at,
            justification=record.justification,
            status="approved",
            decided_by=approver_user_id,
            decided_at=_now_iso(),
            decision_note=decision_note[:4096],
        )
        record_path = _record_path(approved.request_id)
        try:
            record_path.write_text(
                json.dumps(approved.as_json_dict(), indent=2),
                encoding="utf-8",
            )
            _emit_promotion_audit(action="tool.promoted", record=approved)
        except Exception:
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            record_path.write_text(
                json.dumps(record.as_json_dict(), indent=2),
                encoding="utf-8",
            )
            raise
        return approved

    def deny(
        self,
        *,
        request_id: str,
        approver_user_id: str,
        decision_note: str = "",
    ) -> PromotionRequest:
        """Mark a pending request as denied. The source tool is
        unchanged; the record stays on disk for audit until the
        operator deletes it manually.
        """
        if not isinstance(approver_user_id, str) or not approver_user_id:
            raise PromotionError(
                "approver_user_id must be a non-empty string."
            )
        record = self.get(request_id)
        if record.status != "pending":
            raise PromotionError(
                f"Promotion {request_id!r} is already in status "
                f"{record.status!r}; cannot deny."
            )
        denied = PromotionRequest(
            request_id=record.request_id,
            tool_name=record.tool_name,
            from_workspace_slug=record.from_workspace_slug,
            to_workspace_slug=record.to_workspace_slug,
            requested_by=record.requested_by,
            requested_at=record.requested_at,
            justification=record.justification,
            status="denied",
            decided_by=approver_user_id,
            decided_at=_now_iso(),
            decision_note=decision_note[:4096],
        )
        record_path = _record_path(denied.request_id)
        try:
            record_path.write_text(
                json.dumps(denied.as_json_dict(), indent=2),
                encoding="utf-8",
            )
            _emit_promotion_audit(action="tool.promotion_denied", record=denied)
        except Exception:
            record_path.write_text(
                json.dumps(record.as_json_dict(), indent=2),
                encoding="utf-8",
            )
            raise
        return denied
