"""Phase 1 capsule save/reload — Phase Gate items 4 and 5.

The plan §Phase 1 Gate (line 1772) requires "Save it as a capsule" and
"Reload it" for closure. These tests demonstrate a full round-trip on the
example simple-rate-equations spec.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.runtime import Runner
from simworkbench.serialization import (
    CAPSULE_FORMAT_VERSION,
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


def _run_example(max_steps: int = 10) -> tuple[Experiment, object]:
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=max_steps),
    )
    runner = Runner(exp)
    result = runner.run()
    return exp, result


@pytest.fixture
def capsule_scratch():
    """Per-test scratch directory under simulation_capsules_root().

    Capsules must live under the four allowed workbench roots
    (`agent_error_patterns.md` "Writing program artifacts outside the
    project directory"). This fixture creates a unique scratch under the
    real `simulation_capsules/` root and cleans it up after the test.
    """
    import shutil
    import uuid

    from simworkbench.paths import simulation_capsules_root

    scratch = simulation_capsules_root() / f"_pytest-{uuid.uuid4().hex[:8]}"
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        yield scratch
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def test_save_capsule_writes_required_subtree(capsule_scratch):
    exp, result = _run_example()
    capsule_dir = save_capsule(experiment=exp, result=result, base=capsule_scratch)
    # Validate the .lxp directory shape per plan §7.1 (Phase 1 subset).
    assert capsule_dir.is_dir()
    assert capsule_dir.suffix == ".lxp"
    assert (capsule_dir / "manifest.toml").is_file()
    assert (capsule_dir / "model" / "model_spec.yaml").is_file()
    assert (capsule_dir / "configs" / "run_config.yaml").is_file()
    assert (capsule_dir / "results" / "diagnostics.json").is_file()
    assert (capsule_dir / "provenance" / "provenance.lock").is_file()
    assert (capsule_dir / "provenance" / "agent_trace.md").is_file()
    assert (capsule_dir / "README.md").is_file()
    # Phase-2-deferred subdirs exist as empty placeholders (with .gitkeep).
    deferred = (
        "paper_sources",
        "src/generated",
        "src/user_edits",
        "data",
        "validation",
        "notebooks",
    )
    for empty in deferred:
        assert (capsule_dir / empty).is_dir()
        assert (capsule_dir / empty / ".gitkeep").is_file()


def test_load_capsule_returns_experiment_and_diagnostics(capsule_scratch):
    exp, result = _run_example(max_steps=20)
    capsule_dir = save_capsule(experiment=exp, result=result, base=capsule_scratch)
    loaded = load_capsule(capsule_dir)

    assert loaded.format_version == CAPSULE_FORMAT_VERSION
    # The reloaded experiment matches the saved one.
    assert loaded.experiment.model_spec.model.name == exp.model_spec.model.name
    assert loaded.experiment.run_config.start_time.dimensionality == \
        exp.run_config.start_time.dimensionality
    assert loaded.experiment.backend_config.name == exp.backend_config.name
    # Diagnostics survived round-trip.
    assert "A" in loaded.diagnostics
    assert "B" in loaded.diagnostics
    assert len(loaded.diagnostics["A"]) == 20
    # Placeholder propagation.
    assert loaded.placeholders == list(result.placeholders)
    assert loaded.final_simulation_time == pytest.approx(result.final_simulation_time)


def test_save_capsule_refuses_paths_outside_workbench(tmp_path):
    """`tmp_path` is pytest's scratch dir — outside the four allowed workbench
    roots. ``save_capsule`` must refuse, AND must not create the capsule
    directory on disk (`agent_error_patterns.md` "Side-effecting before
    validating")."""
    # Build a capsule path that's clearly outside the workbench: tmp_path
    # under /private/var (macOS) or /tmp (Linux). Adjust the base so the
    # validator triggers — pass an absolute base under /tmp directly.
    forbidden = Path("/tmp/should-not-be-created-by-capsule-test.lxp")
    exp, result = _run_example()
    with pytest.raises(PermissionError, match="outside workbench"):
        save_capsule(
            experiment=exp,
            result=result,
            name=forbidden.stem,
            base=Path("/tmp"),
        )
    # No directory created.
    assert not forbidden.exists()


def test_round_trip_to_simulation_capsules_root_matches_default_layout():
    """End-to-end Phase Gate items 4 and 5: save into the canonical
    simulation_capsules/ root and reload from there."""
    from simworkbench.paths import simulation_capsules_root

    exp, result = _run_example(max_steps=5)
    capsule_dir = save_capsule(experiment=exp, result=result)
    try:
        # The default save lands under <repo>/simulation_capsules/<name>.lxp.
        assert simulation_capsules_root() in capsule_dir.parents
        loaded = load_capsule(capsule_dir)
        assert loaded.experiment.model_spec.model.name == exp.model_spec.model.name
        assert "A" in loaded.diagnostics
    finally:
        # Cleanup so subsequent tests don't see this leftover.
        import shutil

        shutil.rmtree(capsule_dir, ignore_errors=True)


def test_load_capsule_rejects_unknown_format_version(tmp_path):
    capsule_dir = tmp_path / "broken.lxp"
    capsule_dir.mkdir()
    (capsule_dir / "manifest.toml").write_text(
        '[capsule]\nname = "broken"\nformat_version = "99.0"\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Unsupported capsule format_version"):
        load_capsule(capsule_dir)


def test_load_capsule_rejects_missing_directory(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_capsule(tmp_path / "no-such-capsule.lxp")
