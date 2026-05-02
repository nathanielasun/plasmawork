"""Phase 1C — Progress reporting tests."""

from __future__ import annotations

import pytest

from simworkbench.runtime.progress import ProgressTracker, ProgressUpdate


def test_update_records_step_and_fraction():
    t = ProgressTracker()
    u = t.update(step=10, total=100, message="working")
    assert u.step == 10
    assert u.total == 100
    assert u.fraction == pytest.approx(0.1)
    assert u.message == "working"


def test_update_without_total_yields_none_fraction():
    t = ProgressTracker()
    u = t.update(step=5)
    assert u.fraction is None


def test_update_is_monotonic_in_step():
    t = ProgressTracker()
    t.update(step=2, total=10)
    with pytest.raises(ValueError, match="Progress regression"):
        t.update(step=1, total=10)


def test_callbacks_receive_each_update():
    t = ProgressTracker()
    received: list[ProgressUpdate] = []
    t.add_callback(received.append)
    t.update(step=1, total=10)
    t.update(step=2, total=10)
    assert [u.step for u in received] == [1, 2]


def test_finish_sets_terminal_fraction_and_blocks_further_updates():
    t = ProgressTracker()
    t.update(step=5, total=10)
    final = t.finish(message="done")
    assert final.fraction == pytest.approx(1.0)
    assert t.finished is True
    with pytest.raises(RuntimeError, match="after finish"):
        t.update(step=6, total=10)


def test_finish_without_prior_update_emits_terminal_anyway():
    t = ProgressTracker()
    final = t.finish()
    assert final.fraction == pytest.approx(1.0)
    assert t.finished is True


def test_snapshot_returns_latest():
    t = ProgressTracker()
    assert t.snapshot() is None
    t.update(step=3, total=4)
    snap = t.snapshot()
    assert snap is not None and snap.step == 3
