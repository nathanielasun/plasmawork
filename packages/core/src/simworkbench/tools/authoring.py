"""Secure draft authoring services for internal tool construction.

The authoring surface is intentionally draft-first. UI callers never receive
an arbitrary filesystem writer and never write directly into the registry.
Templates are server-known, drafts live under a workbench-managed local
workspace root, and registration is blocked unless the latest package check
matches the current draft content hash.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import uuid
import zipfile
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from simworkbench.paths import local_cache_root, repo_root

from .metadata import load_tool_yaml
from .registry import ToolRegistry


class ToolAuthoringError(RuntimeError):
    """Raised when a tool-authoring operation is invalid or unsafe."""


class ToolAuthoringNotFound(ToolAuthoringError):
    """Raised when a requested template or draft does not exist."""


TOOL_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
DRAFT_ID_RE = re.compile(r"^draft-[a-f0-9]{12}$")
TEMPLATE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
WORKSPACE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
MAX_EDIT_BYTES = 250_000
WORKSPACE_ID = "local"
INTERNAL_DIR = ".simworkbench"
CHECKER = (
    repo_root()
    / ".agents"
    / "skills"
    / "simworkbench-tool-construction"
    / "scripts"
    / "check_tool_package.py"
)

EDITABLE_TOP_LEVEL = {"tool.yaml", "README.md", "assumptions.md", "changelog.md"}
EDITABLE_ROOT_SUFFIXES: dict[str, set[str]] = {
    "src": {".py"},
    "tests": {".py"},
    "docs": {".md", ".txt", ".json", ".yaml", ".yml"},
    "examples": {".py", ".md", ".json", ".yaml", ".yml", ".txt"},
}
SKIP_NAMES = {"__pycache__", ".DS_Store", ".pytest_cache", ".mypy_cache"}


def _now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _is_relative_to(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def _validate_tool_name(name: str) -> str:
    if not TOOL_NAME_RE.fullmatch(name):
        raise ToolAuthoringError(
            "Tool name must be 3-64 chars of lowercase letters, digits, or "
            "underscores, and must start with a letter."
        )
    return name


def _validate_template_id(template_id: str) -> str:
    if not TEMPLATE_ID_RE.fullmatch(template_id):
        raise ToolAuthoringError("Invalid template id.")
    return template_id


def _validate_draft_id(draft_id: str) -> str:
    if not DRAFT_ID_RE.fullmatch(draft_id):
        raise ToolAuthoringError("Invalid draft id.")
    return draft_id


def _validate_workspace_id(workspace_id: str) -> str:
    if not WORKSPACE_ID_RE.fullmatch(workspace_id):
        raise ToolAuthoringError("Invalid workspace id.")
    return workspace_id


def _safe_relative_path(raw_path: str) -> PurePosixPath:
    if not raw_path or not raw_path.strip():
        raise ToolAuthoringError("File path must not be blank.")
    if raw_path != raw_path.strip():
        raise ToolAuthoringError("File path must not have leading/trailing whitespace.")
    if "\\" in raw_path:
        raise ToolAuthoringError("File path must use POSIX separators.")
    rel = PurePosixPath(raw_path)
    if not rel.parts:
        raise ToolAuthoringError("File path must name a file.")
    if rel.is_absolute():
        raise ToolAuthoringError("Absolute file paths are refused.")
    if any(part in {"", ".", ".."} for part in rel.parts):
        raise ToolAuthoringError("Path traversal is refused.")
    if any(part.startswith(".") for part in rel.parts):
        raise ToolAuthoringError("Hidden files are not editable through authoring.")
    if rel.parts[0] in SKIP_NAMES or INTERNAL_DIR in rel.parts:
        raise ToolAuthoringError("Internal files are not editable through authoring.")
    return rel


def _is_editable_path(rel: PurePosixPath) -> bool:
    if len(rel.parts) == 1 and rel.as_posix() in EDITABLE_TOP_LEVEL:
        return True
    root = rel.parts[0]
    suffixes = EDITABLE_ROOT_SUFFIXES.get(root)
    return suffixes is not None and rel.suffix in suffixes


def _copy_tree_no_symlinks(src: Path, dst: Path, *, exclude_internal: bool) -> None:
    src = src.resolve()
    dst = dst.resolve()
    for path in src.rglob("*"):
        rel = path.relative_to(src)
        if exclude_internal and (not rel.parts or rel.parts[0] == INTERNAL_DIR):
            continue
        if any(part in SKIP_NAMES for part in rel.parts):
            continue
        if path.is_symlink():
            raise ToolAuthoringError(f"Refusing to copy symlink in tool tree: {rel}")
        target = dst / rel
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def _assert_no_symlink_components(root: Path, rel: PurePosixPath) -> None:
    probe = root
    for part in rel.parts:
        probe = probe / part
        if probe.is_symlink():
            raise ToolAuthoringError(f"Refusing symlinked draft path: {rel}")


def _package_files(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if not rel.parts or rel.parts[0] == INTERNAL_DIR:
            continue
        if any(part in SKIP_NAMES for part in rel.parts):
            continue
        if path.is_symlink():
            raise ToolAuthoringError(f"Refusing symlink in tool draft: {rel}")
        if path.is_file():
            yield path


def _content_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in _package_files(root):
        rel = path.relative_to(root).as_posix()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _parse_checker_issues(stdout: str) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for line in stdout.splitlines():
        if not (line.startswith("ERROR: ") or line.startswith("WARNING: ")):
            continue
        severity, rest = line.split(": ", 1)
        location, _, message = rest.partition(": ")
        issues.append(
            {
                "severity": severity.lower(),
                "location": location,
                "message": message or rest,
            }
        )
    return issues


class ToolAuthoringService:
    """Backend-owned tool draft workflow.

    Drafts are stored under
    ``local_cache/workspaces/local/tool_drafts/<draft_id>/`` so the path shape
    can migrate to real workspace ids later without changing API semantics.
    """

    def __init__(self, workspace_id: str = WORKSPACE_ID) -> None:
        self.workspace_id = _validate_workspace_id(workspace_id)

    @property
    def templates_root(self) -> Path:
        return repo_root() / "packages" / "internal_tools" / "templates"

    @property
    def drafts_root(self) -> Path:
        root = local_cache_root() / "workspaces" / self.workspace_id / "tool_drafts"
        root.mkdir(parents=True, exist_ok=True)
        return root

    @property
    def audit_log(self) -> Path:
        root = local_cache_root() / "workspaces" / self.workspace_id
        root.mkdir(parents=True, exist_ok=True)
        return root / "tool_authoring_audit.jsonl"

    def list_templates(self) -> list[dict[str, Any]]:
        """Return server-known templates available for draft creation."""
        rows: list[dict[str, Any]] = []
        if not self.templates_root.is_dir():
            return rows
        for template_dir in sorted(self.templates_root.iterdir()):
            if not template_dir.is_dir():
                continue
            template_id = template_dir.name
            if not TEMPLATE_ID_RE.fullmatch(template_id):
                continue
            yaml_path = template_dir / "tool.yaml"
            metadata: dict[str, Any] = {}
            if yaml_path.is_file():
                loaded = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
                if isinstance(loaded, dict):
                    metadata = loaded
            rows.append(
                {
                    "template_id": template_id,
                    "title": str(
                        metadata.get("ui", {}).get("display_name")
                        if isinstance(metadata.get("ui"), dict)
                        else ""
                    )
                    or template_id.replace("_", " ").title(),
                    "description": str(metadata.get("description", "")),
                    "type": str(metadata.get("type", template_id)),
                    "editable_files": self._editable_files(template_dir),
                    "required_files": self._required_files(template_dir, metadata),
                }
            )
        return rows

    def create_draft(self, *, template_id: str, tool_name: str) -> dict[str, Any]:
        """Create a new draft from a server-known template."""
        template_id = _validate_template_id(template_id)
        tool_name = _validate_tool_name(tool_name)
        template_dir = (self.templates_root / template_id).resolve()
        if not template_dir.is_dir() or not _is_relative_to(
            template_dir, self.templates_root.resolve()
        ):
            raise ToolAuthoringNotFound(f"Unknown tool template: {template_id}")

        draft_id = f"draft-{uuid.uuid4().hex[:12]}"
        draft_root = (self.drafts_root / draft_id).resolve()
        if draft_root.exists():
            raise ToolAuthoringError("Draft id collision; retry draft creation.")
        draft_root.mkdir(parents=True)
        _copy_tree_no_symlinks(template_dir, draft_root, exclude_internal=True)
        self._stamp_identity(draft_root, tool_name)

        state = {
            "draft_id": draft_id,
            "workspace_id": self.workspace_id,
            "tool_name": tool_name,
            "template_id": template_id,
            "created_at": _now(),
            "updated_at": _now(),
            "last_check": None,
            "registered_tool": None,
        }
        self._write_state(draft_root, state)
        self._audit("draft.created", draft_id=draft_id, tool_name=tool_name)
        return self.get_draft(draft_id)

    def list_drafts(self) -> list[dict[str, Any]]:
        """Return all local drafts for the current workspace."""
        rows: list[dict[str, Any]] = []
        for path in sorted(self.drafts_root.glob("draft-*")):
            if not path.is_dir():
                continue
            try:
                rows.append(self.get_draft(path.name))
            except ToolAuthoringError:
                continue
        return rows

    def get_draft(self, draft_id: str) -> dict[str, Any]:
        """Return draft metadata, files, manifest status, and checker state."""
        root = self._draft_root(draft_id)
        state = self._read_state(root)
        manifest_ok, manifest_errors = self._manifest_status(root)
        current_hash = _content_hash(root)
        last_check = state.get("last_check")
        check_current = (
            isinstance(last_check, dict)
            and last_check.get("content_hash") == current_hash
            and bool(last_check.get("passed"))
        )
        return {
            "draft_id": state["draft_id"],
            "workspace_id": state["workspace_id"],
            "tool_name": state["tool_name"],
            "template_id": state["template_id"],
            "status": "registered"
            if state.get("registered_tool")
            else ("checked" if check_current else "draft"),
            "draft_root": str(root.relative_to(repo_root())),
            "content_hash": current_hash,
            "manifest_ok": manifest_ok,
            "manifest_errors": manifest_errors,
            "files": self._list_files(root),
            "last_check": last_check,
            "registered_tool": state.get("registered_tool"),
            "created_at": state["created_at"],
            "updated_at": state["updated_at"],
        }

    def read_file(self, draft_id: str, path: str) -> dict[str, Any]:
        """Read one editable draft file."""
        root = self._draft_root(draft_id)
        rel = _safe_relative_path(path)
        if not _is_editable_path(rel):
            raise ToolAuthoringError(f"File is not in the editable manifest: {path}")
        target = self._resolve(root, rel)
        if not target.is_file():
            raise ToolAuthoringNotFound(f"Draft file not found: {path}")
        content = target.read_text(encoding="utf-8")
        return {
            "draft_id": draft_id,
            "path": rel.as_posix(),
            "content": content,
            "editable": True,
            "size_bytes": len(content.encode("utf-8")),
        }

    def write_file(self, draft_id: str, path: str, content: str) -> dict[str, Any]:
        """Write one editable draft file and return updated draft state."""
        root = self._draft_root(draft_id)
        rel = _safe_relative_path(path)
        if not _is_editable_path(rel):
            raise ToolAuthoringError(f"File is not in the editable manifest: {path}")
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_EDIT_BYTES:
            raise ToolAuthoringError(
                f"File edit exceeds {MAX_EDIT_BYTES} byte authoring limit."
            )
        if "\x00" in content:
            raise ToolAuthoringError("NUL bytes are refused in editable text files.")
        target = self._resolve(root, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        state = self._read_state(root)
        state["updated_at"] = _now()
        self._write_state(root, state)
        self._audit("draft.file_updated", draft_id=draft_id, path=rel.as_posix())
        return self.get_draft(draft_id)

    def validate_manifest(self, draft_id: str) -> dict[str, Any]:
        """Parse ``tool.yaml`` and return structured validity status."""
        root = self._draft_root(draft_id)
        ok, errors = self._manifest_status(root)
        payload: dict[str, Any] = {
            "draft_id": draft_id,
            "ok": ok,
            "errors": errors,
        }
        if ok:
            metadata = load_tool_yaml(root / "tool.yaml")
            payload["metadata"] = metadata.model_dump(mode="json")
        return payload

    def run_check(self, draft_id: str) -> dict[str, Any]:
        """Run the deterministic package checker for a draft."""
        root = self._draft_root(draft_id)
        if not CHECKER.is_file():
            raise ToolAuthoringError(f"Tool package checker is missing: {CHECKER}")
        current_hash = _content_hash(root)
        try:
            result = subprocess.run(
                [sys.executable, str(CHECKER), str(root)],
                cwd=repo_root(),
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            stdout = result.stdout[-20_000:]
            stderr = result.stderr[-20_000:]
            payload = {
                "passed": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": stdout,
                "stderr": stderr,
                "issues": _parse_checker_issues(stdout),
                "checked_at": _now(),
                "content_hash": current_hash,
            }
        except subprocess.TimeoutExpired as exc:
            payload = {
                "passed": False,
                "returncode": -1,
                "stdout": (exc.stdout or "")[-20_000:]
                if isinstance(exc.stdout, str)
                else "",
                "stderr": "Tool package check timed out after 30 seconds.",
                "issues": [
                    {
                        "severity": "error",
                        "location": "checker",
                        "message": "Tool package check timed out after 30 seconds.",
                    }
                ],
                "checked_at": _now(),
                "content_hash": current_hash,
            }
        state = self._read_state(root)
        state["last_check"] = payload
        state["updated_at"] = _now()
        self._write_state(root, state)
        self._audit(
            "draft.checked",
            draft_id=draft_id,
            passed=payload["passed"],
            returncode=payload["returncode"],
        )
        return payload

    def register_draft(self, draft_id: str) -> dict[str, Any]:
        """Register a checked draft into the local imported-tools registry."""
        root = self._draft_root(draft_id)
        state = self._read_state(root)
        current_hash = _content_hash(root)
        last_check = state.get("last_check")
        if not isinstance(last_check, dict) or not last_check.get("passed"):
            raise ToolAuthoringError("Run a passing package check before registration.")
        if last_check.get("content_hash") != current_hash:
            raise ToolAuthoringError(
                "Draft changed after the last package check; rerun the checker."
            )
        metadata = load_tool_yaml(root / "tool.yaml")
        if metadata.name != state["tool_name"]:
            raise ToolAuthoringError(
                "tool.yaml name must match the server-created draft tool name."
            )

        target_root = (local_cache_root() / "imported_tools").resolve()
        target_root.mkdir(parents=True, exist_ok=True)
        target = (target_root / metadata.name).resolve()
        if not _is_relative_to(target, target_root):
            raise ToolAuthoringError("Registered tool target escapes imported-tools root.")
        if target.exists():
            raise ToolAuthoringError(
                f"Tool {metadata.name!r} already exists in the imported registry."
            )

        tmp = target_root / f".{metadata.name}.tmp-{uuid.uuid4().hex[:8]}"
        promoted = False
        try:
            _copy_tree_no_symlinks(root, tmp, exclude_internal=True)
            if target.exists():
                raise ToolAuthoringError(
                    f"Tool {metadata.name!r} already exists in the imported registry."
                )
            tmp.rename(target)
            promoted = True
            registry = ToolRegistry()
            registry.refresh()
            entry = registry.get(metadata.name)
        except Exception:
            shutil.rmtree(tmp, ignore_errors=True)
            if promoted:
                shutil.rmtree(target, ignore_errors=True)
            raise

        state["registered_tool"] = {
            "name": entry.name,
            "directory": str(entry.directory.relative_to(repo_root())),
            "registered_at": _now(),
        }
        state["updated_at"] = _now()
        self._write_state(root, state)
        self._audit("draft.registered", draft_id=draft_id, tool_name=entry.name)
        return {
            "draft_id": draft_id,
            "name": entry.name,
            "directory": str(entry.directory.relative_to(repo_root())),
        }

    def export_draft(self, draft_id: str) -> dict[str, Any]:
        """Export the draft package as a zip without internal state files."""
        root = self._draft_root(draft_id)
        state = self._read_state(root)
        archive_dir = local_cache_root() / "exports" / "tool_drafts"
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive = archive_dir / f"{state['tool_name']}-{draft_id}.tool-draft.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in _package_files(root):
                arcname = Path(state["tool_name"]) / path.relative_to(root)
                zf.write(path, arcname=str(arcname))
        self._audit("draft.exported", draft_id=draft_id, archive=str(archive))
        return {
            "draft_id": draft_id,
            "archive": str(archive.relative_to(repo_root())),
            "size_bytes": archive.stat().st_size,
        }

    def _draft_root(self, draft_id: str) -> Path:
        draft_id = _validate_draft_id(draft_id)
        root = (self.drafts_root / draft_id).resolve()
        if not _is_relative_to(root, self.drafts_root.resolve()):
            raise ToolAuthoringError("Draft path escapes draft root.")
        if not root.is_dir():
            raise ToolAuthoringNotFound(f"Unknown tool draft: {draft_id}")
        return root

    def _resolve(self, root: Path, rel: PurePosixPath) -> Path:
        _assert_no_symlink_components(root, rel)
        target = (root / rel.as_posix()).resolve()
        if not _is_relative_to(target, root.resolve()):
            raise ToolAuthoringError("Resolved file path escapes draft root.")
        if target.exists() and target.is_symlink():
            raise ToolAuthoringError("Symlinked draft files are refused.")
        return target

    def _state_path(self, root: Path) -> Path:
        return root / INTERNAL_DIR / "draft.json"

    def _read_state(self, root: Path) -> dict[str, Any]:
        path = self._state_path(root)
        if not path.is_file():
            raise ToolAuthoringError(f"Draft metadata missing: {path}")
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ToolAuthoringError("Draft metadata is malformed.")
        return loaded

    def _write_state(self, root: Path, state: dict[str, Any]) -> None:
        path = self._state_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")

    def _stamp_identity(self, root: Path, tool_name: str) -> None:
        yaml_path = root / "tool.yaml"
        if yaml_path.is_file():
            data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
            if not isinstance(data, dict):
                raise ToolAuthoringError("Template tool.yaml must parse to a mapping.")
            data["name"] = tool_name
            data["status"] = "draft"
            yaml_path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        source = root / "src" / "tool.py"
        if source.is_file():
            text = source.read_text(encoding="utf-8")
            text = text.replace('name = "TEMPLATE"', f'name = "{tool_name}"')
            text = text.replace("name = 'TEMPLATE'", f'name = "{tool_name}"')
            source.write_text(text, encoding="utf-8")

    def _editable_files(self, root: Path) -> list[str]:
        files = []
        for path in _package_files(root):
            rel = PurePosixPath(path.relative_to(root).as_posix())
            if _is_editable_path(rel):
                files.append(rel.as_posix())
        return sorted(files)

    def _required_files(self, root: Path, metadata: dict[str, Any]) -> list[str]:
        required = ["tool.yaml", "README.md"]
        entrypoint = metadata.get("entrypoint")
        if isinstance(entrypoint, str) and ":" in entrypoint:
            required.append(entrypoint.split(":", 1)[0])
        validation = metadata.get("validation")
        if isinstance(validation, dict):
            tests = validation.get("tests")
            if isinstance(tests, list):
                required.extend(test for test in tests if isinstance(test, str))
        return sorted(dict.fromkeys(required))

    def _manifest_status(self, root: Path) -> tuple[bool, list[str]]:
        try:
            load_tool_yaml(root / "tool.yaml")
        except Exception as exc:  # noqa: BLE001 — returned to UI as validation text.
            return False, [str(exc)]
        return True, []

    def _list_files(self, root: Path) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for path in _package_files(root):
            rel = PurePosixPath(path.relative_to(root).as_posix())
            rows.append(
                {
                    "path": rel.as_posix(),
                    "size_bytes": path.stat().st_size,
                    "editable": _is_editable_path(rel),
                }
            )
        return rows

    def _audit(self, event: str, **payload: object) -> None:
        row = {
            "event": event,
            "actor": "local_user",
            "workspace_id": self.workspace_id,
            "timestamp": _now(),
            **payload,
        }
        with self.audit_log.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


__all__ = [
    "ToolAuthoringError",
    "ToolAuthoringNotFound",
    "ToolAuthoringService",
]
