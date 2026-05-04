"""Phase 7C — particle-pusher interface tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

_MODULE_ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "_pusher_src", _MODULE_ROOT / "src" / "__init__.py"
)
assert spec is not None and spec.loader is not None
pusher_mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = pusher_mod
spec.loader.exec_module(pusher_mod)
ParticlePusherStep = pusher_mod.ParticlePusherStep


def test_zero_field_inertial_motion():
    """No fields ⇒ x advances by v*dt, v unchanged."""
    pusher = ParticlePusherStep(
        mass_kg=np.array([1.0]),
        charge_C=np.array([1.0]),
    )
    x0 = np.array([[0.0, 0.0, 0.0]])
    v0 = np.array([[1.0, 0.0, 0.0]])
    E = np.zeros_like(x0)
    B = np.zeros_like(x0)
    x1, v1 = pusher.step(x0, v0, E, B, dt_seconds=1.0)
    np.testing.assert_allclose(v1, v0)
    np.testing.assert_allclose(x1, [[1.0, 0.0, 0.0]])


def test_negative_dt_raises():
    pusher = ParticlePusherStep(
        mass_kg=np.array([1.0]),
        charge_C=np.array([1.0]),
    )
    with pytest.raises(ValueError):
        pusher.step(
            np.zeros((1, 3)),
            np.zeros((1, 3)),
            np.zeros((1, 3)),
            np.zeros((1, 3)),
            dt_seconds=-0.1,
        )
