"""Visualization tool template.

Renders run data into a figure / animation. The default returns a
matplotlib ``Figure``; swap in plotly / bokeh if your downstream consumer
prefers those.
"""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class VisualizationTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("time", units="s")
        inputs.require_array("field")

    def run(self, inputs: ToolInput) -> ToolOutput:
        import matplotlib.pyplot as plt

        time = inputs["time"]
        field = inputs["field"]
        fig, ax = plt.subplots(figsize=(7, 4))
        ax.plot(time.magnitude, field.magnitude)
        ax.set_xlabel(f"time ({time.units!s})")
        ax.set_ylabel("field")
        fig.tight_layout()
        return ToolOutput({"figure": fig})


__all__ = ["VisualizationTemplate"]
