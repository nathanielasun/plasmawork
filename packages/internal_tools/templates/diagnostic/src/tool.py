"""Diagnostic tool template.

Replace ``DiagnosticTemplate`` with your tool name (and update
``tool.yaml``'s ``entrypoint`` to match). Diagnostic tools read run
diagnostics + parameters and emit derived metrics — peak finders,
energy budgets, density histograms, etc.
"""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class DiagnosticTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("time", units="s")
        inputs.require_array("signal")

    def run(self, inputs: ToolInput) -> ToolOutput:
        time = inputs["time"]
        signal = inputs["signal"]
        # Replace this stub with your real metric. The contract is: return
        # a ToolOutput whose keys match the `outputs:` declared in tool.yaml.
        return ToolOutput(
            {
                "summary": [
                    {
                        "n_samples": int(time.size),
                        "signal_min": float(signal.min().magnitude),
                        "signal_max": float(signal.max().magnitude),
                    }
                ]
            }
        )


__all__ = ["DiagnosticTemplate"]
