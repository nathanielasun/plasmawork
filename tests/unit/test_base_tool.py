"""Phase 3A — BaseTool tests."""

from __future__ import annotations

import pytest
from simworkbench.tools import BaseTool, ToolInput, ToolIOError, ToolOutput
from simworkbench.units import Q


class _AddOne(BaseTool):
    """Tiny test tool: adds 1 Hz to its frequency input."""

    name = "_add_one"
    version = "0.0.1"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("frequency", units="Hz")

    def run(self, inputs: ToolInput) -> ToolOutput:
        f = inputs["frequency"]
        return ToolOutput({"frequency_plus_one": f + Q(1, "Hz")})


def test_execute_runs_validate_then_run():
    tool = _AddOne()
    out = tool.execute(frequency=Q(5.0, "Hz"))
    assert out["frequency_plus_one"].magnitude == pytest.approx(6.0)


def test_execute_rejects_missing_input():
    tool = _AddOne()
    with pytest.raises(ToolIOError, match="missing"):
        tool.execute()


def test_execute_rejects_unit_mismatch():
    """Frequency in seconds should be refused by validate_inputs."""
    tool = _AddOne()
    with pytest.raises(ToolIOError, match="dimensionality"):
        tool.execute(frequency=Q(5.0, "s"))


def test_execute_rejects_bare_float_input():
    """Bare ints/floats at the tool boundary are refused — units only."""
    tool = _AddOne()
    with pytest.raises(ToolIOError, match="unit-aware"):
        tool.execute(frequency=5.0)


def test_run_must_return_tool_output():
    """A subclass that returns a dict (not ToolOutput) must raise."""

    class _Bad(BaseTool):
        name = "_bad"

        def validate_inputs(self, inputs: ToolInput) -> None:  # noqa: ARG002
            return None

        def run(self, inputs: ToolInput) -> ToolOutput:  # type: ignore[override]
            return {"x": 1}  # type: ignore[return-value]

    with pytest.raises(TypeError, match="ToolOutput"):
        _Bad().execute()


def test_basetool_is_abstract():
    """Calling BaseTool() directly is a TypeError because the abstracts
    aren't implemented — tools must subclass."""
    with pytest.raises(TypeError):
        BaseTool()  # type: ignore[abstract]
