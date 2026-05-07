"""Regression guards for deprecated phase-state contract drift.

Old phase stubs can survive as executable files or comments after later phases
ship. These checks pin the specific user-facing drift fixed on 2026-05-07.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _text(relative: str) -> str:
    return (REPO_ROOT / relative).read_text(encoding="utf-8")


def test_public_docs_do_not_advertise_obsolete_phase_commands() -> None:
    readme = _text("README.md")
    claude = _text("CLAUDE.md")

    forbidden = [
        "Runtime execution lands in Workstream 1C",
        "examples/krf_excimer/krf_excimer.lxp",
        "./scripts/export/capsule.sh <capsule_name>",
        "drives three new endpoints",
        "| 10 | Next |",
        "`--include-open-workstreams` is empty pending Phase 10",
    ]
    for needle in forbidden:
        assert needle not in readme + claude


def test_core_runtime_errors_do_not_tell_users_to_wait_for_closed_phases() -> None:
    runtime = _text("packages/core/src/simworkbench/runtime/python_cpu.py")
    core_init = _text("packages/core/src/simworkbench/__init__.py")

    forbidden = [
        "Phase 1 cannot parse rate constants",
        "Phase 1 has no rate-parser",
        "wait for Phase",
        "field-only interactions land in Phase",
        "higher-order kinetics land in Phase",
        "currently active",
        "Pending.",
    ]
    for needle in forbidden:
        assert needle not in runtime + core_init


def test_ui_code_viewer_uses_real_capsule_file_contract_not_placeholder_text() -> None:
    code_viewer = _text("apps/workbench-ui/src/components/CodeViewer.tsx")
    app_entrypoint = _text("apps/workbench-ui/src/app/page.tsx")

    assert "workbench shell skeleton" not in code_viewer
    assert "file content fetching is wired" not in code_viewer
    assert "Backend file fetch lands" not in code_viewer
    assert "Phase 0 placeholder" not in app_entrypoint
    assert "UI placeholder" not in app_entrypoint
    assert "getCapsuleFile" in code_viewer
    assert "getCapsuleTree" in code_viewer


def test_documented_security_helper_commands_exist_and_are_executable() -> None:
    for relative in (
        "scripts/dev/check_workspace_paths.sh",
        "scripts/dev/check_security_headers.sh",
        "scripts/dev/check_security_schema.sh",
    ):
        path = REPO_ROOT / relative
        assert path.is_file(), f"missing documented command: {relative}"
        assert os.access(path, os.X_OK), f"not executable: {relative}"


def test_postgres_bootstrap_stub_fails_closed() -> None:
    result = subprocess.run(
        [str(REPO_ROOT / "scripts" / "dev" / "postgres_up.sh")],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode != 0
    assert "no local Postgres bootstrap is configured" in result.stdout
    assert "security_live_db.sh" in result.stdout


def test_performance_lane_is_not_empty_after_phase_close() -> None:
    perf_tests = list((REPO_ROOT / "tests" / "performance").glob("test_*.py"))
    assert perf_tests, "performance lane must contain at least one real test file"
    assert "No performance tests yet." not in _text("scripts/test/performance.sh")


def test_security_gate_dispatches_enabled_live_probe_lanes() -> None:
    security = _text("scripts/test/security.sh")

    assert "security_live_runsc.sh" in security
    assert "security_live_db.sh" in security
    assert "security_live_worm.sh" in security
    assert "will fire against PLASMAWORK_TEST_DB_URL" not in security
    assert "run scripts/test/security_live_worm.sh" not in security
