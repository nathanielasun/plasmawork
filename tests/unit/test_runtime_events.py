"""Phase 1C — Event/log system tests."""

from __future__ import annotations

import json

import pytest

from simworkbench.runtime.events import Event, EventBus


def test_event_construction_sets_iso_timestamp():
    ev = Event(level="INFO", subsystem="runtime", message="hello")
    assert ev.timestamp_iso  # not empty
    assert "T" in ev.timestamp_iso  # ISO 8601


def test_event_rejects_unknown_level():
    with pytest.raises(ValueError, match="Event level"):
        Event(level="VERBOSE", subsystem="x", message="y")


def test_event_to_json_roundtrip():
    ev = Event(level="INFO", subsystem="x", message="m", data={"k": 1})
    parsed = json.loads(ev.to_json())
    assert parsed["level"] == "INFO"
    assert parsed["data"] == {"k": 1}


def test_eventbus_emit_orders_listeners():
    bus = EventBus()
    received: list[Event] = []
    bus.subscribe(received.append)
    bus.emit("INFO", "x", "first")
    bus.emit("INFO", "x", "second")
    assert [e.message for e in received] == ["first", "second"]


def test_eventbus_history_returns_chronological():
    bus = EventBus()
    bus.emit("INFO", "x", "a")
    bus.emit("WARN", "x", "b")
    bus.emit("ERROR", "x", "c")
    msgs = [e.message for e in bus.history()]
    assert msgs == ["a", "b", "c"]


def test_eventbus_unsubscribe_stops_delivery():
    bus = EventBus()
    received: list[Event] = []
    unsubscribe = bus.subscribe(received.append)
    bus.emit("INFO", "x", "first")
    unsubscribe()
    bus.emit("INFO", "x", "second")
    assert [e.message for e in received] == ["first"]


def test_eventbus_emit_returns_event_with_kwargs():
    bus = EventBus()
    ev = bus.emit("INFO", "runtime", "ready", run_id="abc", base_seed=7)
    assert ev.data == {"run_id": "abc", "base_seed": 7}
