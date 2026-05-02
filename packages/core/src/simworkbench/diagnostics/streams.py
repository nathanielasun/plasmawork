"""Live diagnostic streaming — Phase 1E.

Synchronous generator-style streams: callers iterate, the runner pushes.
This is the in-process bridge between a running simulation and the workbench
UI's plot panel (Phase 1F). Async / over-HTTP streaming is a Phase 1F /
Phase 2 concern; the in-process generator is enough for steering inside one
Python session.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from queue import Empty, Queue
from typing import Any


class DiagnosticStream:
    """In-process pub/sub stream of diagnostic samples.

    Producer side: ``stream.publish(event_dict)``.
    Consumer side: ``for sample in stream: ...`` blocks until a sample is
    available or ``stream.close()`` is called.

    Thread-safe enough for the Phase 1 manual workbench: the runner is a
    single thread, the UI consumer is another thread, both share one
    bounded queue. The ``maxsize`` guards against producers running away
    when no consumer is attached.
    """

    def __init__(self, maxsize: int = 1024) -> None:
        self._queue: Queue[Any] = Queue(maxsize=maxsize)
        self._closed = threading.Event()
        self._sentinel = object()

    def publish(self, sample: Any) -> None:
        if self._closed.is_set():
            raise RuntimeError("Cannot publish to a closed DiagnosticStream.")
        self._queue.put(sample)

    def close(self) -> None:
        self._closed.set()
        # Wake up any blocked consumer.
        self._queue.put(self._sentinel)

    @property
    def closed(self) -> bool:
        return self._closed.is_set()

    def __iter__(self) -> Iterator[Any]:
        while True:
            try:
                item = self._queue.get(timeout=0.05)
            except Empty:
                if self._closed.is_set():
                    return
                continue
            if item is self._sentinel:
                return
            yield item


__all__ = ["DiagnosticStream"]
