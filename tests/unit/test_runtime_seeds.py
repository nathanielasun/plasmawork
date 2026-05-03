"""Phase 1C — Deterministic seed handling tests."""

from __future__ import annotations

import numpy as np
import pytest
from simworkbench.runtime.seeds import SeedSet, derive


def test_same_inputs_produce_same_seeds():
    a = derive(0, "run-001")
    b = derive(0, "run-001")
    assert a == b
    assert a.physics == b.physics
    assert a.solver == b.solver


def test_different_run_ids_produce_different_seeds():
    a = derive(0, "run-A")
    b = derive(0, "run-B")
    assert a.physics != b.physics
    assert a.solver != b.solver


def test_different_base_seeds_produce_different_seeds():
    a = derive(0, "run")
    b = derive(1, "run")
    assert a.physics != b.physics


def test_streams_are_independent():
    s = derive(42, "run-001")
    assert s.physics != s.solver, "physics and solver streams must differ"


def test_numpy_generator_reproducibility():
    s = derive(7, "run-deterministic")
    g1 = s.numpy_generator("physics")
    g2 = s.numpy_generator("physics")
    a = g1.standard_normal(5)
    b = g2.standard_normal(5)
    np.testing.assert_array_equal(a, b)


def test_numpy_generator_unknown_stream_raises():
    s = derive(0, "x")
    with pytest.raises(ValueError, match="Unknown seed stream"):
        s.numpy_generator("nonsense")


def test_seedset_is_frozen():
    s = SeedSet(base_seed=1, run_id="r", physics=2, solver=3)
    # Frozen dataclasses raise dataclasses.FrozenInstanceError on mutation —
    # which is a subclass of AttributeError. We assert against AttributeError
    # so the test isn't tied to the dataclass internal exception name.
    with pytest.raises(AttributeError):
        s.physics = 99  # type: ignore[misc]
