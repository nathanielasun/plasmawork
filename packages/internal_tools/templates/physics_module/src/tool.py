"""Physics-module tool template.

Wraps a physical model — laser pulse, photoionization rate, collisional
model — as a registry-discoverable tool. Physics modules under
``packages/physics_modules/<domain>/<name>/`` are the canonical home
for new models; this template is for one-off models that fit better in
the tool registry than in a versioned physics-module directory.

If your model has a validity domain, declare it in ``tool.yaml``'s
``compatible_domains`` and refuse inputs outside that domain in
``validate_inputs`` (raise ToolIOError). Never silently extrapolate.
"""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class PhysicsModuleTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require("parameters")

    def run(self, inputs: ToolInput) -> ToolOutput:
        # Replace with your model's evaluation. Keep units pin: every
        # numerical input/output that crosses the boundary uses
        # `simworkbench.units.Q(value, "<unit>")`.
        return ToolOutput({"result": inputs["parameters"]})


__all__ = ["PhysicsModuleTemplate"]
