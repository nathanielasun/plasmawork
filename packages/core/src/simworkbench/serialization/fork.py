"""Phase 2C — Capsule fork operation.

Per ADR-0002 §"Capsule lifecycle":

> Forking a capsule copies everything except `provenance/` (the fork starts
> a new provenance chain referencing the parent's hash).

The forked capsule preserves ``src/user_edits/`` byte-for-byte — agents
must not modify it during fork, per `agent_error_patterns.md`
*Overwriting `<capsule>/src/user_edits/` during regeneration*.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path

from simworkbench.paths import is_under_workbench, simulation_capsules_root
from simworkbench.provenance import (
    AgentTraceWriter,
    ProvenanceLock,
    SourceRegistry,
    write_environment,
    write_lock,
)
from simworkbench.serialization.manifest import load_manifest, write_manifest


def fork_capsule(
    src: str | Path,
    dst: str | Path | None = None,
    *,
    new_name: str | None = None,
    require_workbench_target: bool = True,
) -> Path:
    """Fork the capsule at ``src`` to ``dst``. Returns the new capsule path.

    If ``dst`` is None, the fork lands under
    ``simulation_capsules/<new_name>.lxp`` (or auto-derived from the source
    name).

    The fork:
    - Copies every subtree EXCEPT ``provenance/``.
    - Computes the parent's source-aggregate hash and records it in the new
      capsule's freshly-written ``provenance/provenance.lock`` as
      ``parent_capsule_hash``.
    - Writes a new ``provenance/agent_trace.md`` whose first entry records
      the fork action and points back to the source path.
    - Captures a fresh ``provenance/environment.yaml`` so the fork has its
      own reproducible-environment snapshot.
    """
    source = Path(src).resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"Capsule directory not found: {source}")
    if not (source / "manifest.toml").is_file():
        raise FileNotFoundError(f"Source is not a capsule: {source} (no manifest.toml)")

    if dst is None:
        derived_name = new_name or _default_fork_name(source)
        if not derived_name.endswith(".lxp"):
            derived_name = f"{derived_name}.lxp"
        dst_path = simulation_capsules_root() / derived_name
    else:
        dst_path = Path(dst)
        if dst_path.suffix != ".lxp":
            dst_path = dst_path.with_suffix(".lxp")

    if require_workbench_target and not is_under_workbench(dst_path):
        raise PermissionError(
            f"Refusing to fork capsule outside workbench-managed roots: {dst_path}"
        )
    if dst_path.exists():
        raise FileExistsError(
            f"Fork target already exists: {dst_path}. "
            "Choose a different name or remove the existing capsule first."
        )

    # 1. Copy everything except provenance/.
    shutil.copytree(source, dst_path, ignore=shutil.ignore_patterns("provenance"))

    # 2. Compute parent's source-aggregate hash for the chain.
    parent_hash = SourceRegistry(source).aggregate_hash()

    # 3. Update the manifest's provenance.parent_capsule_hash + name.
    manifest = load_manifest(dst_path / "manifest.toml")
    manifest.provenance.parent_capsule_hash = parent_hash
    manifest.capsule.name = dst_path.stem
    manifest.capsule.created_at = _utc_now_iso()
    write_manifest(manifest, dst_path / "manifest.toml")

    # 4. Build a fresh provenance/ subtree.
    provenance_dir = dst_path / "provenance"
    provenance_dir.mkdir(parents=True, exist_ok=True)

    lock = ProvenanceLock(
        workbench_version=manifest.capsule.workbench_version,
        python_version=_python_version(),
        platform=_platform_string(),
        capsule_format_version=manifest.capsule.format_version,
        run_id="fork-" + dst_path.stem,
        base_seed=manifest.runtime.default_seed,
        backend=manifest.runtime.backend,
        placeholders=list(manifest.runtime.placeholders),
        parent_capsule_hash=parent_hash,
        created_at=_utc_now_iso(),
    )
    write_lock(lock, provenance_dir / "provenance.lock")
    write_environment(provenance_dir / "environment.yaml")

    trace = AgentTraceWriter(provenance_dir / "agent_trace.md")
    trace.append(
        agent="simworkbench.serialization.fork.fork_capsule",
        action="fork",
        files_touched=("manifest.toml", "provenance/provenance.lock"),
        notes=f"forked from {source!s}; parent_capsule_hash={parent_hash}",
    )

    return dst_path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_fork_name(source: Path) -> str:
    base = source.stem  # e.g. "simple_rate_equations-d0c60a5a"
    return f"{base}-fork"


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def _python_version() -> str:
    import sys

    return sys.version.split()[0]


def _platform_string() -> str:
    import platform

    return platform.platform()


__all__ = ["fork_capsule"]
