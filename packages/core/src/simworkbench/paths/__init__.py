"""Workbench path helpers.

Centralizes resolution of the repo-relative directories that the workbench is
allowed to write to (`local_cache/`, `temp_imports/`, `temp_runs/`,
`simulation_capsules/`). All workbench code that produces artifacts goes
through these helpers — never `tempfile.mkdtemp()`, never `os.path.expanduser`,
never absolute paths chosen at the call site.

See `bugs_and_fixes/agent_error_patterns.md` "Writing program artifacts outside
the project directory".
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def repo_root() -> Path:
    """Return the repository root directory.

    Resolution order:
    1. ``SIMWORKBENCH_REPO_ROOT`` env var (overrides; used by tests).
    2. Walk up from this file until a directory containing ``AGENTS.md`` and
       ``CLAUDE.md`` is found.

    Raises ``RuntimeError`` if the repo root cannot be located, which would
    mean the package is installed outside the source tree without an explicit
    override.
    """
    env_override = os.environ.get("SIMWORKBENCH_REPO_ROOT")
    if env_override:
        path = Path(env_override).resolve()
        if not path.is_dir():
            raise RuntimeError(
                f"SIMWORKBENCH_REPO_ROOT={env_override!r} does not exist or is not a directory."
            )
        return path

    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        if (parent / "AGENTS.md").is_file() and (parent / "CLAUDE.md").is_file():
            return parent

    raise RuntimeError(
        "Could not locate workbench repository root. Set SIMWORKBENCH_REPO_ROOT "
        "to the repo path."
    )


def local_cache_root() -> Path:
    """Return ``<repo>/local_cache``. Created on first access if absent."""
    return _ensure(repo_root() / "local_cache")


def temp_imports_root() -> Path:
    """Return ``<repo>/temp_imports``. Created on first access if absent."""
    return _ensure(repo_root() / "temp_imports")


def temp_runs_root() -> Path:
    """Return ``<repo>/temp_runs``. Created on first access if absent."""
    return _ensure(repo_root() / "temp_runs")


def simulation_capsules_root() -> Path:
    """Return ``<repo>/simulation_capsules``. Created on first access if absent."""
    return _ensure(repo_root() / "simulation_capsules")


def is_under_workbench(path: Path | str) -> bool:
    """Return True iff ``path`` lies inside one of the four allowed roots.

    Used by the runtime to refuse writing checkpoints / artifacts to paths the
    user did not explicitly export to.
    """
    p = Path(path).resolve()
    allowed = (
        local_cache_root().resolve(),
        temp_imports_root().resolve(),
        temp_runs_root().resolve(),
        simulation_capsules_root().resolve(),
    )
    return any(_is_relative_to(p, root) for root in allowed)


def _ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _is_relative_to(child: Path, parent: Path) -> bool:
    """Backport of ``Path.is_relative_to`` for older Pythons; we target 3.11+ so
    this is just an explicit shim that doesn't raise on unrelated paths."""
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


__all__ = [
    "is_under_workbench",
    "local_cache_root",
    "repo_root",
    "simulation_capsules_root",
    "temp_imports_root",
    "temp_runs_root",
]
