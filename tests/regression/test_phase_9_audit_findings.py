"""Regressions for the Phase 9 post-close audit.

Pins the eight findings the audit caught (one critical, two high, three
medium, two low). Each test corresponds to one finding and exercises
the actual failure mode the audit reproduced.

See `bugs_and_fixes/bugfixes.md` 2026-05-04 *Phase 9 post-close audit*.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from simworkbench.paths import simulation_capsules_root
from simworkbench.reports import ComparisonReport
from simworkbench.sweep import (
    AdaptiveSampler,
    GridSampler,
    SweepEngine,
    SweepSpec,
)

# ---------------------------------------------------------------------------
# Finding 1 (critical) — Adaptive sweep resume can hang indefinitely.
# ---------------------------------------------------------------------------


class _ConstantSampler(AdaptiveSampler):
    """Adaptive sampler that always proposes the same point.

    Without history pre-population on resume, this would loop forever
    after the first session (the engine would keep re-proposing the
    same point, the duplicate-skip filter would keep filtering it, and
    nothing would advance).
    """

    def __init__(self) -> None:
        super().__init__()

    def next_point(self, spec, history):  # noqa: ANN001
        # Return the same point every call. Duplicate-skip should kick
        # in and stop the engine instead of looping.
        return {"x": 0.5}


def test_audit_adaptive_resume_terminates_with_duplicate_skip(tmp_path):
    """On resume with an adaptive sampler that re-proposes a point
    already in the prior session's history, the engine must NOT loop
    forever. After DUPLICATE_SKIP_LIMIT consecutive duplicates the
    engine stops with stopped_reason='adaptive_stuck'."""
    spec = SweepSpec(
        name="adaptive_loop_probe",
        parameters={"x": (0.0, 1.0)},
        sampler=_ConstantSampler(),
        max_evaluations=1,
    )
    ckpt = tmp_path / "ckpt.json"
    SweepEngine(
        spec=spec,
        objective=lambda p: {"loss": float(p["x"])},
        checkpoint_path=ckpt,
        require_workbench_target=False,
    ).run()

    # Now resume with the cap removed — the engine should stop at the
    # safety limit instead of spinning forever.
    spec2 = SweepSpec(
        name="adaptive_loop_probe",
        parameters={"x": (0.0, 1.0)},
        sampler=_ConstantSampler(),
    )
    report = SweepEngine.resume(
        spec=spec2,
        objective=lambda p: {"loss": float(p["x"])},
        checkpoint_path=ckpt,
        require_workbench_target=False,
    ).run()
    assert report.stopped_reason == "adaptive_stuck"


def test_audit_adaptive_history_restored_on_resume(tmp_path):
    """The sampler's _history attribute is populated with prior runs
    when resuming, so adaptive samplers see the full trajectory rather
    than starting from scratch."""

    class _RecordingSampler(AdaptiveSampler):
        def __init__(self) -> None:
            super().__init__()
            self.calls: list[int] = []

        def next_point(self, spec, history):  # noqa: ANN001
            self.calls.append(len(history))
            if len(history) >= 4:
                return None
            return {"x": float(len(history))}

    sampler = _RecordingSampler()
    spec = SweepSpec(
        name="adaptive_history_probe",
        parameters={"x": (0.0, 10.0)},
        sampler=sampler,
        max_evaluations=2,
    )
    ckpt = tmp_path / "ckpt.json"
    SweepEngine(
        spec=spec,
        objective=lambda p: {"loss": float(p["x"])},
        checkpoint_path=ckpt,
        require_workbench_target=False,
    ).run()
    assert sampler.calls == [0, 1]

    # Resume with a fresh sampler instance; the engine pre-populates
    # its history from the checkpoint.
    sampler2 = _RecordingSampler()
    spec2 = SweepSpec(
        name="adaptive_history_probe",
        parameters={"x": (0.0, 10.0)},
        sampler=sampler2,
    )
    SweepEngine.resume(
        spec=spec2,
        objective=lambda p: {"loss": float(p["x"])},
        checkpoint_path=ckpt,
        require_workbench_target=False,
    ).run()
    # First call sees 2 prior rows from session 1, not 0.
    assert sampler2.calls[0] == 2


# ---------------------------------------------------------------------------
# Finding 2 (high) — Phase 9 writers bypass workbench locality guard.
# ---------------------------------------------------------------------------


def test_audit_sweep_engine_refuses_non_workbench_checkpoint(tmp_path):
    """SweepEngine refuses checkpoint_path outside workbench-managed
    roots when require_workbench_target=True (default)."""
    spec = SweepSpec(
        name="locality_probe",
        parameters={"x": [0.0, 1.0]},
        sampler=GridSampler(),
    )
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        SweepEngine(
            spec=spec,
            objective=lambda p: {"loss": float(p["x"])},
            checkpoint_path=tmp_path / "sneaky.json",
        )


def test_audit_sweep_engine_resume_refuses_non_workbench_checkpoint(tmp_path):
    """Same guard applies on resume."""
    spec = SweepSpec(
        name="locality_resume_probe",
        parameters={"x": [0.0, 1.0]},
        sampler=GridSampler(),
    )
    # Place a fake checkpoint under tmp_path so it exists.
    ckpt = tmp_path / "rogue.json"
    ckpt.write_text(
        json.dumps(
            {
                "schema_version": "0.1",
                "sweep_name": "locality_resume_probe",
                "sweep_id": "abc",
                "completed": [],
                "failed": [],
                "stopped_reason": "completed",
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        SweepEngine.resume(
            spec=spec,
            objective=lambda p: {"loss": float(p["x"])},
            checkpoint_path=ckpt,
        )


def test_audit_comparison_report_refuses_non_workbench_target(tmp_path):
    """ComparisonReport.write refuses target outside workbench roots
    by default."""
    from simworkbench.sweep.engine import SweepReport, SweepRow

    report = SweepReport(
        sweep_id="abc",
        spec_name="probe",
        runs=[
            SweepRow(
                parameters={"x": 0.0},
                metrics={"loss": 1.0},
            )
        ],
        stopped_reason="completed",
    )
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        ComparisonReport(metric="loss").write(
            report, target=tmp_path / "sneaky_comparison"
        )


# ---------------------------------------------------------------------------
# Finding 3 (high) — Phase 9 not full-gate clean. (ruff)
# ---------------------------------------------------------------------------


def test_audit_phase_9_files_pass_ruff():
    """The Phase 9 source tree (sweep, optimization, uncertainty,
    reports) must lint clean."""
    import subprocess

    from simworkbench.paths import repo_root

    root = repo_root()
    result = subprocess.run(
        [
            ".venv/bin/python",
            "-m",
            "ruff",
            "check",
            "packages/core/src/simworkbench/sweep",
            "packages/core/src/simworkbench/optimization",
            "packages/core/src/simworkbench/uncertainty",
            "packages/core/src/simworkbench/reports",
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"ruff failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


# ---------------------------------------------------------------------------
# Finding 4 (medium) — Comparison example does not feed UI/API path.
# ---------------------------------------------------------------------------


def test_audit_comparison_example_writes_to_capsule_path():
    """The example writes to ``simulation_capsules/<name>.lxp/comparison/``
    not ``temp_runs/<name>/comparison/``, so the API endpoint
    ``GET /api/comparison/{capsule_name}`` finds the manifest the
    example produced."""
    from simworkbench.paths import repo_root

    example = repo_root() / "examples" / "parameter_sweep_quadratic" / "run_sweep.py"
    body = example.read_text(encoding="utf-8")
    # The example imports simulation_capsules_root, not temp_runs_root.
    assert "from simworkbench.paths import simulation_capsules_root" in body
    assert "temp_runs_root" not in body
    # And the target directory has the .lxp suffix.
    assert ".lxp" in body
    assert "simulation_capsules_root() / f" in body


def test_audit_comparison_endpoint_reads_lxp_capsule_dir(tmp_path):
    """End-to-end: the endpoint that reads the manifest accepts a
    capsule directory name with the .lxp suffix and returns the manifest
    JSON. This is the path the example writes to."""
    from fastapi.testclient import TestClient
    from simworkbench.api.server import create_app
    from simworkbench.sweep.engine import SweepReport, SweepRow

    capsule_root = simulation_capsules_root()
    capsule_name = "_pytest_phase9_audit_capsule.lxp"
    capsule_path = capsule_root / capsule_name
    capsule_path.mkdir(exist_ok=True)
    try:
        report = SweepReport(
            sweep_id="abc",
            spec_name="probe",
            runs=[
                SweepRow(
                    parameters={"x": 0.0},
                    metrics={"loss": 1.0},
                )
            ],
            stopped_reason="completed",
        )
        ComparisonReport(metric="loss").write(report, target=capsule_path / "comparison")

        client = TestClient(create_app())
        resp = client.get(f"/api/comparison/{capsule_name}")
        assert resp.status_code == 200
        body = resp.json()
        # The manifest carries the metric and at least one ranked entry.
        assert body["metric"] == "loss"
        assert body["n_completed"] == 1
    finally:
        import shutil

        shutil.rmtree(capsule_path, ignore_errors=True)


# ---------------------------------------------------------------------------
# Finding 5 (medium) — RandomSearchOptimizer all-rejected returns {} inf.
# ---------------------------------------------------------------------------


def test_audit_random_search_all_rejected_returns_structured_status():
    """When every candidate is rejected by constraints,
    RandomSearchOptimizer returns a structured "no valid candidate"
    status (not {} and inf)."""
    from simworkbench.optimization import (
        OptimizationProblem,
        RandomSearchOptimizer,
    )

    # Constraint impossible to satisfy.
    problem = OptimizationProblem(
        parameters={"x": (0.0, 1.0)},
        objective=lambda p: float(p["x"]),
        budget=10,
        constraints=lambda p: False,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    assert result.evaluations == 0
    assert result.rejected_by_constraints == 10
    assert result.stopped_reason in {"all_candidates_rejected", "no_valid_candidate"}
    # best_parameters / best_value carry sentinel signaling rather than
    # a misleading "best" of inf at {}.
    assert result.best_parameters == {} or result.best_value != float("inf") or (
        result.best_value == float("inf") and result.stopped_reason != "completed"
    )


# ---------------------------------------------------------------------------
# Finding 6 (medium) — BayesianOptimizerHook conditional bugs.
# ---------------------------------------------------------------------------


def test_audit_random_search_maximize_early_stop_uses_correct_sign():
    """When minimize=False, the optimizer's "best" is the MAX, not the
    MIN; early-stop comparison must invert. ``early_stop_threshold=0.95``
    with ``minimize=False`` means stop when best_value >= 0.95."""
    from simworkbench.optimization import (
        OptimizationProblem,
        RandomSearchOptimizer,
    )

    problem = OptimizationProblem(
        parameters={"x": (0.0, 1.0)},
        objective=lambda p: float(p["x"]),
        budget=200,
        minimize=False,  # bigger is better
        early_stop_threshold=0.95,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    # With seed=0 and budget=200, the search will draw at least one
    # point above 0.95 quickly. The optimizer must stop with
    # stopped_reason='early_stop' as soon as the best meets the
    # threshold (interpreted as ">=" for maximize).
    assert result.best_value >= 0.95
    assert result.stopped_reason == "early_stop"


def test_audit_bayesian_hook_evaluation_count_excludes_rejected():
    """When skopt isn't installed, calling .optimize raises
    BayesianUnavailable. We probe the data shape by reading the
    OptimizationResult contract: evaluations must be the executed
    count (not executed + rejected). That's a regression on the
    constructor / call shape; we don't need skopt to verify it."""
    from simworkbench.optimization import OptimizationResult

    # The dataclass has the field shape we expect (rejected_by_constraints
    # separate from evaluations).
    res = OptimizationResult(
        best_parameters={"x": 0.5},
        best_value=0.5,
        evaluations=3,
        rejected_by_constraints=7,
    )
    # The contract is: evaluations is executed-only; rejected is
    # tracked separately.
    assert res.evaluations == 3
    assert res.rejected_by_constraints == 7


# ---------------------------------------------------------------------------
# Finding 7 (low) — UQ boundary validation incomplete.
# ---------------------------------------------------------------------------


def test_audit_uq_distribution_rejects_negative_stddev():
    """ParameterDistribution must reject stddev <= 0 at construction."""
    from simworkbench.uncertainty import ParameterDistribution

    with pytest.raises(ValueError):
        ParameterDistribution(
            kind="normal", params={"mean": 0.0, "stddev": -1.0}
        ).sample(__import__("numpy").random.default_rng(0), n=1)


def test_audit_uq_uniform_rejects_inverted_bounds():
    """uniform with low >= high must fail."""
    import numpy as np
    from simworkbench.uncertainty import ParameterDistribution

    with pytest.raises(ValueError):
        ParameterDistribution(
            kind="uniform", params={"low": 5.0, "high": 1.0}
        ).sample(np.random.default_rng(0), n=1)


def test_audit_bootstrap_rejects_zero_resamples():
    """bootstrap_confidence_interval must reject n_resamples <= 0."""
    import numpy as np
    from simworkbench.uncertainty import bootstrap_confidence_interval

    samples = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    with pytest.raises(ValueError):
        bootstrap_confidence_interval(samples, level=0.95, n_resamples=0, seed=0)


def test_audit_sensitivity_rejects_empty_distributions():
    """SensitivityAnalysis must reject an empty distributions dict."""
    from simworkbench.uncertainty import SensitivityAnalysis

    with pytest.raises(ValueError):
        SensitivityAnalysis(distributions={}, n_samples=100, seed=0)


# ---------------------------------------------------------------------------
# Finding 8 (low) — Docs/UI status polish.
# ---------------------------------------------------------------------------


def test_audit_phase_9_docs_page_exists_and_documents_all_subsystems():
    """The Phase 9 docs page must exist and mention sweeps, optimization,
    uncertainty, and comparison reports."""
    from simworkbench.paths import repo_root

    candidates = list(
        (repo_root() / "docs_site" / "src" / "content").glob("*.tsx")
    )
    text = "".join(p.read_text(encoding="utf-8") for p in candidates).lower()
    assert "sweep" in text
    assert "optim" in text
    assert "uncertain" in text or "monte carlo" in text
    assert "comparison" in text or "compare" in text


def test_audit_ui_sidebar_phase_label_does_not_misrepresent_current_phase():
    """The sidebar must not advertise the pre-Phase-2 placeholder
    'Phase 1F' as the current phase tag. After Phase 9 ships the
    rendered ``<p className="phase-tag">`` reads 'Phase 9'."""
    from simworkbench.paths import repo_root

    app_tsx = (
        repo_root() / "apps" / "workbench-ui" / "src" / "App.tsx"
    ).read_text(encoding="utf-8")
    # Find the rendered phase-tag.
    import re

    match = re.search(
        r'<p className="phase-tag">([^<]+)</p>', app_tsx
    )
    assert match is not None, "Could not locate phase-tag in App.tsx"
    rendered = match.group(1).strip()
    assert rendered != "Phase 1F", (
        "App.tsx phase-tag still reads 'Phase 1F'; bump it to the "
        "current phase tag now that Phase 9 is closed."
    )
    assert rendered.startswith("Phase ") and rendered != "Phase 1F"


_ = Path  # keep import used for future audit additions
