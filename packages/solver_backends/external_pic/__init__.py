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


class StubPICAdapter(ExternalSimulatorAdapter):
    """Reference implementation of the external-PIC adapter contract.

    Writes a JSON input deck containing the experiment's payload, and
    reads back a JSON result file the external code (or a test
    fixture) is expected to produce.
    """

    name: str = "external_pic_stub"

    def write_input_deck(self, experiment: Any, target: str | Path) -> Path:
        out = Path(target)
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
        capsule_dir.mkdir(parents=True, exist_ok=True)
        result_path = capsule_dir / "external_result.json"
        result_path.write_text(
            json.dumps({"handle": job_handle, "status": "stub"}),
            encoding="utf-8",
        )
        return result_path


__all__ = ["ExternalJobSpec", "ExternalSimulatorAdapter", "StubPICAdapter"]
