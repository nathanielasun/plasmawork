"""Validation tool template.

Runs a check (conservation, convergence, benchmark comparison) and
reports pass/fail with structured violations. Per AGENTS.md: never lower
tolerances to make a failing check pass — fix the underlying issue or
mark the case ``known_failure`` with an explanation.
"""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class ValidationTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("observations")
        inputs.require("tolerance")

    def run(self, inputs: ToolInput) -> ToolOutput:
        observations = inputs["observations"].magnitude
        tolerance = float(inputs["tolerance"])
        violations = []
        for i, value in enumerate(observations):
            if abs(value) > tolerance:
                violations.append({"index": i, "value": float(value)})
        return ToolOutput({"passed": not violations, "violations": violations})


__all__ = ["ValidationTemplate"]
