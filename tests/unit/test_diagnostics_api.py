"""Phase 1E — Diagnostics API tests."""

from __future__ import annotations

import pytest

from simworkbench.diagnostics import Diagnostic, DiagnosticCollector


def test_diagnostic_appends_in_order():
    d = Diagnostic(name="A", unit="1 / m**3")
    d.append(0.0, 1.0)
    d.append(0.1, 0.9)
    d.append(0.2, 0.8)
    assert len(d) == 3
    assert d.times == [0.0, 0.1, 0.2]
    assert d.values == [1.0, 0.9, 0.8]
    assert d.latest() == (0.2, 0.8)


def test_diagnostic_latest_empty_returns_none():
    d = Diagnostic(name="x")
    assert d.latest() is None


def test_collector_register_and_record():
    c = DiagnosticCollector()
    c.register("A", unit="1 / m**3")
    c.record("A", t=0.0, value=1e18)
    c.record("A", t=0.1, value=9e17)
    report = c.report()
    assert report["A"].values == [1e18, 9e17]


def test_collector_register_duplicate_rejected():
    c = DiagnosticCollector()
    c.register("A")
    with pytest.raises(ValueError, match="already registered"):
        c.register("A")


def test_collector_record_unregistered_rejected():
    c = DiagnosticCollector()
    with pytest.raises(KeyError, match="not registered"):
        c.record("A", 0.0, 1.0)


def test_collector_attaches_and_syncs_from_runner():
    """End-to-end: collector attaches to a runner, runs, and ends up with the
    same per-species data the runner recorded.
    """
    from pathlib import Path

    from simworkbench.experiment import Experiment, RunConfig
    from simworkbench.model_spec import load_yaml
    from simworkbench.runtime import Runner

    spec = load_yaml(
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=10),
    )
    runner = Runner(exp)
    collector = DiagnosticCollector()
    collector.register("A", unit="1 / m**3")
    collector.register("B", unit="1 / m**3")
    collector.attach(runner)
    runner.run()
    report = collector.report()
    # All ten samples should be present.
    assert len(report["A"]) == 10
    assert len(report["B"]) == 10
    # And A + B is conserved within solver tolerance (relative — densities ~1e18).
    initial_total = report["A"].values[0] + report["B"].values[0]
    for a, b in zip(report["A"].values, report["B"].values):
        assert abs((a + b) - initial_total) / initial_total < 1e-6
