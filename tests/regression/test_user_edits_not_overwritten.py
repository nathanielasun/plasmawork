"""Phase 2C regression — `<capsule>/src/user_edits/` is never overwritten.

Encodes the long-standing rule from `agent_error_patterns.md`:

    Overwriting `<capsule>/src/user_edits/` during regeneration

Across the operations Phase 2 introduces:
- ``simworkbench.serialization.fork.fork_capsule``
- ``simworkbench.serialization.exporters.code.export_code``
- ``simworkbench.provenance.AgentTraceWriter`` (refuses log entries naming
  user_edits/)

…``user_edits/`` content must survive byte-for-byte. This file is the
single regression that protects the invariant against future refactors.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.paths import simulation_capsules_root
from simworkbench.provenance import AgentTraceError, AgentTraceWriter
from simworkbench.runtime import Runner
from simworkbench.serialization import fork_capsule, save_capsule
from simworkbench.serialization.exporters.code import export_code

USER_EDITS_FIXTURE = "# user-authored content — must survive every operation\n"


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


@pytest.fixture
def parent_capsule_with_user_edit():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=5),
    )
    runner = Runner(exp)
    result = runner.run()
    base = simulation_capsules_root() / f"_pytest-ue-{uuid.uuid4().hex[:8]}"
    base.mkdir(parents=True, exist_ok=True)
    capsule_dir = save_capsule(experiment=exp, result=result, base=base)
    user_file = capsule_dir / "src" / "user_edits" / "tweak.py"
    user_file.write_text(USER_EDITS_FIXTURE)
    try:
        yield capsule_dir, user_file
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_fork_does_not_modify_source_user_edits(parent_capsule_with_user_edit):
    capsule, user_file = parent_capsule_with_user_edit
    fork_dest_base = simulation_capsules_root() / f"_pytest-ue-fork-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        before = user_file.read_text()
        fork_capsule(capsule, dst=fork_dest_base / "child")
        after = user_file.read_text()
        assert after == before == USER_EDITS_FIXTURE
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_export_code_does_not_modify_source_user_edits(parent_capsule_with_user_edit, tmp_path):
    capsule, user_file = parent_capsule_with_user_edit
    target = simulation_capsules_root() / f"_pytest-ue-export-{uuid.uuid4().hex[:8]}"
    target.mkdir(parents=True, exist_ok=True)
    try:
        before = user_file.read_text()
        export_code(capsule, target)
        after = user_file.read_text()
        assert after == before == USER_EDITS_FIXTURE
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_fork_preserves_user_edits_in_destination(parent_capsule_with_user_edit):
    capsule, _ = parent_capsule_with_user_edit
    fork_dest_base = simulation_capsules_root() / f"_pytest-ue-dest-{uuid.uuid4().hex[:8]}"
    fork_dest_base.mkdir(parents=True, exist_ok=True)
    try:
        fork = fork_capsule(capsule, dst=fork_dest_base / "child")
        forked_user_file = fork / "src" / "user_edits" / "tweak.py"
        assert forked_user_file.read_text() == USER_EDITS_FIXTURE
    finally:
        shutil.rmtree(fork_dest_base, ignore_errors=True)


def test_agent_trace_refuses_to_log_user_edits_writes(tmp_path):
    """The structured trace's append-only contract refuses any record that
    claims an action wrote to user_edits/. This is the trace-side belt to
    the implementation's suspenders — even if a future code path slipped a
    user_edits/ write through, the trace would refuse to record it, which
    is itself a visible failure mode."""
    writer = AgentTraceWriter(tmp_path / "agent_trace.md")
    with pytest.raises(AgentTraceError, match="user_edits"):
        writer.append(
            agent="someone",
            action="overwrite",
            files_touched=["src/user_edits/should_not_be_modified.py"],
        )


def test_repeated_export_then_fork_keeps_user_edits_stable(parent_capsule_with_user_edit):
    """Compose export + fork operations; user_edits content must remain
    stable across the chain."""
    capsule, user_file = parent_capsule_with_user_edit
    target = simulation_capsules_root() / f"_pytest-ue-chain-{uuid.uuid4().hex[:8]}"
    target.mkdir(parents=True, exist_ok=True)
    try:
        export_code(capsule, target)
        fork_dest = simulation_capsules_root() / f"_pytest-ue-chain-fork-{uuid.uuid4().hex[:8]}"
        fork_dest.mkdir(parents=True, exist_ok=True)
        try:
            fork_capsule(capsule, dst=fork_dest / "child")
            assert user_file.read_text() == USER_EDITS_FIXTURE
        finally:
            shutil.rmtree(fork_dest, ignore_errors=True)
    finally:
        shutil.rmtree(target, ignore_errors=True)
