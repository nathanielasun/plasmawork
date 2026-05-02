"""Regression for `bugs_and_fixes/bugfixes.md` 2026-05-02 *Open workstream TODOs
broke the default test gate*.

Asserts the convention checker's two-mode contract:

1. **Default mode** is the hard gate. It must always exit 0 while Phase 1
   workstreams are open. ``scripts/test/all.sh`` calls this mode.
2. **Opt-in mode** (``--include-open-workstreams``) exposes the implementation
   backlog. It exits 1 while any workstream remains open. The exact failure
   count shrinks as work lands; this test does not pin it. Instead it
   asserts a stable subset of opt-in TODO anchors that won't all close at
   once — at least one of the listed anchors must appear in the output.
"""

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
    """Hard gate — default mode must stay green while open workstreams exist."""
    result = _run_checker("--quiet")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Convention check PASSED" in result.stdout


def test_open_workstream_todo_mode_exits_nonzero_with_failures() -> None:
    """Opt-in mode exposes the backlog: exits 1, names "FAILED"."""
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr
    assert result.returncode == 1
    assert "Convention check FAILED" in output


def test_open_workstream_todo_mode_lists_known_open_anchors() -> None:
    """At least one of these stable open-anchor entities is currently failing.

    The list intentionally spans 1D, 1E, and 1F so that no single workstream
    closure makes all of them pass at once. Update this list when *every*
    listed anchor has been implemented (i.e. when Phase 1 is essentially
    closed).
    """
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr

    open_anchors = (
        # Workstream 1D — module template and the seven physics modules.
        "packages/physics_modules/templates/module_template/module.yaml",
        "packages/physics_modules/laser/gaussian_pulse/module.yaml",
        "packages/physics_modules/phase_transition/ising_2d/module.yaml",
        # Workstream 1E — plotters.
        "packages/core/src/simworkbench/diagnostics/plotters/line.py",
        # Workstream 1F — UI components.
        "apps/workbench-ui/src/components/SimulationList.tsx",
        "program_development/architectural_decisions/ADR-0005-ui-framework.md",
    )

    # At least half should still be failing — if fewer, Phase 1 is nearly
    # complete and this test should be updated alongside the close commit.
    found = [a for a in open_anchors if a in output]
    assert len(found) >= 3, (
        f"Only {len(found)}/{len(open_anchors)} open anchors found in opt-in "
        f"output; either Phase 1 is nearly closed (update this test) or the "
        f"opt-in section regressed.\n\nFound: {found}\nMissing: "
        f"{[a for a in open_anchors if a not in found]}"
    )
