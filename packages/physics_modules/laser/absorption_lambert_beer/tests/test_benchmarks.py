"""Phase 7 — gate-walk benchmark for the validated absorption module."""

from __future__ import annotations

from ..benchmarks.closed_form_transmission import run_benchmark


def test_lambert_beer_closed_form_transmission_within_tolerance():
    reports = list(run_benchmark())
    assert reports, "Lambert-Beer benchmark produced no reports."
    for r in reports:
        assert r.passed, (
            f"Benchmark case {r.name!r} failed: {r.detail}. "
            "If this fires, regenerate the module and re-validate."
        )
