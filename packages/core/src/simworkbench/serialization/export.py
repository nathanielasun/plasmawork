"""Phase 2C — Top-level capsule export orchestrator.

Composes the per-kind exporters into a single ``export_capsule`` call.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from simworkbench.paths import is_under_workbench
from simworkbench.serialization.exporters import (
    export_archive,
    export_code,
    export_data,
    export_notebook,
    export_plots,
    export_report,
)

# Names a caller can pass in ``kinds``. Kept narrow so a typo fails loudly.
EXPORT_KINDS: tuple[str, ...] = (
    "code",
    "data",
    "plots",
    "notebook",
    "report",
    "archive",
)


@dataclass
class ExportResult:
    """Bag of per-kind paths produced by ``export_capsule``."""

    target: Path
    kinds: tuple[str, ...]
    paths: dict[str, list[Path]] = field(default_factory=dict)


def export_capsule(
    capsule_dir: str | Path,
    target: str | Path,
    *,
    kinds: Iterable[str] | None = None,
    require_workbench_target: bool = True,
) -> ExportResult:
    """Run the named exporters against ``capsule_dir`` into ``target``.

    ``kinds`` defaults to ``EXPORT_KINDS`` (all of them). The target
    directory is created if necessary. ``archive`` is run last so it
    captures everything the previous kinds wrote.
    """
    selected: tuple[str, ...] = tuple(kinds) if kinds is not None else EXPORT_KINDS
    for k in selected:
        if k not in EXPORT_KINDS:
            raise ValueError(
                f"Unknown export kind {k!r}. Known: {EXPORT_KINDS}"
            )

    target_path = Path(target)
    if require_workbench_target and not is_under_workbench(target_path):
        raise PermissionError(
            f"Refusing to export capsule outside workbench-managed roots: "
            f"{target_path}"
        )
    target_path.mkdir(parents=True, exist_ok=True)

    result = ExportResult(target=target_path, kinds=selected)

    for kind in selected:
        paths: list[Path] = []
        if kind == "code":
            paths.append(export_code(
                capsule_dir, target_path,
                require_workbench_target=require_workbench_target,
            ))
        elif kind == "data":
            paths.extend(export_data(
                capsule_dir, target_path,
                require_workbench_target=require_workbench_target,
            ))
        elif kind == "plots":
            paths.extend(export_plots(
                capsule_dir, target_path,
                require_workbench_target=require_workbench_target,
            ))
        elif kind == "notebook":
            paths.append(export_notebook(
                capsule_dir, target_path,
                require_workbench_target=require_workbench_target,
            ))
        elif kind == "report":
            paths.append(export_report(
                capsule_dir, target_path,
                require_workbench_target=require_workbench_target,
            ))
        elif kind == "archive":
            paths.append(export_archive(
                capsule_dir, target_path,
                require_workbench_target=require_workbench_target,
            ))
        result.paths[kind] = paths

    return result


__all__ = ["EXPORT_KINDS", "ExportResult", "export_capsule"]
