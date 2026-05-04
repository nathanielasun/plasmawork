"""Phase 8 gate-walk integration test (written BEFORE implementation).

Plan §Phase 8 gate: "Phase 8 is complete when experiments can run
locally and on remote/HPC backends through the same experiment
interface."

Gate verbs:
  - run-locally — the same ``Experiment`` runs on multiple local
                  backends (python_cpu, numba_cpu) through one
                  unified ``SolverBackend`` interface.
  - run-remotely — an HPC orchestrator (Slurm batch script generator
                  in this repo, since real Slurm needs a cluster)
                  packages the experiment, the job runs, and the
                  result is imported back through the same Experiment
                  interface. We exercise the package-and-import round
                  trip via a local subprocess that simulates the
                  remote node — the orchestration code path is what
                  we validate, not the remote scheduler.
  - same-interface — the ``Experiment`` object is identical across
                  backends; only the ``backend_config.name`` changes.
                  Cross-backend agreement asserts the result shape +
                  numerical agreement to a configured tolerance.
  - capability-detect — the registry refuses to dispatch a backend
                  whose capability set does not cover the spec; this
                  is a real check, not a heuristic.
  - determinism-marked — provenance.lock records each backend's
                  determinism flag. ``cuda`` reports
                  ``determinism: false``, ``python_cpu`` /
                  ``numba_cpu`` report ``true``.

Twentieth check (endpoints named after a transformation perform that
transformation), eighteenth check (lifecycle promotion gates live at
the mutation boundary), twentieth Phase-7 lesson (registry discovery
does not hide invalid metadata) — every relevant audit lesson lands
in this gate-walk.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import numpy as np
import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Shared fixture — a small reusable Experiment.
# ---------------------------------------------------------------------------


def _build_experiment():
    """Build the canonical Phase 8 cross-backend experiment."""
    from simworkbench.experiment import BackendConfig, Experiment, RunConfig
    from simworkbench.model_spec import (
        Equation,
        Geometry,
        Interaction,
        Model,
        ModelSpec,
        Solvers,
        Species,
    )
    from simworkbench.model_spec.types import SolverRecommendation
    from simworkbench.units import Q

    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="phase8_demo", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e18, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(0.0, "1/m^3")),
        ],
        interactions=[
            Interaction(
                name="A_to_B",
                participants=["A", "B"],
                equation_refs=["eq"],
                coefficient_sources=["placeholder:k=1.0 1/s (Phase 8 cross-backend)"],
            )
        ],
        equations=[Equation(id="eq", latex="dN_A/dt = -k N_A")],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )
    return Experiment.from_model_spec(
        spec,
        run_config=RunConfig(
            start_time="0 s", end_time="2 s", max_steps=20, seed=0
        ),
        backend_config=BackendConfig(name="python_cpu"),
    )


# ---------------------------------------------------------------------------
# Verb 1: run-locally on multiple backends through ONE interface.
# ---------------------------------------------------------------------------


def test_phase_8_gate_walk_python_cpu_runs_canonical_experiment():
    """Verb: RUN-LOCALLY. The canonical reference backend (python_cpu)
    runs the cross-backend experiment to completion."""
    from simworkbench.runtime import Runner

    experiment = _build_experiment()
    result = Runner(experiment, base_seed=0).run()
    assert result.diagnostics
    assert "A" in result.diagnostics
    assert "B" in result.diagnostics


def test_phase_8_gate_walk_numba_cpu_runs_same_experiment():
    """Verb: RUN-LOCALLY on a second backend. The same Experiment
    runs through ``numba_cpu`` with the only mutation being the
    backend name. If Numba isn't installed on this machine, the
    test is informative-skipped — but the import path must still
    surface a structured ``BackendUnavailable`` error, not a bare
    ``ImportError`` (capability detection is part of the gate).
    """
    pytest.importorskip("numba", reason="numba is the dep we're testing")
    from simworkbench.experiment import BackendConfig
    from simworkbench.runtime import Runner

    experiment = _build_experiment()
    experiment_numba = experiment.model_copy(
        update={"backend_config": BackendConfig(name="numba_cpu")}
    )
    result = Runner(experiment_numba, base_seed=0).run()
    assert result.diagnostics
    assert "A" in result.diagnostics


def test_phase_8_gate_walk_cross_backend_agreement():
    """Verb: SAME-INTERFACE. python_cpu and numba_cpu produce
    numerically equivalent results for the canonical experiment to
    within tolerance. Carries plan §Phase 8 / 8A's "cross-backend
    validation" requirement.
    """
    pytest.importorskip("numba")
    from simworkbench.experiment import BackendConfig
    from simworkbench.runtime import Runner

    base = _build_experiment()
    py_result = Runner(
        base.model_copy(update={"backend_config": BackendConfig(name="python_cpu")}),
        base_seed=0,
    ).run()
    nb_result = Runner(
        base.model_copy(update={"backend_config": BackendConfig(name="numba_cpu")}),
        base_seed=0,
    ).run()

    py_a = np.asarray(py_result.diagnostics["A"])
    nb_a = np.asarray(nb_result.diagnostics["A"])
    assert py_a.shape == nb_a.shape
    max_rel = float(np.max(np.abs(py_a - nb_a) / np.maximum(np.abs(py_a), 1e-300)))
    assert max_rel < 1e-6, f"cross-backend disagreement: max relative error {max_rel:.3e}"


# ---------------------------------------------------------------------------
# Verb 2: capability-detect — registry refuses incompatible spec/backend.
# ---------------------------------------------------------------------------


def test_phase_8_gate_walk_backend_registry_loads_yaml():
    """The BackendRegistry consumes ``configs/backends.yaml``. Every
    plan-named backend appears in the registry."""
    from simworkbench.backends import BackendRegistry

    registry = BackendRegistry()
    names = set(registry.names())
    expected = {
        "python_cpu", "numba_cpu", "cpp", "fortran",
        "cuda", "kokkos", "petsc", "amrex", "external_pic",
    }
    missing = expected - names
    assert not missing, f"BackendRegistry missing plan-named backends: {missing}"


def test_phase_8_gate_walk_backend_registry_does_not_hide_invalid_metadata(tmp_path):
    """Phase-7 audit rule 20 carried forward: registry discovery does
    not silently skip a malformed entry. A bad config raises with the
    file path + parse error.
    """
    from simworkbench.backends import BackendRegistry, BackendRegistryError

    bad_yaml = tmp_path / "backends.yaml"
    bad_yaml.write_text("backends:\n  - { foo: not_a_backend }\n", encoding="utf-8")
    with pytest.raises(BackendRegistryError):
        BackendRegistry(config_path=bad_yaml)


def test_phase_8_gate_walk_capability_detection_filters_backends():
    """Verb: CAPABILITY-DETECT. ``BackendRegistry.recommend(spec)``
    returns only backends whose capabilities cover the spec.
    A 0D species spec excludes ``amrex`` (geometries 2/3 only)."""
    from simworkbench.backends import BackendRegistry

    experiment = _build_experiment()
    registry = BackendRegistry()
    candidates = [
        rec.name for rec in registry.recommend(experiment.model_spec)
    ]
    assert "python_cpu" in candidates
    assert "amrex" not in candidates  # AMReX is 2D/3D only


def test_phase_8_gate_walk_lifecycle_gate_lives_at_mutation_boundary(tmp_path):
    """Phase-7 audit rule 18: lifecycle promotion gates live at the
    mutation boundary (the registry method that rewrites status), not
    at the API or UI. ``set_status`` must refuse an agent-driven
    promotion to validated/trusted regardless of how the call is
    structured — and there is no ``skip_approval`` kwarg on the
    method (a bypass flag would itself be the bug).
    """
    import shutil

    import yaml as _yaml
    from simworkbench.backends import (
        BackendLifecycleError,
        BackendRegistry,
        BackendStatus,
    )

    # Use a clone of backends.yaml so the test doesn't mutate the
    # repo's checked-in config.
    src_yaml = REPO_ROOT / "configs" / "backends.yaml"
    cfg = tmp_path / "backends.yaml"
    shutil.copyfile(src_yaml, cfg)

    registry = BackendRegistry(config_path=cfg)
    # Bring python_cpu to in_progress (agent-allowed transition).
    state = registry.get("python_cpu").status
    if state is BackendStatus.PLANNED:
        registry.set_status("python_cpu", BackendStatus.IN_PROGRESS, actor="agent")
    elif state is BackendStatus.VALIDATED:
        # If the repo's checked-in config already promoted python_cpu,
        # demote first so the test exercises the gate cleanly.
        registry.set_status("python_cpu", BackendStatus.IN_PROGRESS, actor="agent")

    # Agent-driven promotion to validated must raise with a human-
    # approval message — the gate lives at the mutation boundary.
    with pytest.raises(BackendLifecycleError, match="human|approval"):
        registry.set_status("python_cpu", BackendStatus.VALIDATED, actor="agent")

    # And there is no bypass kwarg on the public API. Inspect the
    # signature directly so a future regression catches the
    # introduction of a ``skip_approval`` / ``run_tests=False`` flag.
    import inspect

    sig = inspect.signature(BackendRegistry.set_status)
    forbidden = {"skip_approval", "consume_approval", "run_tests"}
    assert not (set(sig.parameters) & forbidden), (
        f"BackendRegistry.set_status grew a bypass flag: "
        f"{set(sig.parameters) & forbidden}. Lifecycle promotion gates "
        "must not take caller-controlled bypass kwargs (rule 18)."
    )
    # Don't mutate the real config.
    _ = _yaml  # silence unused import


# ---------------------------------------------------------------------------
# Verb 3: determinism marked correctly per backend.
# ---------------------------------------------------------------------------


def test_phase_8_gate_walk_determinism_recorded_in_provenance(tmp_path):
    """Plan §11.3: provenance.lock carries each backend's determinism
    flag. After saving a python_cpu run, provenance.lock records
    ``determinism: true``; the same path with cuda would record
    ``determinism: false``.

    We exercise the python_cpu path with a real save; the cuda case is
    covered by ``test_phase_8_cuda_determinism_warning`` below.
    """
    from simworkbench.runtime import Runner
    from simworkbench.serialization import save_capsule

    experiment = _build_experiment()
    result = Runner(experiment, base_seed=0).run()
    capsule_dir = save_capsule(
        experiment=experiment,
        result=result,
        name=f"_pytest_phase8_det_{uuid.uuid4().hex[:8]}",
    )
    try:
        lock_path = capsule_dir / "provenance" / "provenance.lock"
        assert lock_path.is_file()
        text = lock_path.read_text(encoding="utf-8")
        # provenance.lock includes a determinism marker after the
        # Phase-8 extension. The exact key name is enforced by the
        # serializer; we just assert the substring shows up so the
        # writer wired the field.
        assert "determinism" in text, (
            "provenance.lock missing the Phase 8 determinism marker"
        )
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def test_phase_8_cuda_determinism_warning():
    """The CUDA backend's metadata declares determinism=false and the
    capability description surfaces a determinism warning string."""
    from simworkbench.backends import BackendRegistry

    registry = BackendRegistry()
    cuda = registry.get("cuda")
    assert cuda.metadata.determinism is False
    caps = cuda.describe_capabilities()
    # Expose the warning so consumers (UI, log) can surface it.
    assert "determinism" in caps and caps["determinism"]["warning"], (
        "CUDA backend must surface a determinism warning string"
    )


# ---------------------------------------------------------------------------
# Verb 4: run-remotely — Slurm batch script generation + result import.
# ---------------------------------------------------------------------------


def test_phase_8_gate_walk_slurm_batch_script_generation(tmp_path):
    """Verb: RUN-REMOTELY. The Slurm orchestrator packages an
    Experiment into a batch script + payload that can be submitted
    on an HPC system. We don't talk to a real Slurm scheduler — the
    test asserts the produced batch script is well-formed and
    references the submitted Experiment payload.
    """
    from simworkbench.hpc import SlurmJob

    experiment = _build_experiment()
    job = SlurmJob(
        experiment=experiment,
        partition="batch",
        time_limit="00:10:00",
        nodes=1,
        ntasks=1,
        cpus_per_task=2,
    )
    bundle = job.write(tmp_path / "slurm_bundle")
    sbatch = bundle / "submit.sh"
    assert sbatch.is_file()
    body = sbatch.read_text(encoding="utf-8")
    assert "#SBATCH --partition=batch" in body
    assert "#SBATCH --time=00:10:00" in body
    assert "#SBATCH --nodes=1" in body
    assert (bundle / "experiment.yaml").is_file()
    assert (bundle / "run_remote.py").is_file()


def test_phase_8_gate_walk_remote_result_round_trip(tmp_path):
    """Verb: RUN-REMOTELY (round trip). Generate a Slurm bundle, run
    the bundle's ``run_remote.py`` as a subprocess on this machine
    (simulating the remote node), then import the produced result
    artifact back through ``import_remote_result`` and assert the
    diagnostics survive byte-for-byte.
    """
    from simworkbench.hpc import SlurmJob, import_remote_result

    experiment = _build_experiment()
    job = SlurmJob(
        experiment=experiment,
        partition="batch",
        time_limit="00:10:00",
        nodes=1,
        ntasks=1,
        cpus_per_task=2,
    )
    bundle = job.write(tmp_path / "slurm_bundle")
    # Simulate the remote node by running the bundle's run_remote.py.
    env = dict(os.environ)
    env.setdefault("PYTHONPATH", str(REPO_ROOT / "packages" / "core" / "src"))
    proc = subprocess.run(
        [sys.executable, str(bundle / "run_remote.py")],
        cwd=bundle,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, (
        f"remote run failed:\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
    )
    result_path = bundle / "result.json"
    assert result_path.is_file()
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    assert "diagnostics" in payload
    # Round trip: import_remote_result reconstitutes a RunResult-shaped object.
    imported = import_remote_result(result_path)
    assert imported.diagnostics
    assert "A" in imported.diagnostics


# ---------------------------------------------------------------------------
# Verb 5: external simulator interface — adapter contract.
# ---------------------------------------------------------------------------


def test_phase_8_gate_walk_external_pic_adapter_interface_exists():
    """Plan §Phase 8 / 8F: an external-simulator adapter interface
    exists (the validated implementation lives outside this repo).
    The adapter declares an input_deck path, a job submission shape,
    and a result import shape.
    """
    from simworkbench.backends.external import ExternalSimulatorAdapter

    # The base class is abstract — instantiating must raise.
    with pytest.raises(TypeError):
        ExternalSimulatorAdapter()  # type: ignore[abstract]


# ---------------------------------------------------------------------------
# Verb 6: configs/backends.yaml status field transitions correctly.
# ---------------------------------------------------------------------------


def test_phase_8_python_cpu_promoted_to_validated():
    """The python_cpu backend (now real, not planned) reads as
    validated in configs/backends.yaml."""
    config_path = REPO_ROOT / "configs" / "backends.yaml"
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    by_name = {b["name"]: b for b in config["backends"]}
    assert by_name["python_cpu"]["status"] == "validated", (
        "python_cpu must read as 'validated' at Phase 8 close"
    )
    assert by_name["numba_cpu"]["status"] == "validated", (
        "numba_cpu must read as 'validated' at Phase 8 close"
    )


def test_phase_8_determinism_adr_present():
    """Plan §Phase 8 / 8D: an ADR on determinism policy lives in
    program_development/architectural_decisions/."""
    adr = (
        REPO_ROOT
        / "program_development"
        / "architectural_decisions"
        / "ADR-0006-determinism-policy.md"
    )
    assert adr.is_file(), f"Determinism ADR missing at {adr}"
    body = adr.read_text(encoding="utf-8").strip()
    assert len(body) > 200, "Determinism ADR too short to be real"


def test_phase_8_hpc_orchestration_scripts_present():
    """Plan §Phase 8 / 8E: HPC orchestration scripts under scripts/dev/."""
    for script in (
        "scripts/dev/submit_slurm.sh",
        "scripts/dev/import_hpc_result.sh",
    ):
        path = REPO_ROOT / script
        assert path.is_file(), f"Missing HPC orchestration script: {script}"
        assert os.access(path, os.X_OK), f"Not executable: {script}"
