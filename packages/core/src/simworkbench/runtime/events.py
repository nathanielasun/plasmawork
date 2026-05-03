"""Runtime event/log system.

Structured events emitted by the runner. The format mirrors
``bugs_and_fixes/program.log.example`` so the same renderer / log file can
consume both program startup events and per-run runtime events.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

EventLevel = str  # one of "DEBUG", "INFO", "WARN", "ERROR"
_VALID_LEVELS = ("DEBUG", "INFO", "WARN", "ERROR")


@dataclass(frozen=True)
class Event:
    """A single runtime event.

    ``timestamp_iso`` is set at construction and is always UTC (timezone-aware).
    ``data`` carries arbitrary structured fields — keep it JSON-serializable.
    """

    level: EventLevel
    subsystem: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    timestamp_iso: str = ""

    def __post_init__(self) -> None:
        if self.level not in _VALID_LEVELS:
            raise ValueError(
                f"Event level {self.level!r} not in {_VALID_LEVELS}."
            )
        if not self.timestamp_iso:
            # Bypass frozen-dataclass restriction with object.__setattr__.
            object.__setattr__(
                self,
                "timestamp_iso",
                datetime.now(UTC).isoformat(timespec="microseconds"),
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True)


EventListener = Callable[[Event], None]


class EventBus:
    """Synchronous in-process event bus.

    Subscribers receive every event in arrival order. The bus is intentionally
    synchronous for Phase 1 — async streaming is a Phase 1E concern (see
    `simworkbench.diagnostics.streams`).
    """

    def __init__(self) -> None:
        self._listeners: list[EventListener] = []
        self._history: list[Event] = []

    def subscribe(self, listener: EventListener) -> Callable[[], None]:
        """Register ``listener``; return an unsubscribe callable."""
        self._listeners.append(listener)

        def _unsubscribe() -> None:
            try:
                self._listeners.remove(listener)
            except ValueError:
                pass

        return _unsubscribe

    def emit(
        self,
        level: EventLevel,
        subsystem: str,
        message: str,
        **data: Any,
    ) -> Event:
        event = Event(level=level, subsystem=subsystem, message=message, data=dict(data))
        self._history.append(event)
        for listener in list(self._listeners):
            listener(event)
        return event

    def history(self) -> Iterable[Event]:
        """Return an iterable view of the events emitted so far (most-recent-last)."""
        return tuple(self._history)


__all__ = ["Event", "EventBus", "EventLevel", "EventListener"]
