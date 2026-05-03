"""Phase 3A — ToolInput/ToolOutput tests."""

from __future__ import annotations

import pytest
from simworkbench.tools import ToolInput, ToolIOError, ToolOutput
from simworkbench.units import Q


def test_tool_input_is_read_only_mapping():
    inp = ToolInput({"a": 1, "b": "x"})
    assert inp["a"] == 1
    assert inp["b"] == "x"
    assert len(inp) == 2
    assert sorted(inp) == ["a", "b"]


def test_tool_input_missing_key_raises():
    inp = ToolInput({"a": 1})
    with pytest.raises(KeyError, match="missing required key"):
        inp["b"]
    with pytest.raises(ToolIOError, match="Required tool input missing"):
        inp.require("b")


def test_require_array_accepts_quantity():
    inp = ToolInput({"f": Q(1.0, "Hz")})
    out = inp.require_array("f", units="Hz")
    assert out.magnitude == pytest.approx(1.0)


def test_require_array_rejects_bare_value():
    inp = ToolInput({"f": 1.0})
    with pytest.raises(ToolIOError, match="unit-aware"):
        inp.require_array("f", units="Hz")


def test_require_array_rejects_dimensionality_mismatch():
    inp = ToolInput({"f": Q(1.0, "kg")})
    with pytest.raises(ToolIOError, match="dimensionality"):
        inp.require_array("f", units="Hz")


def test_require_array_no_units_arg_just_checks_quantity():
    """Without ``units`` we still require a Quantity but skip the dim check."""
    inp = ToolInput({"x": Q(1.0, "kg")})
    out = inp.require_array("x")
    assert out.magnitude == pytest.approx(1.0)


def test_tool_output_to_dict_is_a_copy():
    out = ToolOutput({"a": 1})
    d = out.to_dict()
    d["a"] = 99
    assert out["a"] == 1


def test_tool_output_iter_and_len():
    out = ToolOutput({"a": 1, "b": 2})
    assert len(out) == 2
    assert sorted(out) == ["a", "b"]
