"""Phase 7C — electromagnetic-field interface tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q

_MODULE_ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "_em_field_src", _MODULE_ROOT / "src" / "__init__.py"
)
assert spec is not None and spec.loader is not None
em_mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = em_mod
spec.loader.exec_module(em_mod)
ElectromagneticField = em_mod.ElectromagneticField


def test_zeros_constructor_matches_grid_shape():
    em = ElectromagneticField.zeros(
        domain_extent=Q([0.1, 0.1, 0.1], "meter"),
        grid_resolution=Q([0.01, 0.01, 0.01], "meter"),
    )
    assert em.grid_shape == (10, 10, 10)
    assert em.E.shape == (10, 10, 10, 3)
    assert em.B.shape == (10, 10, 10, 3)


def test_mismatched_E_B_shapes_raises():
    import numpy as np

    with pytest.raises(ValueError, match="shape mismatch"):
        ElectromagneticField(
            domain_extent=Q([1.0, 1.0, 1.0], "meter"),
            grid_resolution=Q([0.1, 0.1, 0.1], "meter"),
            E=np.zeros((10, 10, 10, 3)),
            B=np.zeros((5, 10, 10, 3)),
        )


def test_wrong_vector_dimensionality_raises():
    import numpy as np

    with pytest.raises(ValueError, match="3 vector components"):
        ElectromagneticField(
            domain_extent=Q([1.0, 1.0, 1.0], "meter"),
            grid_resolution=Q([0.1, 0.1, 0.1], "meter"),
            E=np.zeros((10, 10, 10, 2)),
            B=np.zeros((10, 10, 10, 2)),
        )
