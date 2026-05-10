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
import re
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


# ---------------------------------------------------------------------------
# Workspace-scoped roots — Phase 0.5 auth gateway / Phase E (2026-05-09).
#
# When the workbench runs behind the gateway, every capsule / temp run /
# temp import is scoped to a workspace slug. The gateway forwards the
# slug via the HMAC-signed `X-Workbench-Workspace-Slug` header; the
# FastAPI auth_middleware writes it to ``request.state.workspace_slug``;
# route handlers thread it through to these helpers.
#
# The slug pattern mirrors the secure_core LOGIN_SCHEMA shape so the
# user-id / workspace-id / slug alphabets agree everywhere:
#   ^[A-Za-z0-9_-]{3,64}$
#
# Bare ``simulation_capsules_root()`` etc. are still legal in code that
# is intentionally workspace-agnostic (CLI tooling, examples, tests),
# but the convention checker bans them in the FastAPI route layer —
# server.py MUST go through the ``_for(workspace_slug)`` helpers.
# ---------------------------------------------------------------------------

_WORKSPACE_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,64}$")


def _validate_workspace_slug(workspace_slug: str) -> str:
    """Validate the slug shape. Returns the slug; raises ValueError on
    a malformed slug. Accepts the same alphabet as the secure_core
    LOGIN_SCHEMA so usernames, workspace slugs, and role names share
    one normalization rule."""
    if not isinstance(workspace_slug, str):
        raise ValueError(
            f"workspace_slug must be a string, got {type(workspace_slug).__name__}"
        )
    if not _WORKSPACE_SLUG_PATTERN.match(workspace_slug):
        raise ValueError(
            f"workspace_slug must match ^[A-Za-z0-9_-]{{3,64}}$ (got {workspace_slug!r})"
        )
    return workspace_slug


def simulation_capsules_root_for(workspace_slug: str) -> Path:
    """Return ``<repo>/simulation_capsules/{workspace_slug}``.

    Workspace-scoped capsule storage. Created on first access if absent.
    The slug MUST come from ``request.state.workspace_slug`` (set by the
    auth_middleware after HMAC verification) — never from the request
    body or user input directly.
    """
    return _ensure(simulation_capsules_root() / _validate_workspace_slug(workspace_slug))


def temp_runs_root_for(workspace_slug: str) -> Path:
    """Return ``<repo>/temp_runs/{workspace_slug}``. Workspace-scoped
    transient run artifacts; created on first access if absent."""
    return _ensure(temp_runs_root() / _validate_workspace_slug(workspace_slug))


def temp_imports_root_for(workspace_slug: str) -> Path:
    """Return ``<repo>/temp_imports/{workspace_slug}``. Workspace-scoped
    incoming-import staging area; created on first access if absent."""
    return _ensure(temp_imports_root() / _validate_workspace_slug(workspace_slug))


def imported_tools_root() -> Path:
    """Return ``<repo>/local_cache/imported_tools``. The legacy flat
    cross-tenant cache; preserved as the parent of the per-workspace
    layout AND as a back-compat read source until the operator runs
    ``scripts/dev/migrate_tools_to_workspaces.sh``.
    """
    return _ensure(local_cache_root() / "imported_tools")


def imported_tools_root_for(workspace_slug: str) -> Path:
    """Return ``<repo>/local_cache/imported_tools/{workspace_slug}``.

    Workspace-scoped imported-tool cache (Phase α, 2026-05-10). The
    slug MUST come from ``request.state.workspace_slug`` (set by the
    auth_middleware after HMAC verification) — never from a request
    body or user input. The convention checker bans bare
    ``imported_tools_root()`` calls inside FastAPI handlers.

    The pending-migration directory ``imported_tools/_pending_migration/``
    is reserved by ``scripts/dev/migrate_tools_to_workspaces.sh`` for
    quarantining the legacy flat layout. Defense in depth: ToolRegistry
    skips any directory whose name starts with ``_`` regardless of
    where the name came from, so a hostile request that smuggled
    ``_pending_migration`` past the slug regex still cannot read the
    quarantine.
    """
    return _ensure(imported_tools_root() / _validate_workspace_slug(workspace_slug))


def tool_drafts_root_for(workspace_slug: str) -> Path:
    """Return ``<repo>/local_cache/workspaces/{workspace_slug}/tool_drafts``.

    Workspace-scoped draft authoring sandbox (Phase α, 2026-05-10).
    Drafts created in workspace X are only visible to X members; the
    Tools page authoring panel reads/writes here exclusively.
    """
    base = (
        local_cache_root()
        / "workspaces"
        / _validate_workspace_slug(workspace_slug)
        / "tool_drafts"
    )
    return _ensure(base)


def tool_promotions_root() -> Path:
    """Return ``<repo>/local_cache/imported_tools/_pending_promotions``.

    Tool promotion request queue (Phase α.4, 2026-05-10). A
    promotion request creates a JSON record here keyed by request id;
    a PlatformAdmin's approval reads the record, performs the
    cross-workspace tool copy, then deletes the record.

    Stored alongside ``imported_tools/`` (sibling to the workspace
    slug folders) under the ``_`` prefix so the registry's reserved-
    quarantine skip-set keeps the promotion queue out of the tool
    listing. The directory is gitignored — promotion state is
    deployment-local.
    """
    return _ensure(imported_tools_root() / "_pending_promotions")


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
        return _is_samefile_relative_to(child, parent)
    return True


def _is_samefile_relative_to(child: Path, parent: Path) -> bool:
    """Handle case-preserving/case-insensitive path aliases.

    macOS and Windows can surface the same existing directory with different
    casing through shell wrappers, environment variables, or subprocess cwd.
    Lexical ``relative_to`` rejects those aliases. Compare the would-be parent
    prefix with ``samefile`` so only aliases that the filesystem confirms as
    the same directory are accepted.
    """
    child_parts = child.parts
    parent_parts = parent.parts
    if len(child_parts) < len(parent_parts):
        return False
    try:
        child_prefix = Path(*child_parts[: len(parent_parts)])
        return child_prefix.samefile(parent)
    except OSError:
        return False


__all__ = [
    "is_under_workbench",
    "local_cache_root",
    "repo_root",
    "simulation_capsules_root",
    "simulation_capsules_root_for",
    "temp_imports_root",
    "temp_imports_root_for",
    "temp_runs_root",
    "temp_runs_root_for",
]
