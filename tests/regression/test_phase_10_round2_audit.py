"""Regressions for the Phase 10 round-2 post-close audit.

Pins the six findings the second audit caught against the Phase 10
close (commit 4552742). Each test corresponds to one finding and
exercises the actual failure mode the audit reproduced.

See `bugs_and_fixes/bugfixes.md` 2026-05-04 *Phase 10 round-2 audit*.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from simworkbench.api.server import DEFAULT_WORKSPACE_SLUG, create_app
from simworkbench.autonomy import (
    ApprovalGate,
    ApprovalRequiredError,
    ControlledSweepAgent,
    ExperimentDesigner,
    ScientificReviewer,
    capsule_status_for_plan,
    grant_autonomy_approval,
)
from simworkbench.model_spec import (
    Equation,
    Geometry,
    Interaction,
    Model,
    ModelSpec,
    Solvers,
    Species,
    save_yaml,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.paths import simulation_capsules_root_for
from simworkbench.sweep import GridSampler, SweepSpec
from simworkbench.units import Q


def _spec_with_placeholder_interaction() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="placeholder_probe", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(0.0, "1/m^3")),
        ],
        equations=[Equation(id="eq_AB", latex="A \\to B", description="conv")],
        interactions=[
            Interaction(
                name="AB_conversion",
                participants=["A", "B"],
                equation_refs=["eq_AB"],
                coefficient_sources=["placeholder: rate not yet measured"],
            )
        ],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d",
                    backend_compatibility=["python_cpu"],
                )
            ]
        ),
    )


def _spec_with_real_interaction() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="real_probe", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))
        ],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d",
                    backend_compatibility=["python_cpu"],
                )
            ]
        ),
    )


# ---------------------------------------------------------------------------
# Finding 1 (critical) — placeholder interactions in the spec aren't
# propagated into ExperimentPlan.placeholders.
# ---------------------------------------------------------------------------


def test_round2_designer_propagates_placeholder_interactions():
    spec = _spec_with_placeholder_interaction()
    plan = ExperimentDesigner().design(spec)
    assert plan.placeholders == ["AB_conversion"]
    assert capsule_status_for_plan(plan) == "exploratory"


def test_round2_designer_no_false_placeholders_on_clean_spec():
    spec = _spec_with_real_interaction()
    plan = ExperimentDesigner().design(spec)
    assert plan.placeholders == []
    assert capsule_status_for_plan(plan) == "validated"


# ---------------------------------------------------------------------------
# Finding 2 (high) — autonomy API endpoints didn't write provenance/agent_trace.md.
# ---------------------------------------------------------------------------


def _make_capsule(name: str, spec: ModelSpec) -> Path:
    capsule_path = simulation_capsules_root_for(DEFAULT_WORKSPACE_SLUG) / name
    (capsule_path / "model").mkdir(parents=True, exist_ok=True)
    save_yaml(spec, capsule_path / "model" / "model_spec.yaml")
    return capsule_path


def _cleanup_capsule(capsule_path: Path) -> None:
    import shutil

    shutil.rmtree(capsule_path, ignore_errors=True)


def test_round2_autonomy_design_writes_agent_trace():
    name = "_pytest_autonomy_design_trace.lxp"
    capsule_path = _make_capsule(name, _spec_with_real_interaction())
    try:
        client = TestClient(create_app())
        resp = client.post(f"/api/autonomy/design/{name}")
        assert resp.status_code == 200
        trace_path = capsule_path / "provenance" / "agent_trace.md"
        assert trace_path.is_file(), "design endpoint did not write agent_trace.md"
        body = trace_path.read_text(encoding="utf-8")
        assert "autonomy_design" in body
        assert "experiment_design" in body
    finally:
        _cleanup_capsule(capsule_path)


def test_round2_autonomy_review_writes_agent_trace():
    name = "_pytest_autonomy_review_trace.lxp"
    capsule_path = _make_capsule(name, _spec_with_real_interaction())
    try:
        client = TestClient(create_app())
        resp = client.post(f"/api/autonomy/review/{name}")
        assert resp.status_code == 200
        trace_path = capsule_path / "provenance" / "agent_trace.md"
        assert trace_path.is_file()
        assert "autonomy_review" in trace_path.read_text(encoding="utf-8")
    finally:
        _cleanup_capsule(capsule_path)


def test_round2_autonomy_sweep_writes_agent_trace():
    name = "_pytest_autonomy_sweep_trace.lxp"
    capsule_path = _make_capsule(name, _spec_with_real_interaction())
    try:
        client = TestClient(create_app())
        resp = client.post(
            f"/api/autonomy/sweep/{name}",
            json={"parameters": {"x": [0.0, 0.5, 1.0]}, "metric": "loss"},
        )
        assert resp.status_code == 200
        trace_path = capsule_path / "provenance" / "agent_trace.md"
        assert trace_path.is_file()
        assert "autonomy_sweep" in trace_path.read_text(encoding="utf-8")
    finally:
        _cleanup_capsule(capsule_path)


# ---------------------------------------------------------------------------
# Finding 3 (high) — ControlledSweepAgent didn't stop failed runs early.
# ---------------------------------------------------------------------------


def test_round2_controlled_sweep_aborts_on_high_failure_rate():
    """When the failure ratio crosses the threshold mid-sweep, the
    agent stops the engine cleanly rather than running the full
    capped sweep."""
    spec = SweepSpec(
        name="failure_probe",
        parameters={"x": list(range(20))},
        sampler=GridSampler(),
    )
    agent = ControlledSweepAgent(budget=20, failure_ratio_threshold=0.5)

    def always_failing(_p: dict[str, float]) -> dict[str, float]:
        raise RuntimeError("synthetic failure")

    report = agent.launch(spec, always_failing)
    assert report.stopped_reason == "high_failure_rate"
    # Must not have run all 20 — abort happens once at least 4 runs
    # have happened and the failure ratio is >= threshold.
    assert len(report.runs) < 20
    assert len(report.failed) >= 4


def test_round2_controlled_sweep_continues_when_failure_rate_low():
    """Healthy sweeps still run to completion."""
    spec = SweepSpec(
        name="healthy_probe",
        parameters={"x": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]},
        sampler=GridSampler(),
    )
    agent = ControlledSweepAgent(budget=6, failure_ratio_threshold=0.5)
    report = agent.launch(
        spec, objective=lambda p: {"loss": float(p["x"])}
    )
    assert report.stopped_reason in {"completed", "budget_cap"}
    assert len(report.completed) == 6


# ---------------------------------------------------------------------------
# Finding 4 (high) — Phase 10 writers wrote outside workbench roots.
# ---------------------------------------------------------------------------


def test_round2_scientific_reviewer_refuses_external_capsule(tmp_path):
    """ScientificReviewer.write refuses to land outside workbench-
    managed roots when require_workbench_target=True (default)."""
    capsule_path = tmp_path / "external_capsule.lxp"
    (capsule_path / "model").mkdir(parents=True)
    (capsule_path / "model" / "model_spec.yaml").write_text(
        "schema_version: '0.1'\n"
        "model: {name: probe, domain: species}\n"
        "geometry: {dimensionality: 0}\n"
        "species: [{name: A, type: atom, initial_density: 1.0 1/m^3}]\n"
        "solvers: {recommended: [{name: rate_equation_0d, backend_compatibility: [python_cpu]}]}\n",
        encoding="utf-8",
    )
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        ScientificReviewer().write(capsule_path)


def test_round2_approval_gate_refuses_external_state_dir(tmp_path):
    """ApprovalGate refuses a state_dir outside workbench-managed roots
    by default."""
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        ApprovalGate(state_dir=tmp_path / "approvals")


def test_round2_grant_autonomy_approval_refuses_external_state_dir(tmp_path):
    """grant_autonomy_approval inherits the same locality guard."""
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        grant_autonomy_approval(
            action="trusted_promotion",
            subject="probe",
            reviewer="pytest",
            state_dir=tmp_path / "approvals",
        )


def test_round2_approval_gate_explicit_optout_works(tmp_path):
    """The opt-out kwarg lets test fixtures and CLI helpers use any
    path — the contract is "default-secure, opt-in for external"."""
    gate = ApprovalGate(
        state_dir=tmp_path / "approvals", require_workbench_target=False
    )
    assert gate.state_dir.is_dir()
    # Round-trip: grant + consume.
    grant_autonomy_approval(
        action="trusted_promotion",
        subject="probe",
        reviewer="pytest",
        state_dir=tmp_path / "approvals",
        require_workbench_target=False,
    )
    record = gate.consume(action="trusted_promotion", subject="probe")
    assert record.reviewer == "pytest"
    # Single-use semantics still hold.
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="trusted_promotion", subject="probe")


# ---------------------------------------------------------------------------
# Finding 5 (medium) — API sweep ignored configs/agents.yaml budget.
# ---------------------------------------------------------------------------


def test_round2_api_sweep_uses_yaml_budget():
    """The autonomy sweep endpoint reads
    configs/agents.yaml::controlled_sweep.budget.max_evaluations_per_launch.
    The current YAML sets 32; the response must echo the same number."""
    name = "_pytest_autonomy_budget.lxp"
    capsule_path = _make_capsule(name, _spec_with_real_interaction())
    try:
        client = TestClient(create_app())
        # Pass enough grid points that the budget cap, not the grid
        # size, is what stops the sweep.
        big_grid = [float(i) for i in range(40)]
        resp = client.post(
            f"/api/autonomy/sweep/{name}",
            json={"parameters": {"x": big_grid}, "metric": "loss"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["budget"] == 32, (
            "API sweep must read controlled_sweep.budget.max_evaluations_per_launch "
            f"from configs/agents.yaml; got budget={body['budget']!r}"
        )
        # The response's completed count must respect that cap.
        assert body["completed"] <= 32
    finally:
        _cleanup_capsule(capsule_path)


# ---------------------------------------------------------------------------
# Finding 6 (medium) — smoke endpoint missing.
# ---------------------------------------------------------------------------


def test_round2_smoke_endpoint_exists():
    """POST /api/autonomy/smoke/{name} returns 200 with the smoke
    report fields. The earlier UI panel docstring claimed four
    endpoints; only design / sweep / review were wired."""
    name = "_pytest_autonomy_smoke_endpoint.lxp"
    capsule_path = _make_capsule(name, _spec_with_real_interaction())
    try:
        client = TestClient(create_app())
        resp = client.post(f"/api/autonomy/smoke/{name}")
        assert resp.status_code == 200
        body = resp.json()
        assert "instability_flags" in body
        assert "diagnostics_interpretation" in body
        assert "suggested_param_adjustments" in body
        assert "review_markdown" in body
        # The smoke endpoint also writes a provenance trace.
        trace = capsule_path / "provenance" / "agent_trace.md"
        assert trace.is_file()
        assert "autonomy_smoke" in trace.read_text(encoding="utf-8")
    finally:
        _cleanup_capsule(capsule_path)
