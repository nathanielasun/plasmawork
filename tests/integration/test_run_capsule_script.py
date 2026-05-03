"""Regression test for the post-Phase-2-close finding "scripts/dev/
run_capsule.sh is still a Phase-0 stub".

The Phase 2 gate requires capsules to be portable, inspectable,
*reloadable*, and exportable. README documents `scripts/dev/run_capsule.sh
<capsule.lxp>` as the canonical reload entrypoint, so this test exercises
that script end-to-end on a real saved capsule.
"""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "dev" / "run_capsule.sh"


@pytest.fixture
def saved_capsule():
    from simworkbench.experiment import Experiment, RunConfig
    from simworkbench.model_spec import load_yaml
    from simworkbench.paths import simulation_capsules_root
    from simworkbench.runtime import Runner
    from simworkbench.serialization import save_capsule

    spec = load_yaml(REPO_ROOT / "examples" / "simple_rate_equations" / "model.yaml")
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=5),
    )
    result = Runner(exp).run()
    base = simulation_capsules_root() / f"_pytest-runscript-{uuid.uuid4().hex[:8]}"
    base.mkdir(parents=True, exist_ok=True)
    capsule_dir = save_capsule(experiment=exp, result=result, base=base)
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_run_capsule_script_reloads_and_runs(saved_capsule):
    """The script must (1) exit 0, (2) print run_id and state lines."""
    proc = subprocess.run(
        [str(SCRIPT), str(saved_capsule)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    out = proc.stdout
    assert "run_id" in out
    assert "state" in out
    assert "final_simulation_time" in out


def test_run_capsule_script_help_when_no_args():
    """No args -> usage + exit 2 (the standard convention for usage errors)."""
    proc = subprocess.run(
        [str(SCRIPT)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 2


def test_run_capsule_script_is_not_stub():
    """Regression: the script must NOT be the Phase-0 stub. The stub
    printed `Capsule loading is scheduled for Phase 2.` and exited 2.
    """
    text = SCRIPT.read_text()
    assert "scheduled for Phase 2" not in text
    assert "load_capsule" in text
