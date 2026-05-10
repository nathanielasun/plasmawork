"""Visualization-oriented tool implementation template."""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class {{TOOL_CLASS}}(BaseTool):
    name = "{{TOOL_NAME}}"
    version = "{{TOOL_VERSION}}"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("time", units="s")
        if "field" in inputs:
            inputs.require_array("field")
        elif "signal" in inputs:
            inputs.require_array("signal")

    def run(self, inputs: ToolInput) -> ToolOutput:
        import matplotlib.pyplot as plt

        time = inputs["time"]
        series = inputs["field"] if "field" in inputs else inputs["signal"]
        fig, ax = plt.subplots(figsize=(7, 4))
        ax.plot(time.magnitude, series.magnitude)
        ax.set_xlabel(f"time ({time.units!s})")
        ax.set_ylabel(str(series.units))
        ax.set_title(self.name.replace("_", " ").title())
        fig.tight_layout()
        return ToolOutput({"figure": fig})


__all__ = ["{{TOOL_CLASS}}"]
