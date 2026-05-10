"""Safe structured-diagram output template."""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class {{TOOL_CLASS}}(BaseTool):
    name = "{{TOOL_NAME}}"
    version = "{{TOOL_VERSION}}"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("time", units="s")

    def run(self, inputs: ToolInput) -> ToolOutput:
        diagram = {
            "title": "Tool data flow",
            "nodes": [
                {"id": "input", "label": "Input"},
                {"id": "validate", "label": "Validate"},
                {"id": "run", "label": "Run"},
                {"id": "output", "label": "Output"},
            ],
            "edges": [
                {"source": "input", "target": "validate", "label": "units"},
                {"source": "validate", "target": "run", "label": "accepted"},
                {"source": "run", "target": "output", "label": "artifact"},
            ],
        }
        return ToolOutput({"summary": [{"nodes": 4, "edges": 3}], "diagram": diagram})


__all__ = ["{{TOOL_CLASS}}"]
