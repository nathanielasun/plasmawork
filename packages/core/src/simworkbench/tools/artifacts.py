"""Tool run artifact materialization.

Tool outputs may be small inline JSON values or typed artifacts under
``local_cache/tool_runs/<run_id>/``. This module derives every storage path
server-side; callers never provide output paths, hashes, or artifact ids.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from simworkbench.paths import is_under_workbench, local_cache_root, repo_root

from .metadata import ToolArtifactDeclaration


class ToolArtifactError(ValueError):
    """Raised when an output cannot be safely materialized."""


class ToolRunArtifact(BaseModel):
    """Metadata for one materialized tool output."""

    model_config = ConfigDict(extra="forbid")

    artifact_id: str
    run_id: str
    name: str
    kind: str
    mime_type: str
    size_bytes: int
    content_hash: str
    path: str
    preview: Any | None = None


def tool_runs_root() -> Path:
    """Return ``local_cache/tool_runs`` as the local tool-run namespace."""

    root = (local_cache_root() / "tool_runs").resolve()
    if not is_under_workbench(root):
        raise PermissionError(f"Refusing tool run root outside workbench: {root}")
    root.mkdir(parents=True, exist_ok=True)
    return root


def materialize_artifact(
    *,
    run_id: str,
    run_dir: Path,
    declaration: ToolArtifactDeclaration,
    value: Any,
) -> ToolRunArtifact:
    """Write one artifact under ``run_dir`` and return server-derived metadata."""

    run_root = run_dir.resolve()
    try:
        run_root.relative_to(tool_runs_root())
    except ValueError as exc:
        raise ToolArtifactError(
            f"Tool run directory {run_root} is outside local_cache/tool_runs"
        ) from exc
    if not is_under_workbench(run_root):
        raise ToolArtifactError(f"Tool run directory is not workbench-managed: {run_root}")

    _reject_unsafe_payload(declaration, value)
    artifact_dir = (run_root / "artifacts").resolve()
    try:
        artifact_dir.relative_to(run_root)
    except ValueError as exc:  # pragma: no cover - defensive against Path oddities.
        raise ToolArtifactError("Artifact directory escapes run directory") from exc
    artifact_dir.mkdir(parents=True, exist_ok=True)

    artifact_id = uuid4().hex
    filename = f"{_safe_name(declaration.name)}-{artifact_id}{_extension(declaration)}"
    path = (artifact_dir / filename).resolve()
    try:
        path.relative_to(artifact_dir)
    except ValueError as exc:
        raise ToolArtifactError("Artifact path escapes artifact directory") from exc

    payload = _to_bytes(declaration, value)
    path.write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()
    rel_path = path.relative_to(repo_root())
    preview = _preview_value(declaration, value)
    return ToolRunArtifact(
        artifact_id=artifact_id,
        run_id=run_id,
        name=declaration.name,
        kind=declaration.kind,
        mime_type=declaration.mime_type,
        size_bytes=len(payload),
        content_hash=f"sha256:{digest}",
        path=str(rel_path),
        preview=preview,
    )


def read_artifact_payload(run_id: str, artifact: ToolRunArtifact) -> bytes:
    """Read artifact bytes after re-validating the path is inside its run."""

    run_dir = (tool_runs_root() / run_id).resolve()
    target = (repo_root() / artifact.path).resolve()
    try:
        target.relative_to(run_dir)
    except ValueError as exc:
        raise ToolArtifactError(
            f"Artifact {artifact.artifact_id!r} path escapes run directory"
        ) from exc
    return target.read_bytes()


def json_safe_value(value: Any) -> Any:
    """Return a JSON-serializable representation of a tool value."""

    return _json_safe(value)


def _safe_name(name: str) -> str:
    if not name or "/" in name or "\\" in name or name in {".", ".."}:
        raise ToolArtifactError(f"Unsafe artifact name: {name!r}")
    if name.startswith("..") or name.strip() != name:
        raise ToolArtifactError(f"Unsafe artifact name: {name!r}")
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in name)


def _extension(declaration: ToolArtifactDeclaration) -> str:
    if declaration.mime_type == "application/json":
        return ".json"
    if declaration.mime_type == "text/markdown":
        return ".md"
    if declaration.mime_type == "image/png":
        return ".png"
    if declaration.kind == "file":
        return ".bin"
    return ".artifact"


def _to_bytes(declaration: ToolArtifactDeclaration, value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if declaration.mime_type in {"text/markdown", "text/plain"} and isinstance(value, str):
        return value.encode("utf-8")
    safe = _json_safe(value)
    return json.dumps(safe, indent=2, sort_keys=True).encode("utf-8")


def _json_safe(value: Any) -> Any:
    result: Any
    if hasattr(value, "to_dict") and callable(value.to_dict):
        result = _json_safe(value.to_dict())
    elif isinstance(value, dict):
        result = {str(k): _json_safe(v) for k, v in value.items()}
    elif isinstance(value, (list, tuple)):
        result = [_json_safe(v) for v in value]
    elif hasattr(value, "tolist") and callable(value.tolist):
        result = value.tolist()
    elif hasattr(value, "item") and callable(value.item):
        try:
            result = value.item()
        except ValueError:
            result = repr(value)
    else:
        quantity = _quantity_to_json(value)
        if quantity is not None:
            result = quantity
        elif isinstance(value, (str, int, float, bool)) or value is None:
            result = value
        else:
            result = repr(value)
    return result


def _quantity_to_json(value: Any) -> dict[str, Any] | None:
    try:
        from simworkbench.units.registry import get_registry

        if isinstance(value, get_registry().Quantity):
            magnitude = value.magnitude
            if hasattr(magnitude, "tolist") and callable(magnitude.tolist):
                magnitude = magnitude.tolist()
            return {"magnitude": magnitude, "units": str(value.units)}
    except (AttributeError, TypeError):  # pragma: no cover - defensive.
        return None
    return None


def _preview_value(declaration: ToolArtifactDeclaration, value: Any) -> Any:
    safe = _json_safe(value)
    if declaration.kind == "table" and isinstance(safe, list):
        return {"rows": safe[:20], "truncated": len(safe) > 20}
    if declaration.kind == "diagram":
        return safe
    if declaration.kind == "report" and isinstance(safe, str):
        return safe[:4000]
    return None


def _reject_unsafe_payload(declaration: ToolArtifactDeclaration, value: Any) -> None:
    if declaration.mime_type.lower() in {"text/html", "application/xhtml+xml"}:
        raise ToolArtifactError("Raw HTML artifacts are refused")
    if declaration.kind == "diagram":
        _reject_unsafe_diagram(value)
    if declaration.kind == "report" and isinstance(value, str):
        lowered = value.lower()
        if "<script" in lowered or "<iframe" in lowered:
            raise ToolArtifactError("Report artifacts must not contain script/iframe HTML")


def _reject_unsafe_diagram(value: Any) -> None:
    if not isinstance(value, (dict, list)):
        raise ToolArtifactError(
            "Diagram artifacts must be structured JSON, not raw strings or HTML"
        )
    unsafe_keys = {"html", "raw_html", "script", "iframe", "javascript"}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                if str(key).lower() in unsafe_keys:
                    raise ToolArtifactError(
                        f"Diagram artifact contains unsafe key {key!r}"
                    )
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, str):
            lowered = node.lower()
            if "<script" in lowered or "<iframe" in lowered or "javascript:" in lowered:
                raise ToolArtifactError("Diagram artifact contains unsafe HTML/JS")

    walk(value)


__all__ = [
    "ToolArtifactError",
    "ToolRunArtifact",
    "json_safe_value",
    "materialize_artifact",
    "read_artifact_payload",
    "tool_runs_root",
]
