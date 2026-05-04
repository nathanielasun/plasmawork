"""Phase 7 / 7E — validation library unit tests."""

from __future__ import annotations

from simworkbench.validation_library import (
    ConservationCheck,
    ConvergenceCheck,
    CrossSolverComparison,
    PaperReproduction,
)


def test_paper_reproduction_passes_within_tolerance():
    p = PaperReproduction(
        name="abs",
        observed=lambda r: r,
        expected=10.0,
        tolerance_relative=0.01,
        reference="paper:test",
    )
    r = p.evaluate(10.05)
    assert r.passed
    assert r.metric < 0.01
    assert r.metadata["reference"] == "paper:test"


def test_paper_reproduction_fails_outside_tolerance():
    p = PaperReproduction(
        name="abs", observed=lambda r: r, expected=10.0, tolerance_relative=0.01
    )
    r = p.evaluate(11.0)
    assert not r.passed
    assert r.metric > 0.01


def test_paper_reproduction_handles_zero_expected():
    p = PaperReproduction(
        name="z", observed=lambda r: r, expected=0.0, tolerance_relative=1e-3
    )
    assert p.evaluate(1e-4).passed
    assert not p.evaluate(1.0).passed


def test_conservation_check_passes_for_constant_series():
    c = ConservationCheck(
        name="m",
        quantity_series=lambda _: [1.0, 1.0, 0.9999, 1.0001],
        tolerance_relative=1e-3,
    )
    assert c.evaluate(None).passed


def test_conservation_check_fails_for_drifting_series():
    c = ConservationCheck(
        name="m",
        quantity_series=lambda _: [1.0, 1.0, 1.5],
        tolerance_relative=1e-3,
    )
    assert not c.evaluate(None).passed


def test_conservation_check_short_series_fails():
    c = ConservationCheck(name="m", quantity_series=lambda _: [1.0])
    r = c.evaluate(None)
    assert not r.passed


def test_convergence_check_observes_quadratic_order():
    cv = ConvergenceCheck(
        name="c", run_at=lambda h: h**2, parameters=[1.0, 0.5, 0.25]
    )
    r = cv.evaluate()
    assert r.passed
    # Slope is exactly 2 within float epsilon.
    assert abs(r.metric) < 1e-9


def test_convergence_check_fails_for_first_order_when_second_expected():
    cv = ConvergenceCheck(
        name="c",
        run_at=lambda h: h,  # first-order error
        parameters=[1.0, 0.5, 0.25],
        order_expected=2.0,
        tolerance=0.1,
    )
    assert not cv.evaluate().passed


def test_convergence_check_short_param_list_fails():
    cv = ConvergenceCheck(name="c", run_at=lambda h: h, parameters=[1.0])
    r = cv.evaluate()
    assert not r.passed


def test_cross_solver_comparison_agreement():
    x = CrossSolverComparison(
        name="x",
        series_a=lambda r: r,
        series_b=lambda r: r,
        tolerance_relative=1e-6,
    )
    a = [1.0, 2.0, 3.0]
    b = [1.0, 2.0, 3.0]
    assert x.evaluate(a, b).passed


def test_cross_solver_comparison_disagreement():
    x = CrossSolverComparison(
        name="x",
        series_a=lambda r: r,
        series_b=lambda r: r,
        tolerance_relative=1e-3,
    )
    a = [1.0, 2.0, 3.0]
    b = [1.0, 2.0, 3.5]
    assert not x.evaluate(a, b).passed


def test_cross_solver_comparison_length_mismatch():
    x = CrossSolverComparison(
        name="x", series_a=lambda r: r, series_b=lambda r: r
    )
    r = x.evaluate([1.0, 2.0], [1.0])
    assert not r.passed
    assert "length mismatch" in r.detail.lower()
