"""Progress reporting.

Two interfaces:

- A callback contract: ``ProgressCallback(progress: ProgressUpdate) -> None``.
- A queryable ``ProgressTracker`` whose snapshot reflects the latest update.

The 1F UI consumes the tracker via a generator-style ``stream()`` method that
yields a snapshot whenever progress advances.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProgressUpdate:
    """One progress observation.

    ``step`` and ``total`` describe the current iteration; ``fraction`` is the
    convenience field ``step / total`` clamped to [0, 1] (or ``None`` when the
    total isn't known yet — e.g. adaptive integrators). ``message`` carries a
    human-readable phase label.
    """

    step: int
    total: int | None
    fraction: float | None
    message: str = ""
    elapsed_seconds: float = 0.0


ProgressCallback = Callable[[ProgressUpdate], None]


@dataclass
class ProgressTracker:
    """Stateful progress tracker.

    The tracker owns the latest update; ``stream()`` is a Python generator that
    yields snapshots as they advance (callers consume via ``for u in
    tracker.stream(): ...``). Termination is signalled by ``finish()``.
    """

    callbacks: list[ProgressCallback] = field(default_factory=list)
    _latest: ProgressUpdate | None = None
    _finished: bool = False

    def add_callback(self, callback: ProgressCallback) -> None:
        self.callbacks.append(callback)

    def update(
        self,
        step: int,
        total: int | None = None,
        message: str = "",
        elapsed_seconds: float = 0.0,
    ) -> ProgressUpdate:
        """Record progress. Monotonic in ``step`` — regressions raise."""
        if self._finished:
            raise RuntimeError("ProgressTracker.update() after finish().")
        if self._latest is not None and step < self._latest.step:
            raise ValueError(
                f"Progress regression: step {step} < previous step {self._latest.step}."
            )
        fraction: float | None
        if total is not None and total > 0:
            fraction = max(0.0, min(1.0, step / total))
        else:
            fraction = None
        update = ProgressUpdate(
            step=step,
            total=total,
            fraction=fraction,
            message=message,
            elapsed_seconds=elapsed_seconds,
        )
        self._latest = update
        for cb in list(self.callbacks):
            cb(update)
        return update

    def finish(self, message: str = "") -> ProgressUpdate:
        """Mark the tracker complete and emit a terminal update with fraction=1.0."""
        if self._finished:
            return self.snapshot() or ProgressUpdate(0, None, 1.0, message)
        if self._latest is not None and self._latest.total is not None:
            final = self._latest.total
        elif self._latest is not None:
            final = self._latest.step
        else:
            final = 0
        terminal = ProgressUpdate(
            step=final,
            total=final,
            fraction=1.0,
            message=message or (self._latest.message if self._latest else ""),
            elapsed_seconds=self._latest.elapsed_seconds if self._latest else 0.0,
        )
        self._latest = terminal
        self._finished = True
        for cb in list(self.callbacks):
            cb(terminal)
        return terminal

    def snapshot(self) -> ProgressUpdate | None:
        return self._latest

    @property
    def finished(self) -> bool:
        return self._finished


__all__ = ["ProgressCallback", "ProgressTracker", "ProgressUpdate"]
