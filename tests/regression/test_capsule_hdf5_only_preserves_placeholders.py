"""Regression for `bugs_and_fixes/agent_error_patterns.md` "Serializer
drops semantic fields when writing the canonical format".

Phase-2A made HDF5 the canonical bulk format; the JSON sidecar is
optional. The metadata previously stored only ``placeholder_used:
bool`` — the names came back from the JSON sidecar. An HDF5-only
capsule (no sidecar) lost the names on reload.

This test plants an HDF5-only capsule, reloads it, and asserts the
``placeholders`` list survives byte-for-byte.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

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
from simworkbench.serialization import load_capsule, save_capsule
from simworkbench.units import Q


@pytest.fixture
def hdf5_only_capsule():
    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="hdf5only", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e18, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(1.0e16, "1/m^3")),
        ],
        interactions=[
            Interaction(
                name="A_to_B",
                participants=["A", "B"],
                equation_refs=["eq"],
                coefficient_sources=["placeholder:k=1.0e7 1/s (regression)"],
            ),
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
    name = f"_pytest_hdf5only_{uuid.uuid4().hex[:8]}"
    capsule_dir = save_capsule(experiment=experiment, result=result, name=name)
    # Strip the JSON sidecar so the reload path goes through HDF5 only.
    json_path = capsule_dir / "results" / "diagnostics.json"
    if json_path.exists():
        json_path.unlink()
    try:
        yield capsule_dir, list(result.placeholders)
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def test_hdf5_only_reload_preserves_placeholder_names(hdf5_only_capsule):
    capsule_dir, original = hdf5_only_capsule
    # Confirm the JSON sidecar is gone — this is the audit's hostile fixture.
    assert not (capsule_dir / "results" / "diagnostics.json").exists()
    loaded = load_capsule(capsule_dir)
    assert loaded.placeholders == original, (
        f"HDF5-only capsule reload lost placeholder names. "
        f"Expected {original}, got {loaded.placeholders}."
    )


def test_save_writes_placeholders_list_to_hdf5_metadata(hdf5_only_capsule):
    """Direct check on the canonical format: the HDF5 attrs carry the
    full list, not just a bool."""
    from simworkbench.serialization.bulk_data import read_diagnostics_h5

    capsule_dir, original = hdf5_only_capsule
    h5_path = capsule_dir / "results" / "diagnostics.h5"
    _, meta = read_diagnostics_h5(h5_path)
    assert "placeholders" in meta
    placeholders = [p for p in meta["placeholders"] if p]
    assert placeholders == original, (
        f"HDF5 metadata 'placeholders' field disagrees with source. "
        f"Expected {original}, got {placeholders}."
    )
    _ = Path  # keep import used
