"""Diagnostics API.

Phase 1E core: ``Diagnostic`` (a single named time series) and
``DiagnosticCollector`` (a registry that subscribes to a Runner's events,
accumulates samples, and produces an inspectable report).

The runner emits diagnostic samples through its ``progress.update`` /
``step_once`` flow; the collector subscribes via ``Runner.events`` so it can
record the run's timeline as well.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Diagnostic:
    """One named diagnostic time series.

    ``name`` is a free string. ``unit`` is a unit string (e.g. ``"1 / m**3"``,
    or ``"dimensionless"``). ``times`` and ``values`` are parallel sequences;
    callers append in order.
    """

    name: str
    unit: str = "dimensionless"
    times: list[float] = field(default_factory=list)
    values: list[float] = field(default_factory=list)

    def append(self, t: float, value: float) -> None:
        self.times.append(float(t))
        self.values.append(float(value))

    def __len__(self) -> int:
        return len(self.values)

    def latest(self) -> tuple[float, float] | None:
        if not self.values:
            return None
        return self.times[-1], self.values[-1]


@dataclass
class DiagnosticCollector:
    """Registers diagnostics and consumes runner output.

    Typical use::

        collector = DiagnosticCollector()
        collector.register("A", unit="1 / m**3")
        collector.register("B", unit="1 / m**3")
        collector.attach(runner)        # subscribes to runner.events
        runner.run()
        report = collector.report()     # dict[name, Diagnostic]
    """

    diagnostics: dict[str, Diagnostic] = field(default_factory=dict)
    _unsubscribers: list[Callable[[], None]] = field(default_factory=list)

    def register(self, name: str, unit: str = "dimensionless") -> Diagnostic:
        if name in self.diagnostics:
            raise ValueError(f"Diagnostic {name!r} already registered.")
        d = Diagnostic(name=name, unit=unit)
        self.diagnostics[name] = d
        return d

    def record(self, name: str, t: float, value: float) -> None:
        if name not in self.diagnostics:
            raise KeyError(f"Diagnostic {name!r} not registered.")
        self.diagnostics[name].append(t, value)

    def attach(self, runner: Any) -> None:
        """Subscribe to ``runner.events``. After ``runner.run()`` finishes,
        the collector's diagnostics will mirror the runner's recorded
        diagnostics for any name registered on the collector.

        For Phase 1E we read directly from ``runner.result().diagnostics``;
        this method exists so that future async / streaming runners have a
        stable subscription hook.
        """
        # Subscribe to events so we can sync at completion.
        def _on_event(event: Any) -> None:
            if event.subsystem == "runtime" and event.message == "run completed":
                self._sync_from_runner(runner)

        unsub = runner.events.subscribe(_on_event)
        self._unsubscribers.append(unsub)

    def _sync_from_runner(self, runner: Any) -> None:
        """Pull recorded diagnostics from the runner into our registered set."""
        result = runner.result()
        times = result.diagnostics.get("time_seconds", [])
        for name, diag in self.diagnostics.items():
            samples = result.diagnostics.get(name)
            if samples is None:
                continue
            # Skip the time series itself.
            if name == "time_seconds":
                continue
            n = min(len(times), len(samples))
            for i in range(n):
                if i >= len(diag.times):
                    diag.append(times[i], samples[i])

    def detach(self) -> None:
        for unsub in self._unsubscribers:
            unsub()
        self._unsubscribers.clear()

    def report(self) -> dict[str, Diagnostic]:
        return dict(self.diagnostics)


__all__ = ["Diagnostic", "DiagnosticCollector"]
