"""Synchronous local tool-run manager.

The manager backs the local API's preview/run endpoints. It is intentionally
filesystem-backed so a fresh FastAPI app can read a run created by a previous
request, while all files remain under ``local_cache/tool_runs/<run_id>/``.
Secure multi-user deployments should use the workspace-scoped secure-core run
tables and artifact namespace instead.
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from simworkbench.paths import repo_root
from simworkbench.units import Q

from .artifacts import (
    ToolArtifactError,
    ToolRunArtifact,
    json_safe_value,
    materialize_artifact,
    tool_runs_root,
)
from .metadata import ToolArtifactDeclaration
from .registry import RegisteredTool, ToolRegistryError
from .schema import (
    artifact_for_output,
    normalize_tool_schema,
    planned_artifacts,
    validate_tool_run_request,
)


class ToolRunStatus(StrEnum):
    """Lifecycle status for a local tool run."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ToolRun(BaseModel):
    """Persisted metadata for one local tool run."""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    tool_name: str
    tool_version: str
    status: ToolRunStatus
    started_at: str
    completed_at: str | None = None
    inline_output: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[ToolRunArtifact] = Field(default_factory=list)
    error: str | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)


class ToolPreview(BaseModel):
    """Side-effect-free preview for a pending tool run."""

    model_config = ConfigDict(extra="forbid")

    tool_name: str
    contract: dict[str, Any]
    planned_artifacts: list[dict[str, Any]]
    permissions: dict[str, Any]
    accepted_inputs: list[str]


class ToolRunManager:
    """Create, persist, and read local tool runs."""

    def preview(
        self,
        entry: RegisteredTool,
        *,
        kwargs: dict[str, Any],
        units: dict[str, str] | None = None,
    ) -> ToolPreview:
        """Validate a run request and return the planned side effects."""

        validation = validate_tool_run_request(
            entry.metadata,
            kwargs=kwargs,
            units=units or {},
        )
        return ToolPreview(
            tool_name=entry.name,
            contract=normalize_tool_schema(entry.metadata),
            planned_artifacts=[
                artifact.model_dump(mode="json")
                for artifact in planned_artifacts(entry.metadata)
            ],
            permissions=entry.metadata.permissions.model_dump(mode="json"),
            accepted_inputs=sorted(validation.kwargs),
        )

    def run(
        self,
        entry: RegisteredTool,
        *,
        kwargs: dict[str, Any],
        units: dict[str, str] | None = None,
    ) -> ToolRun:
        """Execute a tool synchronously and persist run/artifact metadata."""

        started_at = _now()
        run_id = uuid4().hex
        run_dir = self._run_dir(run_id)
        validation = validate_tool_run_request(
            entry.metadata,
            kwargs=kwargs,
            units=units or {},
        )
        prepared = _prepare_kwargs(validation.kwargs, validation.units)
        run_dir.mkdir(parents=True, exist_ok=False)

        base = ToolRun(
            run_id=run_id,
            tool_name=entry.name,
            tool_version=entry.metadata.version,
            status=ToolRunStatus.RUNNING,
            started_at=started_at,
            provenance={
                "tool": {
                    "name": entry.name,
                    "version": entry.metadata.version,
                    "status": entry.status.value,
                    "directory": str(entry.directory.relative_to(repo_root())),
                },
                "inputs": {
                    "keys": sorted(validation.kwargs),
                    "units": dict(validation.units),
                },
            },
        )
        self._write_manifest(run_dir, base)

        try:
            output = entry.execute(**prepared)
            inline_output, artifacts = self._materialize_outputs(
                entry=entry,
                run_id=run_id,
                run_dir=run_dir,
                output={key: output[key] for key in output},
            )
            completed = base.model_copy(
                update={
                    "status": ToolRunStatus.COMPLETED,
                    "completed_at": _now(),
                    "inline_output": inline_output,
                    "artifacts": artifacts,
                }
            )
            self._write_manifest(run_dir, completed)
            return completed
        except Exception as exc:  # noqa: BLE001 - tool code can raise custom errors.
            # Partial artifacts cannot survive a failed run. Keep only the
            # structured failed manifest under the same run id.
            shutil.rmtree(run_dir, ignore_errors=True)
            run_dir.mkdir(parents=True, exist_ok=True)
            failed = base.model_copy(
                update={
                    "status": ToolRunStatus.FAILED,
                    "completed_at": _now(),
                    "error": str(exc),
                    "inline_output": {},
                    "artifacts": [],
                }
            )
            self._write_manifest(run_dir, failed)
            return failed

    def get_run(self, tool_name: str, run_id: str) -> ToolRun:
        """Load a run manifest and confirm it belongs to ``tool_name``."""

        run_dir = self._run_dir(_validate_run_id(run_id))
        manifest = run_dir / "run.json"
        if not manifest.is_file():
            raise ToolRegistryError(f"Tool run {run_id!r} not found")
        data = json.loads(manifest.read_text(encoding="utf-8"))
        run = ToolRun.model_validate(data)
        if run.tool_name != tool_name:
            raise ToolRegistryError(
                f"Tool run {run_id!r} belongs to {run.tool_name!r}, "
                f"not {tool_name!r}"
            )
        return run

    def list_artifacts(self, tool_name: str, run_id: str) -> list[ToolRunArtifact]:
        """Return materialized artifacts for a run."""

        return self.get_run(tool_name, run_id).artifacts

    def get_artifact(self, artifact_id: str) -> ToolRunArtifact:
        """Find a materialized artifact by server-derived artifact id."""

        artifact_id = _validate_artifact_id(artifact_id)
        for manifest in tool_runs_root().glob("*/run.json"):
            try:
                run = ToolRun.model_validate(
                    json.loads(manifest.read_text(encoding="utf-8"))
                )
            except (OSError, ValueError):
                continue
            for artifact in run.artifacts:
                if artifact.artifact_id == artifact_id:
                    return artifact
        raise ToolRegistryError(f"Tool artifact {artifact_id!r} not found")

    def _materialize_outputs(
        self,
        *,
        entry: RegisteredTool,
        run_id: str,
        run_dir: Path,
        output: dict[str, Any],
    ) -> tuple[dict[str, Any], list[ToolRunArtifact]]:
        inline_output: dict[str, Any] = {}
        artifacts: list[ToolRunArtifact] = []

        for key, value in output.items():
            declaration = artifact_for_output(entry.metadata, key)
            if declaration is None and _must_materialize(entry.metadata.io.max_inline_bytes, value):
                declaration = ToolArtifactDeclaration(
                    name=key,
                    kind="json",
                    mime_type="application/json",
                    description="Large JSON output materialized by the run manager.",
                )
            if declaration is None:
                inline_output[key] = json_safe_value(value)
                continue
            artifacts.append(
                materialize_artifact(
                    run_id=run_id,
                    run_dir=run_dir,
                    declaration=declaration,
                    value=value,
                )
            )
        return inline_output, artifacts

    @staticmethod
    def _run_dir(run_id: str) -> Path:
        root = tool_runs_root()
        target = (root / _validate_run_id(run_id)).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ToolArtifactError(f"Tool run id escapes run root: {run_id!r}") from exc
        return target

    @staticmethod
    def _write_manifest(run_dir: Path, run: ToolRun) -> None:
        target = (run_dir / "run.json").resolve()
        try:
            target.relative_to(run_dir.resolve())
        except ValueError as exc:
            raise ToolArtifactError("Tool run manifest escapes run directory") from exc
        target.write_text(
            json.dumps(run.model_dump(mode="json"), indent=2, sort_keys=True),
            encoding="utf-8",
        )


def _prepare_kwargs(kwargs: dict[str, Any], units: dict[str, str]) -> dict[str, Any]:
    prepared: dict[str, Any] = {}
    for key, value in kwargs.items():
        if key in units:
            prepared[key] = Q(value, units[key])
        else:
            prepared[key] = value
    return prepared


def _must_materialize(max_inline_bytes: int, value: Any) -> bool:
    try:
        size = len(json.dumps(json_safe_value(value), sort_keys=True).encode("utf-8"))
    except (TypeError, ValueError):
        return True
    return size > max_inline_bytes


def _validate_run_id(run_id: str) -> str:
    if len(run_id) != 32 or any(ch not in "0123456789abcdef" for ch in run_id):
        raise ToolArtifactError(f"Invalid tool run id: {run_id!r}")
    return run_id


def _validate_artifact_id(artifact_id: str) -> str:
    if len(artifact_id) != 32 or any(ch not in "0123456789abcdef" for ch in artifact_id):
        raise ToolArtifactError(f"Invalid tool artifact id: {artifact_id!r}")
    return artifact_id


def _now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds")


__all__ = [
    "ToolPreview",
    "ToolRun",
    "ToolRunManager",
    "ToolRunStatus",
]
