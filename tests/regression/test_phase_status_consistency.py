"""Regression for `agent_error_patterns.md` "Duplicated phase status across
nearby paragraphs".

The Phase 2 close shipped a README that said "Phase 2 — Simulation Capsule
System complete" at the top and "Phase 2 | In progress (2A, 2B, 2C, 2D
open)" twenty-eight lines later. The status-flip commit had updated the
banner but not the table.

This test scans status-bearing files for forbidden phrase pairs that
indicate the kind of intra-file drift the audit caught.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _no_open_workstream_phrase_in_completed_phase(text: str, phase: int) -> tuple[bool, str]:
    """A file claims phase ``phase`` is complete and *also* claims it has
    open workstreams — return (False, offending_excerpt).
    """
    completion_re = re.compile(
        rf"Phase\s*{phase}\s*[—\-:|].*?(complete|Complete)",
        re.IGNORECASE,
    )
    in_progress_re = re.compile(
        rf"Phase\s*{phase}\s*[—\-:|].*?(In progress|in progress|open)",
        re.IGNORECASE,
    )
    if completion_re.search(text) and in_progress_re.search(text):
        match = in_progress_re.search(text)
        return False, match.group(0) if match else "(unknown)"
    return True, ""


def test_readme_phase_status_is_consistent():
    """README must not simultaneously claim Phase N is complete in one
    paragraph and "In progress" / "open" in another. Phase 2 specifically
    was the original failure mode."""
    text = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    for phase in (0, 1, 2):
        ok, excerpt = _no_open_workstream_phrase_in_completed_phase(text, phase)
        assert ok, (
            f"README claims Phase {phase} is complete in one paragraph but "
            f"open in another (excerpt: {excerpt!r}). The status-flip commit "
            "must update every Phase reference, not just the banner."
        )


def test_claude_md_phase_status_is_consistent():
    text = (REPO_ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    for phase in (0, 1, 2):
        ok, excerpt = _no_open_workstream_phrase_in_completed_phase(text, phase)
        assert ok, (
            f"CLAUDE.md claims Phase {phase} is complete in one paragraph "
            f"but open in another (excerpt: {excerpt!r})."
        )
