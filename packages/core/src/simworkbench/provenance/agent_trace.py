"""Phase 2B — Agent-action trace writer.

``provenance/agent_trace.md`` is the chronological log of every agent action
that touched a capsule. It is **append-only** by contract per AGENTS.md
"Off-Limits Directories" — the writer here refuses to overwrite existing
content and refuses to record any action that targets ``<capsule>/src/
user_edits/`` (carries the existing `agent_error_patterns.md` "Overwriting
`<capsule>/src/user_edits/`" pattern into Phase 2's structured trace).

Records are markdown lines so a human can read them without tooling, but
the writer enforces the structure (timestamp, agent identifier, action,
files touched).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


class AgentTraceError(ValueError):
    """Raised when an agent_trace write violates the append-only or
    user_edits contracts."""


@dataclass(frozen=True)
class TraceEntry:
    """One agent_trace.md row."""

    timestamp_iso: str
    agent: str
    action: str
    files_touched: tuple[str, ...] = ()
    notes: str = ""

    def render_markdown(self) -> str:
        files_str = ", ".join(self.files_touched) if self.files_touched else ""
        # Single-line markdown row keeps the file diffable.
        line = f"- {self.timestamp_iso} | agent=`{self.agent}` | action=`{self.action}`"
        if files_str:
            line += f" | files=`{files_str}`"
        if self.notes:
            line += f" — {self.notes}"
        return line


class AgentTraceWriter:
    """Append-only writer for ``provenance/agent_trace.md``.

    Use::

        writer = AgentTraceWriter(capsule_dir / "provenance" / "agent_trace.md")
        writer.append(agent="codegen-1", action="regenerated solver",
                      files_touched=["src/generated/runner.py"])
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text(self._header(), encoding="utf-8")

    @staticmethod
    def _header() -> str:
        return (
            "# Agent trace\n\n"
            "Append-only chronological log of agent actions on this capsule. "
            "Per AGENTS.md, this file MUST NOT be overwritten or rewritten in "
            "place — only appended. Writes that target `<capsule>/src/user_edits/` "
            "are refused at the writer (`agent_error_patterns.md` "
            "*Overwriting `<capsule>/src/user_edits/` during regeneration*).\n\n"
        )

    def append(
        self,
        *,
        agent: str,
        action: str,
        files_touched: Iterable[str] = (),
        notes: str = "",
    ) -> TraceEntry:
        """Add one entry. Refuses files under `src/user_edits/`."""
        files = tuple(files_touched)
        for f in files:
            normalized = f.replace("\\", "/")
            if "/user_edits/" in normalized or normalized.startswith("user_edits/"):
                raise AgentTraceError(
                    f"Agent trace refuses to record an action that targets "
                    f"`<capsule>/src/user_edits/` ({f!r}). user_edits/ is owned "
                    "by the user — see agent_error_patterns.md "
                    "'Overwriting <capsule>/src/user_edits/ during regeneration'."
                )
        entry = TraceEntry(
            timestamp_iso=datetime.now(UTC).isoformat(timespec="microseconds"),
            agent=agent,
            action=action,
            files_touched=files,
            notes=notes,
        )
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(entry.render_markdown() + "\n")
        return entry

    def entries(self) -> tuple[TraceEntry, ...]:
        """Parse existing rows back into ``TraceEntry`` objects.

        The parser is lenient: malformed rows are skipped (with the rest
        preserved). Use this for read-only inspection in the UI.
        """
        if not self.path.exists():
            return ()
        out: list[TraceEntry] = []
        for raw in self.path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line.startswith("- "):
                continue
            entry = _parse_entry_line(line)
            if entry is not None:
                out.append(entry)
        return tuple(out)


def _parse_entry_line(line: str) -> TraceEntry | None:
    # Structure: "- <ts> | agent=`<a>` | action=`<x>` | files=`<f,...>` — <notes>"
    body = line[2:]  # drop the leading "- "

    # Split off the notes portion first — otherwise the trailing ` — notes`
    # ends up appended to the last `|`-segment (e.g. `files=\`...\``) and the
    # value extractor misses its closing backtick.
    notes = ""
    if " — " in body:
        body, notes = body.rsplit(" — ", 1)

    parts = [p.strip() for p in body.split("|")]
    if len(parts) < 3:
        return None
    timestamp_iso = parts[0]
    rest = parts[1:]

    def _value(key: str) -> str | None:
        prefix = f"{key}=`"
        for p in rest:
            if p.startswith(prefix) and p.endswith("`"):
                return p[len(prefix) : -1]
        return None

    agent = _value("agent")
    action = _value("action")
    if agent is None or action is None:
        return None
    files_str = _value("files") or ""
    files = tuple(f.strip() for f in files_str.split(",")) if files_str else ()

    return TraceEntry(
        timestamp_iso=timestamp_iso,
        agent=agent,
        action=action,
        files_touched=files,
        notes=notes,
    )


__all__ = ["AgentTraceError", "AgentTraceWriter", "TraceEntry"]
