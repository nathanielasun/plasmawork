"""Phase 2C — End-to-end export/round-trip integration tests.

Save a real capsule, export every kind, unzip the archive, confirm the
unzipped capsule still validates and reloads.
"""

from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.paths import simulation_capsules_root
from simworkbench.runtime import Runner
from simworkbench.serialization import (
    EXPORT_KINDS,
    CapsuleValidator,
    export_capsule,
    load_capsule,
    save_capsule,
)


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


@pytest.fixture
def saved_capsule():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=8),
    )
    runner = Runner(exp)
    result = runner.run()
    base = simulation_capsules_root() / f"_pytest-export-{uuid.uuid4().hex[:8]}"
    base.mkdir(parents=True, exist_ok=True)
    capsule_dir = save_capsule(experiment=exp, result=result, base=base)
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_export_all_kinds_produces_artifacts(saved_capsule, tmp_path):  # noqa: ARG001 — fixture provides setup
    target = simulation_capsules_root() / f"_pytest-target-{uuid.uuid4().hex[:8]}"
    target.mkdir(parents=True, exist_ok=True)
    try:
        result = export_capsule(saved_capsule, target)
        assert set(result.kinds) == set(EXPORT_KINDS)
        # code → src/
        assert (target / "src").is_dir()
        # data → data/, results/
        assert (target / "results").is_dir()
        # plots → results/plots/*.png
        plot_dir = target / "results" / "plots"
        assert any(p.suffix == ".png" for p in plot_dir.iterdir())
        # notebook
        assert any(target.glob("notebooks/*.ipynb"))
        # report
        assert (target / "REPORT.md").is_file()
        # archive
        archive = next(p for p in target.iterdir() if p.suffix == ".zip")
        assert archive.exists()
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_archive_roundtrip_unzips_to_a_valid_capsule(saved_capsule, tmp_path):
    target = simulation_capsules_root() / f"_pytest-archive-{uuid.uuid4().hex[:8]}"
    target.mkdir(parents=True, exist_ok=True)
    try:
        result = export_capsule(saved_capsule, target, kinds=("archive",))
        archive = result.paths["archive"][0]
        unzip_root = simulation_capsules_root() / f"_pytest-unzip-{uuid.uuid4().hex[:8]}"
        unzip_root.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(unzip_root)
            unzipped_capsule = next(p for p in unzip_root.iterdir() if p.suffix == ".lxp")
            report = CapsuleValidator().validate(unzipped_capsule)
            assert report.ok, f"Unzipped capsule failed validation: {report.violations}"
            loaded = load_capsule(unzipped_capsule)
            assert loaded.experiment.model_spec.model.name == "simple_rate_equations"
            assert "A" in loaded.diagnostics
        finally:
            shutil.rmtree(unzip_root, ignore_errors=True)
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_export_unknown_kind_raises(saved_capsule, tmp_path):  # noqa: ARG001
    target = simulation_capsules_root() / f"_pytest-bad-{uuid.uuid4().hex[:8]}"
    target.mkdir(parents=True, exist_ok=True)
    try:
        with pytest.raises(ValueError, match="Unknown export kind"):
            export_capsule(saved_capsule, target, kinds=("nonsense",))
    finally:
        shutil.rmtree(target, ignore_errors=True)
