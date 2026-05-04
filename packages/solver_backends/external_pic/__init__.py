"""Phase 8 / 8F — external PIC adapter (skeleton).

A concrete adapter for one or more external PIC codes (WarpX, EPOCH,
Smilei) lands when the project owner runs them. Phase 8 ships the
shape — a default adapter that writes a documented input deck and
imports a documented result format. Either step is overridable per
external simulator.

Public API:

  - ``StubPICAdapter`` — non-running implementation that exercises the
    contract: writes a JSON input deck describing the experiment,
    reads a JSON result file produced by the external simulator (or
    a smoke fixture).

The Phase-8 gate-walk only asserts the abstract base class exists
and refuses bare instantiation. The stub's existence (this package)
proves the contract is implementable; downstream wrappers replace
the stub with calls to the real simulator.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from simworkbench.backends.external import (
    ExternalJobSpec,
    ExternalSimulatorAdapter,
)
from simworkbench.paths import is_under_workbench


def _refuse_external_target(target: Path, *, require_workbench: bool) -> None:
    """Refuse a write target that lies outside the workbench-managed
    roots, unless ``require_workbench`` is False.

    Mirrors the export pipeline (`is_under_workbench`) so external
    adapters can't silently write to ``/tmp`` or arbitrary user
    directories. Carries `agent_error_patterns.md` "External-writer
    functions skip the locality guard that exporters got right".
    """
    if require_workbench and not is_under_workbench(target):
        raise PermissionError(
            f"Refusing to write external-simulator artifact outside "
            f"workbench-managed roots: {target}. Allowed roots: "
            "local_cache/, temp_imports/, temp_runs/, "
            "simulation_capsules/. Pass require_workbench_target=False "
            "if the user explicitly chose an external destination via "
            "the export menu."
        )


class StubPICAdapter(ExternalSimulatorAdapter):
    """Reference implementation of the external-PIC adapter contract.

    Writes a JSON input deck containing the experiment's payload, and
    reads back a JSON result file the external code (or a test
    fixture) is expected to produce. Both writers default to
    refusing destinations outside the workbench-managed roots.
    """

    name: str = "external_pic_stub"

    def __init__(self, *, require_workbench_target: bool = True) -> None:
        self.require_workbench_target = require_workbench_target

    def write_input_deck(self, experiment: Any, target: str | Path) -> Path:
        out = Path(target)
        _refuse_external_target(
            out, require_workbench=self.require_workbench_target
        )
        out.mkdir(parents=True, exist_ok=True)
        deck_path = out / "input_deck.json"
        deck_path.write_text(
            json.dumps(
                {
                    "experiment": (
                        experiment.to_dict()
                        if hasattr(experiment, "to_dict")
                        else dict(experiment)
                    )
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return deck_path

    def submit(self, job: ExternalJobSpec) -> str:
        # Phase 8 ships the contract; an actual queue submission lands
        # in a downstream wrapper (e.g. WarpX integration).
        return f"stub-job::{job.name}"

    def import_result(
        self, job_handle: str, *, target_capsule: str | Path
    ) -> Path:
        # Look for an external_result.json next to the job handle's
        # bundle. Phase 8 just exposes the contract.
        capsule_dir = Path(target_capsule)
        _refuse_external_target(
            capsule_dir, require_workbench=self.require_workbench_target
        )
        capsule_dir.mkdir(parents=True, exist_ok=True)
        result_path = capsule_dir / "external_result.json"
        result_path.write_text(
            json.dumps({"handle": job_handle, "status": "stub"}),
            encoding="utf-8",
        )
        return result_path


__all__ = ["ExternalJobSpec", "ExternalSimulatorAdapter", "StubPICAdapter"]
