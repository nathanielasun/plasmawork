"""Regression for `bugs_and_fixes/bugfixes.md` 2026-05-02 *Open workstream TODOs
broke the default test gate*.

Asserts the convention checker's two-mode contract:

1. **Default mode** is the hard gate. It must always exit 0. ``scripts/test/all.sh``
   calls this mode.
2. **Opt-in mode** (``--include-open-workstreams``) exposes any open
   implementation backlog. Phase 3 closed 2026-05-02 with every entity
   ratcheted into the default branch; no workstream is currently open, so
   opt-in mode also passes. When Phase 4 opens, the "no open workstreams"
   message will be replaced by failing assertions and these tests flip back
   to the "exits non-zero" form.

Update procedure when opening a new phase:
- Add a section under ``if [[ $INCLUDE_OPEN_WORKSTREAMS -eq 1 ]]`` in the
  checker with one assertion per open-workstream entity.
- Flip the assertions in this file to expect the failing form
  (``returncode == 1`` and a list of anchors that should appear missing).
- When closing the phase, ratchet the assertions into the default branch
  and flip these tests back to the "passes" form.
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


def test_opt_in_mode_passes_with_no_open_workstream() -> None:
    """No workstream is currently open — opt-in mode also passes.

    When Phase 4 opens (a new section under
    ``if [[ $INCLUDE_OPEN_WORKSTREAMS -eq 1 ]]``), flip this back to the
    "exits non-zero" form.
    """
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "Convention check PASSED" in output


def test_opt_in_mode_carries_no_open_anchors() -> None:
    """The "Open Workstream TODOs" section currently advertises that no
    workstream is open."""
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr
    assert "no open workstreams" in output


def test_opt_in_mode_check_count_at_least_default() -> None:
    """With no open workstream, both modes run the same number of checks."""
    default = _run_checker("--quiet")
    opt_in = _run_checker("--include-open-workstreams", "--quiet")
    import re

    def _ok_count(out: str) -> int:
        m = re.search(r"(\d+) check\(s\) ok", out)
        assert m, f"Could not parse check count from {out!r}"
        return int(m.group(1))

    default_count = _ok_count(default.stdout + default.stderr)
    opt_in_count = _ok_count(opt_in.stdout + opt_in.stderr)
    assert opt_in_count >= default_count
