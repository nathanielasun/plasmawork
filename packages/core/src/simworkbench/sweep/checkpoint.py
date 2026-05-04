"""Phase 9 / 9A — Sweep checkpoint format.

The checkpoint file is JSON: ``{sweep_id, completed: [{parameters,
metrics, error}], next_index}``. Rewritten after each completed run
so a kill-and-resume preserves work.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from simworkbench.paths import is_under_workbench


@dataclass
class SweepCheckpoint:
    """One sweep's persisted state."""

    sweep_id: str
    sweep_name: str
    completed: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sweep_id": self.sweep_id,
            "sweep_name": self.sweep_name,
            "completed": list(self.completed),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SweepCheckpoint:
        return cls(
            sweep_id=str(data.get("sweep_id", "")),
            sweep_name=str(data.get("sweep_name", "")),
            completed=list(data.get("completed", [])),
        )

    def save(
        self,
        path: str | Path,
        *,
        require_workbench_target: bool = True,
    ) -> None:
        """Write the checkpoint as JSON at ``path``.

        Default: ``path`` must lie under one of the four workbench-
        managed roots (``local_cache/``, ``temp_imports/``,
        ``temp_runs/``, ``simulation_capsules/``). The Phase-8 audit
        lesson "External-writer functions skip the locality guard
        exporters got right" applies here too — every Phase 9 writer
        validates the target before any side-effect. Pass
        ``require_workbench_target=False`` only when the user
        explicitly chose an external destination.
        """
        target = Path(path)
        if require_workbench_target and not is_under_workbench(target):
            raise PermissionError(
                f"Refusing to write SweepCheckpoint outside workbench-"
                f"managed roots: {target}. Allowed roots: local_cache/, "
                "temp_imports/, temp_runs/, simulation_capsules/. Pass "
                "require_workbench_target=False if the user explicitly "
                "chose an external destination."
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> SweepCheckpoint:
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def _params_key(params: dict[str, float]) -> tuple:
    """Stable hashable key for parameter dicts."""
    return tuple(sorted((k, float(v)) for k, v in params.items()))


__all__ = ["SweepCheckpoint", "_params_key"]
