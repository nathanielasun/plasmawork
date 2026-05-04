"""Regressions for the Phase 8 post-close audit.

Pins the seven findings the audit caught (one critical, two high,
two medium, two low). Each test corresponds to one finding and
exercises the actual failure mode the audit reproduced.

See `bugs_and_fixes/bugfixes.md` 2026-05-04 *Phase 8 post-close audit*.
"""

from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path

import numpy as np
import pytest
import yaml
from simworkbench.experiment import BackendConfig, Experiment, RunConfig
from simworkbench.model_spec import (
    Geometry,
    Model,
    ModelSpec,
    Solvers,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.paths import temp_runs_root
from simworkbench.units import Q


def _spec() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="audit_probe", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )


# ---------------------------------------------------------------------------
# Finding 1 (critical) — backend lifecycle promotion repeats the old actor
# bypass. set_status must consume an approval token for validated/trusted,
# regardless of actor=.
# ---------------------------------------------------------------------------


def test_audit_set_status_actor_human_without_token_blocked():
    """Direct probe from the audit: actor='human' without a token
    must NOT promote python_cpu to validated."""
    from simworkbench.backends import (
        BackendApprovalError,
        BackendRegistry,
        BackendStatus,
    )

    src = Path("configs") / "backends.yaml"
    with tempfile.TemporaryDirectory() as td:
        cfg = Path(td) / "backends.yaml"
        shutil.copyfile(src, cfg)
        registry = BackendRegistry(config_path=cfg)
        # Demote to in_progress legally first so the transition is
        # in_progress → validated and the token gate can fire.
        registry.set_status("python_cpu", BackendStatus.IN_PROGRESS, actor="agent")
        with pytest.raises(BackendApprovalError, match="No human-approval token"):
            registry.set_status("python_cpu", BackendStatus.VALIDATED, actor="human")


def test_audit_set_status_with_token_succeeds():
    """The token-driven path still works."""
    from simworkbench.backends import (
        BackendRegistry,
        BackendStatus,
        grant_backend_approval,
    )

    src = Path("configs") / "backends.yaml"
    with tempfile.TemporaryDirectory() as td:
        cfg = Path(td) / "backends.yaml"
        shutil.copyfile(src, cfg)
        registry = BackendRegistry(config_path=cfg)
        registry.set_status("python_cpu", BackendStatus.IN_PROGRESS, actor="agent")
        grant_backend_approval(
            "python_cpu",
            from_status="in_progress",
            to_status="validated",
            reviewer="pytest",
        )
        promoted = registry.set_status(
            "python_cpu", BackendStatus.VALIDATED, actor="human"
        )
        assert promoted.status is BackendStatus.VALIDATED


def test_audit_set_status_token_is_single_use():
    """A token consumed once cannot be reused for a second promotion."""
    from simworkbench.backends import (
        BackendApprovalError,
        BackendRegistry,
        BackendStatus,
        grant_backend_approval,
    )

    src = Path("configs") / "backends.yaml"
    with tempfile.TemporaryDirectory() as td:
        cfg = Path(td) / "backends.yaml"
        shutil.copyfile(src, cfg)
        registry = BackendRegistry(config_path=cfg)
        registry.set_status("python_cpu", BackendStatus.IN_PROGRESS, actor="agent")
        grant_backend_approval(
            "python_cpu",
            from_status="in_progress",
            to_status="validated",
            reviewer="pytest",
        )
        # First promotion consumes the token.
        registry.set_status("python_cpu", BackendStatus.VALIDATED, actor="human")
        # Demote and try to re-promote — token is gone, should refuse.
        registry.set_status("python_cpu", BackendStatus.IN_PROGRESS, actor="agent")
        with pytest.raises(BackendApprovalError):
            registry.set_status("python_cpu", BackendStatus.VALIDATED, actor="human")


# ---------------------------------------------------------------------------
# Finding 2 (high) — backend metadata status not validated at load.
# ---------------------------------------------------------------------------


def test_audit_invalid_status_rejected_at_load(tmp_path):
    """An unknown ``status`` value must fail at registry load, not
    later when ``.status`` is accessed."""
    from simworkbench.backends import BackendRegistry, BackendRegistryError

    cfg = tmp_path / "bad.yaml"
    cfg.write_text(
        "\n".join(
            [
                "backends:",
                "  - name: foo",
                "    status: totally_invalid",
                "    supports:",
                "      domains: [species]",
                "      geometries: [0]",
                "",
            ]
        ),
        encoding="utf-8",
    )
    with pytest.raises(BackendRegistryError, match="Invalid backend metadata"):
        BackendRegistry(config_path=cfg)


# ---------------------------------------------------------------------------
# Finding 3 (high) — CUDA/non-registered backend determinism falsely true.
# ---------------------------------------------------------------------------


def test_audit_cuda_capsule_determinism_reads_false():
    """``cuda`` is registered in BackendRegistry as deterministic=false
    but is NOT auto-registered with the runtime. The capsule writer
    must consult BackendRegistry as a fallback and stamp the correct
    flag."""
    from simworkbench.serialization.capsule import _resolve_backend_determinism

    determinism, warning = _resolve_backend_determinism("cuda")
    assert determinism is False
    assert warning, "cuda should surface a determinism warning"


def test_audit_python_cpu_capsule_determinism_reads_true():
    """python_cpu is the deterministic baseline."""
    from simworkbench.serialization.capsule import _resolve_backend_determinism

    determinism, warning = _resolve_backend_determinism("python_cpu")
    assert determinism is True
    assert warning == ""


def test_audit_unknown_backend_refuses_save():
    """A backend the registry doesn't know either: save must refuse
    rather than default-true."""
    from simworkbench.serialization.capsule import (
        CapsuleSaveError,
        _resolve_backend_determinism,
    )

    with pytest.raises(CapsuleSaveError):
        _resolve_backend_determinism("not_a_real_backend_xyz")


# ---------------------------------------------------------------------------
# Finding 4 (medium) — recommend ignores lifecycle status.
# ---------------------------------------------------------------------------


def test_audit_recommend_filters_to_validated_by_default():
    """Default ``recommend(spec)`` returns only validated/trusted
    backends. Earlier the audit found planned/in_progress backends
    appeared in the result."""
    from simworkbench.backends import BackendRegistry

    registry = BackendRegistry()
    candidates = [r.name for r in registry.recommend(_spec())]
    # python_cpu is validated; it must be present.
    assert "python_cpu" in candidates
    # planned backends must not be in the default recommendation.
    forbidden = {"fortran", "cuda", "kokkos", "petsc", "amrex"}
    leaked = forbidden & set(candidates)
    assert not leaked, (
        f"Default recommend leaked planned backends: {leaked}. The "
        "selection_policy in configs/backends.yaml says auto filters "
        "to validated/trusted."
    )


def test_audit_recommend_explicit_include_widens_selection():
    """Callers who explicitly want broader candidates can pass an
    empty ``include_statuses`` (= every status) or a custom set.

    Use a 2D PDE spec so several planned/in_progress backends from
    configs/backends.yaml actually match the capability filter
    (cpp, fortran, kokkos, petsc, amrex all advertise 2D PDE
    support but ship at planned / in_progress).
    """
    from simworkbench.backends import BackendRegistry, BackendSupports

    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="audit_pde", domain="pde"),
        geometry=Geometry(
            dimensionality=2,
            domain_bounds={
                "x": [Q(0, "meter"), Q(1, "meter")],
                "y": [Q(0, "meter"), Q(1, "meter")],
            },
            boundary_conditions=[
                {"name": "bc_x", "kind": "periodic"},
                {"name": "bc_y", "kind": "periodic"},
            ],
        ),
        species=[Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )

    registry = BackendRegistry()
    default_recs = {r.name for r in registry.recommend(spec)}
    everything = {
        r.name for r in registry.recommend(spec, include_statuses=frozenset())
    }
    # Empty set means "no filter" → broader OR equal candidate list.
    assert everything >= default_recs
    # And at least one backend that's NOT validated/trusted shows up
    # in the broader recommendation (e.g. cpp is in_progress + 2D PDE).
    new_candidates = everything - default_recs
    assert new_candidates, (
        "Explicit include_statuses=frozenset() didn't widen the "
        f"candidate set. default={default_recs!r} all={everything!r}"
    )
    _ = BackendSupports  # silence unused import (kept for future tests)


# ---------------------------------------------------------------------------
# Finding 5 (medium) — HPC/external writers skip locality checks.
# ---------------------------------------------------------------------------


def test_audit_slurm_refuses_non_workbench_target(tmp_path):
    """SlurmJob.write must refuse a target outside the workbench-
    managed roots when require_workbench_target=True (default)."""
    from simworkbench.hpc import SlurmJob

    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=1),
        backend_config=BackendConfig(name="python_cpu"),
    )
    job = SlurmJob(
        experiment=experiment,
        partition="batch",
        time_limit="01:00:00",
    )
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        job.write(tmp_path / "sneaky_bundle")


def test_audit_external_pic_refuses_non_workbench_target(tmp_path):
    """StubPICAdapter writers must refuse non-workbench destinations."""
    from packages.solver_backends.external_pic import StubPICAdapter

    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec, run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=1)
    )
    adapter = StubPICAdapter()
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        adapter.write_input_deck(experiment, tmp_path / "sneaky_deck")
    with pytest.raises(PermissionError, match="workbench-managed roots"):
        adapter.import_result("stub-job::x", target_capsule=tmp_path / "sneaky_capsule")


def test_audit_slurm_explicit_external_target_works(tmp_path):
    """The locality guard has an explicit opt-out for users who chose
    an external destination via the orchestrator UI/CLI."""
    from simworkbench.hpc import SlurmJob

    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=1),
        backend_config=BackendConfig(name="python_cpu"),
    )
    job = SlurmJob(experiment=experiment, partition="batch", time_limit="01:00:00")
    bundle = job.write(
        tmp_path / "external_bundle", require_workbench_target=False
    )
    assert (bundle / "submit.sh").is_file()


# ---------------------------------------------------------------------------
# Finding 6 (low) — axpy claims in-place mutation but copied non-contiguous y.
# ---------------------------------------------------------------------------


def test_audit_axpy_refuses_strided_y():
    """``axpy(a, x, y)`` advertises in-place mutation but the earlier
    implementation called ``np.ascontiguousarray(y)`` which silently
    copied non-contiguous arrays — the caller's view never updated.
    The fix raises rather than silently copy."""
    from packages.solver_backends.cpp import axpy

    base = np.zeros(6, dtype=np.float64)
    y_view = base[::2]  # non-contiguous strided view
    x = np.ones(3, dtype=np.float64)
    with pytest.raises(ValueError, match="contiguous"):
        axpy(2.0, x, y_view)


def test_audit_axpy_refuses_strided_x():
    """Symmetric guard: x must also be contiguous (the C++ kernel
    interprets the buffer as packed float64)."""
    from packages.solver_backends.cpp import axpy

    base = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0], dtype=np.float64)
    x_view = base[::2]  # non-contiguous
    y = np.zeros(3, dtype=np.float64)
    with pytest.raises(ValueError, match="contiguous"):
        axpy(2.0, x_view, y)


def test_audit_axpy_contiguous_path_still_works():
    """Sanity check: the contiguous in-place path is unchanged."""
    from packages.solver_backends.cpp import axpy

    x = np.array([1.0, 2.0, 3.0], dtype=np.float64)
    y = np.array([10.0, 20.0, 30.0], dtype=np.float64)
    axpy(2.0, x, y)
    np.testing.assert_array_equal(y, [12.0, 24.0, 36.0])


# ---------------------------------------------------------------------------
# Finding 7 (low) — Slurm bundle docstring accuracy.
# ---------------------------------------------------------------------------


def test_audit_slurm_docstring_explains_remote_python_dependency():
    """The earlier docstring called the bundle 'self-contained' without
    qualification; the runner actually needs simworkbench-core
    available on the remote node. The fixed docstring spells this out.
    """
    from simworkbench.hpc import slurm

    body = (slurm.__doc__ or "").lower()
    # Mentions PYTHONPATH / install / pip explicitly so a reviewer
    # reading the module knows the bundle's actual contract.
    assert "pythonpath" in body or "pip install" in body or "simworkbench_core_path" in body
    # And documents the audit lesson reference.
    assert "self-contained" in body  # still uses the word, but qualified


# ---------------------------------------------------------------------------
# Use temp_runs_root() in the audit-write probe so the test doesn't
# depend on the host's tmpdir being inside a workbench root.
# ---------------------------------------------------------------------------


def test_audit_slurm_workbench_root_target_works():
    """Writing under ``temp_runs/`` succeeds (it's a workbench-managed
    root)."""
    from simworkbench.hpc import SlurmJob

    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=1),
        backend_config=BackendConfig(name="python_cpu"),
    )
    job = SlurmJob(experiment=experiment, partition="batch", time_limit="01:00:00")
    bundle_root = temp_runs_root() / f"_pytest_audit_slurm_{uuid.uuid4().hex[:8]}"
    try:
        bundle = job.write(bundle_root / "ok_bundle")
        assert (bundle / "submit.sh").is_file()
    finally:
        shutil.rmtree(bundle_root, ignore_errors=True)


# ---------------------------------------------------------------------------
# configs/backends.yaml validation status round-trips through Pydantic.
# ---------------------------------------------------------------------------


def test_audit_backends_yaml_status_field_rejects_unknown():
    """Belt-and-suspenders: load the real config and confirm every
    declared status is in the BackendStatus enum."""
    from simworkbench.backends import BackendStatus
    from simworkbench.paths import repo_root

    config = yaml.safe_load(
        (repo_root() / "configs" / "backends.yaml").read_text(encoding="utf-8")
    )
    valid = {s.value for s in BackendStatus}
    for entry in config["backends"]:
        assert entry["status"] in valid, (
            f"Backend {entry['name']!r} has out-of-enum status "
            f"{entry['status']!r}; allowed: {sorted(valid)}"
        )
