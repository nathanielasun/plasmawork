"""Phase 9 gate-walk integration test (written BEFORE implementation).

Plan §Phase 9 gate: "Phase 9 is complete when the system can run
parameter sweeps, rank outputs, quantify uncertainty, and generate
comparison reports."

Gate verbs:
  - sweep   — `simworkbench.sweep.SweepEngine` runs a multi-point
              parameter sweep, produces an aggregated result table,
              respects an explicit budget cap (no silent overrun).
  - rank    — `simworkbench.reports.ComparisonReport` ranks the
              sweep's runs and writes a Markdown + JSON summary.
  - quantify — `simworkbench.uncertainty` propagates parameter
              uncertainty (Monte Carlo), produces confidence
              intervals, runs sensitivity analysis, attributes
              dominant uncertainty.
  - report  — Comparative-report artifacts land at documented paths.
  - resume  — A sweep with a checkpoint can be killed and resumed.
  - provenance-chain — every child run carries the parent sweep id.
  - budget-cap — a sweep with `max_evaluations=N` stops at exactly N.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]


def _quadratic_objective(params: dict[str, float]) -> dict[str, float]:
    """f(x, y) = (x - 1)^2 + (y - 2)^2; minimum 0 at (1, 2)."""
    x = float(params["x"])
    y = float(params["y"])
    return {
        "loss": (x - 1.0) ** 2 + (y - 2.0) ** 2,
        "x": x,
        "y": y,
    }


# ---------------------------------------------------------------------------
# Verb 1: SWEEP — grid + random + LHS samplers.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_grid_sweep_runs_and_aggregates():
    from simworkbench.sweep import GridSampler, SweepEngine, SweepSpec

    spec = SweepSpec(
        name="grid_demo",
        parameters={"x": [0.0, 1.0, 2.0], "y": [1.0, 2.0, 3.0]},
        sampler=GridSampler(),
    )
    engine = SweepEngine(spec=spec, objective=_quadratic_objective)
    report = engine.run()
    assert len(report.runs) == 9
    for row in report.runs:
        assert "x" in row.parameters and "y" in row.parameters
        assert "loss" in row.metrics
        assert row.error is None


def test_phase_9_gate_walk_random_sweep_respects_seed():
    from simworkbench.sweep import RandomSampler, SweepEngine, SweepSpec

    def make_spec():
        return SweepSpec(
            name="random_demo",
            parameters={"x": (-2.0, 4.0), "y": (-2.0, 4.0)},
            sampler=RandomSampler(n_samples=8, seed=42),
        )

    a = SweepEngine(spec=make_spec(), objective=_quadratic_objective).run()
    b = SweepEngine(spec=make_spec(), objective=_quadratic_objective).run()
    a_x = [r.parameters["x"] for r in a.runs]
    b_x = [r.parameters["x"] for r in b.runs]
    assert a_x == b_x


def test_phase_9_gate_walk_latin_hypercube_covers_each_axis():
    from simworkbench.sweep import (
        LatinHypercubeSampler,
        SweepEngine,
        SweepSpec,
    )

    n = 8
    spec = SweepSpec(
        name="lhs_demo",
        parameters={"x": (0.0, 1.0), "y": (0.0, 1.0)},
        sampler=LatinHypercubeSampler(n_samples=n, seed=0),
    )
    report = SweepEngine(spec=spec, objective=_quadratic_objective).run()
    xs = sorted(r.parameters["x"] for r in report.runs)
    for i, x in enumerate(xs):
        assert i / n <= x <= (i + 1) / n + 1e-12, (
            f"LHS broke stratification at i={i}: x={x}"
        )


# ---------------------------------------------------------------------------
# Verb 2: BUDGET-CAP.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_sweep_budget_cap_stops_exactly_at_cap():
    from simworkbench.sweep import RandomSampler, SweepEngine, SweepSpec

    spec = SweepSpec(
        name="budget_demo",
        parameters={"x": (0.0, 1.0)},
        sampler=RandomSampler(n_samples=100, seed=0),
        max_evaluations=7,
    )
    report = SweepEngine(spec=spec, objective=_quadratic_objective).run()
    assert len(report.runs) == 7
    assert report.stopped_reason in {"budget_cap", "budget"}


def test_phase_9_gate_walk_sweep_logs_failures_without_stopping():
    from simworkbench.sweep import GridSampler, SweepEngine, SweepSpec

    def flaky(params: dict[str, float]) -> dict[str, float]:
        if params["x"] == 1.0:
            raise RuntimeError("intentional failure at x=1.0")
        return {"loss": float(params["x"])}

    spec = SweepSpec(
        name="flaky_demo",
        parameters={"x": [0.0, 1.0, 2.0]},
        sampler=GridSampler(),
    )
    report = SweepEngine(spec=spec, objective=flaky).run()
    assert len(report.runs) == 3
    failed = [r for r in report.runs if r.error]
    assert len(failed) == 1
    assert "intentional failure" in failed[0].error


# ---------------------------------------------------------------------------
# Verb 3: RESUME — sweep checkpointing.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_sweep_checkpoint_round_trip(tmp_path):
    from simworkbench.sweep import GridSampler, SweepEngine, SweepSpec

    completed: list[dict[str, float]] = []

    def counting_objective(params: dict[str, float]) -> dict[str, float]:
        completed.append(params.copy())
        return {"loss": float(params["x"])}

    spec_full = SweepSpec(
        name="resume_demo",
        parameters={"x": [0.0, 1.0, 2.0, 3.0]},
        sampler=GridSampler(),
    )
    checkpoint_path = tmp_path / "sweep_checkpoint.json"

    spec_partial = SweepSpec(
        name="resume_demo",
        parameters={"x": [0.0, 1.0, 2.0, 3.0]},
        sampler=GridSampler(),
        max_evaluations=2,
    )
    SweepEngine(
        spec=spec_partial,
        objective=counting_objective,
        checkpoint_path=checkpoint_path,
    ).run()
    assert len(completed) == 2
    completed.clear()

    SweepEngine.resume(
        spec=spec_full,
        objective=counting_objective,
        checkpoint_path=checkpoint_path,
    ).run()
    assert len(completed) == 2


# ---------------------------------------------------------------------------
# Verb 4: RANK + REPORT.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_comparison_report_ranks_runs(tmp_path):
    from simworkbench.reports import ComparisonReport
    from simworkbench.sweep import GridSampler, SweepEngine, SweepSpec

    spec = SweepSpec(
        name="rank_demo",
        parameters={"x": [-1.0, 0.5, 1.0, 1.5]},
        sampler=GridSampler(),
    )
    report = SweepEngine(
        spec=spec,
        objective=lambda p: {"loss": (float(p["x"]) - 1.0) ** 2},
    ).run()
    out = tmp_path / "comparison"
    paths = ComparisonReport(metric="loss", lower_is_better=True).write(
        report, target=out
    )
    assert (out / "manifest.json").is_file()
    assert (out / "report.md").is_file()
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert "ranking" in manifest
    top = manifest["ranking"][0]
    assert abs(top["parameters"]["x"] - 1.0) < 1e-9
    body = (out / "report.md").read_text(encoding="utf-8")
    assert "loss" in body and "Ranking" in body
    _ = paths


def test_phase_9_gate_walk_comparison_report_lower_is_better_flag():
    from simworkbench.reports import ComparisonReport
    from simworkbench.sweep import GridSampler, SweepEngine, SweepSpec

    spec = SweepSpec(
        name="rank_dir",
        parameters={"x": [0.0, 1.0, 2.0]},
        sampler=GridSampler(),
    )
    report = SweepEngine(
        spec=spec, objective=lambda p: {"score": float(p["x"])}
    ).run()
    cmp = ComparisonReport(metric="score", lower_is_better=False)
    ranked = cmp.rank(report)
    assert abs(ranked[0].parameters["x"] - 2.0) < 1e-9
    assert abs(ranked[-1].parameters["x"] - 0.0) < 1e-9


# ---------------------------------------------------------------------------
# Verb 5: QUANTIFY.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_uq_monte_carlo_propagation():
    from simworkbench.uncertainty import (
        MonteCarloPropagator,
        ParameterDistribution,
    )

    propagator = MonteCarloPropagator(
        distributions={
            "x": ParameterDistribution(
                kind="normal", params={"mean": 1.0, "stddev": 0.1}
            ),
        },
        n_samples=2000,
        seed=0,
    )
    summary = propagator.propagate(lambda p: {"out": 2.0 * p["x"]})
    assert "out" in summary.metrics
    mean = summary.metrics["out"]["mean"]
    std = summary.metrics["out"]["stddev"]
    assert abs(mean - 2.0) < 0.05
    assert abs(std - 0.2) < 0.05
    ci = summary.metrics["out"]["ci_95"]
    assert ci[0] < mean < ci[1]


def test_phase_9_gate_walk_uq_sensitivity_attribution():
    from simworkbench.uncertainty import (
        ParameterDistribution,
        SensitivityAnalysis,
    )

    sens = SensitivityAnalysis(
        distributions={
            "x": ParameterDistribution(kind="uniform", params={"low": 0.0, "high": 1.0}),
            "y": ParameterDistribution(kind="uniform", params={"low": 0.0, "high": 1.0}),
        },
        n_samples=512,
        seed=0,
    )
    result = sens.evaluate(lambda p: float(p["x"]) + 10.0 * float(p["y"]))
    assert result.dominant == "y"
    assert result.total_index["y"] > result.total_index["x"]


# ---------------------------------------------------------------------------
# Verb 6: PROVENANCE-CHAIN.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_sweep_runs_carry_parent_sweep_id():
    from simworkbench.sweep import GridSampler, SweepEngine, SweepSpec

    spec = SweepSpec(
        name="provenance_demo",
        parameters={"x": [0.0, 1.0]},
        sampler=GridSampler(),
    )
    report = SweepEngine(spec=spec, objective=lambda p: {"loss": p["x"]}).run()
    assert report.sweep_id
    for row in report.runs:
        assert row.parent_sweep_id == report.sweep_id


# ---------------------------------------------------------------------------
# Verb 7: OPTIMIZATION.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_optimizer_finds_quadratic_minimum():
    from simworkbench.optimization import (
        OptimizationProblem,
        RandomSearchOptimizer,
    )

    problem = OptimizationProblem(
        parameters={"x": (-3.0, 3.0), "y": (-1.0, 5.0)},
        objective=lambda p: float(_quadratic_objective(p)["loss"]),
        minimize=True,
        budget=400,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    assert result.evaluations == 400
    # Random search converges loosely; assert order-of-magnitude
    # improvement over the box average (mean loss for the quadratic
    # over a 6x6 box centered roughly at origin is ~7).
    assert result.best_value < 0.2
    assert abs(result.best_parameters["x"] - 1.0) < 0.5
    assert abs(result.best_parameters["y"] - 2.0) < 0.5


def test_phase_9_gate_walk_optimizer_budget_cap_strict():
    from simworkbench.optimization import (
        OptimizationProblem,
        RandomSearchOptimizer,
    )

    counter = {"n": 0}

    def counting(p: dict[str, float]) -> float:
        counter["n"] += 1
        return float(p["x"])

    problem = OptimizationProblem(
        parameters={"x": (-1.0, 1.0)},
        objective=counting,
        minimize=True,
        budget=11,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    assert counter["n"] == 11
    assert result.evaluations == 11


def test_phase_9_gate_walk_optimizer_early_stopping():
    from simworkbench.optimization import (
        OptimizationProblem,
        RandomSearchOptimizer,
    )

    problem = OptimizationProblem(
        parameters={"x": (-3.0, 3.0), "y": (-1.0, 5.0)},
        objective=lambda p: float(_quadratic_objective(p)["loss"]),
        minimize=True,
        budget=10_000,
        early_stop_threshold=0.5,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    assert result.best_value <= 0.5
    assert result.stopped_reason == "early_stop"
    assert result.evaluations < 10_000


# ---------------------------------------------------------------------------
# Confidence intervals + dominant attribution.
# ---------------------------------------------------------------------------


def test_phase_9_gate_walk_confidence_intervals_bracket_truth():
    from simworkbench.uncertainty import bootstrap_confidence_interval

    rng = np.random.default_rng(0)
    samples = rng.normal(loc=5.0, scale=1.0, size=1000)
    low, high = bootstrap_confidence_interval(
        samples, level=0.95, n_resamples=500, seed=0
    )
    assert low < 5.0 < high


def test_phase_9_gate_walk_dominant_uncertainty_attribution():
    from simworkbench.uncertainty import dominant_uncertainty

    rng = np.random.default_rng(0)
    samples_per_param = {
        "x": rng.normal(loc=0.0, scale=0.1, size=500).tolist(),
        "y": rng.normal(loc=0.0, scale=10.0, size=500).tolist(),
    }
    assert dominant_uncertainty(samples_per_param) == "y"


# ---------------------------------------------------------------------------
# UI tab + sweep example exist.
# ---------------------------------------------------------------------------


def test_phase_9_comparison_ui_panel_present():
    panel = REPO_ROOT / "apps/workbench-ui/src/components/reports/ComparisonReport.tsx"
    assert panel.is_file(), f"Missing UI panel: {panel}"


def test_phase_9_sweep_example_capsule_exists():
    example = REPO_ROOT / "examples" / "parameter_sweep_quadratic"
    assert example.is_dir(), f"Missing example: {example}"
    assert (example / "run_sweep.py").is_file()


# ---------------------------------------------------------------------------
# No bypass kwargs on optimizer / sweep budget gates.
# ---------------------------------------------------------------------------


def test_phase_9_no_budget_bypass_kwargs():
    import inspect

    from simworkbench.optimization import RandomSearchOptimizer
    from simworkbench.sweep import SweepEngine

    forbidden = {"ignore_budget", "unbounded", "skip_budget", "force", "no_cap"}
    for cls in (SweepEngine, RandomSearchOptimizer):
        for fn in (
            cls.__init__,
            getattr(cls, "run", None),
            getattr(cls, "optimize", None),
        ):
            if fn is None:
                continue
            params = set(inspect.signature(fn).parameters)
            leaked = params & forbidden
            assert not leaked, (
                f"{cls.__name__}.{fn.__name__} grew a budget-bypass kwarg: "
                f"{leaked}."
            )
