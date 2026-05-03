"""Phase 2C — Capsule fork integration test.

Forks a real capsule and confirms the new capsule's provenance chain
references the parent's source-aggregate hash, the diagnostics survive,
and ``user_edits/`` is byte-identical (no agent modification per
`agent_error_patterns.md`).
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.paths import simulation_capsules_root
from simworkbench.provenance import SourceRegistry, load_lock
from simworkbench.runtime import Runner
from simworkbench.serialization import (
    CapsuleValidator,
    fork_capsule,
    load_capsule,
    load_manifest,
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
def parent_capsule():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=8),
    )
    runner = Runner(exp)
    result = runner.run()
    base = simulation_capsules_root() / f"_pytest-fork-parent-{uuid.uuid4().hex[:8]}"
    base.mkdir(parents=True, exist_ok=True)
    capsule_dir = save_capsule(experiment=exp, result=result, base=base)
    # Plant some user_edits content so we can assert it survives unchanged.
    user_edits_file = capsule_dir / "src" / "user_edits" / "tweak.py"
    user_edits_file.write_text("# user-authored content\n")
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_fork_creates_new_capsule_with_parent_hash(parent_capsule):
    fork_dest_base = simulation_capsules_root() / f"_pytest-fork-child-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        fork = fork_capsule(parent_capsule, dst=fork_dest_base / "child")
        assert fork.is_dir()
        assert fork.suffix == ".lxp"

        # Manifest carries the parent hash.
        manifest = load_manifest(fork / "manifest.toml")
        parent_hash = SourceRegistry(parent_capsule).aggregate_hash()
        assert manifest.provenance.parent_capsule_hash == parent_hash

        # Provenance lock carries the same hash.
        lock = load_lock(fork / "provenance" / "provenance.lock")
        assert lock.parent_capsule_hash == parent_hash

        # Validator accepts the fork.
        report = CapsuleValidator().validate(fork)
        assert report.ok, f"Fork failed validation: {report.violations}"
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_fork_preserves_user_edits_byte_for_byte(parent_capsule):
    """Regression for `agent_error_patterns.md` "Overwriting <capsule>/src/
    user_edits/ during regeneration": fork must NOT modify user_edits."""
    fork_dest_base = simulation_capsules_root() / f"_pytest-fork-ue-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        original = (parent_capsule / "src" / "user_edits" / "tweak.py").read_bytes()
        fork = fork_capsule(parent_capsule, dst=fork_dest_base / "child")
        forked = (fork / "src" / "user_edits" / "tweak.py").read_bytes()
        assert forked == original
        # The source's user_edits is also untouched.
        assert (parent_capsule / "src" / "user_edits" / "tweak.py").read_bytes() == original
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_fork_preserves_diagnostics(parent_capsule):
    fork_dest_base = simulation_capsules_root() / f"_pytest-fork-diag-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        fork = fork_capsule(parent_capsule, dst=fork_dest_base / "child")
        loaded = load_capsule(fork)
        assert "A" in loaded.diagnostics
        assert "B" in loaded.diagnostics
        assert len(loaded.diagnostics["A"]) == 8
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_fork_starts_fresh_provenance(parent_capsule):
    """Fork must NOT copy parent's provenance/ — it starts a new chain."""
    fork_dest_base = simulation_capsules_root() / f"_pytest-fork-prov-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        fork = fork_capsule(parent_capsule, dst=fork_dest_base / "child")
        # The fork's agent_trace.md is freshly written and its only entry is
        # the fork action — not the parent's history.
        trace = (fork / "provenance" / "agent_trace.md").read_text()
        assert "action=`fork`" in trace
        # If the parent's trace had a "capsule saved" entry, it must NOT
        # appear in the fork's trace.
        assert "action=`capsule saved" not in trace
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_fork_refuses_existing_destination(parent_capsule):
    fork_dest_base = simulation_capsules_root() / f"_pytest-fork-conflict-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        first = fork_capsule(parent_capsule, dst=fork_dest_base / "child")
        assert first.exists()
        with pytest.raises(FileExistsError, match="already exists"):
            fork_capsule(parent_capsule, dst=fork_dest_base / "child")
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_fork_refuses_outside_workbench(parent_capsule, tmp_path):
    with pytest.raises(PermissionError, match="outside workbench"):
        fork_capsule(parent_capsule, dst=tmp_path / "external.lxp")
