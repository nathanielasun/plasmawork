"""Regression for `bugs_and_fixes/bugfixes.md` 2026-05-02 *Open workstream TODOs
broke the default test gate*.

Asserts the convention checker's two-mode contract:

1. **Default mode** is the hard gate. It must always exit 0. ``scripts/test/all.sh``
   calls this mode.
2. **Opt-in mode** (``--include-open-workstreams``) exposes any open
   implementation backlog. While Phase 1 was open it returned non-zero with
   the failing TODO list; now that Phase 1 is complete it also exits 0.
   When the next phase opens its workstreams, this test will fail until it is
   updated to reflect the new backlog — that's the explicit ratchet point.

Update procedure when opening a new phase:
- Add a test like ``test_opt_in_mode_lists_known_open_anchors`` checking that
  at least one expected open-anchor entity from the newly-opened
  workstream(s) appears in opt-in output.
- When closing the phase, drop that test or replace it with the "passes"
  variant below.
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
    """Hard gate — default mode must stay green."""
    result = _run_checker("--quiet")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Convention check PASSED" in result.stdout


def test_opt_in_mode_passes_when_no_workstreams_open() -> None:
    """Phase 1 is complete; opt-in mode currently exposes no failing TODOs.

    When the next phase opens workstreams, replace this with a test that
    asserts opt-in mode returns non-zero with the new backlog.
    """
    result = _run_checker("--include-open-workstreams")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Convention check PASSED" in result.stdout


def test_opt_in_mode_check_count_at_least_default() -> None:
    """Opt-in mode runs at least as many checks as default mode.

    Today (Phase 1 complete) opt-in adds zero failing assertions but still
    runs all the closed-workstream entity assertions. This test guards
    against accidentally removing the opt-in section entirely — if a future
    refactor drops it, the count delta would go negative.
    """
    default = _run_checker("--quiet")
    opt_in = _run_checker("--include-open-workstreams", "--quiet")
    # Last lines look like "Convention check PASSED — N check(s) ok." or
    # "Convention check FAILED — F failure(s), N check(s) ok.". Extract N.
    import re

    def _ok_count(out: str) -> int:
        m = re.search(r"(\d+) check\(s\) ok", out)
        assert m, f"Could not parse check count from {out!r}"
        return int(m.group(1))

    default_count = _ok_count(default.stdout + default.stderr)
    opt_in_count = _ok_count(opt_in.stdout + opt_in.stderr)
    assert opt_in_count >= default_count
