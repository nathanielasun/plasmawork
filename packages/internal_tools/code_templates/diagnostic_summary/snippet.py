"""Diagnostic summary implementation template."""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class {{TOOL_CLASS}}(BaseTool):
    name = "{{TOOL_NAME}}"
    version = "{{TOOL_VERSION}}"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("time", units="s")
        inputs.require_array("signal")

    def run(self, inputs: ToolInput) -> ToolOutput:
        signal = inputs["signal"]
        values = signal.magnitude
        return ToolOutput(
            {
                "summary": [
                    {
                        "samples": int(values.size),
                        "min": float(values.min()),
                        "max": float(values.max()),
                        "mean": float(values.mean()),
                        "units": str(signal.units),
                    }
                ]
            }
        )


__all__ = ["{{TOOL_CLASS}}"]
