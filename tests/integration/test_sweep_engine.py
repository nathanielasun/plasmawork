"""Phase 9 / 9A — sweep engine integration tests.

Exercises the sweep machinery end-to-end on small fixtures. The
gate-walk in ``test_phase_9_gate_walk.py`` covers the headline gate
verbs; this file pins the long-tail behaviours: AdaptiveSampler
contract, sweep-report `completed`/`failed` partitioning, restart
across multiple kills, and metadata round-trip.
"""

from __future__ import annotations

import json
from pathlib import Path

from simworkbench.sweep import (
    AdaptiveSampler,
    GridSampler,
    SweepEngine,
    SweepSpec,
)


class _ConvergeOnZeroSampler(AdaptiveSampler):
    """Trivial adaptive sampler — moves toward x=0 each step.

    Demonstrates the AdaptiveSampler ABC contract: ``next_point``
    consumes the history and proposes the next point; returning
    ``None`` stops the sweep.
    """

    def __init__(self, max_steps: int = 5) -> None:
        super().__init__()
        self.max_steps = max_steps

    def next_point(self, spec, history):  # noqa: ANN001 — ABC shape
        if len(history) >= self.max_steps:
            return None
        if not history:
            return {"x": 1.0}
        # Halve the latest x toward zero.
        last_x = float(history[-1]["parameters"]["x"])
        return {"x": last_x / 2.0}


def test_adaptive_sampler_drives_to_target():
    spec = SweepSpec(
        name="adaptive_demo",
        parameters={"x": (-1.0, 1.0)},
        sampler=_ConvergeOnZeroSampler(max_steps=6),
    )
    report = SweepEngine(
        spec=spec, objective=lambda p: {"loss": float(p["x"]) ** 2}
    ).run()
    xs = [r.parameters["x"] for r in report.runs]
    # Sequence is 1.0, 0.5, 0.25, 0.125, 0.0625, 0.03125
    assert xs[0] == 1.0
    assert xs[-1] < 0.05


def test_sweep_report_partitions_completed_vs_failed():
    spec = SweepSpec(
        name="partition_demo",
        parameters={"x": [-1.0, 0.0, 1.0]},
        sampler=GridSampler(),
    )
    report = SweepEngine(
        spec=spec,
        objective=lambda p: (1 / 0) if p["x"] == 0.0 else {"loss": p["x"]},
    ).run()
    assert len(report.completed) == 2
    assert len(report.failed) == 1
    assert "ZeroDivisionError" in report.failed[0].error


def test_sweep_checkpoint_survives_two_resumes(tmp_path):
    """``max_evaluations`` is the SWEEP TOTAL cap (not a per-session
    cap). Resumes with a higher total cap pick up where the previous
    session left off and stop when the total reaches the new cap.
    """
    completed_records: list[dict[str, float]] = []

    def counting(p):
        completed_records.append(p.copy())
        return {"loss": float(p["x"])}

    ckpt = tmp_path / "ckpt.json"

    # Session 1: cap at 2 (total). Runs 2 evaluations.
    spec_1 = SweepSpec(
        name="multi_resume",
        parameters={"x": [0.0, 1.0, 2.0, 3.0, 4.0]},
        sampler=GridSampler(),
        max_evaluations=2,
    )
    SweepEngine(spec=spec_1, objective=counting, checkpoint_path=ckpt).run()
    assert len(completed_records) == 2

    # Session 2: raise the total cap to 4. Resume should run 2 more
    # (already had 2 from session 1).
    completed_records.clear()
    spec_2 = SweepSpec(
        name="multi_resume",
        parameters={"x": [0.0, 1.0, 2.0, 3.0, 4.0]},
        sampler=GridSampler(),
        max_evaluations=4,
    )
    SweepEngine.resume(
        spec=spec_2, objective=counting, checkpoint_path=ckpt
    ).run()
    assert len(completed_records) == 2

    # Session 3: no cap. Runs the remaining 1 evaluation.
    completed_records.clear()
    spec_3 = SweepSpec(
        name="multi_resume",
        parameters={"x": [0.0, 1.0, 2.0, 3.0, 4.0]},
        sampler=GridSampler(),
    )
    SweepEngine.resume(
        spec=spec_3, objective=counting, checkpoint_path=ckpt
    ).run()
    assert len(completed_records) == 1


def test_sweep_checkpoint_round_trips_through_disk(tmp_path):
    spec = SweepSpec(
        name="disk_roundtrip",
        parameters={"x": [0.0, 1.0]},
        sampler=GridSampler(),
    )
    ckpt = tmp_path / "ckpt.json"
    SweepEngine(
        spec=spec,
        objective=lambda p: {"loss": p["x"]},
        checkpoint_path=ckpt,
    ).run()
    payload = json.loads(ckpt.read_text(encoding="utf-8"))
    assert payload["sweep_name"] == "disk_roundtrip"
    assert len(payload["completed"]) == 2
    _ = Path  # silence unused
