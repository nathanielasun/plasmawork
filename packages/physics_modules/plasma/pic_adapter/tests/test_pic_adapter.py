"""Phase 7C PIC adapter — config validation."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_MODULE_ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "_pic_src", _MODULE_ROOT / "src" / "__init__.py"
)
assert spec is not None and spec.loader is not None
pic_mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = pic_mod
spec.loader.exec_module(pic_mod)
PICStepConfig = pic_mod.PICStepConfig


def test_config_accepts_supported_orders():
    for order in (1, 2, 3):
        cfg = PICStepConfig(particles_per_cell=10, deposition_order=order)
        assert cfg.deposition_order == order


def test_config_rejects_zero_particles():
    with pytest.raises(ValueError):
        PICStepConfig(particles_per_cell=0)


def test_config_rejects_unknown_order():
    with pytest.raises(ValueError):
        PICStepConfig(particles_per_cell=10, deposition_order=4)
