"""Phase 2B — Environment capture for capsule provenance.

Writes ``provenance/environment.yaml`` with a snapshot of the Python /
package / OS environment so a capsule can be re-instantiated on a different
machine. Phase 2 captures pip-freeze; Phase 8+ may add conda env exports
and CUDA driver introspection when those backends arrive.
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


def capture_environment() -> dict[str, Any]:
    """Snapshot the current Python / OS / packages environment.

    Returns a JSON/YAML-serializable dict. Calling pip-freeze is best-effort:
    if pip is not available (e.g. in a stripped-down embedded interpreter),
    the ``packages`` field is the empty list with a `notes` explanation.
    """
    snapshot: dict[str, Any] = {
        "python_version": sys.version.split()[0],
        "python_executable": sys.executable,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "system": platform.system(),
        "system_release": platform.release(),
        "user": _safe_user(),
        "packages": _pip_freeze(),
    }
    return snapshot


def write_environment(path: str | Path, snapshot: dict[str, Any] | None = None) -> Path:
    """Write the environment snapshot to ``path`` as YAML.

    If ``snapshot`` is None, ``capture_environment()`` is called.
    """
    if snapshot is None:
        snapshot = capture_environment()
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(yaml.safe_dump(snapshot, sort_keys=False), encoding="utf-8")
    return target


def load_environment(path: str | Path) -> dict[str, Any]:
    """Read a previously-written environment snapshot."""
    return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_user() -> str:
    """Return the login user, never raising. Falls back to ``"unknown"``."""
    return os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"


def _pip_freeze() -> list[dict[str, str]]:
    """Best-effort pip-freeze. Returns one ``{"name": ..., "version": ...}`` dict
    per installed package, sorted by name."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "freeze", "--disable-pip-version-check"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return [{"note": "pip freeze unavailable in this environment"}]

    packages: list[dict[str, str]] = []
    for raw in result.stdout.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-e"):
            # pip's editable installs come through as "-e ..." — record but
            # don't try to parse a version out.
            if line.startswith("-e"):
                packages.append({"name": line, "version": "editable"})
            continue
        if "==" in line:
            name, _, version = line.partition("==")
            packages.append({"name": name.strip(), "version": version.strip()})
        elif "@" in line:
            name, _, source = line.partition("@")
            packages.append({"name": name.strip(), "version": f"@ {source.strip()}"})
    packages.sort(key=lambda p: p.get("name", ""))
    return packages


__all__ = ["capture_environment", "load_environment", "write_environment"]
