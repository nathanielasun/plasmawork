"""Phase 7C boundary-condition library tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_MODULE_ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "_bc_src", _MODULE_ROOT / "src" / "__init__.py"
)
assert spec is not None and spec.loader is not None
bc_mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bc_mod
spec.loader.exec_module(bc_mod)


def test_known_kinds_are_loadable():
    for name in ("periodic", "conducting", "absorbing", "reflecting", "mirror"):
        kind = bc_mod.lookup(name)
        assert kind.name == name


def test_unknown_kind_raises():
    with pytest.raises(KeyError):
        bc_mod.lookup("not_a_kind")


def test_dimensionality_filter_excludes_mirror_for_1d():
    kinds = bc_mod.kinds_for_dimensionality(1)
    assert "mirror" not in kinds
    assert "periodic" in kinds


def test_mirror_supported_in_2d_and_3d():
    assert "mirror" in bc_mod.kinds_for_dimensionality(2)
    assert "mirror" in bc_mod.kinds_for_dimensionality(3)
