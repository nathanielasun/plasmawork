"""Phase 2B — agent_trace.md writer tests.

Includes the regression for `agent_error_patterns.md` "Overwriting
`<capsule>/src/user_edits/`": the writer refuses to record any action that
targets ``user_edits/``, regardless of slash style.
"""

from __future__ import annotations

import pytest
from simworkbench.provenance import (
    AgentTraceError,
    AgentTraceWriter,
    TraceEntry,
)


def test_initial_writer_creates_header(tmp_path):
    target = tmp_path / "agent_trace.md"
    AgentTraceWriter(target)
    text = target.read_text(encoding="utf-8")
    assert "# Agent trace" in text
    assert "Append-only" in text


def test_append_records_in_order(tmp_path):
    writer = AgentTraceWriter(tmp_path / "agent_trace.md")
    writer.append(agent="a", action="action-1", files_touched=["src/generated/x.py"])
    writer.append(agent="b", action="action-2")
    entries = writer.entries()
    assert len(entries) == 2
    assert entries[0].agent == "a"
    assert entries[0].action == "action-1"
    assert entries[0].files_touched == ("src/generated/x.py",)
    assert entries[1].agent == "b"


def test_append_refuses_user_edits_path(tmp_path):
    writer = AgentTraceWriter(tmp_path / "agent_trace.md")
    with pytest.raises(AgentTraceError, match="user_edits"):
        writer.append(
            agent="codegen",
            action="overwrite",
            files_touched=["src/user_edits/runner.py"],
        )


def test_append_refuses_user_edits_with_backslashes(tmp_path):
    """Windows-style paths get normalized before the user_edits check."""
    writer = AgentTraceWriter(tmp_path / "agent_trace.md")
    with pytest.raises(AgentTraceError):
        writer.append(
            agent="codegen",
            action="overwrite",
            files_touched=["src\\user_edits\\runner.py"],
        )


def test_append_refuses_top_level_user_edits_prefix(tmp_path):
    writer = AgentTraceWriter(tmp_path / "agent_trace.md")
    with pytest.raises(AgentTraceError):
        writer.append(
            agent="codegen",
            action="overwrite",
            files_touched=["user_edits/x.py"],
        )


def test_writer_is_append_only_does_not_overwrite_existing_entries(tmp_path):
    target = tmp_path / "agent_trace.md"
    writer = AgentTraceWriter(target)
    writer.append(agent="a", action="first")
    text_after_first = target.read_text(encoding="utf-8")

    # New writer instance for the same path: still appends, doesn't reset.
    writer2 = AgentTraceWriter(target)
    writer2.append(agent="b", action="second")

    text_after_second = target.read_text(encoding="utf-8")
    # The second writer didn't truncate the first writer's content.
    assert text_after_second.startswith(text_after_first)


def test_render_markdown_format():
    entry = TraceEntry(
        timestamp_iso="2026-05-02T12:00:00+00:00",
        agent="codegen",
        action="generate",
        files_touched=("src/generated/runner.py", "configs/run_config.yaml"),
        notes="Phase 6 codegen run",
    )
    line = entry.render_markdown()
    assert line.startswith("- 2026-05-02T12:00:00+00:00")
    assert "agent=`codegen`" in line
    assert "action=`generate`" in line
    assert "src/generated/runner.py" in line
    assert "Phase 6 codegen run" in line


def test_entries_round_trip_through_render(tmp_path):
    writer = AgentTraceWriter(tmp_path / "agent_trace.md")
    writer.append(
        agent="codegen",
        action="generate",
        files_touched=["src/generated/runner.py"],
        notes="initial scaffold",
    )
    [entry] = writer.entries()
    assert entry.agent == "codegen"
    assert entry.action == "generate"
    assert entry.files_touched == ("src/generated/runner.py",)
    assert entry.notes == "initial scaffold"
