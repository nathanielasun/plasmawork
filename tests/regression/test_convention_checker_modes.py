"""Regression for `bugs_and_fixes/bugfixes.md` 2026-05-02 *Open workstream TODOs
broke the default test gate*.

Asserts the convention checker's two-mode contract:

1. **Default mode** is the hard gate. It must always exit 0. ``scripts/test/all.sh``
   calls this mode.
2. **Opt-in mode** (``--include-open-workstreams``) exposes any open
   implementation backlog. Phase 2 is currently open, so opt-in mode exits
   non-zero with the Phase 2 TODO list visible. When Phase 2 closes, this
   test flips back to "passes" — that's the explicit ratchet point.

Update procedure when opening a new phase:
- Update ``test_opt_in_mode_lists_known_open_anchors`` to point at entities
  from the newly-opened workstream(s).
- When closing a phase, either point the anchors at the next phase's
  entities (if it has been opened) or convert the test back to "passes" if
  no workstream is open.
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


def test_opt_in_mode_exits_nonzero_with_phase_2_backlog() -> None:
    """Phase 2 is open; opt-in mode exposes its TODO list and exits non-zero.

    When Phase 2 closes (with all its assertions promoted into the default
    branch), flip this test back to the "passes" form below.
    """
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr
    assert result.returncode == 1
    assert "Convention check FAILED" in output


def test_opt_in_mode_lists_known_open_anchors() -> None:
    """At least three of these stable Phase 2 open-anchor entities are
    currently failing. Spans 2A/2B/2C/2D so no single workstream closure
    flips them all green prematurely.

    When Phase 2 closes, update this list to point at Phase 3 entities (or
    drop the test entirely if no workstream is open).
    """
    result = _run_checker("--include-open-workstreams")
    output = result.stdout + result.stderr

    open_anchors = (
        # Workstream 2D — capsule UI components (the only remaining open
        # workstream now that 2A/2B/2C have shipped). When 2D closes, this
        # test flips to "passes" for the Phase 2 close commit.
        "apps/workbench-ui/src/components/capsule/ManifestView.tsx",
        "apps/workbench-ui/src/components/capsule/ModelSpecView.tsx",
        "apps/workbench-ui/src/components/capsule/CapsuleCodeView.tsx",
        "apps/workbench-ui/src/components/capsule/ResultsView.tsx",
        "apps/workbench-ui/src/components/capsule/ValidationView.tsx",
        "apps/workbench-ui/src/components/capsule/ProvenanceView.tsx",
        # 2D backend additions.
        "/api/capsules/{name}/validate",
    )

    found = [a for a in open_anchors if a in output]
    assert len(found) >= 3, (
        f"Only {len(found)}/{len(open_anchors)} open anchors found in opt-in "
        "output; either Phase 2 is nearly closed (update this test) or the "
        f"opt-in section regressed.\n\nFound: {found}\nMissing: "
        f"{[a for a in open_anchors if a not in found]}"
    )


def test_opt_in_mode_check_count_at_least_default() -> None:
    """Opt-in mode runs at least as many checks as default mode.

    Phase 2 is open: opt-in adds ~50 failing assertions (Phase 2 backlog)
    but still runs every default check. This guards against accidentally
    removing the opt-in section entirely.
    """
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
