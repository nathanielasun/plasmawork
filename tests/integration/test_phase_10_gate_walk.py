"""Phase 10 gate-walk integration tests — written FIRST.

Per `CLAUDE.md → Phase Gate Procedure → ninth check`:
  9. Gate-clause verb walk. Read the plan's `## Phase Gate` paragraph
     for the phase. Extract every verb. For each verb, confirm a real
     implementation, a user-facing surface, and a test in
     ``tests/integration/test_phase_N_gate_walk.py`` that exercises
     the verb end-to-end on a real artifact, with at least one
     negative case.

The plan §Phase 10 gate reads: "the system can autonomously **propose**
and **run** bounded computational experiments while preserving
**inspectability**, **validation**, and **human control**."

Gate verbs by workstream (plan §Phase 10):
  10A propose: design_experiment(), select_minimum_viable_model,
       fidelity_ladder, estimate_cost, define_diagnostics,
       define_validation_path
  10B run / interpret / detect / adjust / report: SmokeRunner.run,
       diagnostic interpretation, instability detection, safe-param
       adjustment, review report
  10C launch / monitor / stop / summarise / recommend:
       ControlledSweepAgent.launch + budget cap + trend summary +
       next-sweep recommendation
  10D critique / identify / compare / flag / recommend:
       ScientificReviewer.review covering assumptions / missing
       physics / literature / overclaims / validation
  10E approve / refuse: ApprovalGate enforces single-use tokens for
       trusted-promotion / expensive-runs / external-export /
       destructive-edits

Negative tests cover the bypass paths the Phase-5/6/7/8 audits caught:
  - hard rules don't take a client-controlled flag
  - approval is server-derived, not body-supplied
  - autonomous runs without evidence stay `exploratory`, never
    `validated` (plan §22)
"""

from __future__ import annotations

import pytest
from simworkbench.autonomy import (
    ApprovalGate,
    ApprovalRequiredError,
    ControlledSweepAgent,
    ExperimentDesigner,
    ExperimentPlan,
    ScientificReview,
    ScientificReviewer,
    SmokeReport,
    SmokeRunner,
    grant_autonomy_approval,
)
from simworkbench.experiment import BackendConfig, Experiment, RunConfig
from simworkbench.model_spec import (
    Geometry,
    Model,
    ModelSpec,
    Solvers,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.units import Q


def _spec() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="phase10_probe", domain="species"),
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
# 10A — Experiment Design Agent
# ---------------------------------------------------------------------------


def test_phase_10_gate_walk_designer_emits_plan_with_required_fields():
    """ExperimentDesigner.design(spec) returns an ExperimentPlan
    carrying every plan-named field: minimum_viable_model,
    fidelity_ladder, cost_estimate, diagnostics, validation_path."""
    plan = ExperimentDesigner().design(_spec())
    assert isinstance(plan, ExperimentPlan)
    assert plan.minimum_viable_model
    assert plan.fidelity_ladder  # ordered list of fidelity levels
    assert plan.cost_estimate.total_cpu_seconds > 0
    assert plan.diagnostics
    assert plan.validation_path


def test_phase_10_gate_walk_designer_fidelity_ladder_is_ordered():
    """The fidelity ladder is an explicit ordered sequence (low → high
    fidelity), not an unordered set."""
    plan = ExperimentDesigner().design(_spec())
    levels = [step.label for step in plan.fidelity_ladder]
    assert len(levels) >= 2
    # No duplicates; order is meaningful.
    assert len(set(levels)) == len(levels)


def test_phase_10_gate_walk_designer_refuses_no_validation_path():
    """A plan that can't articulate how the experiment will be
    validated is refused. The designer raises rather than emit a
    plan with empty validation_path."""
    with pytest.raises(ValueError, match="validation"):
        # Construct a contrived spec that the designer can't tie to
        # a validation strategy (no recommended solver).
        bad = ModelSpec(
            schema_version="0.1",
            model=Model(name="no_validation", domain="species"),
            geometry=Geometry(dimensionality=0),
            species=[
                Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))
            ],
            solvers=Solvers(recommended=[]),
        )
        ExperimentDesigner().design(bad)


# ---------------------------------------------------------------------------
# 10B — Autonomous Small Runs
# ---------------------------------------------------------------------------


def test_phase_10_gate_walk_smoke_run_executes_and_reports():
    """SmokeRunner.run executes a tiny run, returns a SmokeReport
    with diagnostics interpretation, instability flags, and a
    review markdown summary."""
    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=10),
        backend_config=BackendConfig(name="python_cpu"),
    )
    report = SmokeRunner().run(experiment)
    assert isinstance(report, SmokeReport)
    assert isinstance(report.review_markdown, str)
    assert len(report.review_markdown) > 0
    # diagnostics_interpretation is a dict from diagnostic name -> short summary
    assert isinstance(report.diagnostics_interpretation, dict)


def test_phase_10_gate_walk_smoke_run_detects_instability():
    """When a run produces NaN / inf / monotonic blow-up, the
    SmokeReport's instability_flags is non-empty."""

    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=10),
        backend_config=BackendConfig(name="python_cpu"),
    )
    # Inject a synthetic unstable trajectory via the runner kwargs
    # the SmokeRunner exposes for tests.
    report = SmokeRunner().run(
        experiment,
        _force_synthetic_diagnostics={
            "density_A": [1.0, 1e10, 1e20, float("inf")]
        },
    )
    assert report.instability_flags  # non-empty


def test_phase_10_gate_walk_smoke_run_proposes_safe_adjustments():
    """When instability is detected, SmokeReport carries at least one
    suggested parameter adjustment (e.g. shorter timestep, smaller
    domain). Suggestions are markdown text — the agent doesn't
    auto-apply them."""
    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=10),
        backend_config=BackendConfig(name="python_cpu"),
    )
    report = SmokeRunner().run(
        experiment,
        _force_synthetic_diagnostics={
            "density_A": [1.0, 1e10, 1e20, float("inf")]
        },
    )
    assert report.suggested_param_adjustments


# ---------------------------------------------------------------------------
# 10C — Controlled Sweep Agent
# ---------------------------------------------------------------------------


def test_phase_10_gate_walk_controlled_sweep_respects_budget():
    """ControlledSweepAgent(budget=N) executes at most N evaluations.
    No bypass kwargs exist."""
    from simworkbench.sweep import GridSampler, SweepSpec

    spec = SweepSpec(
        name="phase10_budget_probe",
        parameters={"x": [0.0, 1.0, 2.0, 3.0, 4.0]},
        sampler=GridSampler(),
    )
    agent = ControlledSweepAgent(budget=2)
    report = agent.launch(
        spec,
        objective=lambda p: {"loss": float(p["x"])},
    )
    assert len(report.completed) == 2
    assert report.stopped_reason in {"budget_cap", "completed"}


def test_phase_10_gate_walk_controlled_sweep_no_budget_bypass_kwargs():
    """ControlledSweepAgent's __init__ and launch must NOT expose
    ignore_budget / unbounded / skip_budget kwargs (Phase-7/8/9
    audit lesson)."""
    import inspect

    init_sig = inspect.signature(ControlledSweepAgent.__init__)
    launch_sig = inspect.signature(ControlledSweepAgent.launch)
    forbidden = {"ignore_budget", "unbounded", "skip_budget", "no_budget"}
    init_kwargs = set(init_sig.parameters)
    launch_kwargs = set(launch_sig.parameters)
    assert not (forbidden & init_kwargs)
    assert not (forbidden & launch_kwargs)


def test_phase_10_gate_walk_controlled_sweep_summarises_trends():
    """The agent's report carries a trend_summary describing the
    objective's behaviour across the sweep."""
    from simworkbench.sweep import GridSampler, SweepSpec

    spec = SweepSpec(
        name="phase10_trend_probe",
        parameters={"x": [0.0, 1.0, 2.0, 3.0]},
        sampler=GridSampler(),
    )
    agent = ControlledSweepAgent(budget=4)
    result = agent.launch_with_summary(
        spec, objective=lambda p: {"loss": float(p["x"]) ** 2}
    )
    assert result.trend_summary  # non-empty
    assert result.next_sweep_recommendation


# ---------------------------------------------------------------------------
# 10D — Scientific Review Agent
# ---------------------------------------------------------------------------


def test_phase_10_gate_walk_scientific_reviewer_emits_review(tmp_path):
    """ScientificReviewer.review(capsule) returns a ScientificReview
    with all five plan-named sections."""
    capsule_path = tmp_path / "review_probe.lxp"
    (capsule_path / "model").mkdir(parents=True)
    (capsule_path / "model" / "model_spec.yaml").write_text(
        "schema_version: '0.1'\n"
        "model: {name: probe, domain: species}\n"
        "geometry: {dimensionality: 0}\n"
        "species: [{name: A, type: atom, initial_density: 1.0 1/m^3}]\n"
        "solvers: {recommended: [{name: rate_equation_0d, backend_compatibility: [python_cpu]}]}\n",
        encoding="utf-8",
    )
    review = ScientificReviewer().review(capsule_path)
    assert isinstance(review, ScientificReview)
    assert isinstance(review.assumption_critique, str)
    assert isinstance(review.missing_physics, list)
    assert isinstance(review.literature_alignment, str)
    assert isinstance(review.overclaim_flags, list)
    assert isinstance(review.recommended_validation, list)


def test_phase_10_gate_walk_scientific_reviewer_writes_markdown(tmp_path):
    """The reviewer writes the review to
    ``<capsule>/review/scientific_review.md``."""
    capsule_path = tmp_path / "review_md_probe.lxp"
    (capsule_path / "model").mkdir(parents=True)
    (capsule_path / "model" / "model_spec.yaml").write_text(
        "schema_version: '0.1'\n"
        "model: {name: probe, domain: species}\n"
        "geometry: {dimensionality: 0}\n"
        "species: [{name: A, type: atom, initial_density: 1.0 1/m^3}]\n"
        "solvers: {recommended: [{name: rate_equation_0d, backend_compatibility: [python_cpu]}]}\n",
        encoding="utf-8",
    )
    written = ScientificReviewer().write(capsule_path)
    assert written.is_file()
    assert written.relative_to(capsule_path).parts[:2] == ("review", "scientific_review.md")


def test_phase_10_gate_walk_scientific_reviewer_never_writes_user_edits(tmp_path):
    """Reviewer must not touch ``<capsule>/src/user_edits/``."""
    capsule_path = tmp_path / "review_sandbox.lxp"
    (capsule_path / "model").mkdir(parents=True)
    (capsule_path / "model" / "model_spec.yaml").write_text(
        "schema_version: '0.1'\n"
        "model: {name: probe, domain: species}\n"
        "geometry: {dimensionality: 0}\n"
        "species: [{name: A, type: atom, initial_density: 1.0 1/m^3}]\n"
        "solvers: {recommended: [{name: rate_equation_0d, backend_compatibility: [python_cpu]}]}\n",
        encoding="utf-8",
    )
    user_edits = capsule_path / "src" / "user_edits"
    user_edits.mkdir(parents=True)
    (user_edits / "user_file.py").write_text("# user", encoding="utf-8")
    ScientificReviewer().write(capsule_path)
    assert (user_edits / "user_file.py").read_text(encoding="utf-8") == "# user"


# ---------------------------------------------------------------------------
# 10E — Human Approval Gates
# ---------------------------------------------------------------------------


def test_phase_10_gate_walk_approval_gate_refuses_without_token(tmp_path):
    """ApprovalGate refuses a privileged action when no token has
    been granted out-of-band."""
    gate = ApprovalGate(state_dir=tmp_path / "approvals")
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="trusted_promotion", subject="some_module")


def test_phase_10_gate_walk_approval_gate_grants_then_consumes(tmp_path):
    """A granted token unlocks exactly one consume; second consume
    raises (single-use semantics)."""
    state_dir = tmp_path / "approvals"
    grant_autonomy_approval(
        action="expensive_run",
        subject="capsule_42",
        reviewer="pytest",
        state_dir=state_dir,
    )
    gate = ApprovalGate(state_dir=state_dir)
    record = gate.consume(action="expensive_run", subject="capsule_42")
    assert record.action == "expensive_run"
    # Second consume of the same action+subject must refuse.
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="expensive_run", subject="capsule_42")


def test_phase_10_gate_walk_approval_gate_action_token_isolation(tmp_path):
    """A token granted for action A doesn't unlock action B on the
    same subject."""
    state_dir = tmp_path / "approvals"
    grant_autonomy_approval(
        action="external_export",
        subject="capsule_x",
        reviewer="pytest",
        state_dir=state_dir,
    )
    gate = ApprovalGate(state_dir=state_dir)
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="destructive_edits", subject="capsule_x")


def test_phase_10_gate_walk_approval_gate_action_set_complete(tmp_path):
    """Every action documented in `configs/agents.yaml`'s
    `human_approval_gates` block is recognised by the gate."""
    state_dir = tmp_path / "approvals"
    actions = [
        "module_promotion_to_trusted",
        "external_export",
        "destructive_edits",
        "high_compute_runs",
        "destructive_git_operations",
    ]
    for action in actions:
        grant_autonomy_approval(
            action=action,
            subject=f"subj_{action}",
            reviewer="pytest",
            state_dir=state_dir,
        )
    gate = ApprovalGate(state_dir=state_dir)
    for action in actions:
        record = gate.consume(action=action, subject=f"subj_{action}")
        assert record.action == action


def test_phase_10_gate_walk_no_approval_bypass_kwargs():
    """Public APIs MUST NOT expose skip_approval, consume_approval=False,
    require_approval=False, run_tests=False, or similar flags."""
    import inspect

    forbidden = {
        "skip_approval", "consume_approval", "require_approval",
        "run_tests", "_for_tests",
    }
    surfaces = [
        ApprovalGate.__init__,
        ApprovalGate.consume,
        ExperimentDesigner.design,
        SmokeRunner.run,
        ControlledSweepAgent.__init__,
        ControlledSweepAgent.launch,
        ScientificReviewer.review,
    ]
    for fn in surfaces:
        sig = inspect.signature(fn)
        leaks = forbidden & set(sig.parameters)
        assert not leaks, (
            f"{fn.__qualname__} exposes bypass kwarg(s): {leaks}"
        )


# ---------------------------------------------------------------------------
# Plan §22 — Scientific Accuracy Policy: missing-coefficient runs are
# `exploratory`, not `validated`.
# ---------------------------------------------------------------------------


def test_phase_10_gate_walk_no_validated_capsule_without_evidence():
    """An autonomous run that fabricated coefficients (or had any
    placeholder) MUST produce a capsule with status `exploratory`,
    never `validated`."""
    from simworkbench.autonomy.experiment_design import (
        capsule_status_for_plan,
    )

    plan = ExperimentDesigner().design(_spec())
    # If the plan flags any fabricated / placeholder coefficient, the
    # capsule status must be `exploratory`.
    plan_with_placeholder = plan.with_placeholder_coefficient(
        "rate_constant_k_AB"
    )
    assert capsule_status_for_plan(plan_with_placeholder) == "exploratory"

    # A plan with all real coefficients can be validated.
    assert capsule_status_for_plan(plan) in {"exploratory", "validated"}
