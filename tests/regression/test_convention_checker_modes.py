from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "dev" / "check_repo_conventions.sh"


def _run_checker(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(CHECKER), *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_default_convention_checker_excludes_open_workstream_todos() -> None:
    result = _run_checker("--quiet")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Convention check PASSED" in result.stdout


def test_open_workstream_todo_mode_tracks_current_phase_1_backlog() -> None:
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr

    assert result.returncode == 1
    assert "60 failure(s), 142 check(s) ok" in output
    assert "tests/unit/test_runtime_progress.py" in output
    assert "scripts/dev/run_backend.sh is no longer the Phase-0 stub" in output
    assert "packages/physics_modules/templates/module_template/src/__init__.py" in output
    assert "packages/physics_modules/templates/module_template/tests/test_template.py" in output
