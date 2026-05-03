"""Regression for `bugs_and_fixes/agent_error_patterns.md` "Archive
contains its own destination".

Phase-6 audit found that ``export_archive`` walked the capsule with
``rglob`` after creating the destination zip — when the destination
was inside the source (e.g. ``<capsule>/exports/<capsule>.zip``), the
in-flight archive captured itself. Now the exporter refuses any
target inside the source capsule.
"""

from __future__ import annotations

import shutil
import uuid
import zipfile

import pytest
from simworkbench.experiment import Experiment, RunConfig
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
from simworkbench.runtime import Runner
from simworkbench.serialization import save_capsule
from simworkbench.serialization.exporters import export_archive
from simworkbench.units import Q


@pytest.fixture
def saved_capsule():
    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="archive_demo", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e16, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(1.0e15, "1/m^3")),
        ],
        interactions=[
            Interaction(
                name="A_to_B",
                participants=["A", "B"],
                equation_refs=["eq"],
                coefficient_sources=["placeholder:k=1.0e7 1/s"],
            )
        ],
        equations=[Equation(id="eq", latex="dN/dt = -k N")],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )
    experiment = Experiment.from_model_spec(
        spec, run_config=RunConfig(start_time="0 s", end_time="10 ns", max_steps=4)
    )
    result = Runner(experiment, base_seed=0).run()
    name = f"_pytest_archive_{uuid.uuid4().hex[:8]}"
    capsule_dir = save_capsule(experiment=experiment, result=result, name=name)
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def test_export_refuses_target_inside_source(saved_capsule):
    """A destination inside the source capsule must be refused before
    any archive write."""
    bad_target = saved_capsule / "exports"
    with pytest.raises(ValueError, match="inside the source capsule"):
        export_archive(saved_capsule, bad_target)
    assert not (bad_target / f"{saved_capsule.name}.zip").exists()


def test_external_export_does_not_contain_itself(saved_capsule):
    """The canonical (default-target) export path produces an archive
    that does NOT contain a copy of itself."""
    archive = export_archive(saved_capsule)
    try:
        with zipfile.ZipFile(archive) as zf:
            names = zf.namelist()
        # No entry should match the archive's own filename anywhere in
        # the namelist (sanity check that the rglob exclude works even
        # when the archive lives in workbench-managed local_cache/).
        assert not any(name.endswith(archive.name) for name in names), (
            f"Archive {archive.name} captured itself in {names}"
        )
    finally:
        archive.unlink(missing_ok=True)
